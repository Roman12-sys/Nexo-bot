import { vi, describe, it, expect, beforeEach } from 'vitest';

// resolveAudioForKnownTrack() es el punto donde una canción identificada por Spotify (o
// cualquier fuente de metadata futura) consigue de dónde sacar el audio — nunca duplica
// la extracción, reusa el mismo camino interno que resolveTrack(). Se mockea
// youtube-dl-exec entero; nunca se spawnea un proceso real en los tests.
const youtubedlFn = vi.fn();
youtubedlFn.constants = { YOUTUBE_DL_PATH: '/fake/yt-dlp' };
vi.mock('youtube-dl-exec', () => ({ default: youtubedlFn }));

const { resolveAudioForKnownTrack, TrackUnavailableError } = await import('../src/utils/musicSource.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAudioForKnownTrack', () => {
  it('arma la búsqueda como "artista - título" y devuelve la URL encontrada', async () => {
    youtubedlFn.mockResolvedValueOnce({ title: 'Nightcall', webpage_url: 'https://youtube.com/watch?v=abc', is_live: false });

    const result = await resolveAudioForKnownTrack({ title: 'Nightcall', artist: 'Kavinsky' });

    expect(result).toEqual({ url: 'https://youtube.com/watch?v=abc', isLive: false });
    expect(youtubedlFn).toHaveBeenCalledWith(
      'ytsearch1:Kavinsky - Nightcall',
      expect.objectContaining({ dumpSingleJson: true, noPlaylist: true }),
      expect.any(Object),
    );
  });

  it('sin artista, busca solo por título', async () => {
    youtubedlFn.mockResolvedValueOnce({ title: 'Nightcall', webpage_url: 'https://youtube.com/watch?v=abc' });
    await resolveAudioForKnownTrack({ title: 'Nightcall', artist: null });
    expect(youtubedlFn).toHaveBeenCalledWith('ytsearch1:Nightcall', expect.anything(), expect.anything());
  });

  it('maneja el contenedor { entries: [...] } de una búsqueda', async () => {
    youtubedlFn.mockResolvedValueOnce({ entries: [{ title: 'Nightcall', webpage_url: 'https://youtube.com/watch?v=abc' }] });
    const result = await resolveAudioForKnownTrack({ title: 'Nightcall', artist: 'Kavinsky' });
    expect(result.url).toBe('https://youtube.com/watch?v=abc');
  });

  it('sin resultados: tira TrackUnavailableError con el mensaje exacto pedido', async () => {
    youtubedlFn.mockResolvedValueOnce({ entries: [] });
    await expect(resolveAudioForKnownTrack({ title: 'Canción rarísima', artist: 'Nadie' })).rejects.toThrow(
      'Encontré la canción, pero no pude obtener una fuente de reproducción.',
    );
  });

  it('error de yt-dlp (red/timeout): se traduce al mismo mensaje claro, no al error crudo', async () => {
    youtubedlFn.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(resolveAudioForKnownTrack({ title: 'X', artist: 'Y' })).rejects.toThrow(TrackUnavailableError);
    await expect(resolveAudioForKnownTrack({ title: 'X', artist: 'Y' })).rejects.toThrow(
      'Encontré la canción, pero no pude obtener una fuente de reproducción.',
    );
  });
});
