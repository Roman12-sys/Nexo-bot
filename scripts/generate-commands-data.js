// Genera website/data/commands.generated.json a partir de los SlashCommandBuilder
// reales — mismo mecanismo que src/deploy-commands.js (import dinámico + .toJSON()),
// pero acá el output es un JSON estático que después lee website/ en runtime.
//
// POR QUÉ UN SCRIPT APARTE, no parte del proceso siempre-vivo del sitio: importar los
// 88 archivos de comando arrastra utils/economyStore.js, utils/guildConfigStore.js,
// etc. -> src/supabaseClient.js -> src/config.js, que exige DISCORD_TOKEN y
// SUPABASE_SERVICE_ROLE_KEY con throw al importarse. El sitio público (website/) está
// diseñado a propósito para no tener esos secrets en memoria (ver website/config.js) —
// así que la única forma de sacar datos reales de los comandos sin romper esa garantía
// es hacerlo en un paso de build/deploy aparte, corrido a mano o en CI con el .env
// completo, nunca en el proceso que atiende tráfico público.
//
// Uso: node scripts/generate-commands-data.js
// Correr de nuevo cada vez que se agrega/saca/edita un comando y se quiere que
// /commands en el sitio refleje el cambio (mismo criterio operativo que
// "node src/deploy-commands.js" para que Discord se entere).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PermissionsBitField } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', 'src', 'commands');
const OUTPUT_PATH = path.join(__dirname, '..', 'website', 'data', 'commands.generated.json');

// Mismo mapeo carpeta->categoría que website/data/features.js usa para sus tarjetas —
// centralizado ACÁ (no en features.js) porque este script es el único lugar que ve el
// nombre de archivo real, necesario para separar economía/casino. features.js importa
// el resultado ya categorizado en vez de reimplementar este mapeo.
function categoryForCommand(folder, filename) {
  if (folder === 'economia' && ['coinflip.js', 'dado.js', 'ruleta.js', 'slots.js'].includes(filename)) return 'casino';
  const map = {
    accion: 'accion',
    admin: 'administracion',
    anuncios: 'anuncios',
    diversion: 'diversion',
    economia: 'economia',
    general: 'informacion',
    informacion: 'informacion',
    moderacion: 'moderacion',
    progresion: 'progresion',
    sorteos: 'sorteos',
    utilidad: 'diversion',
    xp: 'progresion',
  };
  return map[folder] || folder;
}

const OPTION_TYPE_LABELS = {
  3: 'texto', 4: 'número entero', 5: 'sí/no', 6: 'usuario', 7: 'canal',
  8: 'rol', 9: 'mención', 10: 'número', 11: 'archivo',
};

// Permisos nativos de Discord que algún comando exige vía .setDefaultMemberPermissions
// — decodificados con el propio PermissionsBitField de discord.js (nunca una tabla a
// mano que se puede desactualizar). La mayoría del staffing real de NEXO pasa por
// guild_config (isStaff/isAdmin), no por esto — este campo solo existe cuando el
// comando ADEMÁS restringe a nivel de Discord (ej. requerir Administrator nativo).
function decodeDefaultMemberPermissions(bitfieldString) {
  if (!bitfieldString) return [];
  return new PermissionsBitField(BigInt(bitfieldString)).toArray();
}

function formatOptions(options) {
  if (!options || options.length === 0) return [];
  return options.map((opt) => {
    if (opt.type === 1 || opt.type === 2) {
      return {
        kind: opt.type === 1 ? 'subcommand' : 'subcommand-group',
        name: opt.name,
        description: opt.description,
        options: formatOptions(opt.options),
      };
    }
    return {
      kind: 'parameter',
      name: opt.name,
      description: opt.description,
      required: Boolean(opt.required),
      type: OPTION_TYPE_LABELS[opt.type] || 'valor',
      choices: (opt.choices || []).map((c) => c.name),
    };
  });
}

async function main() {
  const commands = [];
  const categories = fs.readdirSync(COMMANDS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const category of categories) {
    const categoryPath = path.join(COMMANDS_DIR, category.name);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const mod = await import(pathToFileURL(filePath).href);
      if (!('data' in mod)) continue;

      const json = mod.data.toJSON();
      commands.push({
        name: json.name,
        description: json.description,
        category: categoryForCommand(category.name, file),
        folder: category.name,
        dmAllowed: json.dm_permission !== false,
        requiredDiscordPermissions: decodeDefaultMemberPermissions(json.default_member_permissions),
        options: formatOptions(json.options),
      });
    }
  }

  commands.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), commands }, null, 2));
  console.log(`✅ ${commands.length} comandos escritos en ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error('❌ Error generando los datos de comandos:', error);
  process.exit(1);
});
