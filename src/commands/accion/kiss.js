import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'kiss', description: 'Le das un beso a alguien.', category: 'kiss',
  selfText: '{autor} anda repartiendo besitos al aire 😘',
  targetText: '{autor} le da un beso a {objetivo} 😘',
});
