import { vi, describe, it, expect, beforeEach } from 'vitest';

// spotifyResolver.js es el único módulo que sabe que Spotify existe — se mockea
// config.js (para poder simular "sin credenciales") y el fetch global (nunca se pega a
// la Spotify API real). asyncLock.js (withLock) se deja real: es puro, sin efectos de
// red, y es justamente lo que evita la tormenta de renovaciones de token en paralelo que
// se pide probar acá.
const configMock = { spotifyClientId: 'client-id', spotifyClientSecret: 'client-secret' };
vi.mock('../src/config.js', () => ({ config: configMock }));

// Por defecto, sin refresh token guardado -- todos los tests existentes de este archivo
// ejercitan el camino de Client Credentials sin darse cuenta. Los tests de la sección
// "Authorization Code Flow" de más abajo lo pisan explícitamente.
const getSpotifyRefreshToken = vi.fn().mockResolvedValue(null);
const saveSpotifyRefreshToken = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/spotifyAuthStore.js', () => ({ getSpotifyRefreshToken, saveSpotifyRefreshToken }));

const {
  isSpotifyUrl,
  resolveSpotifyInput,
  SpotifyNotFoundError,
  SpotifyUnavailableError,
  SpotifyPrivateError,
  _resetTokenCacheForTests,
} = await import('../src/utils/spotifyResolver.js');

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function tokenResponse(token = 'token-1', expiresIn = 3600, extra = {}) {
  return jsonResponse(200, { access_token: token, expires_in: expiresIn, ...extra });
}

function fullTrack(overrides = {}) {
  return {
    name: 'Nightcall',
    artists: [{ name: 'Kavinsky' }],
    album: { name: 'OutRun', images: [{ url: 'https://img/outrun.jpg' }] },
    duration_ms: 257000,
    external_ids: { isrc: 'FR1234567890' },
    external_urls: { spotify: 'https://open.spotify.com/track/abc123' },
    type: 'track',
    ...overrides,
  };
}

beforeEach(() => {
  configMock.spotifyClientId = 'client-id';
  configMock.spotifyClientSecret = 'client-secret';
  _resetTokenCacheForTests();
  vi.stubGlobal('fetch', vi.fn());
  vi.useFakeTimers();
  getSpotifyRefreshToken.mockReset().mockResolvedValue(null);
  saveSpotifyRefreshToken.mockReset().mockResolvedValue(undefined);
});

describe('isSpotifyUrl — detección', () => {
  it('reconoce una URL de track', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(true);
  });
  it('reconoce una URL de playlist', () => {
    expect(isSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(true);
  });
  it('reconoce una URL de álbum', () => {
    expect(isSpotifyUrl('https://open.spotify.com/album/1weenld61qoidwYuZ1GESA')).toBe(true);
  });
  it('tolera query params (?si=...)', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123')).toBe(true);
  });
  it('tolera el prefijo intl-XX de los links compartidos desde la app', () => {
    expect(isSpotifyUrl('https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(true);
  });
  it('no confunde una URL de YouTube ni una URL cualquiera', () => {
    expect(isSpotifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isSpotifyUrl('https://example.com/track/123')).toBe(false);
    expect(isSpotifyUrl('no es una url')).toBe(false);
  });
});

describe('Track', () => {
  it('resuelve un track correctamente', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    const result = await resolveSpotifyInput('https://open.spotify.com/track/abc123', { requestedBy: { id: 'u1' }, maxTracks: 200 });

    expect(result.type).toBe('track');
    expect(result.tracks).toHaveLength(1);
    const track = result.tracks[0];
    expect(track.title).toBe('Nightcall');
    expect(track.artist).toBe('Kavinsky');
    expect(track.album).toBe('OutRun');
    expect(track.durationSec).toBe(257);
    expect(track.thumbnail).toBe('https://img/outrun.jpg');
    expect(track.isrc).toBe('FR1234567890');
    expect(track.source).toBe('spotify');
    expect(track.url).toBeNull(); // todavía sin fuente de audio -- eso lo resuelve musicSource, no acá
  });

  it('track inexistente (404) tira SpotifyNotFoundError con mensaje claro', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(resolveSpotifyInput('https://open.spotify.com/track/nope', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      SpotifyNotFoundError,
    );
  });

  it('metadata incompleta (sin name) se trata como no disponible', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, { ...fullTrack(), name: undefined }));

    await expect(resolveSpotifyInput('https://open.spotify.com/track/abc123', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      SpotifyUnavailableError,
    );
  });

  it('error de red/API genérico tira SpotifyUnavailableError, no un stack trace', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(500, {}));

    await expect(resolveSpotifyInput('https://open.spotify.com/track/abc123', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      SpotifyUnavailableError,
    );
  });
});

describe('Playlist', () => {
  it('playlist con canciones: pagina y normaliza cada item.item', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Synthwave hits', public: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 2,
          items: [{ item: fullTrack({ name: 'Nightcall' }) }, { item: fullTrack({ name: 'Genesis' }) }],
          next: null,
        }),
      );

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/xyz', { requestedBy: {}, maxTracks: 200 });

    expect(result.type).toBe('playlist');
    expect(result.name).toBe('Synthwave hits');
    expect(result.totalCount).toBe(2);
    expect(result.tracks.map((t) => t.title)).toEqual(['Nightcall', 'Genesis']);
    expect(result.skippedCount).toBe(0);
  });

  it('playlist vacía: cero tracks, cero omitidas, sin tirar error', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Vacía', public: true }))
      .mockResolvedValueOnce(jsonResponse(200, { total: 0, items: [], next: null }));

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/empty', { requestedBy: {}, maxTracks: 200 });
    expect(result.tracks).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('playlist privada (403) tira SpotifyPrivateError con el mensaje pedido', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(403, {}));

    await expect(resolveSpotifyInput('https://open.spotify.com/playlist/private', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      SpotifyPrivateError,
    );
    try {
      _resetTokenCacheForTests();
      fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(403, {}));
      await resolveSpotifyInput('https://open.spotify.com/playlist/private', { requestedBy: {}, maxTracks: 200 });
    } catch (error) {
      expect(error.message).toBe('No puedo acceder a esa playlist de Spotify.');
    }
  });

  it('playlist inexistente (404) tira SpotifyNotFoundError', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(404, {}));

    await expect(resolveSpotifyInput('https://open.spotify.com/playlist/nope', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      SpotifyNotFoundError,
    );
  });

  it('entradas inválidas (local, sin nombre, episodios) se cuentan como omitidas y no se agregan', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Mixta', public: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 4,
          items: [
            { item: fullTrack({ name: 'Válida' }) },
            { item: { ...fullTrack(), is_local: true } },
            { item: { ...fullTrack(), name: undefined } },
            { item: { ...fullTrack(), type: 'episode' } },
          ],
          next: null,
        }),
      );

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/mixta', { requestedBy: {}, maxTracks: 200 });
    expect(result.tracks).toHaveLength(1);
    expect(result.skippedCount).toBe(3);
  });

  it('respeta el límite máximo de cola (maxTracks) — nunca agrega más de lo que entra', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Grande', public: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 5,
          items: Array.from({ length: 5 }, (_, i) => ({ item: fullTrack({ name: `T${i}` }) })),
          next: null,
        }),
      );

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/grande', { requestedBy: {}, maxTracks: 2 });
    expect(result.tracks).toHaveLength(2);
  });

  it('playlist grande: sigue la paginación (next) hasta completar maxTracks o quedarse sin next', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Enorme', public: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 4,
          items: [{ item: fullTrack({ name: 'A' }) }, { item: fullTrack({ name: 'B' }) }],
          next: 'https://api.spotify.com/v1/playlists/x/items?offset=2&limit=50',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          total: 4,
          items: [{ item: fullTrack({ name: 'C' }) }, { item: fullTrack({ name: 'D' }) }],
          next: null,
        }),
      );

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/enorme', { requestedBy: {}, maxTracks: 200 });
    expect(result.tracks.map((t) => t.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(fetch).toHaveBeenCalledTimes(4); // token + meta + 2 páginas
  });
});

describe('Authentication', () => {
  it('obtiene un token nuevo en el primer pedido', async () => {
    fetch.mockResolvedValueOnce(tokenResponse('tok-a')).mockResolvedValueOnce(jsonResponse(200, fullTrack()));
    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    const tokenCall = fetch.mock.calls.find(([url]) => String(url).includes('accounts.spotify.com'));
    expect(tokenCall).toBeDefined();
  });

  it('token cacheado: un segundo pedido dentro de la ventana de validez NO vuelve a pedir token', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse('tok-a', 3600))
      .mockResolvedValueOnce(jsonResponse(200, fullTrack()))
      .mockResolvedValueOnce(jsonResponse(200, fullTrack({ name: 'Otra' })));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });
    await resolveSpotifyInput('https://open.spotify.com/track/b', { requestedBy: {}, maxTracks: 200 });

    const tokenCalls = fetch.mock.calls.filter(([url]) => String(url).includes('accounts.spotify.com'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('token expirado: pide uno nuevo (refresh)', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse('tok-a', 60)) // vence rápido
      .mockResolvedValueOnce(jsonResponse(200, fullTrack()))
      .mockResolvedValueOnce(tokenResponse('tok-b', 3600))
      .mockResolvedValueOnce(jsonResponse(200, fullTrack({ name: 'Otra' })));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });
    vi.advanceTimersByTime(120_000); // pasa el buffer de renovación
    await resolveSpotifyInput('https://open.spotify.com/track/b', { requestedBy: {}, maxTracks: 200 });

    const tokenCalls = fetch.mock.calls.filter(([url]) => String(url).includes('accounts.spotify.com'));
    expect(tokenCalls).toHaveLength(2);
  });

  it('sin SPOTIFY_CLIENT_ID/SECRET configurados, falla con mensaje claro sin pegarle a la red', async () => {
    configMock.spotifyClientId = null;
    configMock.spotifyClientSecret = null;

    await expect(resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      'Spotify no está configurado en este bot.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('401 en un pedido: descarta el token cacheado y reintenta una vez con uno nuevo', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse('tok-viejo'))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(tokenResponse('tok-nuevo'))
      .mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    const result = await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });
    expect(result.tracks[0].title).toBe('Nightcall');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('429 con Retry-After chico: espera y reintenta una vez', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    const promise = resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.tracks[0].title).toBe('Nightcall');
  });

  it('429 con Retry-After grande: falla con mensaje claro en vez de colgar la interacción', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(429, {}, { 'Retry-After': '30' }));

    await expect(resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 })).rejects.toThrow(
      /limitando las consultas/i,
    );
  });
});

describe('Authorization Code Flow — refresh token guardado (autorización real del dueño)', () => {
  it('con un refresh token guardado, lo usa en vez de Client Credentials', async () => {
    getSpotifyRefreshToken.mockResolvedValue({ refreshToken: 'rt-1', authorizedBy: 'owner-1' });
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    const tokenCallBody = String(fetch.mock.calls[0][1].body);
    expect(tokenCallBody).toContain('grant_type=refresh_token');
    expect(tokenCallBody).toContain('refresh_token=rt-1');
  });

  it('esto es justo lo que permite listar una playlist -- una vez autorizado, resolvePlaylist funciona igual que con un track', async () => {
    getSpotifyRefreshToken.mockResolvedValue({ refreshToken: 'rt-1', authorizedBy: 'owner-1' });
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { name: 'Mi playlist', public: true }))
      .mockResolvedValueOnce(jsonResponse(200, { total: 1, items: [{ item: fullTrack() }], next: null }));

    const result = await resolveSpotifyInput('https://open.spotify.com/playlist/xyz', { requestedBy: {}, maxTracks: 200 });
    expect(result.tracks).toHaveLength(1);
  });

  it('si Spotify rota el refresh token en la respuesta, persiste el nuevo', async () => {
    getSpotifyRefreshToken.mockResolvedValue({ refreshToken: 'rt-1', authorizedBy: 'owner-1' });
    fetch.mockResolvedValueOnce(tokenResponse('tok', 3600, { refresh_token: 'rt-2' })).mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    expect(saveSpotifyRefreshToken).toHaveBeenCalledWith('rt-2', 'owner-1');
  });

  it('si NO rota (misma respuesta de siempre), no llama a saveSpotifyRefreshToken de nuevo', async () => {
    getSpotifyRefreshToken.mockResolvedValue({ refreshToken: 'rt-1', authorizedBy: 'owner-1' });
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    expect(saveSpotifyRefreshToken).not.toHaveBeenCalled();
  });

  it('refresh token revocado/expirado: cae a Client Credentials en vez de crashear', async () => {
    getSpotifyRefreshToken.mockResolvedValue({ refreshToken: 'rt-vencido', authorizedBy: 'owner-1' });
    fetch
      .mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' })) // intento con refresh_token falla
      .mockResolvedValueOnce(tokenResponse()) // fallback a client_credentials
      .mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    const result = await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    expect(result.tracks[0].title).toBe('Nightcall'); // no crasheó, terminó resolviendo igual
    const secondCallBody = String(fetch.mock.calls[1][1].body);
    expect(secondCallBody).toBe('grant_type=client_credentials');
  });

  it('sin refresh token guardado, usa Client Credentials directo (comportamiento de siempre)', async () => {
    getSpotifyRefreshToken.mockResolvedValue(null);
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, fullTrack()));

    await resolveSpotifyInput('https://open.spotify.com/track/a', { requestedBy: {}, maxTracks: 200 });

    expect(String(fetch.mock.calls[0][1].body)).toBe('grant_type=client_credentials');
  });
});
