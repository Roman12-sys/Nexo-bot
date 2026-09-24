import { vi, describe, it, expect } from 'vitest';

// Auditoría 2026-09-23: /setup gateaba solo la entrada del comando (dueño o
// Administrator); ninguno de sus 26 registros de botón/select/modal revalidaba el
// permiso — se apoyaban en que el panel es ephemeral. Ahora todos pasan por
// guardSetup(). Este test recorre CADA superficie con un miembro común y confirma que
// se rechaza ANTES de tocar nada (ni update, ni modal, ni sesión).
await import('../src/commands/admin/setup.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

const BUTTONS = [
  'setup_template_gaming',
  'setup_toggle_xp',
  'setup_confirm',
  'setup_cancel',
  'setuphome_quickstart',
  'setuphome_back',
  'setuphome_roles',
  'setupwizard_roles_create',
  'setupwizard_roles_wiring_save',
  'setuphome_diagnostics',
  'setupwizard_diagnostics_fix',
  'setuphome_counter',
  'setupwizard_counter_create',
  'setupwizard_counter_disable',
  'setuphome_welcome',
  'setupwizard_welcome_edit',
  'setupwizard_welcome_channel',
  'setupwizard_welcome_save',
  'setuphome_economy',
];
const SELECTS = [
  'setup_role_select',
  'setupwizard_roles_select',
  'setupwizard_roles_edittarget_select',
  'setupwizard_roles_admintier_select',
  'setupwizard_roles_modtier_select',
];
const MODALS = ['modal_setupwizard_roleedit_admin', 'modal_setupwizard_welcometext'];

function makeInteraction(customId, { userId = 'member-1', isAdministrator = false } = {}) {
  return {
    customId,
    guildId: 'guild-gate',
    user: { id: userId },
    guild: { id: 'guild-gate', ownerId: 'owner-1' },
    member: { permissions: { has: () => isAdministrator } },
    values: [],
    fields: { getTextInputValue: () => '' },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

function expectRejected(i) {
  expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('dueño del servidor o un administrador') }));
  expect(i.update).not.toHaveBeenCalled();
  expect(i.deferUpdate).not.toHaveBeenCalled();
  expect(i.showModal).not.toHaveBeenCalled();
}

describe('/setup — cada superficie rechaza a un miembro sin permiso', () => {
  it.each(BUTTONS)('botón %s', async (customId) => {
    const i = makeInteraction(customId);
    await routeButton(i);
    expectRejected(i);
  });

  it.each(SELECTS)('select %s', async (customId) => {
    const i = makeInteraction(customId);
    await routeSelect(i);
    expectRejected(i);
  });

  it.each(MODALS)('modal %s', async (customId) => {
    const i = makeInteraction(customId);
    await routeModal(i);
    expectRejected(i);
  });
});

describe('/setup — el mismo gate deja pasar a quien sí puede', () => {
  it('el dueño del servidor (sin Administrator) pasa el gate', async () => {
    const i = makeInteraction('setup_cancel', { userId: 'owner-1' });
    await routeButton(i);
    expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('cancelado') }));
  });

  it('un Administrator que no es el dueño pasa el gate', async () => {
    const i = makeInteraction('setup_cancel', { isAdministrator: true });
    await routeButton(i);
    expect(i.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('cancelado') }));
  });
});
