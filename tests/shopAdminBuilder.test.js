import { vi, describe, it, expect, beforeEach } from 'vitest';

// Auditoría UX/UI (2026-09-18), hallazgo Mejora: "/shop-admin agregar/editar (7
// opciones) se beneficiaría de un modal con preview, mismo patrón que /anuncio".
// Archivo separado de shopAdminCommand.test.js a propósito (mismo criterio que ese
// archivo documenta arriba): acá se prueba el flujo de botones/select/modal del
// builder, no el wiring de las slash options.
const getGuildShopItems = vi.fn().mockResolvedValue([]);
const getShopItem = vi.fn().mockResolvedValue(null);
const addShopItem = vi.fn().mockResolvedValue('nuevo-id');
const updateShopItem = vi.fn().mockResolvedValue(true);
const hasCustomShopItems = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/shopStore.js', () => ({
  getGuildShopItems,
  getShopItem,
  addShopItem,
  updateShopItem,
  removeShopItem: vi.fn(),
  hasCustomShopItems,
}));

const isAdmin = vi.fn().mockResolvedValue(true);
vi.mock('../src/utils/permissions.js', () => ({ isAdmin }));

await import('../src/commands/economia/shopAdmin.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

function makeBase({ guildId = 'guild-1', userId = 'admin-1' } = {}) {
  return {
    guildId,
    user: { id: userId },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
}

async function clickButton(base, customId) {
  const i = { ...base, customId };
  await routeButton(i);
  return i;
}
async function pickSelect(base, customId, values) {
  const i = { ...base, customId, values };
  await routeSelect(i);
  return i;
}
async function submitModal(base, customId, fields) {
  const i = { ...base, customId, fields: { getTextInputValue: (id) => fields[id] ?? '' } };
  await routeModal(i);
  return i;
}
function payloadOf(i) {
  if (i.update.mock.calls.length) return i.update.mock.calls.at(-1)[0];
  return i.reply.mock.calls.at(-1)[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  isAdmin.mockResolvedValue(true);
  getGuildShopItems.mockResolvedValue([]);
  getShopItem.mockResolvedValue(null);
  addShopItem.mockResolvedValue('nuevo-id');
  updateShopItem.mockResolvedValue(true);
  hasCustomShopItems.mockResolvedValue(true);
});

describe('/shop-admin builder — crear (vista previa)', () => {
  it('abrir el builder muestra una vista previa vacía, ephemeral', async () => {
    const base = makeBase();
    const opened = await clickButton(base, 'shopadmin_builder_new');

    expect(opened.reply).toHaveBeenCalledTimes(1);
    const payload = payloadOf(opened);
    expect(payload.flags).toBeDefined();
    expect(payload.embeds[0].data.title).toContain('Nuevo ítem');
  });

  it('completar el modal de campos actualiza la vista previa con los datos reales', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');

    const afterModal = await submitModal(base, 'modal_shopadmin_builder_fields', {
      nombre: 'Espada Legendaria',
      precio: '750',
      descripcion: 'Corta todo',
      categoria: 'Armas',
    });

    const payload = payloadOf(afterModal);
    expect(payload.embeds[0].data.fields[0].name).toBe('Espada Legendaria');
    expect(payload.embeds[0].data.fields[0].value).toContain('750');
    expect(payload.embeds[0].data.fields[0].value).toContain('Corta todo');
    expect(payload.embeds[0].data.fields[1].value).toBe('Armas');
  });

  it('precio no numérico en el modal: rechaza sin tocar la sesión', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');

    const rejected = await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'X', precio: 'gratis' });

    expect(rejected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('número entero') }));
  });

  it('elegir un rol lo refleja en la vista previa, y se puede volver a vaciar (min 0)', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');
    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Rol VIP', precio: '500' });

    const withRole = await pickSelect(base, 'shopadmin_builder_role', ['role-vip']);
    expect(payloadOf(withRole).embeds[0].data.fields[0].value).toContain('<@&role-vip>');

    const withoutRole = await pickSelect(base, 'shopadmin_builder_role', []);
    expect(payloadOf(withoutRole).embeds[0].data.fields[0].value).not.toContain('<@&');
  });

  it('elegir "Caja misteriosa" y guardar con un precio bajo el piso rechaza sin crear el ítem', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');
    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Caja', precio: '10' });
    await pickSelect(base, 'shopadmin_builder_tipo', ['mystery_box']);

    const rejected = await clickButton(base, 'shopadmin_builder_save');

    expect(rejected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('caja misteriosa') }));
    expect(addShopItem).not.toHaveBeenCalled();
  });

  it('guardar sin nombre/precio completos rechaza con un mensaje claro', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');

    const rejected = await clickButton(base, 'shopadmin_builder_save');

    expect(rejected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Nombre y Precio') }));
    expect(addShopItem).not.toHaveBeenCalled();
  });

  it('guardar un ítem completo y válido llama a addShopItem con los datos del draft, incluido el toggle de entrega manual', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');
    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Trofeo', precio: '300', categoria: 'Trofeos' });
    await pickSelect(base, 'shopadmin_builder_role', ['role-x']);
    await clickButton(base, 'shopadmin_builder_manual'); // toggle a "Sí"

    const saved = await clickButton(base, 'shopadmin_builder_save');

    expect(addShopItem).toHaveBeenCalledWith('guild-1', {
      name: 'Trofeo',
      description: 'Sin descripción.',
      category: 'Trofeos',
      price: 300,
      roleId: 'role-x',
      fulfillment: 'manual',
      type: null,
    });
    expect(saved.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Se agregó') }));
  });

  it('cancelar no guarda nada y limpia la sesión (guardar después ya no encuentra nada que guardar)', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');
    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'X', precio: '100' });

    await clickButton(base, 'shopadmin_builder_cancel');
    const afterCancel = await clickButton(base, 'shopadmin_builder_save');

    expect(addShopItem).not.toHaveBeenCalled();
    expect(afterCancel.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });

  // Auditoría 2026-09-23: un ítem "rob_shield" sin tipo en producción cobraba y no
  // daba nada. El aviso aparece ANTES de guardar, en la vista previa, y desaparece
  // apenas se elige el tipo.
  it('nombre de escudo con tipo "Ítem normal": la vista previa avisa, y el aviso se va al elegir el tipo', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');

    const afterModal = await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Escudo Anti-Robo', precio: '2000' });
    const warned = payloadOf(afterModal).embeds[0].data.fields.find((f) => f.name.startsWith('⚠️'));
    expect(warned?.name).toContain('escudo anti-robo');

    const afterTipo = await pickSelect(base, 'shopadmin_builder_tipo', ['rob_shield']);
    expect(payloadOf(afterTipo).embeds[0].data.fields.some((f) => f.name.startsWith('⚠️'))).toBe(false);
  });

  it('un nombre sin relación con un tipo especial no muestra ningún aviso', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');

    const afterModal = await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Trofeo', precio: '300' });

    expect(payloadOf(afterModal).embeds[0].data.fields.some((f) => f.name.startsWith('⚠️'))).toBe(false);
  });

  it('si igual se guarda sin tipo, el mensaje final repite el aviso con cómo corregirlo', async () => {
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_new');
    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'rob_shield', precio: '2000' });

    const saved = await clickButton(base, 'shopadmin_builder_save');

    expect(addShopItem).toHaveBeenCalledWith('guild-1', expect.objectContaining({ type: null }));
    const { content } = saved.editReply.mock.calls[0][0];
    expect(content).toContain('Se agregó');
    expect(content).toContain('/shop-admin quitar');
  });
});

describe('/shop-admin builder — editar (vista previa, precargada)', () => {
  const EXISTING_ITEM = {
    id: 'item-9',
    name: 'Escudo viejo',
    price: 200,
    description: 'Un escudo',
    category: 'Armas',
    roleId: 'role-old',
    fulfillment: null,
    type: 'rob_shield',
  };

  it('elegir un ítem para editar precarga la vista previa con sus datos reales', async () => {
    getGuildShopItems.mockResolvedValue([EXISTING_ITEM]);
    getShopItem.mockResolvedValue(EXISTING_ITEM);
    const base = makeBase();

    await clickButton(base, 'shopadmin_builder_edit');
    const picked = await pickSelect(base, 'shopadmin_builder_edit_select', ['item-9']);

    const payload = payloadOf(picked);
    expect(payload.embeds[0].data.title).toContain('Editar');
    expect(payload.embeds[0].data.fields[0].name).toBe('Escudo viejo');
    expect(payload.embeds[0].data.fields[0].value).toContain('200');
    expect(payload.embeds[0].data.fields[0].value).toContain('<@&role-old>');
  });

  it('el tipo y la entrega manual vienen deshabilitados al editar (updateShopItem no los acepta)', async () => {
    getGuildShopItems.mockResolvedValue([EXISTING_ITEM]);
    getShopItem.mockResolvedValue(EXISTING_ITEM);
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_edit');

    const picked = await pickSelect(base, 'shopadmin_builder_edit_select', ['item-9']);

    const payload = payloadOf(picked);
    const tipoRow = payload.components.find((row) => row.components[0].data.custom_id === 'shopadmin_builder_tipo');
    const manualRow = payload.components.find((row) => row.components.some((c) => c.data.custom_id === 'shopadmin_builder_manual'));
    expect(tipoRow.components[0].data.disabled).toBe(true);
    expect(manualRow.components.find((c) => c.data.custom_id === 'shopadmin_builder_manual').data.disabled).toBe(true);
  });

  it('guardar una edición llama a updateShopItem con el draft completo, sin patch parcial', async () => {
    getGuildShopItems.mockResolvedValue([EXISTING_ITEM]);
    getShopItem.mockResolvedValue(EXISTING_ITEM);
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_edit');
    await pickSelect(base, 'shopadmin_builder_edit_select', ['item-9']);

    await submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'Escudo nuevo', precio: '250', categoria: 'Armas' });
    const saved = await clickButton(base, 'shopadmin_builder_save');

    expect(updateShopItem).toHaveBeenCalledWith('guild-1', 'item-9', {
      name: 'Escudo nuevo',
      price: 250,
      description: 'Sin descripción.',
      category: 'Armas',
      roleId: 'role-old',
    });
    expect(saved.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('actualizado') }));
  });

  // A diferencia de /shop-admin editar (solo pisa lo que se completó), el builder SÍ
  // puede vaciar un rol ya asignado — el draft es el estado completo, no un patch
  // parcial, y roleId:null pasa igual porque la clave está presente (ver shopStore.js).
  it('vaciar el rol en el builder de edición SÍ lo limpia (a diferencia del comando directo)', async () => {
    getGuildShopItems.mockResolvedValue([EXISTING_ITEM]);
    getShopItem.mockResolvedValue(EXISTING_ITEM);
    const base = makeBase();
    await clickButton(base, 'shopadmin_builder_edit');
    await pickSelect(base, 'shopadmin_builder_edit_select', ['item-9']);

    await pickSelect(base, 'shopadmin_builder_role', []);
    await clickButton(base, 'shopadmin_builder_save');

    expect(updateShopItem).toHaveBeenCalledWith('guild-1', 'item-9', expect.objectContaining({ roleId: null }));
  });

  it('sin ítems en la tienda: "editar" avisa en vez de mostrar un select vacío', async () => {
    getGuildShopItems.mockResolvedValue([]);
    const base = makeBase();

    const result = await clickButton(base, 'shopadmin_builder_edit');

    expect(result.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no hay ítems') }));
  });
});

describe('/shop-admin builder — el gate de Tier 2 se revalida en cada paso', () => {
  it('cada botón/select/modal del builder rechaza a un Tier 1, sin abrir ni guardar nada', async () => {
    isAdmin.mockResolvedValue(false);
    const base = makeBase();

    const steps = [
      () => clickButton(base, 'shopadmin_builder_new'),
      () => clickButton(base, 'shopadmin_builder_edit'),
      () => clickButton(base, 'shopadmin_builder_fields'),
      () => pickSelect(base, 'shopadmin_builder_role', ['role-x']),
      () => pickSelect(base, 'shopadmin_builder_tipo', ['xp_boost']),
      () => clickButton(base, 'shopadmin_builder_manual'),
      () => clickButton(base, 'shopadmin_builder_save'),
      () => submitModal(base, 'modal_shopadmin_builder_fields', { nombre: 'X', precio: '100' }),
    ];

    for (const step of steps) {
      const rejected = await step();
      expect(rejected.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/config rol-admin') }));
    }
    expect(addShopItem).not.toHaveBeenCalled();
    expect(updateShopItem).not.toHaveBeenCalled();
  });
});
