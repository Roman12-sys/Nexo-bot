import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'hug', description: 'Le das un abrazo a alguien.', category: 'hug',
  selfText: '{autor} está pidiendo un abrazo... 🤗',
  targetText: '{autor} abraza a {objetivo} 🤗',
});
