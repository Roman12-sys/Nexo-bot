// Router de botones por prefijo de customId. Cada feature registra su propio
// prefijo acá a medida que se migra (ej: 'giveaway_enter_', 'anuncio_edit_').
// handler recibe (interaction) y es responsable de responder/editar.
const handlers = [];

export function registerButtonPrefix(prefix, handler) {
  handlers.push({ prefix, handler });
}

export async function routeButton(interaction) {
  // QUÉ CAMBIÓ: antes tomaba el PRIMER prefijo registrado que matcheara — el orden lo
  // decide el import dinámico de los archivos de comandos (src/index.js), no algo
  // controlado a mano. Si un prefijo corto ('trivia_') se registraba antes que uno más
  // específico que lo tiene como substring ('trivia_ranking_page_'), el corto se comía
  // también todos los customId del específico. Hoy eso no pasa (trivia.js declara el
  // específico primero) pero es frágil: depende de mantener ese orden a mano para
  // siempre, en CUALQUIER archivo que registre dos prefijos así. Ahora se busca el
  // prefijo MÁS LARGO (más específico) entre todos los que matchean, sin importar el
  // orden de registro — el resultado deja de depender de eso.
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
