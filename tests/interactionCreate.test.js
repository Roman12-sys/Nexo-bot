import { vi, describe, it, expect, beforeEach } from 'vitest';

// interactionCreate.js despacha TODO lo que el usuario toca (comandos, autocompletado,
// botones, menús, formularios) y hasta el 2026-09-27 no tenía un test directo. Se prueba
// el contrato del despachador: límite de uso, a quién se le pasa cada interacción, y que
// un error siempre termine en una respuesta clara para el usuario y una alerta.
const routeButton = vi.fn();
const routeModal = vi.fn();
const routeSelect = vi.fn();
vi.mock('../src/components/buttons.js', () => ({ routeButton: (...a) => routeButton(...a) }));
vi.mock('../src/components/modals.js', () => ({ routeModal: (...a) => routeModal(...a) }));
vi.mock('../src/components/selects.js', () => ({ routeSelect: (...a) => routeSelect(...a) }));

const checkRateLimit = vi.fn();
vi.mock('../src/utils/rateLimiter.js', () => ({ checkRateLimit: (...a) => checkRateLimit(...a) }));

const trackCommandUsage = vi.fn().mockResolvedValue(undefined);
const getTotalUsage = vi.fn().mockResolvedValue(10);
vi.mock('../src/utils/commandUsageStore.js', () => ({ trackCommandUsage: (...a) => trackCommandUsage(...a), getTotalUsage: (...a) => getTotalUsage(...a) }));

vi.mock('../src/utils/guildAchievements.js', () => ({ checkCommandUsageAchievements: vi.fn().mockResolvedValue(undefined) }));

const reportCriticalError = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/errorReporter.js', () => ({ reportCriticalError: (...a) => reportCriticalError(...a) }));

const { execute } = await import('../src/events/interactionCreate.js');

function makeInteraction({ kind = 'command', commandName = 'ping', replied = false, deferred = false, customId = 'algo_1' } = {}) {
  return {
    commandName,
    customId,
    guildId: 'guild-1',
    user: { id: 'user-1' },
    replied,
    deferred,
    isAutocomplete: () => kind === 'autocomplete',
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isModalSubmit: () => kind === 'modal',
    isAnySelectMenu: () => kind === 'select',
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
  };
}

function makeClient(commands = {}) {
  return { commands: new Map(Object.entries(commands)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('interactionCreate — comandos', () => {
  it('ejecuta el comando y registra el uso', async () => {
    const command = { execute: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction();

    await execute(interaction, makeClient({ ping: command }));

    expect(command.execute).toHaveBeenCalledWith(interaction, expect.anything());
    await vi.waitFor(() => expect(trackCommandUsage).toHaveBeenCalledWith('guild-1', 'ping'));
  });

  it('usando comandos muy rápido: responde que espere y no ejecuta nada', async () => {
    checkRateLimit.mockReturnValue(false);
    const command = { execute: vi.fn(), rateLimitCategory: 'casino' };
    const interaction = makeInteraction();

    await execute(interaction, makeClient({ ping: command }));

    expect(checkRateLimit).toHaveBeenCalledWith('user-1', 'casino');
    expect(command.execute).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('muy rápido') }));
  });

  it('un comando que ya no existe en el bot no revienta', async () => {
    await expect(execute(makeInteraction({ commandName: 'play' }), makeClient())).resolves.toBeUndefined();
  });

  it('si el comando falla antes de responder: mensaje de error, alerta al operador y no cuenta como uso', async () => {
    const command = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const interaction = makeInteraction();

    await execute(interaction, makeClient({ ping: command }));

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hubo un error ejecutando este comando.' }));
    expect(reportCriticalError).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/ping'), expect.any(Error));
    expect(trackCommandUsage).not.toHaveBeenCalled();
  });

  it('si el comando falla después de responder: el aviso va como mensaje aparte (followUp), nunca un segundo reply', async () => {
    const command = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const interaction = makeInteraction({ deferred: true });

    await execute(interaction, makeClient({ ping: command }));

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('interactionCreate — autocompletado', () => {
  it('si el autocompletado falla, devuelve una lista vacía en vez de dejar colgado el menú', async () => {
    const command = { execute: vi.fn(), autocomplete: vi.fn().mockRejectedValue(new Error('boom')) };
    const interaction = makeInteraction({ kind: 'autocomplete', commandName: 'warn' });

    await execute(interaction, makeClient({ warn: command }));

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});

describe('interactionCreate — botones, menús y formularios', () => {
  it.each([
    ['button', routeButton],
    ['select', routeSelect],
    ['modal', routeModal],
  ])('%s: se pasa al router que corresponde', async (kind, router) => {
    router.mockResolvedValue(true);
    const interaction = makeInteraction({ kind });

    await execute(interaction, makeClient());

    expect(router).toHaveBeenCalledWith(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('un botón viejo que ningún router reconoce: avisa que ya no es válido', async () => {
    routeButton.mockResolvedValue(false);
    const interaction = makeInteraction({ kind: 'button', customId: 'boton_de_una_feature_borrada' });

    await execute(interaction, makeClient());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('ya no es válido') }));
  });

  it('si el handler de un botón falla: mensaje de error y alerta al operador', async () => {
    routeButton.mockRejectedValue(new Error('boom'));
    const interaction = makeInteraction({ kind: 'button', customId: 'staff_nav_1' });

    await execute(interaction, makeClient());

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hubo un error procesando esto.' }));
    expect(reportCriticalError).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('staff_nav_1'), expect.any(Error));
  });
});
