// Router de modales por prefijo de customId. Mismo patrón que buttons.js.
const handlers = [];

export function registerModalPrefix(prefix, handler) {
  handlers.push({ prefix, handler });
}

export async function routeModal(interaction) {
  const match = handlers.find((h) => interaction.customId.startsWith(h.prefix));
  if (!match) return false;
  await match.handler(interaction);
  return true;
}
