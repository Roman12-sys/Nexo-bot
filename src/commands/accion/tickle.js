import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'tickle', description: 'Le hacés cosquillas a alguien.', category: 'tickle',
  selfText: '{autor} se hace cosquillas solo/a jajaja',
  targetText: '{autor} le hace cosquillas a {objetivo} 😂',
});
