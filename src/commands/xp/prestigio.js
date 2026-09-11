// Techo de progresión para quien ya "terminó" el sistema de niveles: a cambio de
// resetear nivel y XP a 0, se lleva una insignia permanente (⭐×N) visible en /perfil,
// /nivel y /ranking. Reusa el panel de confirmación genérico (mismo que /ban, /clear)
// porque es una acción destructiva e irreversible sobre los propios datos del usuario.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getUserXp, applyPrestige } from '../../utils/xpStore.js';
import { buildConfirmation } from '../../utils/confirmations.js';
import { withLock } from '../../utils/asyncLock.js';

export const PRESTIGE_MIN_LEVEL = 50;

export const data = new SlashCommandBuilder()
  .setName('prestigio')
  .setDescription(`A partir del nivel ${PRESTIGE_MIN_LEVEL}, reseteá tu nivel a cambio de una insignia permanente (⭐).`)
  .setDMPermission(false);

async function confirmPrestige(interaction) {
  await interaction.update({ content: '⏳ Prestigiando...', embeds: [], components: [] });

  // Auditoría completa NEXO (2026-09-11), XP-1: sin lock, dos confirmaciones de
  // /prestigio disparadas casi al mismo tiempo (dos paneles distintos, cada uno con su
  // propio token de confirmación) podían leer el mismo nivel ≥50 antes de que ninguna
  // terminara de escribir, y apply_prestige no valida el nivel mínimo del lado de
  // Postgres — el resultado era un prestige duplicado por una sola vez que se alcanzó el
  // nivel mínimo. El lock revalida con datos frescos, mismo criterio que /daily y /rob.
  const message = await withLock(`prestige:${interaction.guildId}:${interaction.user.id}`, async () => {
    const record = await getUserXp(interaction.guildId, interaction.user.id);
    if (record.level < PRESTIGE_MIN_LEVEL) {
      return `❌ Ya no cumplís el nivel mínimo (${PRESTIGE_MIN_LEVEL}) — estás en el nivel ${record.level}.`;
    }

    const newPrestige = await applyPrestige(interaction.guildId, interaction.user.id);
    return `🌟 ¡Prestigiaste! Ahora tenés **⭐×${newPrestige}** y arrancás de nuevo desde el nivel 0.`;
  });

  await interaction.editReply({ content: message });
}

export async function execute(interaction) {
  const record = await getUserXp(interaction.guildId, interaction.user.id);

  if (record.level < PRESTIGE_MIN_LEVEL) {
    await interaction.reply({
      content: `❌ Necesitás nivel **${PRESTIGE_MIN_LEVEL}** para prestigiar. Estás en el nivel **${record.level}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const confirmation = buildConfirmation({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    description: `Vas a resetear tu nivel (**${record.level}**) y tu XP a **0**, a cambio de la insignia **⭐×${record.prestige + 1}**. Esto no se puede deshacer.`,
    run: confirmPrestige,
  });
  await interaction.reply({ ...confirmation, flags: MessageFlags.Ephemeral });
}
