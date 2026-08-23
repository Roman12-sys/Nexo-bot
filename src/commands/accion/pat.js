import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'pat', description: 'Le hacés cariño a alguien.', category: 'pat',
  selfText: '{autor} se hace cariño solo/a 🥺',
  targetText: '{autor} le hace cariño a {objetivo} 🥰',
});
