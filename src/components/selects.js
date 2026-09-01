// Router de select menus (string select y user select) por prefijo de customId.
// Mismo patrón que buttons.js/modals.js — Discord los entrega como interacciones
// distintas de los botones, así que necesitan su propio router.
const handlers = [];

export function registerSelectPrefix(prefix, handler) {
  handlers.push({ prefix, handler });
}

export async function routeSelect(interaction) {
  // Busca el prefijo MÁS LARGO (más específico) entre todos los que matchean, en vez del
  // primero registrado — mismo motivo y mismo fix que buttons.js (ver ese archivo).
  // MOTIVO: auditoría Fase 2B, sección 13.
  let match = null;
  for (const candidate of handlers) {
    if (!interaction.customId.startsWith(candidate.prefix)) continue;
    if (!match || candidate.prefix.length > match.prefix.length) match = candidate;
  }
  if (!match) return false;
  await match.handler(interaction);
  return true;
}
