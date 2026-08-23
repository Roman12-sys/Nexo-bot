// Banner de bienvenida generado con avatar + nombre del miembro nuevo. Se registran
// las fuentes desde archivos propios (src/assets/fonts/) en vez de confiar en las del
// sistema — Railway corre en un contenedor mínimo que puede no tener NINGUNA fuente
// instalada, y sin esto el texto directamente no se dibuja.
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

export async function buildWelcomeImageAttachment(member) {
  ensureFontsRegistered();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Fondo: degradé morado de marca
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#241c3d');
  gradient.addColorStop(1, '#4a2f8f');
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.fill();

  // Avatar circular
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
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
    console.error('⚠️ No se pudo cargar el avatar para el banner de bienvenida:', error);
  }

  // Anillo alrededor del avatar
  ctx.strokeStyle = '#a284f7';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.stroke();

  // Texto
  const textX = avatarX + AVATAR_SIZE + 48;

  ctx.fillStyle = '#a284f7';
  ctx.font = '600 24px "Manrope SemiBold"';
  ctx.fillText('¡BIENVENIDO/A!', textX, HEIGHT / 2 - 34);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 46px "Manrope Bold"';
  const displayName = member.displayName.length > 22 ? `${member.displayName.slice(0, 21)}…` : member.displayName;
  ctx.fillText(displayName, textX, HEIGHT / 2 + 14);

  ctx.fillStyle = '#c9bef0';
  ctx.font = '600 22px "Manrope SemiBold"';
  ctx.fillText(`Miembro #${member.guild.memberCount.toLocaleString('es-ES')} de ${member.guild.name}`.slice(0, 60), textX, HEIGHT / 2 + 56);

  const buffer = await canvas.encode('png');
  return new AttachmentBuilder(buffer, { name: 'welcome.png' });
}
