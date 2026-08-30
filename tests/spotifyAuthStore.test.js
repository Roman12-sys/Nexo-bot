import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// spotify_auth es una fila única a nivel bot completo (no por guild, mismo criterio que
// lol_patch_state) — lo que más importa proteger acá es que "sin fila todavía" devuelva
// null en vez de explotar (el bot debe poder arrancar sin que nadie haya autorizado
// Spotify todavía) y que save() haga upsert sobre la fila fija 'main', nunca una fila
// nueva por llamada.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

const { getSpotifyRefreshToken, saveSpotifyRefreshToken } = await import('../src/utils/spotifyAuthStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.getBuilder('spotify_auth').__setResult({ data: null, error: null });
});

describe('getSpotifyRefreshToken', () => {
  it('sin fila guardada todavía, devuelve null (no explota)', async () => {
    await expect(getSpotifyRefreshToken()).resolves.toBeNull();
  });

  it('con una fila guardada, devuelve el refresh token y quién autorizó', async () => {
    supabaseMock
      .getBuilder('spotify_auth')
      .__setResult({ data: { refresh_token: 'rt-1', authorized_by: 'owner-1', updated_at: '2026-08-30T00:00:00.000Z' }, error: null });

    const result = await getSpotifyRefreshToken();
    expect(result).toEqual({ refreshToken: 'rt-1', authorizedBy: 'owner-1', updatedAt: '2026-08-30T00:00:00.000Z' });
  });

  it('propaga un error real de Supabase en vez de esconderlo', async () => {
    supabaseMock.getBuilder('spotify_auth').__setResult({ data: null, error: new Error('conexión caída') });
    await expect(getSpotifyRefreshToken()).rejects.toThrow('conexión caída');
  });
});

describe('saveSpotifyRefreshToken', () => {
  it('hace upsert sobre la fila fija "main", nunca una fila nueva por llamada', async () => {
    await saveSpotifyRefreshToken('rt-nuevo', 'owner-1');

    const builder = supabaseMock.getBuilder('spotify_auth');
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'main', refresh_token: 'rt-nuevo', authorized_by: 'owner-1' }),
      { onConflict: 'id' },
    );
  });

  it('propaga un error real de Supabase en vez de esconderlo', async () => {
    supabaseMock.getBuilder('spotify_auth').__setResult({ data: null, error: new Error('constraint violada') });
    await expect(saveSpotifyRefreshToken('rt', 'owner-1')).rejects.toThrow('constraint violada');
  });
});
