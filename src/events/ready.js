export const name = 'clientReady';
export const once = true;

export async function execute(client) {
  console.log(`Conectado como ${client.user.tag}`);
}
