import { vi, describe, it, expect, beforeEach } from 'vitest';

// NEXO Setup Inteligente — panel principal + wizard de roles + diagnóstico de canales +
// contador de miembros + editor de bienvenida, ejercitados a través de los routers
// REALES (routeButton/routeSelect/routeModal), nunca llamando handlers a mano — mismo
// criterio que rolreacciones.test.js/setupRoleSafety.test.js. asyncLock.js NO se
// mockea a propósito: los tests de doble-click dependen del withLock real.
const getGuildConfig = vi.fn();
const setGuildConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/utils/guildConfigStore.js', () => ({ getGuildConfig, setGuildConfig }));

const getGuildLogChannel = vi.fn().mockResolvedValue(null);
vi.mock('../src/utils/guildLogChannels.js', () => ({ getGuildLogChannel }));

const hasCustomShopItems = vi.fn().mockResolvedValue(false);
vi.mock('../src/utils/shopStore.js', () => ({ hasCustomShopItems }));

vi.mock('../src/config.js', () => ({ config: { dashboardUrl: null } }));

await import('../src/commands/admin/setup.js');
const { routeButton } = await import('../src/components/buttons.js');
const { routeSelect } = await import('../src/components/selects.js');
const { routeModal } = await import('../src/components/modals.js');

function makeRole(id, name, position = 1) {
  return { id, name, color: 0, position, toString: () => `<@&${id}>` };
}

function makeGuildRoleRegistry({ createImpl, existingRoles = [] } = {}) {
  // `.cache` es un Map REAL (no un objeto ad-hoc con solo get/find) — setupDiagnostics.js
  // ahora también itera TODOS los roles del servidor (`.values()`, scanGuildRoles), no
  // solo los busca por ID/nombre.
  const byId = new Map(existingRoles.map((r) => [r.id, r]));
  byId.find = function (predicate) {
    for (const value of this.values()) if (predicate(value)) return value;
    return undefined;
  };
  let counter = 1;
  return {
    everyone: { id: 'role-everyone' },
    cache: byId,
    fetch: vi.fn(async (id) => byId.get(id) || null),
    create:
      createImpl ||
      vi.fn(async ({ name }) => {
        const role = makeRole(`role-nuevo-${counter++}`, name);
        byId.set(role.id, role);
        return role;
      }),
    setPositions: vi.fn().mockResolvedValue(undefined),
  };
}

// `.cache` es un Map REAL (no un objeto ad-hoc con solo un par de métodos) — discord.js
// Collection extiende Map, y setupDiagnostics.js/setup.js usan tanto `.values()` (para
// iterar todos los canales) como `.find()` (para el reuso por nombre de resolveChannel).
function makeChannelRegistry(ownerGuildRef) {
  const cache = new Map();
  cache.find = function (predicate) {
    for (const value of this.values()) if (predicate(value)) return value;
    return undefined;
  };
  let counter = 1;
  return {
    cache,
    fetch: vi.fn(async (id) => cache.get(id) || null),
    create: vi.fn(async ({ name, type }) => {
      const channel = {
        id: `chan-nuevo-${counter++}`,
        name,
        type,
        parent: null,
        guild: ownerGuildRef,
        toString() {
          return `<#${this.id}>`;
        },
        permissionOverwrites: { cache: new Map(), edit: vi.fn().mockResolvedValue(undefined) },
      };
      cache.set(channel.id, channel);
      return channel;
    }),
  };
}

// Guild autoincremental por defecto — CADA test toma un guild nuevo salvo que
// comparta explícitamente uno (varios "clicks" dentro del MISMO test SÍ deben
// compartir guild/user, porque comparten la misma sesión en memoria de setup.js;
// pero entre tests distintos NUNCA, o el estado de un test se filtra al siguiente).
let guildCounter = 0;

function makeGuild({ guildId, botPosition = 10, roleRegistry, channelRegistry, memberCount = 50, botPermissionsGranted = true, emojis = new Map() } = {}) {
  const id = guildId || `guild-test-${++guildCounter}`;
  const guild = {
    id,
    memberCount,
    roles: roleRegistry || makeGuildRoleRegistry(),
    members: { me: { roles: { highest: { position: botPosition } }, permissions: { has: () => botPermissionsGranted } } },
    emojis: { cache: emojis, fetch: vi.fn().mockResolvedValue(emojis) },
  };
  guild.channels = channelRegistry || makeChannelRegistry(guild);
  return guild;
}

function makeGuildEmoji(id, name, animated = false) {
  return { id, name, animated, toString: () => `<${animated ? 'a' : ''}:${name}:${id}>` };
}

// Producción tiró un CombinedPropertyError real (LabelBuilder.setLabel > 45 chars) que
// esta suite entera no había agarrado, porque un showModal mockeado con
// `.mockResolvedValue()` nunca ejercita `.toJSON()` — que es DONDE discord.js valida
// límites de longitud (mismo motivo por el que node --check tampoco los agarra, ver el
// gotcha ya documentado en CLAUDE.md para SlashCommandBuilder). Esta versión SÍ llama al
// `.toJSON()` real de cualquier modal que un handler intente mostrar — si algo excede un
// límite real de Discord, el test revienta acá en vez de en el log de Railway.
function validatingShowModal() {
  return vi.fn((modal) => {
    modal.toJSON();
    return Promise.resolve();
  });
}

function makeInteraction({ guild, userId = 'admin-1' } = {}) {
  const g = guild || makeGuild();
  return {
    guild: g,
    guildId: g.id,
    user: { id: userId, tag: 'admin#0001', username: 'admin', toString: () => `<@${userId}>`, displayAvatarURL: () => 'https://cdn.example.com/avatar.png' },
    member: { permissions: { has: () => true } },
    client: {},
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    showModal: validatingShowModal(),
  };
}

// Cada "click" real de Discord es una interacción NUEVA que comparte guild/user/client
// (y por lo tanto la MISMA sesión, keyeada por guildId:userId) con la original.
function click(base, customId, { values, fields } = {}) {
  return {
    ...base,
    customId,
    values,
    fields: fields || { getTextInputValue: () => '' },
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    showModal: validatingShowModal(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockResolvedValue({});
  getGuildLogChannel.mockResolvedValue(null);
  hasCustomShopItems.mockResolvedValue(false);
});

describe('NEXO Setup — panel principal', () => {
  it('setuphome_back vuelve al home con el estado real (roles sin configurar = rojo)', async () => {
    const interaction = makeInteraction();
    const backClick = click(interaction, 'setuphome_back');
    await routeButton(backClick);

    const embed = backClick.update.mock.calls[0][0].embeds[0];
    expect(embed.data.fields.find((f) => f.name.includes('Roles')).name).toContain('🔴');
  });

  it('setuphome_quickstart muestra el selector de plantillas de siempre (flujo viejo intacto)', async () => {
    const interaction = makeInteraction();
    const quickClick = click(interaction, 'setuphome_quickstart');
    await routeButton(quickClick);

    const payload = quickClick.update.mock.calls[0][0];
    expect(payload.components[0].components.map((b) => b.data.custom_id)).toEqual(
      expect.arrayContaining(['setup_template_comunidad', 'setup_template_estudio', 'setup_template_personalizado']),
    );
  });
});

describe('NEXO Setup — wizard de roles: selección y edición', () => {
  it('setuphome_roles abre el wizard con los 4 tiers por defecto', async () => {
    const interaction = makeInteraction();
    const i = click(interaction, 'setuphome_roles');
    await routeButton(i);

    const embed = i.update.mock.calls[0][0].embeds[0];
    const names = embed.data.fields.map((f) => f.name);
    expect(names.some((n) => n.includes('Administrador'))).toBe(true);
    expect(names.some((n) => n.includes('Moderador'))).toBe(true);
    expect(names.some((n) => n.includes('Staff'))).toBe(false); // Staff/Ayudante NO están en el default
  });

  it('setupwizard_roles_select reemplaza la selección completa por lo elegido', async () => {
    const interaction = makeInteraction();
    await routeButton(click(interaction, 'setuphome_roles'));
    const selectInteraction = click(interaction, 'setupwizard_roles_select', { values: ['staff'] });
    await routeSelect(selectInteraction);

    const embed = selectInteraction.update.mock.calls[0][0].embeds[0];
    expect(embed.data.fields).toHaveLength(1);
    expect(embed.data.fields[0].name).toContain('Staff');
  });

  it('editar un rol: el modal sale prellenado con el nombre/color por defecto, y el submit lo actualiza', async () => {
    const interaction = makeInteraction();
    await routeButton(click(interaction, 'setuphome_roles'));

    const editSelect = click(interaction, 'setupwizard_roles_edittarget_select', { values: ['moderador'] });
    await routeSelect(editSelect);
    expect(editSelect.showModal).toHaveBeenCalledTimes(1);

    const modalSubmit = click(interaction, 'modal_setupwizard_roleedit_moderador', {
      fields: { getTextInputValue: (id) => (id === 'nombre' ? 'Mods del Server' : '#123456') },
    });
    await routeModal(modalSubmit);

    const embed = modalSubmit.update.mock.calls[0][0].embeds[0];
    const field = embed.data.fields.find((f) => f.name.includes('Mods del Server'));
    expect(field).toBeDefined();
    expect(field.value).toContain('#123456');
  });

  it('color inválido en el modal: conserva el color anterior en vez de tirar o guardar basura', async () => {
    const interaction = makeInteraction();
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_edittarget_select', { values: ['moderador'] }));

    const modalSubmit = click(interaction, 'modal_setupwizard_roleedit_moderador', {
      fields: { getTextInputValue: (id) => (id === 'nombre' ? 'Mods' : 'no-es-un-color') },
    });
    await routeModal(modalSubmit);

    const embed = modalSubmit.update.mock.calls[0][0].embeds[0];
    const field = embed.data.fields.find((f) => f.name.includes('Mods'));
    expect(field.value).toMatch(/#[0-9A-F]{6}/); // sigue siendo un hex válido (el default), no el string inválido
  });
});

describe('NEXO Setup — wizard de roles: creación', () => {
  it('crea los roles seleccionados con permisos nativos y sin Administrator, y pasa a la pantalla de asignación', async () => {
    const guild = makeGuild();
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: ['administrador', 'moderador'] }));

    const createClick = click(interaction, 'setupwizard_roles_create');
    await routeButton(createClick);

    expect(guild.roles.create).toHaveBeenCalledTimes(2);
    for (const call of guild.roles.create.mock.calls) {
      expect(call[0].permissions).not.toContain(8n); // Administrator = 1n<<3n = 8n, por las dudas explícito
    }
    const finalPayload = createClick.editReply.mock.calls.at(-1)[0];
    expect(finalPayload.embeds[0].data.title).toContain('Asignar tiers');
    expect(getGuildLogChannel).toHaveBeenCalled(); // se intentó loguear la creación
  });

  it('fallo parcial: un rol falla al crearse (permiso insuficiente), los demás se crean igual y el resumen lo muestra', async () => {
    let attempt = 0;
    const roleRegistry = makeGuildRoleRegistry({
      createImpl: vi.fn(async ({ name }) => {
        attempt++;
        if (attempt === 1) throw { code: 50013 };
        return makeRole(`role-ok-${attempt}`, name);
      }),
    });
    const guild = makeGuild({ roleRegistry });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: ['administrador', 'moderador'] }));

    const createClick = click(interaction, 'setupwizard_roles_create');
    await routeButton(createClick);

    expect(guild.roles.create).toHaveBeenCalledTimes(2); // el fallo del primero no aborta al segundo
    const description = createClick.editReply.mock.calls.at(-1)[0].embeds[0].data.description;
    expect(description).toMatch(/❌.*permiso/i);
    expect(description).toMatch(/✅ Creado/);
  });

  it('el bot sin ningún rol por encima de @everyone: error fatal explícito, no crea nada', async () => {
    const guild = makeGuild({ botPosition: 0 });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: ['staff'] }));

    const createClick = click(interaction, 'setupwizard_roles_create');
    await routeButton(createClick);

    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(createClick.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('por encima de @everyone') }));
  });

  it('doble click en "Crear roles": el segundo no repite la creación (lock real + idempotencia)', async () => {
    const guild = makeGuild();
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: ['staff'] }));

    const clickA = click(interaction, 'setupwizard_roles_create');
    const clickB = click(interaction, 'setupwizard_roles_create');
    await Promise.all([routeButton(clickA), routeButton(clickB)]);

    expect(guild.roles.create).toHaveBeenCalledTimes(1);
    // Las DOS interacciones terminan viendo un resultado final coherente (nunca una
    // quedó congelada en "Creando roles...").
    expect(clickA.editReply).toHaveBeenCalled();
    expect(clickB.editReply).toHaveBeenCalled();
  });

  it('rol sin selección: "Crear" va directo a la pantalla de asignación sin tocar Discord', async () => {
    const guild = makeGuild();
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: [] }));

    const createClick = click(interaction, 'setupwizard_roles_create');
    await routeButton(createClick);

    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(createClick.update.mock.calls.at(-1)[0].embeds[0].data.title).toContain('Asignar tiers');
  });
});

describe('NEXO Setup — wizard de roles: asignación de tiers NEXO', () => {
  it('guardar la asignación persiste SOLO las columnas elegidas y vuelve al home', async () => {
    const guild = makeGuild();
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: ['administrador'] }));
    await routeButton(click(interaction, 'setupwizard_roles_create'));
    await routeSelect(click(interaction, 'setupwizard_roles_admintier_select', { values: ['role-nuevo-1'] }));

    const saveClick = click(interaction, 'setupwizard_roles_wiring_save');
    await routeButton(saveClick);

    expect(setGuildConfig).toHaveBeenCalledWith(guild.id, { admin_role_id: 'role-nuevo-1' });
    // Vuelve al home — el embed final tiene el título del panel principal.
    const finalEmbed = saveClick.update.mock.calls.at(-1)[0].embeds[0];
    expect(finalEmbed.data.title).toMatch(/NEXO Setup|preparar tu servidor/);
  });

  it('sin elegir ningún rol para wirear: no llama setGuildConfig con columnas de rol', async () => {
    const interaction = makeInteraction();
    await routeButton(click(interaction, 'setuphome_roles'));
    await routeSelect(click(interaction, 'setupwizard_roles_select', { values: [] }));
    await routeButton(click(interaction, 'setupwizard_roles_create')); // sin roles → wiring panel directo

    const saveClick = click(interaction, 'setupwizard_roles_wiring_save');
    await routeButton(saveClick);

    expect(setGuildConfig).not.toHaveBeenCalled();
  });
});

describe('NEXO Setup — diagnóstico de canales', () => {
  it('setuphome_diagnostics escanea y muestra "sin problemas" cuando todo está bien', async () => {
    const interaction = makeInteraction();
    const diagClick = click(interaction, 'setuphome_diagnostics');
    await routeButton(diagClick);

    const embed = diagClick.update.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toMatch(/No se detectó ningún problema/);
  });

  it('con un problema real: el botón de corregir queda habilitado y dispara una confirmación', async () => {
    const roleRegistry = makeGuildRoleRegistry({ existingRoles: [makeRole('role-staff', 'Staff', 5)] });
    const guild = makeGuild({ roleRegistry });
    // Canal de logs de moderación SIN overwrite propio — @everyone lo ve por default,
    // exactamente el hallazgo 🔴 que scanGuildChannels debe detectar.
    guild.channels.cache.set('chan-log', {
      id: 'chan-log',
      name: 'registro-moderacion',
      type: 0,
      parent: null,
      guild,
      permissionOverwrites: { cache: new Map() },
    });
    getGuildConfig.mockResolvedValue({ log_channel_moderation_id: 'chan-log', moderator_role_id: 'role-staff' });
    const interaction = makeInteraction({ guild });

    const diagClick = click(interaction, 'setuphome_diagnostics');
    await routeButton(diagClick);
    const embed = diagClick.update.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toMatch(/registro-moderacion/);

    const fixClick = click(interaction, 'setupwizard_diagnostics_fix');
    await routeButton(fixClick);
    expect(fixClick.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Confirmar') }));
  });
});

describe('NEXO Setup — contador de miembros', () => {
  it('crear el contador: canal de voz bloqueado, nombre con el conteo real, guarda la columna', async () => {
    const guild = makeGuild({ memberCount: 77 });
    const interaction = makeInteraction({ guild });

    const createClick = click(interaction, 'setupwizard_counter_create');
    await routeButton(createClick);

    expect(guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringContaining('77'), type: 2 /* GuildVoice */ }),
    );
    expect(setGuildConfig).toHaveBeenCalledWith(guild.id, expect.objectContaining({ member_counter_channel_id: expect.any(String), member_counter_last_count: 77 }));
  });

  it('desactivar: limpia la columna sin borrar el canal de Discord', async () => {
    getGuildConfig.mockResolvedValue({ member_counter_channel_id: 'chan-x', member_counter_last_count: 5 });
    const interaction = makeInteraction();

    await routeButton(click(interaction, 'setupwizard_counter_disable'));

    expect(setGuildConfig).toHaveBeenCalledWith(interaction.guildId, { member_counter_channel_id: null, member_counter_last_count: null });
  });
});

describe('NEXO Setup — editor de bienvenida', () => {
  it('abre con la vista previa del texto de ejemplo cuando no hay nada personalizado', async () => {
    const interaction = makeInteraction();
    const welcomeClick = click(interaction, 'setuphome_welcome');
    await routeButton(welcomeClick);

    const [, preview] = welcomeClick.update.mock.calls[0][0].embeds;
    expect(preview.data.description).toContain('Ya sos parte de nuestra comunidad');
  });

  it('editar texto + guardar: persiste solo los campos completados y vuelve al home', async () => {
    const interaction = makeInteraction();
    await routeButton(click(interaction, 'setuphome_welcome'));

    const modalSubmit = click(interaction, 'modal_setupwizard_welcometext', {
      fields: {
        getTextInputValue: (id) => ({ titulo: '🎊 Hola {usuario}', descripcion: 'Texto custom', color: '', footer: '' }[id] ?? ''),
      },
    });
    await routeModal(modalSubmit);
    const [, preview] = modalSubmit.update.mock.calls[0][0].embeds;
    expect(preview.data.title).toContain('🎊 Hola');

    const saveClick = click(interaction, 'setupwizard_welcome_save');
    await routeButton(saveClick);
    expect(setGuildConfig).toHaveBeenCalledWith(interaction.guildId, { welcome_title: '🎊 Hola {usuario}', welcome_description: 'Texto custom', welcome_color: null, welcome_footer: null });
  });

  // Feedback en vivo del usuario: el selector de emoji tiene que estar DENTRO del mismo
  // modal de "✏️ Editar" (4 campos de texto + el selector como 5ta fila), no un botón
  // aparte — ver el comentario de setupwizard_welcome_edit en setup.js.
  it('sin emojis propios: el modal de editar se abre igual, solo sin el selector (4 filas)', async () => {
    const guild = makeGuild({ emojis: new Map() });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));

    const editClick = click(interaction, 'setupwizard_welcome_edit');
    await routeButton(editClick);

    expect(editClick.showModal).toHaveBeenCalledTimes(1); // no revienta, no se cae a un mensaje de error
    const modal = editClick.showModal.mock.calls[0][0];
    expect(modal.toJSON().components).toHaveLength(4);
  });

  it('con emojis propios: el modal de editar suma el selector como 5ta fila (Components V2)', async () => {
    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'pizza')]]);
    const guild = makeGuild({ emojis });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));

    const editClick = click(interaction, 'setupwizard_welcome_edit');
    await routeButton(editClick);

    const modal = editClick.showModal.mock.calls[0][0];
    expect(modal.toJSON().components).toHaveLength(5); // exactamente el máximo real de un modal
  });

  // DiscordAPIError 50035 real en producción: un select DENTRO de un modal es
  // "required" por defecto (BaseSelectMenuBuilder.setRequired, "Only for use in
  // modals") — un concepto SEPARADO de minValues. min_values:0 + required:true es una
  // combinación que Discord rechaza del lado del SERVIDOR, algo que .toJSON() nunca
  // detecta (es válido como objeto, el .toJSON() de discord.js no lo valida) — por eso
  // este test no reemplaza la verificación en vivo, solo evita que la MISMA
  // combinación rota se reintroduzca sin querer.
  it('el selector de emoji queda min_values:0 + required:false (nunca la combinación que Discord rechaza)', async () => {
    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'pizza')]]);
    const guild = makeGuild({ emojis });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));

    const editClick = click(interaction, 'setupwizard_welcome_edit');
    await routeButton(editClick);

    const label = editClick.showModal.mock.calls[0][0].toJSON().components[4];
    expect(label.component.min_values).toBe(0);
    expect(label.component.required).toBe(false);
  });

  it('elegir un emoji en el mismo submit lo agrega al final de la descripción que se acaba de escribir', async () => {
    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'pizza')]]);
    const guild = makeGuild({ emojis });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));
    await routeButton(click(interaction, 'setupwizard_welcome_edit'));

    const modalSubmit = click(interaction, 'modal_setupwizard_welcometext', {
      fields: {
        getTextInputValue: (id) => (id === 'descripcion' ? 'Mi texto propio' : ''),
        getStringSelectValues: () => ['emoji-1'],
      },
    });
    await routeModal(modalSubmit);

    const [, preview] = modalSubmit.update.mock.calls[0][0].embeds;
    expect(preview.data.description).toBe('Mi texto propio <:pizza:emoji-1>');

    await routeButton(click(interaction, 'setupwizard_welcome_save'));
    expect(setGuildConfig).toHaveBeenCalledWith(interaction.guildId, expect.objectContaining({ welcome_description: 'Mi texto propio <:pizza:emoji-1>' }));
  });

  it('el selector estaba disponible pero no se tocó (minValues 0): el texto se guarda sin ningún emoji agregado', async () => {
    const emojis = new Map([['emoji-1', makeGuildEmoji('emoji-1', 'pizza')]]);
    const guild = makeGuild({ emojis });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));
    await routeButton(click(interaction, 'setupwizard_welcome_edit'));

    const modalSubmit = click(interaction, 'modal_setupwizard_welcometext', {
      fields: {
        getTextInputValue: (id) => (id === 'descripcion' ? 'Mi texto propio' : ''),
        getStringSelectValues: () => [], // presente en el modal, pero nada elegido
      },
    });
    await routeModal(modalSubmit);

    const [, preview] = modalSubmit.update.mock.calls[0][0].embeds;
    expect(preview.data.description).toBe('Mi texto propio');
  });

  it('servidor sin emojis propios: el submit funciona igual (getStringSelectValues ni existe en ese modal)', async () => {
    const guild = makeGuild({ emojis: new Map() });
    const interaction = makeInteraction({ guild });
    await routeButton(click(interaction, 'setuphome_welcome'));
    await routeButton(click(interaction, 'setupwizard_welcome_edit'));

    const modalSubmit = click(interaction, 'modal_setupwizard_welcometext', {
      fields: { getTextInputValue: (id) => (id === 'descripcion' ? 'Mi texto propio' : '') }, // sin getStringSelectValues
    });
    await expect(routeModal(modalSubmit)).resolves.not.toThrow();

    const [, preview] = modalSubmit.update.mock.calls[0][0].embeds;
    expect(preview.data.description).toBe('Mi texto propio');
  });
});
