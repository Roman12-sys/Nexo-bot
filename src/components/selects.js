// Router de select menus (string select y user select) por prefijo de customId.
// Mismo patrón que buttons.js/modals.js — Discord los entrega como interacciones
// distintas de los botones, así que necesitan su propio router.
const handlers = [];

export function registerSelectPrefix(prefix, handler) {
  handlers.push({ prefix, handler });
}

export async function routeSelect(interaction) {
  const match = handlers.find((h) => interaction.customId.startsWith(h.prefix));
  if (!match) return false;
  await match.handler(interaction);
  return true;
}
