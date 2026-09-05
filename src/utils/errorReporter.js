// Alerta operativa mínima (Fase 4B, COM-1): antes de esto, una falla real en un cliente
// solo dejaba rastro en console.error → logs de Railway — nadie se enteraba salvo que
// alguien estuviera mirando en vivo o el cliente se quejara. Un canal fijo en un
// servidor propio de operación (NUNCA guild_config — esto es infraestructura interna,
// no una feature de cliente) en vez de sumar un proveedor externo (Sentry/webhook) que
// no hace falta para el volumen de un piloto.
//
// Manda el mensaje por REST directo (fetch a discord.com/api, Authorization: Bot
// <token>) en vez de `client.channels.fetch().send()` — a propósito: el bot y el
// dashboard son DOS PROCESOS separados (dashboard/server.js no tiene una conexión de
// gateway, ver CLAUDE.md "Dashboard web") pero los dos necesitan poder llamar a esta
// misma función (COM-1 pide integrarla también en los handlers globales del
// dashboard). Un POST REST plano funciona igual desde cualquiera de los dos sin
// depender de un Client de discord.js — el parámetro `client` se conserva en la firma
// por si algún caller ya lo tiene a mano (el bot), pero la función nunca lo usa: desde
// el dashboard se llama con `null` sin ninguna diferencia de comportamiento.
import { config } from '../config.js';
import { LOG_COLOR, BRAND_NAME } from './embeds.js';
import { redactSecretsInText } from './secretDetector.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Una alerta por huella (contexto+error) cada 10 minutos, no una por ocurrencia — un
// loop roto que falla en cada tick no debe spamear el canal. Mismo patrón Map
// autolimpiante que userUpdate.js.
const THROTTLE_MS = 10 * 60 * 1000;
const lastAlertedAt = new Map(); // huella -> timestamp de la última alerta enviada

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastAlertedAt) {
    if (now - ts >= THROTTLE_MS) lastAlertedAt.delete(key);
  }
}, THROTTLE_MS).unref();

function fingerprint(context, error) {
  return `${context}::${error?.name || 'Error'}::${error?.message || String(error)}`;
}

// Único punto de entrada, llamable desde el bot O el dashboard. Nunca debe poder tirar
// nada: se llama desde catch-alls y handlers globales que ya están procesando un error
// real — una excepción ACÁ adentro no puede sumarse al problema original, por eso el
// cuerpo entero vive en un solo try/catch con console.error como única red de respaldo
// si la alerta misma falla (canal borrado, permisos, token inválido, rate limit).
// `client` no se usa (ver comentario de arriba) — queda en la firma para que los
// call-sites del bot, que ya tienen uno a mano, no necesiten un caso especial.
export async function reportCriticalError(client, context, error) {
  try {
    if (!config.operatorAlertChannelId) return;

    const key = fingerprint(context, error);
    const now = Date.now();
    const last = lastAlertedAt.get(key);
    if (last !== undefined && now - last < THROTTLE_MS) return;
    lastAlertedAt.set(key, now);

    // redactSecretsInText por las dudas en los 3 campos — context lo arma el propio
    // código (nunca debería traer un secreto), pero aplicar la misma limpieza acá
    // cuesta nada y cierra cualquier descuido futuro en un call-site.
    const contextText = redactSecretsInText(String(context ?? 'Desconocido')).slice(0, 1024);
    const message = redactSecretsInText(String(error?.message ?? error ?? 'Sin mensaje')).slice(0, 1000);
    const stack = redactSecretsInText(String(error?.stack ?? '')).slice(0, 1000);

    const embed = {
      color: parseInt(LOG_COLOR.slice(1), 16),
      title: '🚨 Error crítico en Nexo',
      fields: [
        { name: 'Contexto', value: contextText || 'Sin contexto' },
        { name: 'Mensaje', value: message || 'Sin mensaje' },
      ],
      footer: { text: BRAND_NAME },
      timestamp: new Date().toISOString(),
    };
    if (stack) embed.fields.push({ name: 'Stack (recortado)', value: `\`\`\`${stack}\`\`\`` });

    const response = await fetch(`${DISCORD_API_BASE}/channels/${config.operatorAlertChannelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.discordToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!response.ok) {
      console.error(`❌ reportCriticalError: Discord respondió ${response.status} al mandar la alerta operativa.`);
    }
  } catch (reportError) {
    console.error('❌ reportCriticalError no pudo enviar la alerta operativa:', reportError);
  }
}
