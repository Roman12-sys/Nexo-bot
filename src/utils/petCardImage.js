// Tarjeta visual para /pet ver — mismo patrón que rankCardImage.js (que a su vez copia
// welcomeImage.js): fuentes propias registradas desde archivo, avatar circular por
// fetch. Antes /pet ver mostraba hambre/felicidad/XP como 3 barras de texto Unicode
// separadas; esto las junta en una sola tarjeta con el mismo lenguaje visual que /nivel.
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
const HEIGHT = 360;
const AVATAR_SIZE = 140;

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawBar(ctx, x, y, width, pct, color) {
  const height = 20;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fill();
  if (pct > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(height, width * Math.min(1, pct)), height, height / 2);
    ctx.fill();
  }
}

// Huella dibujada con formas nativas (óvalo + 4 círculos) en vez de un emoji de especie
// (🐶/🐱/etc.) — @napi-rs/canvas NO trae glifos de emoji en este contenedor (mismo
// problema ya resuelto en rankCardImage.js con el ⭐ de prestigio) y se dibujaba como un
// cuadrado vacío. Una huella genérica funciona para cualquier especie sin depender de
// una fuente que tenga el glifo.
function drawPawPrint(ctx, cx, cy, scale, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy + scale * 0.35, scale * 0.5, scale * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  const toes = [
    { dx: -0.55, dy: -0.55, r: 0.22 },
    { dx: -0.2, dy: -0.75, r: 0.24 },
    { dx: 0.2, dy: -0.75, r: 0.24 },
    { dx: 0.55, dy: -0.55, r: 0.22 },
  ];
  for (const toe of toes) {
    ctx.beginPath();
    ctx.arc(cx + toe.dx * scale, cy + toe.dy * scale, toe.r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

// { targetUser, pet (con hunger/happiness YA decaídos, ver computePetStats), species,
//   stage, progress: {level, currentLevelXp, xpForNextLevel} }
export async function buildPetCardAttachment({ targetUser, pet, species, stage, progress }) {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#241c3d');
  gradient.addColorStop(1, '#4a2f8f');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.fill();

  // Avatar del dueño, chico, arriba a la izquierda — la mascota (emoji grande) es la
  // protagonista de la tarjeta, no la persona.
  const avatarX = 40;
  const avatarY = 40;
  try {
    const response = await fetch(targetUser.displayAvatarURL({ extension: 'png', size: 128 }));
    const buffer = Buffer.from(await response.arrayBuffer());
    const avatarImage = await loadImage(buffer);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + 32, avatarY + 32, 32, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX, avatarY, 64, 64);
    ctx.restore();
  } catch (error) {
    console.error('⚠️ No se pudo cargar el avatar para la tarjeta de mascota:', error);
  }

  ctx.fillStyle = '#c9bef0';
  ctx.font = '600 20px "Manrope SemiBold"';
  ctx.fillText(targetUser.username.slice(0, 24), avatarX + 78, avatarY + 26);
  ctx.fillStyle = '#a284f7';
  ctx.font = '600 18px "Manrope SemiBold"';
  ctx.fillText(`Nivel ${progress.level} · ${stage.label}`, avatarX + 78, avatarY + 50);

  drawPawPrint(ctx, 150, 250, 90, 'rgba(255,255,255,0.92)');

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 44px "Manrope Bold"';
  ctx.fillText(pet.name.slice(0, 18), 260, 150);

  const barX = 260;
  const barWidth = WIDTH - barX - 60;

  ctx.fillStyle = '#c9bef0';
  ctx.font = '600 18px "Manrope SemiBold"';
  ctx.fillText(`Hambre: ${pet.hunger}%`, barX, 195);
  drawBar(ctx, barX, 205, barWidth, pet.hunger / 100, '#e0b23d');

  ctx.fillStyle = '#c9bef0';
  ctx.fillText(`Felicidad: ${pet.happiness}%`, barX, 250);
  drawBar(ctx, barX, 260, barWidth, pet.happiness / 100, '#e0607a');

  const xpPct = progress.xpForNextLevel > 0 ? progress.currentLevelXp / progress.xpForNextLevel : 0;
  ctx.fillStyle = '#c9bef0';
  ctx.fillText(`XP: ${progress.currentLevelXp}/${progress.xpForNextLevel}`, barX, 305);
  drawBar(ctx, barX, 315, barWidth, xpPct, '#a284f7');

  ctx.fillStyle = '#8f86b0';
  ctx.font = '600 16px "Manrope SemiBold"';
  ctx.fillText(`${species.name} · ${pet.wins}V-${pet.losses}D en combate`, barX, 350);

  const bufferOut = await canvas.encode('png');
  return new AttachmentBuilder(bufferOut, { name: 'mascota.png' });
}
