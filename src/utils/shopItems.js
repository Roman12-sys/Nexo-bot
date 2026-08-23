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
// - type: 'mystery_box' es un caso especial que maneja buy.js de forma distinta (da una
//         recompensa en monedas al azar, en vez de guardarse en el inventario).
export default [
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
    id: 'mencion_anuncio',
    name: '📢 Mención en el próximo anuncio',
    category: 'Diversión',
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
    id: 'insignia_coleccionista',
    name: '🏅 Insignia de Coleccionista',
    category: 'Utilidad',
    price: 100,
    roleId: null,
    description: 'Ítem puramente cosmético que queda guardado en tu /inventory.',
  },
];
