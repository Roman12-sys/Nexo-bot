// QUÉ CAMBIÓ: ya no reimplementa la lógica acá — reexporta la versión compartida.
// MOTIVO: auditoría 2026-08-29 (Parte 13/22, Fase 5) — esta función y isStaff() del bot
// eran dos copias idénticas de la misma regla (admin_role_id OR moderator_role_id) que
// podían divergir con el tiempo. Ahora hay un solo lugar (src/utils/permissions.js) que
// la define; el nombre "isStaffFromRoles" se mantiene igual para no tener que tocar
// queries.js, que ya la importa con ese nombre.
export { isStaffFromRoleIds as isStaffFromRoles } from '../src/utils/permissions.js';
