import { vi, describe, it, expect, beforeEach } from 'vitest';

// 2026-09-24: /staff → "Crear anuncio" (visible con "Aplicar timeout") dejaba a
// cualquier moderador prender @everyone en el constructor de /anuncio, aunque /say —
// la otra forma de arrobar a todos — ya era tier Administrador (H4). Mención masiva
// (@everyone o un rol no mencionable) exige ahora isAdmin() en las 4 puertas: abrir el
// constructor con la opción, el botón, el selector de rol y el envío.
const isStaff = vi.fn().mockResolvedValue(true);
const isAdmin = vi.fn().mockResolvedValue(false);
vi.mock('../src/utils/permissions.js', () => ({ isStaff, isAdmin }));

const { startBuilder } = await import('../src/commands/anuncios/anuncio.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

let guildCounter = 0;

function makeInteraction() {
  const guildId = `guild-mm-${++guildCounter}`;
  return {
    guild: { id: guildId },
    guildId,
    channel: { send: vi.fn().mockResolvedValue(undefined) },
    user: { id: 'staff-1', tag: 'staff-1#0001' },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function click(base, customId, extra = {}) {
  return { ...base, customId, update: vi.fn().mockResolvedValue(undefined), reply: vi.fn().mockResolvedValue(undefined), ...extra };
}

async function fillContent(base) {
  await routeModal(
    click(base, 'modal_anuncio_content', {
      fields: { getTextInputValue: (id) => ({ titulo: 'Aviso', descripcion: 'Texto' })[id] ?? '' },
    }),
  );
}

const role = (id, mentionable) => ({ id, name: id, mentionable, toString: () => `<@&${id}>` });

beforeEach(() => {
  vi.clearAllMocks();
  isStaff.mockResolvedValue(true);
  isAdmin.mockResolvedValue(false);
});

describe('/anuncio — mención masiva solo para el tier Administrador', () => {
  it('un moderador no puede prender @everyone desde el botón', async () => {
    const base = makeInteraction();
    await startBuilder(base);
    await fillContent(base);

    const toggle = click(base, 'anuncio_mention_everyone_toggle');
    await routeButton(toggle);
    expect(toggle.reply.mock.calls[0][0].content).toMatch(/Administrador de NEXO/);
    expect(toggle.update).not.toHaveBeenCalled();

    await routeButton(click(base, 'anuncio_send'));
    expect(base.channel.send.mock.calls[0][0].content).toBeUndefined();
  });

  it('un moderador no puede abrir el constructor con @everyone ya prendido (/anuncio mencionar_everyone)', async () => {
    const base = makeInteraction();
    await startBuilder(base, { everyone: true });

    expect(base.reply.mock.calls[0][0].content).toMatch(/Administrador de NEXO/);
  });

  it('rol no mencionable = mención masiva; rol mencionable queda libre', async () => {
    const base = makeInteraction();
    await startBuilder(base);

    const blocked = click(base, 'anuncio_mention_role_select', { roles: { first: () => role('role-miembro', false) } });
    await routeSelect(blocked);
    expect(blocked.reply.mock.calls[0][0].content).toMatch(/Administrador de NEXO/);

    const allowed = click(base, 'anuncio_mention_role_select', { roles: { first: () => role('role-eventos', true) } });
    await routeSelect(allowed);
    expect(allowed.reply).not.toHaveBeenCalled();
    expect(allowed.update).toHaveBeenCalled();
  });

  it('el envío revalida: un draft con @everyone armado por un admin que perdió el rol no sale', async () => {
    const base = makeInteraction();
    isAdmin.mockResolvedValue(true);
    await startBuilder(base, { everyone: true });
    await fillContent(base);

    isAdmin.mockResolvedValue(false);
    const send = click(base, 'anuncio_send');
    await routeButton(send);
    expect(base.channel.send).not.toHaveBeenCalled();
    expect(send.reply.mock.calls[0][0].content).toMatch(/Administrador de NEXO/);
  });

  it('un Administrador de NEXO sí puede mencionar a @everyone', async () => {
    isAdmin.mockResolvedValue(true);
    const base = makeInteraction();
    await startBuilder(base);
    await fillContent(base);
    await routeButton(click(base, 'anuncio_mention_everyone_toggle'));
    await routeButton(click(base, 'anuncio_send'));

    const sent = base.channel.send.mock.calls[0][0];
    expect(sent.content).toBe('@everyone');
    expect(sent.allowedMentions.parse).toContain('everyone');
  });
});
