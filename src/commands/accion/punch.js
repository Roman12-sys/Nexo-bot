import { createActionCommand } from '../../utils/actionCommandFactory.js';
export const { data, execute } = createActionCommand({
  name: 'punch', description: 'Le pegás un puñetazo a alguien.', category: 'punch',
  selfText: '{autor} tira piñas al aire 🥊',
  targetText: '{autor} le pega un puñetazo a {objetivo} 🥊',
});
