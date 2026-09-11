// QUÉ CAMBIÓ: ANNOUNCE_CHANNEL_ID hardcodeado → barrido sobre guild_config.
// MOTIVO: auditoría 2026-08-29 (Diagnóstico Nexo, Parte 15) — "si la intención es que
// LoL sea un diferencial DENTRO de un bot general, tiene que poder prenderse por guild,
// igual que cualquier otro módulo". El estado de "qué patch fue el último anunciado"
// (lol_patch_state, ver lolPatchStore.js) sigue siendo UNA sola fila global a
// propósito — es el mismo patch para todo el mundo, lo único que cambia por servidor
// es A QUIÉN se le manda el aviso.
// VERIFICACIÓN: en un guild con /config canal-lol configurado, el próximo patch nuevo
// llega a ese canal. En un guild sin configurar, no llega nada (ni error en consola).
//
// Riot no tiene una API pública de patch notes. Esto lee el JSON __NEXT_DATA__
// embebido en la página de tags/patch-notes de leagueoflegends.com (el mismo dato que
// usa el sitio para renderizar la grilla de artículos) — un endpoint no documentado.
// Si Riot cambia el markup del sitio, fetchLatestPatchArticle empieza a tirar o a
// devolver null y el barrido queda en no-op silencioso (logueado), nunca tira el bot.
import { EmbedBuilder } from 'discord.js';
import { getLastAnnouncedPatchUrl, setLastAnnouncedPatchUrl } from './lolPatchStore.js';
import { getGuildsWithLolAnnounceChannel } from './guildConfigStore.js';
import { reportCriticalError } from './errorReporter.js';

const PATCH_NOTES_TAG_URL = 'https://www.leagueoflegends.com/en-us/news/tags/patch-notes/';
const SITE_ORIGIN = 'https://www.leagueoflegends.com';
const TICK_MS = 20 * 60 * 1000; // los patches no salen más seguido que esto, no hace falta más agresivo
const FETCH_TIMEOUT_MS = 10 * 1000; // ARCH-2, auditoría completa 2026-09-11 — ver más abajo
const LOL_GOLD = '#C89B3C'; // Hextech gold

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchLatestPatchArticle() {
  // ARCH-2 (auditoría completa 2026-09-11): sin timeout, un stall de red (la conexión
  // ni siquiera cierra, no es un HTTP error) dejaba este fetch colgado indefinidamente
  // — con el tickRunning de más abajo, un solo tick trabado bloqueaba TODOS los
  // siguientes para siempre en vez de saltear el que está colgado.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(PATCH_NOTES_TAG_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexoBot/1.0)' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} pidiendo la página de patch notes`);
  const html = await res.text();

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No se encontró __NEXT_DATA__ en el HTML — Riot cambió el sitio');

  const data = JSON.parse(match[1]);
  const blades = data?.props?.pageProps?.page?.blades ?? [];
  const grid = blades.find((b) => b.type === 'articleCardGrid');
  const items = grid?.items ?? [];

  // Filtro de sanidad: la grilla ya viene filtrada por el tag de la URL, pero por las
  // dudas nos quedamos solo con lo que realmente cuelga de /news/game-updates/.
  const article = items.find((item) => item?.action?.payload?.url?.includes('/news/game-updates/'));
  if (!article) return null;

  const relativeUrl = article.action.payload.url;
  return {
    url: relativeUrl.startsWith('http') ? relativeUrl : `${SITE_ORIGIN}${relativeUrl}`,
    title: article.title || 'Nuevo patch de League of Legends',
    summary: article.description?.body ? stripHtml(article.description.body) : null,
    imageUrl: article.media?.url || null,
    publishedAt: article.publishedAt || null,
  };
}

function buildPatchEmbed(article) {
  const description = article.summary
    ? `${article.summary}\n\n📋 [Leer el patch note completo](${article.url})`
    : `📋 [Leer el patch note completo](${article.url})`;

  const embed = new EmbedBuilder()
    .setColor(LOL_GOLD)
    .setAuthor({ name: 'League of Legends · Patch Notes' })
    .setTitle(article.title)
    .setURL(article.url)
    .setDescription(description)
    .setFooter({ text: 'Fuente: leagueoflegends.com' })
    .setTimestamp(article.publishedAt ? new Date(article.publishedAt) : new Date());

  if (article.imageUrl) embed.setImage(article.imageUrl);

  return embed;
}

async function checkForNewPatch(client) {
  const article = await fetchLatestPatchArticle();
  if (!article) return;

  const lastUrl = await getLastAnnouncedPatchUrl();
  if (lastUrl === article.url) return; // ya se avisó este mismo patch

  if (lastUrl === null) {
    // Primera corrida (tabla vacía): siembra el estado sin mandar mensaje, para no
    // anunciar como "nuevo" un patch que puede tener semanas al desplegar esta feature.
    await setLastAnnouncedPatchUrl(article.url);
    return;
  }

  const targets = await getGuildsWithLolAnnounceChannel();
  const embed = buildPatchEmbed(article);

  // Un servidor con el canal mal configurado (borrado, sin permisos) no debe impedir
  // que el resto reciba el aviso — mismo criterio que guildDelete.js con Promise.allSettled,
  // pero acá alcanza un for-of con catch por iteración porque el volumen es bajo
  // (un aviso cada 20 min como mucho, no un hot path).
  for (const { guildId, channelId } of targets) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error(`❌ [patch notes LoL] No se pudo resolver el canal ${channelId} del guild ${guildId}`);
      continue;
    }
    await channel.send({ embeds: [embed] }).catch((error) => console.error(`❌ [patch notes LoL] Error enviando al guild ${guildId}:`, error));
  }

  await setLastAnnouncedPatchUrl(article.url);
  console.log(`🎮 [patch notes LoL] Anunciado a ${targets.length} servidor(es): ${article.title}`);
}

// ARCH-2 (auditoría completa 2026-09-11): sin esta guardia, un tick colgado (ver el
// timeout de arriba — cubre el caso común, no todos) podía solaparse con el siguiente
// disparo del setInterval; dos chequeos en paralelo leyendo/escribiendo
// lol_patch_state podían terminar anunciando el mismo patch dos veces. Mismo patrón
// que voiceXpEngine.js — con una diferencia real: acá también existe un chequeo
// INICIAL (antes del primer tick del setInterval), así que la guardia tiene que
// envolver los DOS disparadores con la misma variable, no solo el setInterval.
let tickRunning = false;

function runTick(client) {
  if (tickRunning) {
    console.warn('⚠️ [patch notes LoL] El chequeo anterior todavía no terminó — se saltea este tick.');
    return;
  }
  tickRunning = true;
  checkForNewPatch(client)
    .catch((error) => {
      console.error('❌ [patch notes LoL] Error en el chequeo:', error);
      reportCriticalError(client, 'lolPatchEngine: chequeo de patch notes', error);
    })
    .finally(() => {
      tickRunning = false;
    });
}

export function startLolPatchLoop(client) {
  runTick(client);
  setInterval(() => runTick(client), TICK_MS).unref();
}
