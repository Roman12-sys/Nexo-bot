import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'stare', description: 'Mirás fijo a alguien.', category: 'stare',
  selfText: '{autor} mira fijo a la nada 👀',
  targetText: '{autor} mira fijo a {objetivo} 👀',
});
