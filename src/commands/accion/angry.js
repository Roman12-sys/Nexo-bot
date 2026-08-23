import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'angry', description: 'Mostrás que estás enojado/a.', category: 'angry',
  selfText: '{autor} está enojadísimo/a 😠',
  targetText: '{autor} está furioso/a con {objetivo} 😠',
});
