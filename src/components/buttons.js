// Router de botones por prefijo de customId. Cada feature registra su propio
// prefijo acá a medida que se migra (ej: 'giveaway_enter_', 'anuncio_edit_').
// handler recibe (interaction) y es responsable de responder/editar.
const handlers = [];

export function registerButtonPrefix(prefix, handler) {
  handlers.push({ prefix, handler });
}

export async function routeButton(interaction) {
  const match = handlers.find((h) => interaction.customId.startsWith(h.prefix));
  if (!match) return false;
  await match.handler(interaction);
  return true;
}
