import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'bite', description: 'Le mordés a alguien.', category: 'bite',
  selfText: '{autor} anda mordiendo el aire 🦷',
  targetText: '{autor} le muerde a {objetivo} 😬',
});
