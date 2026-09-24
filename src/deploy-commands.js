import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Uso: node src/deploy-commands.js        -> registro global (tarda ~1h en propagar)
//      node src/deploy-commands.js dev    -> registro solo en GUILD_ID_DEV (instantáneo, para desarrollo)
//
// Comandos con `export const ownerGuildOnly = true` (hoy solo /owner-metricas) nunca
// van al registro global: en modo global se registran aparte en GUILD_ID_DEV. Ese PUT
// reemplaza la lista entera del server de test, así que de paso borra la copia vieja
// que deja un `dev` anterior (la que Discord mostraba duplicada junto a la global).
const mode = process.argv[2];

async function loadCommandData() {
  const commandsPath = path.join(__dirname, 'commands');
  const commands = [];
  const ownerGuildCommands = [];
  const seenNames = new Map(); // name -> filePath, para detectar colisiones
  if (!fs.existsSync(commandsPath)) return commands;

  const categories = fs.readdirSync(commandsPath, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const category of categories) {
    const categoryPath = path.join(commandsPath, category.name);
    const files = fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const command = await import(pathToFileURL(filePath).href);
      if (!('data' in command)) continue;

      const json = command.data.toJSON();
      const previous = seenNames.get(json.name);
      if (previous) {
        throw new Error(`Nombre de comando duplicado "${json.name}": ${previous} y ${filePath}. Corregí uno de los dos antes de desplegar.`);
      }
      seenNames.set(json.name, filePath);
      (command.ownerGuildOnly ? ownerGuildCommands : commands).push(json);
    }
  }
  return { commands, ownerGuildCommands };
}

const { commands, ownerGuildCommands } = await loadCommandData();
const rest = new REST().setToken(config.discordToken);

try {
  if (mode === 'dev') {
    if (!config.guildIdDev) throw new Error('Falta GUILD_ID_DEV en .env para deploy dev.');
    const all = [...commands, ...ownerGuildCommands];
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildIdDev), { body: all });
    console.log(`${all.length} comando(s) registrados en el server de test.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`${commands.length} comando(s) registrados globalmente (puede tardar hasta 1h en propagar).`);
    if (config.guildIdDev) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildIdDev), { body: ownerGuildCommands });
      console.log(`${ownerGuildCommands.length} comando(s) solo-dueño registrados en el server de test (${ownerGuildCommands.map((c) => `/${c.name}`).join(', ')}).`);
    } else {
      console.warn(`⚠️ Falta GUILD_ID_DEV: no se registraron ${ownerGuildCommands.map((c) => `/${c.name}`).join(', ')} en ningún lado.`);
    }
  }
} catch (error) {
  console.error('Error registrando comandos:', error);
  process.exit(1);
}
