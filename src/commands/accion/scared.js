import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'scared', description: 'Mostrás que estás asustado/a.', category: 'shocked',
  selfText: '{autor} está asustadísimo/a 😱',
  targetText: '{autor} asustó a {objetivo} 😱',
});
