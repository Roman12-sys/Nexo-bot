import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'laugh', description: 'Te reís de alguien.', category: 'laugh',
  selfText: '{autor} se está riendo solo/a 😂',
  targetText: '{autor} se ríe de {objetivo} 😂',
});
