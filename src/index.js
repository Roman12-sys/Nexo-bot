import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { registerShutdown } from './utils/shutdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// discord.js emite 'error'/'shardError' en problemas de conexión (blips de red,
// reconexiones del gateway) — sin un listener, Node trata un 'error' no manejado en un
// EventEmitter como excepción fatal y tira todo el proceso por un problema transitorio.
client.on('error', (error) => console.error('❌ Error del cliente de Discord:', error));
client.on('shardError', (error) => console.error('❌ Error de conexión con el gateway:', error));

// Red de seguridad general: un error async sin catch en algún punto del código no debería
// tirar el proceso en silencio. Se loguea siempre; en uncaughtException además se sale con
// código 1 para que el "restart policy" de Railway levante un proceso limpio en vez de
// seguir corriendo en un estado posiblemente corrupto.
process.on('unhandledRejection', (reason) => console.error('❌ Promesa rechazada sin manejar:', reason));
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada, reiniciando el proceso:', error);
  process.exit(1);
});

client.commands = new Collection();

async function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  if (!fs.existsSync(commandsPath)) return;

  const categories = fs.readdirSync(commandsPath, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category.name);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      // Un solo comando roto (error de sintaxis, import inválido) no debería tirar
      // abajo los otros 74 — se loguea y se sigue, en vez de dejar que el error se
      // propague al uncaughtException global y reinicie el proceso en loop.
      try {
        const command = await import(pathToFileURL(filePath).href);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
        } else {
          console.warn(`[WARN] Comando en ${filePath} le falta "data" o "execute".`);
        }
      } catch (error) {
        console.error(`❌ No se pudo cargar el comando en ${filePath}:`, error);
      }
    }
  }
}

async function loadEvents() {
  const eventsPath = path.join(__dirname, 'events');
  if (!fs.existsSync(eventsPath)) return;

  const files = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(eventsPath, file);
    try {
      const event = await import(pathToFileURL(filePath).href);
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
    } catch (error) {
      console.error(`❌ No se pudo cargar el evento en ${filePath}:`, error);
    }
  }
}

await loadCommands();
await loadEvents();

// SIGTERM es lo que manda Railway en cada redeploy/restart antes de matar el proceso
// con SIGKILL si no respondió a tiempo; SIGINT es Ctrl+C en desarrollo. client.destroy()
// cierra la conexión de gateway de forma prolija (deja de aceptar eventos nuevos) en vez
// de cortarla de golpe.
registerShutdown(['SIGTERM', 'SIGINT'], async () => {
  await client.destroy();
});

client.login(config.discordToken);
