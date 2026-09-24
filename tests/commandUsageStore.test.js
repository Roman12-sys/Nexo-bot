import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseMock } from './helpers/supabaseMock.js';

// getTopLiveCommands — auditoría 2026-09-23: command_usage nunca se limpia cuando un
// comando se elimina del bot. En producción, /play (música, eliminada en Fase 3C) salía
// 2° en /metricas y en "Comando más usado" del dashboard. Esta función es la ÚNICA que
// filtra, y la usan las dos superficies — se testea la lógica real contra el mock de
// Supabase, no un mock de la función.
const supabaseMock = createSupabaseMock();
vi.mock('../src/supabaseClient.js', () => ({ get supabase() { return supabaseMock; } }));

const { getTopLiveCommands } = await import('../src/utils/commandUsageStore.js');

const LIVE = new Set(['ruleta', 'setup', 'config', 'helpstaff', 'coinflip', 'help', 'ranking', 'crime', 'daily', 'perfil', 'shop', 'work']);
const row = (command_name, uses) => ({ command_name, uses });
const builder = () => supabaseMock.getBuilder('command_usage');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTopLiveCommands', () => {
  it('saca los comandos eliminados sin romper el orden de los vivos (datos reales de producción)', async () => {
    builder().__setResult({ data: [row('ruleta', 61), row('play', 54), row('setup', 28), row('pet', 8), row('volume', 6), row('report', 6), row('crime', 6)], error: null });

    const top = await getTopLiveCommands('guild-1', LIVE, 10);

    expect(top.map((r) => r.command_name)).toEqual(['ruleta', 'setup', 'crime']);
  });

  it('pide 30 filas de margen para que los descartados no dejen el top corto, y corta en el límite', async () => {
    const dead = ['play', 'pet', 'report', 'volume', 'stop', 'queue'].map((n, i) => row(n, 1000 - i));
    const live = [...LIVE].map((n, i) => row(n, 100 - i));
    builder().__setResult({ data: [...dead, ...live], error: null });

    const top = await getTopLiveCommands('guild-1', LIVE, 10);

    expect(builder().limit).toHaveBeenCalledWith(40);
    expect(top).toHaveLength(10);
    expect(top.map((r) => r.command_name)).toEqual([...LIVE].slice(0, 10));
  });

  it('respeta un límite distinto (el dashboard pide 5)', async () => {
    builder().__setResult({ data: [...LIVE].map((n, i) => row(n, 100 - i)), error: null });

    const top = await getTopLiveCommands('guild-1', LIVE, 5);

    expect(builder().limit).toHaveBeenCalledWith(35);
    expect(top).toHaveLength(5);
  });

  it('acepta un Map como catálogo (client.commands del bot es una Collection)', async () => {
    builder().__setResult({ data: [row('play', 54), row('ruleta', 61)], error: null });

    const top = await getTopLiveCommands('guild-1', new Map([['ruleta', {}]]), 10);

    expect(top.map((r) => r.command_name)).toEqual(['ruleta']);
  });

  it('catálogo vacío (no cargó): no filtra — mejor un fantasma que un ranking vacío', async () => {
    builder().__setResult({ data: [row('ruleta', 61), row('play', 54)], error: null });

    expect((await getTopLiveCommands('guild-1', new Set(), 10)).map((r) => r.command_name)).toEqual(['ruleta', 'play']);
    expect((await getTopLiveCommands('guild-1', null, 10)).map((r) => r.command_name)).toEqual(['ruleta', 'play']);
  });

  it('un error de Supabase se propaga (no se traga en silencio)', async () => {
    builder().__setResult({ data: null, error: new Error('boom') });

    await expect(getTopLiveCommands('guild-1', LIVE, 10)).rejects.toThrow('boom');
  });
});
