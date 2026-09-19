// Embed de bienvenida personalizable (NEXO Setup Inteligente, Bloques 11-12) —
// reemplaza el enfoque basado en imagen (welcomeImage.js, @napi-rs/canvas) como
// respuesta por defecto de guildMemberAdd.js. welcomeImage.js NO se borra (rankCardImage.js
// sigue dependiendo de la misma infraestructura de canvas/fuentes, y es una utilidad
// propia con sus propios tests) — solo deja de ser el camino por defecto.
//
// 4 columnas nuevas y nullable en guild_config (welcome_title/welcome_description/
// welcome_color/welcome_footer): null en cualquiera de ellas = usar el default de acá
// abajo, así un guild que nunca toca el editor sigue viendo exactamente el texto de
// ejemplo del Bloque 11, sin ninguna migración de datos necesaria.
//
// Variables soportadas en título/descripción/footer: {servidor} {usuario}
// {usuarioNombre} {miembroNumero} — reemplazo de texto simple, sin motor de plantillas
// nuevo (no hace falta más que esto).
import { EmbedBuilder } from 'discord.js';
import { MAGENTA_COLOR, BRAND_NAME } from './embeds.js';

export const DEFAULT_WELCOME_TITLE = '👋 ¡Bienvenido a {servidor}!';
export const DEFAULT_WELCOME_DESCRIPTION =
  'Hola {usuario}.\n\nYa sos parte de nuestra comunidad.\n\n📜 Leé las reglas\n🎭 Elegí tus roles\n💬 Presentate\n\n¡Esperamos que disfrutes tu estadía!';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function applyTemplate(text, ctx) {
  return text
    .replaceAll('{servidor}', ctx.servidor)
    .replaceAll('{usuario}', ctx.usuario)
    .replaceAll('{usuarioNombre}', ctx.usuarioNombre)
    .replaceAll('{miembroNumero}', ctx.miembroNumero);
}

export function contextFromMember(member) {
  return {
    servidor: member.guild.name,
    usuario: `${member}`,
    usuarioNombre: member.displayName,
    miembroNumero: member.guild.memberCount.toLocaleString('es-ES'),
    avatarURL: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
  };
}

export function contextFromInteraction(interaction) {
  return {
    servidor: interaction.guild.name,
    usuario: `${interaction.user}`,
    usuarioNombre: interaction.member?.displayName || interaction.user.username,
    miembroNumero: interaction.guild.memberCount.toLocaleString('es-ES'),
    avatarURL: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
  };
}

// `cfg` es guild_config (o un draft en memoria del editor con el mismo shape) — `ctx`
// viene de contextFromMember/contextFromInteraction. Trunca a los límites reales de
// Discord (título 256, descripción 4096, footer 2048) — un texto custom largo no debe
// poder romper el envío del mensaje de bienvenida.
// Trailer de descubrimiento (COM, Ciclo 1) — SIEMPRE se agrega al final de la
// descripción, sea la default o una que el admin customizó en el editor: un miembro
// nuevo no tiene forma de enterarse de que /help existe si el admin lo saca sin darse
// cuenta al reescribir el texto. No forma parte del draft editable (Bloque 12) a propósito.
const HELP_HINT = 'Usá `/help` para conocer todo lo que podés hacer en **{servidor}**.';

export function buildWelcomeEmbed(cfg, ctx) {
  const title = applyTemplate(cfg.welcome_title || DEFAULT_WELCOME_TITLE, ctx).slice(0, 256);
  const rawDescription = `${cfg.welcome_description || DEFAULT_WELCOME_DESCRIPTION}\n\n${HELP_HINT}`;
  const description = applyTemplate(rawDescription, ctx).slice(0, 4096);
  const footerText = cfg.welcome_footer ? applyTemplate(cfg.welcome_footer, ctx).slice(0, 2048) : BRAND_NAME;
  const color = HEX_COLOR_RE.test(cfg.welcome_color || '') ? cfg.welcome_color : MAGENTA_COLOR;

  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setThumbnail(ctx.avatarURL).setFooter({ text: footerText });
}

// Vista previa del editor (Bloque 12) — mismo builder, pero SIN el trailer de /help
// (sería confuso mostrarlo dos veces si el propio admin lo menciona en su texto) y con
// una etiqueta que aclara que es una previsualización, no el mensaje real.
export function buildWelcomePreviewEmbed(draft, ctx) {
  const title = applyTemplate(draft.welcome_title || DEFAULT_WELCOME_TITLE, ctx).slice(0, 256);
  const description = applyTemplate(draft.welcome_description || DEFAULT_WELCOME_DESCRIPTION, ctx).slice(0, 4096);
  const footerText = draft.welcome_footer ? applyTemplate(draft.welcome_footer, ctx).slice(0, 2048) : BRAND_NAME;
  const color = HEX_COLOR_RE.test(draft.welcome_color || '') ? draft.welcome_color : MAGENTA_COLOR;

  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setThumbnail(ctx.avatarURL).setFooter({ text: footerText });
}

export function isCustomWelcomeConfigured(cfg) {
  return Boolean(cfg.welcome_title || cfg.welcome_description || cfg.welcome_color || cfg.welcome_footer);
}
