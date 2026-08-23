import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'stare', description: 'Mirás fijo a alguien.', category: 'stare',
  selfText: '{autor} mira fijo a la nada 👀',
  targetText: '{autor} mira fijo a {objetivo} 👀',
});
