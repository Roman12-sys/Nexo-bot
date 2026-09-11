// Nombre + emoji de cada categoría — única fuente para website/data/features.js Y
// website/pages/commands.js (antes vivía duplicado en cada uno). Reusa EXACTAMENTE los
// emoji/nombres que ya usan /help y /helpstaff dentro de Discord (mismo criterio que
// features.js documentaba) para que el sitio nunca muestre un nombre de categoría
// distinto al que un usuario ve adentro del bot. Sin dependencias — evita el ciclo
// features.js <-> commands.js que se daría si cualquiera de los dos importara al otro.
export const CATEGORY_META = {
  moderacion: { emoji: '🧹', name: 'Moderación' },
  economia: { emoji: '💰', name: 'Economía' },
  casino: { emoji: '🎰', name: 'Casino' },
  progresion: { emoji: '⭐', name: 'XP y progresión' },
  diversion: { emoji: '🎲', name: 'Diversión' },
  accion: { emoji: '🎭', name: 'Acción' },
  sorteos: { emoji: '🎉', name: 'Sorteos' },
  anuncios: { emoji: '📢', name: 'Anuncios' },
  voz: { emoji: '🔊', name: 'Voz temporal' },
  administracion: { emoji: '⚙️', name: 'Administración' },
  informacion: { emoji: 'ℹ️', name: 'Información' },
};
