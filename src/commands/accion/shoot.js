import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'shoot', description: 'Le disparás a alguien.', category: 'shoot',
  selfText: '{autor} dispara al aire, cuidado 🔫',
  targetText: '{autor} le dispara a {objetivo} 🔫',
});
