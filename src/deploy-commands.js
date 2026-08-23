import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Uso: node src/deploy-commands.js        -> registro global (tarda ~1h en propagar)
//      node src/deploy-commands.js dev    -> registro solo en GUILD_ID_DEV (instantáneo, para desarrollo)
const mode = process.argv[2];

async function loadCommandData() {
  const commandsPath = path.join(__dirname, 'commands');
  const commands = [];
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
      commands.push(json);
    }
  }
  return commands;
}

const commands = await loadCommandData();
const rest = new REST().setToken(config.discordToken);

try {
  if (mode === 'dev') {
    if (!config.guildIdDev) throw new Error('Falta GUILD_ID_DEV en .env para deploy dev.');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildIdDev), { body: commands });
    console.log(`${commands.length} comando(s) registrados en el server de test.`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`${commands.length} comando(s) registrados globalmente (puede tardar hasta 1h en propagar).`);
  }
} catch (error) {
  console.error('Error registrando comandos:', error);
  process.exit(1);
}
