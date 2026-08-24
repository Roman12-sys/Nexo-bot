// Catálogo de la tienda (/shop, /buy). Plantilla genérica — a diferencia de gNoX (que
// tenía roles de color específicos de SU servidor hardcodeados acá), estos ítems de
// ejemplo funcionan out-of-the-box en cualquier servidor porque ninguno depende de un
// roleId propio. Un servidor que quiera vender roles puede agregar sus propios ítems acá
// con el roleId real de su servidor (ver comentario de "roleId" abajo).
//
// Cada ítem puede tener:
// - id: identificador único, sin espacios (se usa internamente, no lo ve el usuario)
// - name, description, price: lo que se muestra
// - category: para agrupar visualmente en /shop
// - roleId: si lo completás con el ID de un rol de tu servidor, se asigna solo al comprar.
//           Dejalo en null (o sin la propiedad) si el ítem no otorga ningún rol.
// - fulfillment: 'manual' significa que el bot NO hace nada automático más que
//                avisarle al staff en el canal de logs de economía para que lo entregue
//                a mano. Si no tiene esta propiedad, se asume automático (rol o solo
//                cosmético/inventario).
// - type: casos especiales que maneja buy.js de forma distinta a un ítem normal:
//         'mystery_box' (recompensa en monedas al azar, no se guarda en inventario),
//         'xp_boost' (x2 XP por 24hs), 'rob_shield' (protegido de /rob por 2hs),
//         'pet_food' (se guarda en inventario normal, pero /pet alimentar lo busca por
//         este tipo en vez de por nombre — así funciona aunque el staff lo renombre).
export default [
  // --- Diversión / mecánicas activas ---
  {
    id: 'caja_misteriosa',
    name: '🎁 Caja Misteriosa',
    category: 'Diversión',
    price: 250,
    roleId: null,
    type: 'mystery_box',
    description: 'Se abre sola al comprarla: podés ganar entre 50 y 600 monedas.',
  },
  {
    id: 'impulso_xp',
    name: '⚡ Impulso de XP',
    category: 'Diversión',
    price: 400,
    roleId: null,
    type: 'xp_boost',
    description: 'Ganás el doble de XP por mensaje y por voz durante 24 horas.',
  },
  {
    id: 'escudo_antirobo',
    name: '🛡️ Escudo Anti-Robo',
    category: 'Diversión',
    price: 350,
    roleId: null,
    type: 'rob_shield',
    description: 'Nadie puede robarte con /rob durante 2 horas.',
  },

  // --- Mascotas ---
  {
    id: 'comida_mascota',
    name: '🍖 Comida para Mascota',
    category: 'Mascotas',
    price: 80,
    roleId: null,
    type: 'pet_food',
    description: 'Usala con /pet alimentar. Sube el hambre de tu mascota y le da experiencia.',
  },

  // --- Utilidad (el staff lo entrega a mano) ---
  {
    id: 'mencion_anuncio',
    name: '📢 Mención en el próximo anuncio',
    category: 'Utilidad',
    price: 300,
    roleId: null,
    fulfillment: 'manual',
    description: 'El staff te menciona en el próximo /anuncio que se publique.',
  },
  {
    id: 'apodo',
    name: '✏️ Cambio de Apodo',
    category: 'Utilidad',
    price: 150,
    roleId: null,
    fulfillment: 'manual',
    description: 'El staff te cambia el apodo del servidor (dentro de las normas de la comunidad).',
  },
  {
    id: 'rol_color',
    name: '🎨 Rol de Color Personalizado',
    category: 'Utilidad',
    price: 500,
    roleId: null,
    fulfillment: 'manual',
    description: 'El staff te asigna un rol con el color que elijas.',
  },
  {
    id: 'titulo_especial',
    name: '👑 Título Especial',
    category: 'Utilidad',
    price: 1200,
    roleId: null,
    fulfillment: 'manual',
    description: 'El staff te agrega un título/rol personalizado, a coordinar con ellos.',
  },
  {
    id: 'anuncio_cumple',
    name: '🎂 Anuncio de Cumpleaños',
    category: 'Utilidad',
    price: 200,
    roleId: null,
    fulfillment: 'manual',
    description: 'El staff publica un saludo de cumpleaños para vos en el canal de anuncios.',
  },

  // --- Coleccionables (cosmético puro, quedan en /inventory) ---
  {
    id: 'insignia_coleccionista',
    name: '🏅 Insignia de Coleccionista',
    category: 'Coleccionables',
    price: 100,
    roleId: null,
    description: 'Ítem puramente cosmético que queda guardado en tu /inventory.',
  },
  {
    id: 'estrella_bronce',
    name: '⭐ Estrella de Bronce',
    category: 'Coleccionables',
    price: 200,
    roleId: null,
    description: 'Primer escalón de la colección de estrellas. Cosmético.',
  },
  {
    id: 'estrella_plata',
    name: '🌟 Estrella de Plata',
    category: 'Coleccionables',
    price: 800,
    roleId: null,
    description: 'Segundo escalón de la colección de estrellas. Cosmético.',
  },
  {
    id: 'estrella_oro',
    name: '✨ Estrella de Oro',
    category: 'Coleccionables',
    price: 2500,
    roleId: null,
    description: 'Tercer escalón de la colección de estrellas. Cosmético.',
  },
  {
    id: 'estrella_legendaria',
    name: '💫 Estrella Legendaria',
    category: 'Coleccionables',
    price: 7000,
    roleId: null,
    description: 'El escalón más alto de la colección de estrellas. Cosmético.',
  },
  {
    id: 'insignia_fundador',
    name: '🎗️ Insignia de Fundador',
    category: 'Coleccionables',
    price: 1000,
    roleId: null,
    description: 'Para quienes apoyan al servidor desde temprano. Cosmético.',
  },
  {
    id: 'insignia_racha',
    name: '🔥 Insignia de Racha',
    category: 'Trofeos',
    price: 600,
    roleId: null,
    description: 'Para quienes no se pierden un /daily. Cosmético.',
  },
  {
    id: 'mascara_casino',
    name: '🎭 Máscara del Casino',
    category: 'Trofeos',
    price: 450,
    roleId: null,
    description: 'Para los que se la juegan en /slots, /ruleta y /dado. Cosmético.',
  },
  {
    id: 'amuleto_mascota',
    name: '🐾 Amuleto de Mascota',
    category: 'Trofeos',
    price: 350,
    roleId: null,
    description: 'Para dueños orgullosos de su /pet. Cosmético.',
  },
  {
    id: 'reliquia_nexo',
    name: '💎 Reliquia Nexo',
    category: 'Trofeos',
    price: 10000,
    roleId: null,
    description: 'El ítem más caro de la tienda. Puramente para presumir. Cosmético.',
  },
  {
    id: 'trofeo_diamante',
    name: '💠 Trofeo de Diamante',
    category: 'Trofeos',
    price: 6000,
    roleId: null,
    description: 'Para quienes ya tienen todo lo demás. Cosmético.',
  },
];
