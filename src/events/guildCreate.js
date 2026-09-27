import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR } from '../utils/embeds.js';
import { recordGuildEvent } from '../utils/botGuildEventsStore.js';
import { getBotChannelVisibility } from '../utils/botPermissions.js';

export const name = 'guildCreate';
export const once = false;

export async function execute(guild) {
  // Best-effort, nunca bloquea el mensaje de bienvenida de abajo — ver
  // botGuildEventsStore.js (plan de ejecución post-auditoría, Fase 5).
  recordGuildEvent(guild.id, 'join').catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('👋 ¡Gracias por invitar a Nexo Bot!')
    .setDescription(
      'Antes de usarlo corré **/setup** — crea los canales de log y confirma el rol de staff. ' +
        'Podés volver a correrlo cuando quieras para ajustar qué features tenés activas.',
    );

  // 2026-09-27: en Cloud6 NEXO entró sin poder ver ningún canal (todos ocultos para
  // @everyone) y nadie se enteró. Se avisa en este mismo mensaje, el único que manda solo.
  const visibility = getBotChannelVisibility(guild);
  if (visibility && visibility.total > 0 && visibility.visible === 0) {
    embed.addFields({
      name: '⚠️ Todavía no veo tus canales',
      value: `No puedo ver ninguno de los ${visibility.total} canales de texto, así que no voy a poder moderar, dar XP ni registrar nada. Dame el rol que ve los canales (o sumá mi rol en sus permisos) y después corré **/setup**.`,
    });
  }

  // Primero el canal de sistema; si no hay, o NEXO no puede escribir ahí (justamente el
  // caso de arriba), por MD al dueño. Antes un envío fallido al canal de sistema no
  // tenía plan B y el mensaje se perdía.
  const sentToChannel = guild.systemChannel ? await guild.systemChannel.send({ embeds: [embed] }).then(() => true, () => false) : false;
  if (sentToChannel) return;

  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.user?.send({ embeds: [embed] }).catch(() => {});
}
