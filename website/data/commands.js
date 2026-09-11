// Lee el JSON generado por scripts/generate-commands-data.js — el proceso del sitio
// SOLO lee este archivo estático, nunca importa los comandos reales (ver el comentario
// de ese script y de website/config.js para el motivo: evitar que website/ necesite
// DISCORD_TOKEN/SUPABASE_*). Si el JSON no existe todavía (repo recién clonado, nadie
// corrió el script), el sitio sigue arrancando — /commands simplemente muestra "sin
// datos" en vez de tirar el proceso entero abajo por un archivo de build faltante.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'commands.generated.json');

function load() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { generatedAt: null, commands: [] };
  }
}

const { generatedAt, commands } = load();

export const COMMANDS = commands;
export const COMMANDS_GENERATED_AT = generatedAt;

// Etiquetas en español de los permisos nativos de Discord que aparecen en
// requiredDiscordPermissions — son solo 8 valores distintos entre los 88 comandos reales
// (verificado recorriendo el JSON generado), no una tabla genérica de los ~40 permisos
// de la API. Mismas etiquetas que ya usa src/utils/botPermissions.js donde coinciden.
const PERMISSION_LABELS = {
  Administrator: 'Administrador (nativo de Discord)',
  BanMembers: 'Banear miembros',
  KickMembers: 'Expulsar miembros',
  ManageChannels: 'Gestionar canales',
  ManageGuild: 'Gestionar servidor',
  ManageMessages: 'Gestionar mensajes',
  ManageRoles: 'Gestionar roles',
  ModerateMembers: 'Aplicar timeout',
};

export function formatPermissionLabel(flag) {
  return PERMISSION_LABELS[flag] || flag;
}

export function getCommandsByCategory(categoryId) {
  return COMMANDS.filter((c) => c.category === categoryId);
}

// Ejemplos "/comando subcomando" reales para mostrar en las tarjetas de features — para
// categorías con pocos comandos de nivel superior pero varios subcomandos (ej. /sorteo,
// /config), mostrar solo el nombre del comando ("/sorteo" x1) es mucho menos útil que
// mostrar sus acciones reales ("/sorteo crear", "/sorteo cancelar"). Nunca inventa un
// subcomando: si un comando no tiene subcomandos, entra tal cual ("/setup").
export function sampleExamplesForCategory(categoryId, limit = 6, maxPerCommand = 2) {
  const examples = [];
  for (const command of getCommandsByCategory(categoryId)) {
    const subcommands = command.options.filter((o) => o.kind === 'subcommand');
    if (subcommands.length === 0) {
      examples.push(`/${command.name}`);
    } else {
      // Máximo maxPerCommand por comando — sin esto, un comando con muchos
      // subcomandos (ej. /config) se comía todo el cupo y la muestra nunca llegaba a
      // mostrar los otros comandos reales de la categoría.
      for (const sub of subcommands.slice(0, maxPerCommand)) {
        examples.push(`/${command.name} ${sub.name}`);
      }
    }
    if (examples.length >= limit) break;
  }
  return examples.slice(0, limit);
}
