import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'kickbutt', description: 'Le pegás una patada a alguien.', category: 'kick',
  selfText: '{autor} practica patadas al aire 🦵',
  targetText: '{autor} le pega una patada a {objetivo} 🦵',
});
