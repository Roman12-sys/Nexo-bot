// Traduce los códigos de error más comunes de la API de Discord (discord.js los expone
// como `error.code` en cualquier DiscordAPIError) a un mensaje que le dice al staff QUÉ
// pasó, en vez del genérico "❌ Ocurrió un error" que obliga a mirar los logs del
// proceso para algo que el mensaje ya podría decir. Deliberadamente acotado a los pocos
// códigos que realmente aparecen en comandos de moderación — no un mapeo exhaustivo de
// los ~40 códigos que tiene la API.
const DISCORD_ERROR_MESSAGES = {
  50013: '❌ Al bot le falta un permiso de Discord para completar esta acción (revisá su rol en Ajustes del servidor → Roles).',
  50001: '❌ El bot no tiene acceso a ese canal o recurso.',
  10011: '❌ Ese rol ya no existe — puede que se haya borrado. Reconfigurálo si hace falta.',
  10003: '❌ Ese canal ya no existe — puede que se haya borrado.',
  10007: '❌ Ese usuario ya no está en el servidor.',
  10013: '❌ Ese usuario no existe.',
};

// Si el error trae un código conocido, devuelve el mensaje específico; si no, el
// fallback que ya tenía el comando (nunca deja al staff sin ningún mensaje).
export function describeError(error, fallback) {
  return DISCORD_ERROR_MESSAGES[error?.code] || fallback;
}
