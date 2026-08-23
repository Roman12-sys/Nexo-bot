import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { saveGiveaway, getGiveaway, updateGiveaway, toggleParticipant, getGuildGiveawaysForAutocomplete } from '../../utils/giveawaysStore.js';
import { pickWinners, endGiveaway, scheduleGiveawayEnd } from '../../utils/giveawayEngine.js';
import { createGiveawayEmbed } from '../../utils/embeds.js';
import { isStaff } from '../../utils/permissions.js';
import { registerButtonPrefix } from '../../components/buttons.js';

export const data = new SlashCommandBuilder()
  .setName('sorteo')
  .setDescription('Sistema de sorteos.')
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crea un nuevo sorteo.')
      .addStringOption((o) => o.setName('premio').setDescription('Qué se sortea').setRequired(true).setMaxLength(1024))
      .addStringOption((o) =>
        o
          .setName('duracion')
          .setDescription('Duración del sorteo')
          .setRequired(true)
          .addChoices(
            { name: '5 minutos', value: '300000' },
            { name: '10 minutos', value: '600000' },
            { name: '30 minutos', value: '1800000' },
            { name: '1 hora', value: '3600000' },
            { name: '6 horas', value: '21600000' },
            { name: '12 horas', value: '43200000' },
            { name: '1 día', value: '86400000' },
            { name: '3 días', value: '259200000' },
            { name: '1 semana', value: '604800000' },
          ),
      )
      .addIntegerOption((o) =>
        o.setName('ganadores').setDescription('Cantidad de ganadores (por defecto: 1)').setRequired(false).setMinValue(1).setMaxValue(20),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('terminar')
      .setDescription('Termina un sorteo antes de tiempo y elige ganadores ya mismo.')
      .addStringOption((o) => o.setName('mensaje_id').setDescription('ID del mensaje del sorteo (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reroll')
      .setDescription('Vuelve a elegir ganador(es) de un sorteo ya finalizado.')
      .addStringOption((o) => o.setName('mensaje_id').setDescription('ID del mensaje del sorteo (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancelar')
      .setDescription('Cancela un sorteo activo sin elegir ganadores.')
      .addStringOption((o) => o.setName('mensaje_id').setDescription('ID del mensaje del sorteo (escribí para buscar)').setRequired(true).setAutocomplete(true)),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

// reroll busca entre sorteos ya finalizados; terminar/cancelar entre los que siguen
// activos — mismo campo "mensaje_id" en los 3 subcomandos, pero cada uno mira una
// lista distinta de Supabase.
export async function autocomplete(interaction) {
  const sub = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused().toLowerCase();

  const giveaways = await getGuildGiveawaysForAutocomplete(interaction.guildId, sub === 'reroll').catch(() => []);
  const matches = giveaways
    .filter((g) => g.prize.toLowerCase().includes(focused) || g.messageId.includes(focused))
    .slice(0, 25)
    .map((g) => ({ name: `${g.prize} (${g.messageId})`.slice(0, 100), value: g.messageId }));

  await interaction.respond(matches);
}

export async function execute(interaction) {
  if (!(await isStaff(interaction))) {
    await interaction.reply({ content: '❌ No tenés permisos para usar este comando.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'crear') return handleCrear(interaction);
  if (sub === 'terminar') return handleTerminar(interaction);
  if (sub === 'reroll') return handleReroll(interaction);
  if (sub === 'cancelar') return handleCancelar(interaction);
}

async function handleCrear(interaction) {
  const premio = interaction.options.getString('premio');
  const duracionMs = parseInt(interaction.options.getString('duracion'), 10);
  const winnersCount = interaction.options.getInteger('ganadores') || 1;
  const endTimestamp = Date.now() + duracionMs;

  try {
    await interaction.reply({ content: '🎉 Creando el sorteo...', flags: MessageFlags.Ephemeral });

    const embed = createGiveawayEmbed({ prize: premio, winnersCount, endTimestamp, participantsCount: 0, ended: false });
    const message = await interaction.channel.send({ embeds: [embed] });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway_enter_${message.id}`).setLabel('🎉 Participar').setStyle(ButtonStyle.Primary),
    );
    await message.edit({ components: [row] });

    await saveGiveaway(interaction.guild.id, message.id, {
      channelId: interaction.channel.id,
      prize: premio,
      winnersCount,
      endTimestamp,
      ended: false,
      winners: [],
      creatorId: interaction.user.id,
    });

    scheduleGiveawayEnd(interaction.client, interaction.guild.id, message.id, duracionMs);

    await interaction.editReply({ content: `✅ Sorteo creado. ID del mensaje: \`${message.id}\` (lo vas a necesitar para /sorteo terminar, reroll o cancelar).` });
  } catch (error) {
    console.error('❌ Error creando el sorteo:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al crear el sorteo.' });
  }
}

async function handleTerminar(interaction) {
  const messageId = interaction.options.getString('mensaje_id');
  const giveaway = await getGiveaway(interaction.guild.id, messageId);

  if (!giveaway) {
    await interaction.reply({ content: '❌ No se encontró un sorteo con ese ID de mensaje.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (giveaway.ended) {
    await interaction.reply({ content: '⚠️ Ese sorteo ya había finalizado.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: '⏳ Finalizando el sorteo...', flags: MessageFlags.Ephemeral });
  await endGiveaway(interaction.client, interaction.guild.id, messageId);
  await interaction.editReply({ content: '✅ Sorteo finalizado manualmente.' });
}

async function handleReroll(interaction) {
  const messageId = interaction.options.getString('mensaje_id');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const giveaway = await getGiveaway(interaction.guild.id, messageId);

  if (!giveaway) {
    await interaction.editReply({ content: '❌ No se encontró un sorteo con ese ID de mensaje.' });
    return;
  }
  if (!giveaway.ended) {
    await interaction.editReply({ content: '⚠️ Ese sorteo todavía no finalizó, no se puede rerollear.' });
    return;
  }
  if (giveaway.cancelled) {
    await interaction.editReply({ content: '❌ Ese sorteo fue cancelado, no se puede rerollear.' });
    return;
  }
  if (giveaway.participants.length === 0) {
    await interaction.editReply({ content: '❌ No hubo participantes, no hay de dónde elegir un nuevo ganador.' });
    return;
  }

  const newWinners = pickWinners(giveaway.participants, giveaway.winnersCount);
  const updated = await updateGiveaway(interaction.guild.id, messageId, { winners: newWinners });

  try {
    const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        const embed = createGiveawayEmbed({ ...updated, ended: true });
        await message.edit({ embeds: [embed] }).catch(() => {});
      }
      await channel
        .send({ content: `🔁 Reroll del sorteo de **${giveaway.prize}**: ¡Felicidades ${newWinners.map((id) => `<@${id}>`).join(', ')}!` })
        .catch(() => {});
    }
    await interaction.editReply({ content: '✅ Se eligieron nuevos ganadores.' });
  } catch (error) {
    console.error('❌ Error en el reroll:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al hacer el reroll.' });
  }
}

async function handleCancelar(interaction) {
  const messageId = interaction.options.getString('mensaje_id');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const giveaway = await getGiveaway(interaction.guild.id, messageId);

  if (!giveaway) {
    await interaction.editReply({ content: '❌ No se encontró un sorteo con ese ID de mensaje.' });
    return;
  }
  if (giveaway.ended) {
    await interaction.editReply({ content: '⚠️ Ese sorteo ya finalizó, no se puede cancelar.' });
    return;
  }

  const updated = await updateGiveaway(interaction.guild.id, messageId, { ended: true, cancelled: true });

  try {
    const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        const embed = createGiveawayEmbed({ ...updated, ended: true, cancelled: true });
        await message.edit({ embeds: [embed], components: [] }).catch(() => {});
      }
    }
    await interaction.editReply({ content: '✅ Sorteo cancelado.' });
  } catch (error) {
    console.error('❌ Error cancelando el sorteo:', error);
    await interaction.editReply({ content: '❌ Ocurrió un error al cancelar el sorteo.' });
  }
}

registerButtonPrefix('giveaway_enter_', async (interaction) => {
  const messageId = interaction.customId.slice('giveaway_enter_'.length);
  const giveaway = await getGiveaway(interaction.guild.id, messageId);

  if (!giveaway) {
    await interaction.reply({ content: '❌ No se encontró este sorteo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (giveaway.ended) {
    await interaction.reply({ content: '⚠️ Este sorteo ya finalizó.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { joined } = await toggleParticipant(interaction.guild.id, messageId, interaction.user.id);
  const updated = await getGiveaway(interaction.guild.id, messageId);

  const embed = createGiveawayEmbed({ ...updated, ended: false });
  await interaction.message.edit({ embeds: [embed] }).catch(() => {});

  await interaction.reply({
    content: joined ? '✅ ¡Te anotaste en el sorteo!' : '❌ Saliste del sorteo.',
    flags: MessageFlags.Ephemeral,
  });
});
