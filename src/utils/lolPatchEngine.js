// Anuncia patch notes nuevos de League of Legends en un canal fijo de un servidor
// puntual — no es una feature multi-tenant de guild_config, el usuario pidió un canal
// específico (mismo criterio que la presencia fija de ready.js, ver CLAUDE.md).
//
// Riot no tiene una API pública de patch notes. Esto lee el JSON __NEXT_DATA__
// embebido en la página de tags/patch-notes de leagueoflegends.com (el mismo dato que
// usa el sitio para renderizar la grilla de artículos) — un endpoint no documentado.
// Si Riot cambia el markup del sitio, fetchLatestPatchArticle empieza a tirar o a
// devolver null y el barrido queda en no-op silencioso (logueado), nunca tira el bot.
import { EmbedBuilder } from 'discord.js';
import { getLastAnnouncedPatchUrl, setLastAnnouncedPatchUrl } from './lolPatchStore.js';

const ANNOUNCE_CHANNEL_ID = '1542041482918109235';
const PATCH_NOTES_TAG_URL = 'https://www.leagueoflegends.com/en-us/news/tags/patch-notes/';
const SITE_ORIGIN = 'https://www.leagueoflegends.com';
const TICK_MS = 20 * 60 * 1000; // los patches no salen más seguido que esto, no hace falta más agresivo
const LOL_GOLD = '#C89B3C'; // Hextech gold

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchLatestPatchArticle() {
  const res = await fetch(PATCH_NOTES_TAG_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexoBot/1.0)' },
  });
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

  const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error(`❌ [patch notes LoL] No se pudo resolver el canal ${ANNOUNCE_CHANNEL_ID}`);
    return;
  }

  await channel.send({ embeds: [buildPatchEmbed(article)] });
  await setLastAnnouncedPatchUrl(article.url);
  console.log(`🎮 [patch notes LoL] Anunciado: ${article.title}`);
}

export function startLolPatchLoop(client) {
  checkForNewPatch(client).catch((error) => console.error('❌ [patch notes LoL] Error en el chequeo inicial:', error));
  setInterval(() => {
    checkForNewPatch(client).catch((error) => console.error('❌ [patch notes LoL] Error en el barrido:', error));
  }, TICK_MS).unref();
}
