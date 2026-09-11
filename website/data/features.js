// Catálogo de funciones — la copia (tagline/description/audiences) es curada a mano,
// pero commandCount y sampleCommands YA NO se tipean acá (Fase 5): se derivan más abajo
// de website/data/commands.js, que a su vez lee el JSON generado por
// scripts/generate-commands-data.js a partir de los SlashCommandBuilder reales. Esto
// cierra el loop que el prompt pedía ("código -> fuente de verdad -> web/docs") — antes
// (Fase 4) estos números estaban a mano y ya habían quedado desactualizados una vez
// (el Artifact de landing viejo decía "70+ comandos" cuando ya eran 88).
// Los títulos/emoji de categoría reusan EXACTAMENTE los que ya usan /help y /helpstaff
// dentro de Discord (src/commands/informacion/help.js,helpstaff.js) — para que el sitio
// nunca use un nombre de categoría distinto al que ve un usuario adentro del bot.
import { getCommandsByCategory, sampleExamplesForCategory } from './commands.js';

const RAW_FEATURES = [
  {
    id: 'moderacion',
    emoji: '🧹',
    name: 'Moderación',
    tagline: 'Moderación completa, con memoria.',
    description:
      'Bans, kicks, timeouts y warnings con historial persistente por usuario. Las restricciones con ' +
      'duración (1h/6h/1d/7d) se levantan solas — y si el bot se reinicia en el medio, el timer se ' +
      'reprograma solo al volver a arrancar, nunca se pierde. Jerarquía de roles real: nadie puede ' +
      'sancionar a alguien con un rol igual o superior al suyo.',
    audiences: ['gaming', 'comunidades'],
  },
  {
    id: 'economia',
    emoji: '💰',
    name: 'Economía',
    tagline: 'Una economía real, con wallet y banco separados.',
    description:
      'Monedas propias del servidor: recompensas diarias/semanales con racha, trabajo, robos con ' +
      'riesgo real, tienda con roles e ítems, y un banco separado del wallet que rinde interés y te ' +
      'protege de que te roben. Todas las operaciones de dinero pasan por funciones atómicas — dos ' +
      'personas usando /rob al mismo tiempo nunca corrompen un balance.',
    audiences: ['gaming', 'comunidades'],
  },
  {
    id: 'casino',
    emoji: '🎰',
    name: 'Casino',
    tagline: 'Coinflip, dados, tragamonedas y ruleta.',
    description:
      'Cuatro juegos que apuestan monedas del wallet. Coinflip y dado son 50/50 limpio, sin ventaja ' +
      'de la casa — slots y ruleta tienen la ventaja natural de cualquier paytable real, nunca un ' +
      'ajuste oculto.',
    audiences: ['gaming'],
  },
  {
    id: 'progresion',
    emoji: '⭐',
    name: 'XP y progresión',
    tagline: 'Niveles, prestigio, misiones y logros.',
    description:
      'XP por mensaje y por voz (con cooldown anti-farm), tarjetas de nivel generadas como imagen, ' +
      'prestigio desde nivel 50 a cambio de una insignia permanente, misiones diarias/semanales que ' +
      'se completan y pagan solas, y logros que se desbloquean automáticamente y se muestran en ' +
      '/perfil — sin ningún botón de "reclamar".',
    audiences: ['gaming', 'comunidades'],
  },
  {
    id: 'diversion',
    emoji: '🎲',
    name: 'Diversión',
    tagline: 'Trivia, encuestas, confesiones y más.',
    description:
      'Trivia con ranking propio, encuestas con cooldown, confesiones anónimas, recordatorios que ' +
      'sobreviven un reinicio del bot, sistema de AFK, y comandos rápidos como 8ball o elegir entre ' +
      'opciones.',
    audiences: ['comunidades', 'creadores'],
  },
  {
    id: 'accion',
    emoji: '🎭',
    name: 'Acción',
    tagline: '21 comandos de interacción entre miembros.',
    description:
      'Comandos de rol/interacción social — abrazar, saludar, chocar los cinco, y varios más — para ' +
      'usar solo o mencionando a otro miembro. El catálogo más grande del bot en cantidad de comandos.',
    audiences: ['gaming', 'comunidades'],
  },
  {
    id: 'sorteos',
    emoji: '🎉',
    name: 'Sorteos',
    tagline: 'Sorteos con recovery real ante fallas.',
    description:
      'Crear, participar, cerrar, rerollear y cancelar sorteos — todo bajo un lock que serializa las ' +
      'operaciones sobre el mismo sorteo. Si el bot se cae justo después de elegir ganadores pero ' +
      'antes de anunciarlos, un barrido periódico retoma el anuncio solo, sin repetir el sorteo.',
    audiences: ['comunidades', 'creadores'],
  },
  {
    id: 'anuncios',
    emoji: '📢',
    name: 'Anuncios',
    tagline: 'Constructor de anuncios paso a paso.',
    description:
      'Un flujo guiado con botones y modales para armar un anuncio (título, texto, color, canal) sin ' +
      'tener que escribir el mensaje de una sola vez ni depender de saber formatear un embed a mano.',
    audiences: ['creadores', 'comunidades'],
  },
  {
    id: 'voz',
    emoji: '🔊',
    name: 'Voz temporal',
    tagline: 'Join to Create, sin configurar nada por sala.',
    description:
      'Un miembro entra a un canal de voz "crear sala" y consigue su propia sala (pública, privada o ' +
      'solo por invitación), que se borra sola al quedar vacía. Si el bot se reinicia con salas activas, ' +
      'las reconcilia solo al arrancar en vez de dejarlas huérfanas.',
    // Sin comando propio (0 en el JSON generado) — feature 100% automática. Nota manual,
    // no derivada, porque no hay ningún comando real del que sacar un sampleCommands.
    manualNote: 'Automático — se configura una vez con /setup o /config',
    audiences: ['gaming', 'comunidades'],
  },
  {
    id: 'administracion',
    emoji: '⚙️',
    name: 'Administración',
    tagline: 'Un panel de configuración, no variables de entorno.',
    description:
      '/setup arma canales, roles y módulos automáticamente (y es re-ejecutable sin duplicar nada); ' +
      '/config apunta a lo que ya existe en tu server. Tres niveles de permisos (moderador, ' +
      'administrador, dueño) — no todo el staff puede acreditarse saldo o XP sin límite. /estado da ' +
      'un diagnóstico real de salud (latencia, conexión a la base, sistemas activos), sin tener que ' +
      'mirar Railway.',
    audiences: ['comunidades', 'creadores'],
  },
  {
    id: 'informacion',
    emoji: 'ℹ️',
    name: 'Información',
    tagline: 'Perfil, servidor y ayuda contextual.',
    description:
      'Perfil completo (nivel, monedas, logros, sanciones, sorteos ganados), información del ' +
      'servidor, y un centro de ayuda dentro de Discord que solo menciona lo que tu servidor tiene ' +
      'realmente activado — nunca un comando que apagaste.',
    audiences: ['gaming', 'comunidades', 'creadores'],
  },
];

// Deriva commandCount/sampleCommands de los comandos reales (website/data/commands.js)
// para cada categoría — 'voz' es la única sin comandos propios, usa el manualNote de
// arriba en vez de una lista vacía.
export const FEATURES = RAW_FEATURES.map((feature) => {
  const commands = getCommandsByCategory(feature.id);
  if (commands.length === 0) {
    return { ...feature, commandCount: 0, sampleCommands: [feature.manualNote || 'Sin comandos propios'] };
  }
  return {
    ...feature,
    commandCount: commands.length,
    sampleCommands: sampleExamplesForCategory(feature.id),
  };
});

export const TOTAL_COMMANDS_IN_FEATURES = FEATURES.reduce((sum, f) => sum + f.commandCount, 0);
