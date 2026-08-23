import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute, rateLimitCategory } = createActionCommand({
  name: 'handholding', description: 'Le agarrás la mano a alguien.', category: 'handhold',
  selfText: '{autor} espera a alguien para agarrarse de las manos',
  targetText: '{autor} le agarra la mano a {objetivo} 🤝',
});
