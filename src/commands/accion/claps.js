import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'claps', description: 'Le aplaudís a alguien.', category: 'clap',
  selfText: '{autor} aplaude solo/a 👏',
  targetText: '{autor} le aplaude a {objetivo} 👏',
});
