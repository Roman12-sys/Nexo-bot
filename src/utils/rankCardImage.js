// Tarjeta de rango visual para /nivel — mismo patrón exacto que welcomeImage.js (fuentes
// propias registradas desde archivos, porque Railway no trae ninguna instalada; avatar
// circular cargado por fetch). Antes /nivel mostraba el progreso como una barra de texto
// Unicode; esto reusa la infraestructura de canvas que el proyecto ya tiene resuelta.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');

let fontsRegistered = false;
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Manrope-Bold.ttf'), 'Manrope Bold');
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Manrope-SemiBold.ttf'), 'Manrope SemiBold');
  fontsRegistered = true;
}

const WIDTH = 900;
const HEIGHT = 300;
const AVATAR_SIZE = 176;

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// { targetUser, progress: {level, currentLevelXp, xpForNextLevel}, rank, prestige }
export async function buildRankCardAttachment({ targetUser, progress, rank, prestige }) {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#241c3d');
  gradient.addColorStop(1, '#4a2f8f');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.fill();

  const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
  const avatarX = 62;
  const avatarY = HEIGHT / 2 - AVATAR_SIZE / 2;

  try {
    const response = await fetch(avatarUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const avatarImage = await loadImage(buffer);

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (error) {
    console.error('⚠️ No se pudo cargar el avatar para la tarjeta de rango:', error);
  }

  ctx.strokeStyle = '#a284f7';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + AVATAR_SIZE + 48;
  const barWidth = WIDTH - textX - 62;

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 40px "Manrope Bold"';
  const displayName = targetUser.username.length > 20 ? `${targetUser.username.slice(0, 19)}…` : targetUser.username;
  ctx.fillText(displayName, textX, 96);

  ctx.font = '600 24px "Manrope SemiBold"';
  let cursorX = textX;
  ctx.fillStyle = '#a284f7';
  const levelText = `NIVEL ${progress.level}`;
  ctx.fillText(levelText, cursorX, 130);
  cursorX += ctx.measureText(levelText).width;

  // Sin emoji acá a propósito: la fuente registrada (Manrope) no trae glifos de emoji y
  // el contenedor de Railway no tiene ninguna fuente de sistema de respaldo con color-emoji
  // — un ⭐ se dibujaría como un cuadrado vacío. Texto + color dorado cumple lo mismo.
  if (prestige > 0) {
    ctx.fillStyle = '#e0b23d';
    const prestigeText = `  PRESTIGIO ×${prestige}`;
    ctx.fillText(prestigeText, cursorX, 130);
    cursorX += ctx.measureText(prestigeText).width;
  }

  if (rank) {
    ctx.fillStyle = '#a284f7';
    ctx.fillText(`  ·  #${rank} del ranking`, cursorX, 130);
  }

  // Barra de progreso
  const barY = 170;
  const barHeight = 28;
  const pct = progress.xpForNextLevel > 0 ? Math.min(1, progress.currentLevelXp / progress.xpForNextLevel) : 0;

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(ctx, textX, barY, barWidth, barHeight, barHeight / 2);
  ctx.fill();

  if (pct > 0) {
    const fillGradient = ctx.createLinearGradient(textX, 0, textX + barWidth, 0);
    fillGradient.addColorStop(0, '#a284f7');
    fillGradient.addColorStop(1, '#e0b23d');
    ctx.fillStyle = fillGradient;
    roundRect(ctx, textX, barY, Math.max(barHeight, barWidth * pct), barHeight, barHeight / 2);
    ctx.fill();
  }

  ctx.fillStyle = '#c9bef0';
  ctx.font = '600 20px "Manrope SemiBold"';
  const xpText = `${progress.currentLevelXp.toLocaleString('es-ES')} / ${progress.xpForNextLevel.toLocaleString('es-ES')} XP  (${Math.round(pct * 100)}%)`;
  ctx.fillText(xpText, textX, barY + barHeight + 34);

  const bufferOut = await canvas.encode('png');
  return new AttachmentBuilder(bufferOut, { name: 'rango.png' });
}
