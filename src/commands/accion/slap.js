import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'slap', description: 'Le das una cachetada a alguien.', category: 'slap',
  selfText: '{autor} se cachetea solo/a, qué día 😵',
  targetText: '{autor} le da una cachetada a {objetivo} 👋',
});
