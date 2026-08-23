import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'hi', description: 'Saludás a alguien.', category: 'wave',
  selfText: '{autor} saluda a todos 👋',
  targetText: '{autor} saluda a {objetivo} 👋',
});
