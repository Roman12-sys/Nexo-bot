import { vi, describe, it, expect, beforeEach } from 'vitest';

// /estado — nuevo (roadmap "estado real de Nexo"): salud del bot para staff, distinto
// de /metricas (que es popularidad de comandos, no conectividad/latencia/sistemas
// activos).
const getGuildConfig = vi.fn();
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig }));

const pingSupabase = vi.fn();
vi.mock('../src/supabaseClient.js', () => ({ pingSupabase, supabase: {} }));

const getGuildGiveawaysForAutocomplete = vi.fn();
vi.mock('../src/utils/giveawaysStore.js', () => ({ getGuildGiveawaysForAutocomplete }));

const getAllTempChannels = vi.fn();
vi.mock('../src/utils/tempVoiceStore.js', () => ({ getAllTempChannels }));

const { execute } = await import('../src/commands/admin/estado.js');

function makeInteraction({ isStaffMember = true } = {}) {
  return {
    guildId: 'guild-1',
    // Map real, no un objeto ad-hoc con solo .has(): /estado usa isStaff(), que hace
    // [...roles.cache.keys()] — igual que la Collection real de discord.js.
    member: { roles: { cache: new Map(isStaffMember ? [['role-admin', { id: 'role-admin' }]] : []) } },
    client: {
      ws: { ping: 42 },
      uptime: 3_600_000,
      guilds: { cache: { size: 7 } },
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue({ admin_role_id: 'role-admin', moderator_role_id: null });
  pingSupabase.mockResolvedValue({ ok: true, ms: 55 });
  getGuildGiveawaysForAutocomplete.mockResolvedValue([{ messageId: '1', prize: 'a' }, { messageId: '2', prize: 'b' }]);
  getAllTempChannels.mockResolvedValue([{ channelId: 'c1' }]);
});

describe('/estado', () => {
  it('sin permisos de staff, no llega a consultar nada', async () => {
    const interaction = makeInteraction({ isStaffMember: false });

    await execute(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(pingSupabase).not.toHaveBeenCalled();
  });

  it('con permisos: arma el embed con latencia, estado de Supabase y conteos del server', async () => {
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const field = (name) => embed.data.fields.find((f) => f.name === name)?.value;

    expect(field('📡 Latencia (gateway)')).toBe('42ms');
    expect(field('🗄️ Supabase')).toMatch(/OK \(55ms\)/);
    expect(field('🌐 Servidores totales')).toBe('7');
    expect(field('🎉 Sorteos activos (este server)')).toBe('2');
    expect(field('🔊 Salas de voz temporales activas')).toBe('1');
  });

  it('si Supabase no responde, lo muestra sin reventar el resto del embed', async () => {
    pingSupabase.mockResolvedValue({ ok: false, ms: 5000 });
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const field = (name) => embed.data.fields.find((f) => f.name === name)?.value;
    expect(field('🗄️ Supabase')).toMatch(/Sin conexión/);
  });

  // Fase 2C, sección 12 — antes "Supabase" era binario (OK/Sin conexión): un round-trip
  // lento pero que SÍ responde se mostraba igual que uno rápido, sin forma de que un
  // operador notara la degradación sin mirar el número exacto de ms.
  it('Supabase responde pero lento: se distingue de "OK" y de "Sin conexión"', async () => {
    pingSupabase.mockResolvedValue({ ok: true, ms: 1500 });
    const interaction = makeInteraction();

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const field = (name) => embed.data.fields.find((f) => f.name === name)?.value;
    expect(field('🗄️ Supabase')).toMatch(/Lento \(1500ms\)/);
  });

  // client.ws.ping vale -1 cuando discord.js todavía no completó ningún heartbeat ACK
  // (recién conectado/reconectando) — mostrar "-1ms" crudo no dice nada útil sin leer el
  // código.
  it('gateway con ping -1 (sin heartbeat todavía): se muestra como reconectando, no "-1ms"', async () => {
    const interaction = makeInteraction();
    interaction.client.ws.ping = -1;

    await execute(interaction);

    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    const field = (name) => embed.data.fields.find((f) => f.name === name)?.value;
    expect(field('📡 Latencia (gateway)')).not.toContain('-1ms');
    expect(field('📡 Latencia (gateway)')).toMatch(/Reconectando/);
  });
});
