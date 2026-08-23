import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'baka', description: 'Le decís baka a alguien.', category: 'baka',
  selfText: '{autor} se dice baka a sí mismo/a',
  targetText: '{autor} le grita ¡baka! a {objetivo} 😤',
});
