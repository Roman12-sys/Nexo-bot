import { vi, describe, it, expect, beforeEach } from 'vitest';

// GIVE-1 (auditoría completa 2026-09-11): /sorteo crear posteaba el embed
// (channel.send) y RECIÉN DESPUÉS agregaba el botón (message.edit) y registraba el
// sorteo (saveGiveaway) — si cualquiera de esos dos pasos fallaba, el mensaje ya
// publicado quedaba "fantasma" en el canal: visible, sin botón, sin fila en Supabase y
// sin temporizador, así que ni /sorteo terminar/cancelar podían tocarlo nunca. sorteo.js
// no tenía NINGÚN test previo (ni de esto ni de nada más) — se arma el mock scaffolding
// completo acá.
const saveGiveaway = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/giveawaysStore.js', () => ({
  saveGiveaway: (...a) => saveGiveaway(...a),
  getGiveaway: vi.fn(),
  toggleParticipant: vi.fn(),
  getGuildGiveawaysForAutocomplete: vi.fn().mockResolvedValue([]),
}));

const scheduleGiveawayEnd = vi.fn();
vi.mock('../src/utils/giveawayEngine.js', () => ({
  endGiveaway: vi.fn(),
  rerollGiveaway: vi.fn(),
  cancelGiveaway: vi.fn(),
  scheduleGiveawayEnd: (...a) => scheduleGiveawayEnd(...a),
}));

const isStaff = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isStaff: (...a) => isStaff(...a) }));

const { execute } = await import('../src/commands/sorteos/sorteo.js');

function makeInteraction({ editImpl, sendImpl, deleteImpl, options = {} } = {}) {
  const message = {
    id: 'msg-1',
    edit: editImpl || vi.fn().mockResolvedValue(undefined),
    delete: deleteImpl || vi.fn().mockResolvedValue(undefined),
  };
  return {
    guild: { id: 'guild-1' },
    channel: { id: 'chan-1', send: sendImpl || vi.fn().mockResolvedValue(message) },
    client: {},
    user: { id: 'staff-1' },
    options: {
      getSubcommand: () => 'crear',
      getString: (name) => (name === 'premio' ? (options.premio ?? 'Nitro Classic') : name === 'duracion' ? (options.duracion ?? '3600000') : null),
      getInteger: () => options.ganadores ?? 1,
      getRole: () => null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    _message: message,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
  saveGiveaway.mockResolvedValue(undefined);
});

describe('/sorteo crear', () => {
  it('caso exitoso: publica, agrega el botón, registra y programa el final', async () => {
    const interaction = makeInteraction();
    await execute(interaction);

    expect(interaction.channel.send).toHaveBeenCalledTimes(1);
    expect(interaction._message.edit).toHaveBeenCalledTimes(1);
    expect(saveGiveaway).toHaveBeenCalledTimes(1);
    expect(scheduleGiveawayEnd).toHaveBeenCalledTimes(1);
    expect(interaction._message.delete).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Sorteo creado') }));
  });

  it('si message.edit() (agregar el botón) falla: borra el mensaje recién publicado, nunca lo deja fantasma', async () => {
    const interaction = makeInteraction({ editImpl: vi.fn().mockRejectedValue(new Error('rate limited')) });

    await execute(interaction);

    expect(interaction._message.delete).toHaveBeenCalledTimes(1);
    expect(saveGiveaway).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('error') }));
  });

  it('si saveGiveaway falla: borra el mensaje, nunca deja un sorteo a medio registrar', async () => {
    saveGiveaway.mockRejectedValueOnce(new Error('db down'));
    const interaction = makeInteraction();

    await execute(interaction);

    expect(interaction._message.delete).toHaveBeenCalledTimes(1);
    expect(scheduleGiveawayEnd).not.toHaveBeenCalled();
  });

  it('si el fallo ocurre DESPUÉS de registrar (ej. el editReply final falla), el mensaje real NO se borra', async () => {
    const interaction = makeInteraction();
    interaction.editReply = vi.fn().mockRejectedValueOnce(new Error('interaction expired')).mockResolvedValue(undefined);

    await execute(interaction);

    expect(saveGiveaway).toHaveBeenCalledTimes(1);
    expect(interaction._message.delete).not.toHaveBeenCalled();
  });

  it('si channel.send() falla directamente (nunca se publicó nada): no intenta borrar ningún mensaje', async () => {
    const interaction = makeInteraction({ sendImpl: vi.fn().mockRejectedValue(new Error('sin permiso')) });

    await expect(execute(interaction)).resolves.not.toThrow();
    expect(saveGiveaway).not.toHaveBeenCalled();
  });
});
