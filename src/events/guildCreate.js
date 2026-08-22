import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR } from '../utils/embeds.js';

export const name = 'guildCreate';
export const once = false;

export async function execute(guild) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('👋 ¡Gracias por invitar a Nexo Bot!')
    .setDescription(
      'Antes de usarlo corré **/setup** — crea los canales de log y confirma el rol de staff. ' +
        'Podés volver a correrlo cuando quieras para ajustar qué features tenés activas.',
    );

  const target = guild.systemChannel ?? (await guild.fetchOwner().catch(() => null))?.user;
  if (!target) return;

  await target.send({ embeds: [embed] }).catch(() => {});
}
