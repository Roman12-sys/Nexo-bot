import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'cuddle', description: 'Te acurrucás con alguien.', category: 'cuddle',
  selfText: '{autor} se abraza a una almohada 🛏️',
  targetText: '{autor} se acurruca con {objetivo} 🥰',
});
