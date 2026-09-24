import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PermissionFlagsBits } from 'discord.js';

// Quién ve cada comando de staff en el menú de "/" (2026-09-24). Discord decide eso con
// setDefaultMemberPermissions (permiso NATIVO); NEXO decide quién puede ejecutarlo con
// isStaff()/isAdmin(). Hacen falta los dos, y antes cada comando elegía su permiso nativo
// por su cuenta: un rol de staff sin "Gestionar servidor" no veía /helpstaff ni
// /sanciones, y /estado, /metricas y /owner-metricas aparecían para cualquier miembro.
//
// Regla: un permiso nativo por tier de NEXO — "Aplicar timeout" para el tier Moderador,
// "Gestionar servidor" para el tier Administrador, "Administrador" para dueño —, salvo
// los comandos que equivalen 1:1 a una acción nativa de Discord (banear, expulsar,
// borrar mensajes, gestionar canales): esos piden la misma que pediría hacerlo a mano.
// /anuncio queda en "Gestionar servidor" pese a ser tier Moderador porque puede
// mencionar a @everyone (mismo criterio que llevó /say al tier Administrador).
const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..');

const { ModerateMembers, ManageGuild, Administrator, BanMembers, KickMembers, ManageMessages, ManageChannels } = PermissionFlagsBits;

const EXPECTED = {
  // Tier Moderador de NEXO
  helpstaff: ModerateMembers,
  staff: ModerateMembers,
  sanciones: ModerateMembers,
  sorteo: ModerateMembers,
  roles: ModerateMembers,
  estado: ModerateMembers,
  metricas: ModerateMembers,
  warn: ModerateMembers,
  warns: ModerateMembers,
  unwarn: ModerateMembers,
  'warn-editar': ModerateMembers,
  timeout: ModerateMembers,
  punish: ModerateMembers,
  unpunish: ModerateMembers,
  anuncio: ManageGuild,
  // Acciones con equivalente nativo
  ban: BanMembers,
  unban: BanMembers,
  kick: KickMembers,
  clear: ManageMessages,
  lock: ManageChannels,
  unlock: ManageChannels,
  voice: ManageChannels,
  // Tier Administrador de NEXO
  'economia-staff': ManageGuild,
  xp: ManageGuild,
  'shop-admin': ManageGuild,
  say: ManageGuild,
  // Dueño / Administrator nativo
  setup: Administrator,
  config: Administrator,
  rolreacciones: Administrator,
};

// Comandos para cualquier miembro que usan isStaff() solo en un botón puntual
// (aprobar una confesión, cerrar una encuesta ajena) — nunca para abrir el comando.
const MEMBER_COMMANDS_WITH_STAFF_BUTTONS = new Set(['confession', 'encuesta']);

let commands;

beforeAll(async () => {
  commands = [];
  const commandsPath = path.join(rootDir, 'src', 'commands');
  for (const category of fs.readdirSync(commandsPath, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of fs.readdirSync(path.join(commandsPath, category.name)).filter((f) => f.endsWith('.js'))) {
      const filePath = path.join(commandsPath, category.name, file);
      const mod = await import(pathToFileURL(filePath).href);
      const json = mod.data.toJSON();
      commands.push({
        name: json.name,
        defaultPermissions: json.default_member_permissions ?? null,
        ownerGuildOnly: mod.ownerGuildOnly === true,
        usesStaffGate: /\bis(Staff|Admin)\(/.test(fs.readFileSync(filePath, 'utf8')),
      });
    }
  }
}, 30_000);

describe('visibilidad de comandos de staff en el menú de "/"', () => {
  it('cada comando de staff pide exactamente el permiso nativo de su tier', () => {
    for (const [name, flag] of Object.entries(EXPECTED)) {
      const command = commands.find((c) => c.name === name);
      expect(command, `/${name} no existe`).toBeDefined();
      expect(command.defaultPermissions, `/${name}`).toBe(flag.toString());
    }
  });

  it('ningún comando con chequeo de staff queda visible para todos', () => {
    const visibleToEveryone = commands
      .filter((c) => c.usesStaffGate && c.defaultPermissions === null)
      .filter((c) => !c.ownerGuildOnly && !MEMBER_COMMANDS_WITH_STAFF_BUTTONS.has(c.name))
      .map((c) => c.name);
    expect(visibleToEveryone).toEqual([]);
  });

  it('/owner-metricas nunca va al registro global (solo al server del dueño)', () => {
    const ownerOnly = commands.filter((c) => c.ownerGuildOnly).map((c) => c.name);
    expect(ownerOnly).toEqual(['owner-metricas']);
  });
});
