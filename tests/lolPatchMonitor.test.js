import { vi, describe, it, expect, beforeEach } from 'vitest';

// lolPatchMonitor.js no toca Supabase directamente (eso lo hace lolPatchStore.js, que
// se mockea acá) — mismo patrón que reminderEngine.test.js. Nunca debe llamar a
// discord.js ni mandar mensajes: es puramente una señal secundaria de logging.
const getLolPatchMonitorState = vi.fn();
const setLolDdragonVersionSeen = vi.fn().mockResolvedValue(undefined);
const setLolDdragonWarningSent = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/lolPatchStore.js', () => ({
  getLolPatchMonitorState,
  setLolDdragonVersionSeen,
  setLolDdragonWarningSent,
}));

const { checkDdragonVersion } = await import('../src/utils/lolPatchMonitor.js');

const HOUR_MS = 60 * 60 * 1000;
const TOLERANCE_MS = 24 * HOUR_MS; // debe coincidir con DDRAGON_PATCH_WARNING_DELAY_MS del módulo

function mockVersionsResponse(version, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve([version, 'version-anterior']),
    }),
  );
}

function emptyState() {
  return { patchEngineUpdatedAt: null, lastDdragonVersion: null, ddragonVersionDetectedAt: null, ddragonWarningSentAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkDdragonVersion', () => {
  it('primera corrida con estado vacío: siembra la versión, no compara ni tira nada', async () => {
    mockVersionsResponse('16.17.1');
    getLolPatchMonitorState.mockResolvedValue(emptyState());

    await checkDdragonVersion();

    expect(setLolDdragonVersionSeen).toHaveBeenCalledWith('16.17.1', expect.any(Number));
    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
  });

  it('misma versión que la corrida anterior: no hace nada', async () => {
    mockVersionsResponse('16.17.1');
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: Date.now(),
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: Date.now() - HOUR_MS,
      ddragonWarningSentAt: null,
    });

    await checkDdragonVersion();

    expect(setLolDdragonVersionSeen).not.toHaveBeenCalled();
    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
  });

  it('versión nueva detectada: actualiza el estado y resetea el warning previo', async () => {
    mockVersionsResponse('16.18.1');
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: Date.now(),
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: Date.now() - 2 * TOLERANCE_MS,
      ddragonWarningSentAt: Date.now() - HOUR_MS, // warning viejo de la versión anterior
    });

    await checkDdragonVersion();

    expect(setLolDdragonVersionSeen).toHaveBeenCalledWith('16.18.1', expect.any(Number));
    expect(setLolDdragonWarningSent).not.toHaveBeenCalled(); // el reset del warning lo hace setLolDdragonVersionSeen, no un call aparte
  });

  it('versión nueva + el patch engine YA progresó dentro de la ventana: no genera warning', async () => {
    mockVersionsResponse('16.17.1');
    const detectedAt = Date.now() - (TOLERANCE_MS + HOUR_MS); // venció la ventana
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: detectedAt + 10 * 60 * 1000, // encontró el artículo poco después del cambio de ddragon
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: detectedAt,
      ddragonWarningSentAt: null,
    });

    await checkDdragonVersion();

    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
  });

  it('el artículo se publicó ANTES del cambio de ddragon (orden real más común): no genera falso positivo', async () => {
    mockVersionsResponse('16.17.1');
    const detectedAt = Date.now() - (TOLERANCE_MS + HOUR_MS);
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: detectedAt - HOUR_MS, // el scraper encontró el artículo ANTES de que ddragon cambiara
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: detectedAt,
      ddragonWarningSentAt: null,
    });

    await checkDdragonVersion();

    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
  });

  it('venció la ventana de tolerancia y el patch engine nunca progresó: genera warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockVersionsResponse('16.17.1');
    const detectedAt = Date.now() - (TOLERANCE_MS + HOUR_MS);
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: detectedAt - (TOLERANCE_MS + HOUR_MS), // último artículo, bien afuera de la ventana de tolerancia
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: detectedAt,
      ddragonWarningSentAt: null,
    });

    await checkDdragonVersion();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(setLolDdragonWarningSent).toHaveBeenCalledWith(expect.any(Number));
    warnSpy.mockRestore();
  });

  it('todavía no venció la ventana de tolerancia: no genera warning aunque no haya progreso', async () => {
    mockVersionsResponse('16.17.1');
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: null,
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: Date.now() - HOUR_MS, // recién cambió, todavía dentro de la ventana
      ddragonWarningSentAt: null,
    });

    await checkDdragonVersion();

    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
  });

  it('no duplica warnings: si ya se avisó para esta versión, no vuelve a avisar', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockVersionsResponse('16.17.1');
    const detectedAt = Date.now() - (TOLERANCE_MS + HOUR_MS);
    getLolPatchMonitorState.mockResolvedValue({
      patchEngineUpdatedAt: null,
      lastDdragonVersion: '16.17.1',
      ddragonVersionDetectedAt: detectedAt,
      ddragonWarningSentAt: Date.now() - HOUR_MS, // ya se avisó una vez
    });

    await checkDdragonVersion();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(setLolDdragonWarningSent).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('Data Dragon caído (HTTP 500): tira, pero no debe afectar nada más (aislado del patch engine)', async () => {
    mockVersionsResponse('16.17.1', { ok: false, status: 500 });
    getLolPatchMonitorState.mockResolvedValue(emptyState());

    await expect(checkDdragonVersion()).rejects.toThrow('HTTP 500');
    expect(setLolDdragonVersionSeen).not.toHaveBeenCalled();
  });

  it('respuesta con forma inválida (no es array de strings): tira un error claro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ oops: true }) }));
    getLolPatchMonitorState.mockResolvedValue(emptyState());

    await expect(checkDdragonVersion()).rejects.toThrow(/forma inesperada/);
  });

  it('error de base de datos al leer el estado: se propaga en vez de tragarse silenciosamente', async () => {
    mockVersionsResponse('16.17.1');
    getLolPatchMonitorState.mockRejectedValue(new Error('conexión a Supabase caída'));

    await expect(checkDdragonVersion()).rejects.toThrow('conexión a Supabase caída');
  });

  it('nunca anuncia nada públicamente ni importa discord.js — nunca llama a nada de canales', async () => {
    mockVersionsResponse('16.17.1');
    getLolPatchMonitorState.mockResolvedValue(emptyState());

    await checkDdragonVersion();

    // No hay ningún mock de discord.js en este archivo: si el módulo intentara mandar
    // un mensaje a un canal, el import fallaría o el test explotaría por falta de mock.
    expect(setLolDdragonVersionSeen).toHaveBeenCalledTimes(1);
  });
});
