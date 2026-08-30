import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildIdDev: process.env.GUILD_ID_DEV || null,
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  // Opcionales a propósito (a diferencia de todo lo de arriba): sin esto el bot arranca
  // igual, /play con YouTube sigue andando — solo un link de Spotify muestra "Spotify no
  // está configurado" en vez de tirar el proceso abajo al bootear. Ver spotifyResolver.js.
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
};
