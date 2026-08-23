// Detecta secretos/tokens posteados por accidente en el chat (Discord tokens, API keys
// estilo OpenAI/Anthropic, AWS keys, JWTs y líneas de .env tipo "ALGO_TOKEN=valor").
// Patrones específicos a propósito — el objetivo es pescar secretos reales, no cualquier
// string largo, para no andar borrando mensajes normales por error.

const PATTERNS = [
  { type: 'Discord bot token', regex: /[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}/ },
  { type: 'API key (OpenAI/Anthropic)', regex: /\b(sk|sk-ant)-[A-Za-z0-9_-]{20,}\b/ },
  { type: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: 'JWT / Supabase key', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { type: 'Variable de entorno filtrada', regex: /\b(DISCORD_TOKEN|CLIENT_SECRET|SUPABASE_KEY|SUPABASE_URL|API_KEY|BOT_TOKEN|AWS_SECRET_ACCESS_KEY|WEBHOOK_URL)\s*=\s*\S{6,}/i },
];

// Muestra los primeros/últimos caracteres y tapa el medio, para que el log sea útil
// (el staff puede reconocer qué token es) sin republicar el secreto completo.
function redact(value) {
  if (value.length <= 10) return '•'.repeat(value.length);
  return `${value.slice(0, 6)}${'•'.repeat(Math.min(value.length - 10, 20))}${value.slice(-4)}`;
}

// Devuelve { type, preview } del primer patrón que matchea, o null si el mensaje está limpio.
export function detectSecret(content) {
  if (!content) return null;
  for (const { type, regex } of PATTERNS) {
    const match = content.match(regex);
    if (match) return { type, preview: redact(match[0]) };
  }
  return null;
}

// Reemplaza CUALQUIER coincidencia de los patrones de arriba dentro de un texto libre
// por su versión redactada, en vez de solo detectar/reportar la primera.
export function redactSecretsInText(text) {
  if (!text) return text;
  let result = text;
  for (const { regex } of PATTERNS) {
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    result = result.replace(globalRegex, (match) => redact(match));
  }
  return result;
}
