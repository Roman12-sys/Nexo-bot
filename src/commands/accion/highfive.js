import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'highfive', description: 'Chocás los cinco con alguien.', category: 'highfive',
  selfText: '{autor} choca los cinco al aire ✋',
  targetText: '{autor} choca los cinco con {objetivo} ✋',
});
