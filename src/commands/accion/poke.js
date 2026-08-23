import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'poke', description: 'Le picás a alguien.', category: 'poke',
  selfText: '{autor} se pica a sí mismo/a, raro 👉',
  targetText: '{autor} le pica a {objetivo} 👉',
});
