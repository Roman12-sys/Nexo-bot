import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'feed', description: 'Le das de comer a alguien.', category: 'feed',
  selfText: '{autor} come solo/a 🍕',
  targetText: '{autor} le da de comer a {objetivo} 🍕',
});
