import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  SPECIES,
  ADOPTION_COST,
  PLAY_COOLDOWN_MS,
  BATTLE_COOLDOWN_MS,
  BATTLE_REWARD_MIN,
  BATTLE_REWARD_MAX,
  getPet,
  createPet,
  renamePet,
  feedPet,
  playWithPet,
  computePetStats,
  getPetLevelProgress,
  getPetStage,
  resolveBattle,
  recordBattleResult,
} from '../../utils/petsStore.js';
import { getUserEconomy, deductBalanceIfSufficient, incrementInventoryItem, addBalance } from '../../utils/economyStore.js';
import { getGuildShopItems } from '../../utils/shopStore.js';
import { buildPetCardAttachment } from '../../utils/petCardImage.js';
import { BRAND_COLOR, BRAND_NAME } from '../../utils/embeds.js';
import { withLock } from '../../utils/asyncLock.js';
import { eventBus } from '../../utils/eventBus.js'; // Event Engine — auditoría 2026-08-29, Parte 7

// Tarjeta de imagen (mismo lenguaje visual que /nivel, ver petCardImage.js) en vez del
// embed de texto que tenía antes — se usa en todos lados donde se muestra UNA mascota.
// /pet pelear es la excepción: ahí se comparan DOS mascotas a la vez, así que se queda
// con un embed de texto (la tarjeta está pensada para una sola).
async function buildPetPayload(targetUser, pet) {
  const current = computePetStats(pet);
  const progress = getPetLevelProgress(pet.xp);
  const species = SPECIES[pet.species];
  const stage = getPetStage(progress.level);

  const attachment = await buildPetCardAttachment({
    targetUser,
    pet: { ...current, name: pet.name, wins: pet.wins || 0, losses: pet.losses || 0 },
    species,
    stage,
    progress,
  });
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setImage('attachment://mascota.png');

  return { embeds: [embed], files: [attachment] };
}

async function handleAdoptar(interaction) {
  const especie = interaction.options.getString('especie');
  const nombre = interaction.options.getString('nombre') || SPECIES[especie].name;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const existing = await getPet(guildId, userId);
  if (existing) {
    await interaction.reply({ content: `❌ Ya tenés una mascota (**${existing.name}**). Solo se puede tener una a la vez.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const economy = await getUserEconomy(guildId, userId);
  if (economy.balance < ADOPTION_COST) {
    await interaction.reply({ content: `❌ Adoptar cuesta **${ADOPTION_COST.toLocaleString('es-ES')}** monedas. Te faltan **${(ADOPTION_COST - economy.balance).toLocaleString('es-ES')}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`pet:${guildId}:${userId}`, async () => {
    const alreadyHas = await getPet(guildId, userId);
    if (alreadyHas) {
      await interaction.editReply({ content: `❌ Ya tenés una mascota (**${alreadyHas.name}**).` });
      return;
    }

    try {
      await deductBalanceIfSufficient(guildId, userId, ADOPTION_COST);
    } catch (error) {
      if (error.code === 'insufficient_funds') {
        await interaction.editReply({ content: '❌ No tenés suficientes monedas para adoptar.' });
        return;
      }
      throw error;
    }

    const created = await createPet(guildId, userId, especie, nombre.slice(0, 32));
    if (!created) {
      await interaction.editReply({ content: '❌ Ya tenés una mascota.' });
      return;
    }

    const pet = await getPet(guildId, userId);
    await interaction.editReply({ content: `🎉 ¡Adoptaste a **${nombre}**!`, ...(await buildPetPayload(interaction.user, pet)) });
    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId, achievementId: 'primera_mascota', interaction });
  });
}

async function handleVer(interaction) {
  const targetUser = interaction.options.getUser('usuario') || interaction.user;
  await interaction.deferReply();

  const pet = await getPet(interaction.guildId, targetUser.id);
  if (!pet) {
    const isSelf = targetUser.id === interaction.user.id;
    await interaction.editReply({ content: isSelf ? '❌ No tenés mascota todavía. Adoptá una con `/pet adoptar`.' : `❌ ${targetUser.tag} no tiene mascota.` });
    return;
  }

  await interaction.editReply(await buildPetPayload(targetUser, pet));
}

async function handleAlimentar(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const pet = await getPet(guildId, userId);
  if (!pet) {
    await interaction.reply({ content: '❌ No tenés mascota todavía. Adoptá una con `/pet adoptar`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`pet:${guildId}:${userId}`, async () => {
    const [economy, shopItems] = await Promise.all([getUserEconomy(guildId, userId), getGuildShopItems(guildId)]);
    const foodItem = shopItems.find((item) => item.type === 'pet_food' && (economy.inventory[item.id] || 0) > 0);

    if (!foodItem) {
      await interaction.editReply({ content: '❌ No tenés comida para mascota. Comprá una en `/shop` (categoría Mascotas) y usá `/buy`.' });
      return;
    }

    await incrementInventoryItem(guildId, userId, foodItem.id, -1);
    const updated = await feedPet(guildId, userId);

    await interaction.editReply({
      content: `🍖 Le diste de comer a **${updated.name}** (usaste 1x ${foodItem.name}).${updated.leveledUp ? ' ¡Subió de nivel! 🎉' : ''}`,
      ...(await buildPetPayload(interaction.user, updated)),
    });
  });
}

async function handleJugar(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const pet = await getPet(guildId, userId);
  if (!pet) {
    await interaction.reply({ content: '❌ No tenés mascota todavía. Adoptá una con `/pet adoptar`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const lastPlayedElapsed = Date.now() - pet.lastPlayed;
  if (lastPlayedElapsed < PLAY_COOLDOWN_MS) {
    const readyTimestamp = Math.floor((pet.lastPlayed + PLAY_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ ${pet.name} ya jugó hace poco. Podés volver a jugar <t:${readyTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`pet:${guildId}:${userId}`, async () => {
    const current = await getPet(guildId, userId);
    if (!current || Date.now() - current.lastPlayed < PLAY_COOLDOWN_MS) {
      await interaction.editReply({ content: `⏳ ${pet.name} ya jugó hace poco.` });
      return;
    }

    const updated = await playWithPet(guildId, userId);
    await interaction.editReply({
      content: `🎾 Jugaste con **${updated.name}**.${updated.leveledUp ? ' ¡Subió de nivel! 🎉' : ''}`,
      ...(await buildPetPayload(interaction.user, updated)),
    });
  });
}

// Combate instantáneo, sin apostar plata entre los dos usuarios a propósito — dos
// cuentas peleando entre sí para transferirse plata "por las dudas" sería el mismo
// riesgo de lavado que ya se cuida en /give (ver giveTracker.js). La recompensa la pone
// "la casa" (parecido a /work), nunca sale del bolsillo del que pierde.
async function handlePelear(interaction) {
  const targetUser = interaction.options.getUser('usuario');
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (targetUser.id === userId) {
    await interaction.reply({ content: '❌ No podés pelear contra vos mismo.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({ content: '❌ Los bots no tienen mascota.', flags: MessageFlags.Ephemeral });
    return;
  }

  const [myPet, theirPet] = await Promise.all([getPet(guildId, userId), getPet(guildId, targetUser.id)]);
  if (!myPet) {
    await interaction.reply({ content: '❌ No tenés mascota todavía. Adoptá una con `/pet adoptar`.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!theirPet) {
    await interaction.reply({ content: `❌ ${targetUser.tag} no tiene mascota.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const now = Date.now();
  if (now - myPet.lastBattle < BATTLE_COOLDOWN_MS) {
    const readyTimestamp = Math.floor((myPet.lastBattle + BATTLE_COOLDOWN_MS) / 1000);
    await interaction.reply({ content: `⏳ ${myPet.name} está cansada de pelear. Puede volver a pelear <t:${readyTimestamp}:R>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (now - theirPet.lastBattle < BATTLE_COOLDOWN_MS) {
    await interaction.reply({ content: `⏳ La mascota de ${targetUser.tag} ya peleó hace poco — probá más tarde.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  await withLock(`pet:${guildId}:${userId}`, async () => {
    const winnerSide = resolveBattle(myPet, theirPet);
    const iWon = winnerSide === 'A';
    const winnerId = iWon ? userId : targetUser.id;
    const winnerPetName = iWon ? myPet.name : theirPet.name;
    const loserPetName = iWon ? theirPet.name : myPet.name;

    const [myResult, theirResult] = await Promise.all([
      recordBattleResult(guildId, userId, { won: iWon, now }),
      recordBattleResult(guildId, targetUser.id, { won: !iWon, now }),
    ]);

    const reward = Math.floor(Math.random() * (BATTLE_REWARD_MAX - BATTLE_REWARD_MIN + 1)) + BATTLE_REWARD_MIN;
    const winnerBalance = await addBalance(guildId, winnerId, reward, { type: 'pet_battle_win', reason: `${winnerPetName} venció a ${loserPetName}` });

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('⚔️ ¡Combate de mascotas!')
      .setDescription(
        `${SPECIES[myPet.species].emoji} **${myPet.name}** (${interaction.user.tag}) vs ${SPECIES[theirPet.species].emoji} **${theirPet.name}** (${targetUser.tag})\n\n` +
          `🏆 Ganó **${winnerPetName}**\n` +
          `💰 ${iWon ? interaction.user.tag : targetUser.tag} ganó **${reward.toLocaleString('es-ES')}** monedas (balance: ${winnerBalance.toLocaleString('es-ES')}).` +
          `${myResult.leveledUp || theirResult.leveledUp ? '\n🎉 ¡Alguna mascota subió de nivel!' : ''}`,
      )
      .setFooter({ text: `${BRAND_NAME} • Récord de ${myPet.name}: ${myResult.wins}V-${myResult.losses}D` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    await eventBus.emit('ACHIEVEMENT_CHECK', { guildId, userId: winnerId, achievementId: 'primera_pelea', interaction });
  });
}

function buildAyudaEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('🐾 Cómo funcionan las mascotas')
    .addFields(
      { name: '1. Adoptar', value: `\`/pet adoptar\` — ${ADOPTION_COST} monedas, una sola por usuario. Elegís especie y nombre.` },
      {
        name: '2. Hambre y felicidad',
        value:
          'Bajan solas con el tiempo (hambre ~2%/hora, felicidad ~3%/hora) — no hace falta que estés online, se calcula cuando consultás. `/pet alimentar` sube el hambre (necesita 1x comida de `/shop`, categoría Mascotas). `/pet jugar` sube la felicidad (gratis, cooldown 1 hora).',
      },
      {
        name: '3. Bonus a /work y /crime',
        value: 'Con hambre Y felicidad en 50% o más, tu mascota te da un bonus a las recompensas de /work y /crime. Descuidarla nunca la "mata" — solo perdés el bonus hasta que la cuides de nuevo.',
      },
      {
        name: '4. Etapas (subir de nivel)',
        value: 'Alimentarla, jugar y pelear le dan experiencia. Etapas: **Cría** (+10%) → nivel 5 **Adulto** (+15%) → nivel 15 **Veterano** (+20%) → nivel 30 **Legendario** (+30%). El % es el bonus de la etapa 3.',
      },
      {
        name: '5. Combate',
        value:
          '`/pet pelear @usuario` — resultado instantáneo. Gana quien tenga más "poder" (nivel + qué tan cuidada está + algo de azar), así una mascota de nivel bajo bien cuidada puede ganarle a una de nivel alto descuidada. El premio (100-200 monedas) sale de la casa, nunca del que pierde. Cooldown de 30 min por mascota.',
      },
      { name: '6. Renombrar', value: '`/pet renombrar <nombre>` — cambia el nombre cuando quieras, gratis.' },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp();
}

async function handleAyuda(interaction) {
  await interaction.reply({ embeds: [buildAyudaEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleRenombrar(interaction) {
  const nombre = interaction.options.getString('nombre').slice(0, 32);
  const pet = await getPet(interaction.guildId, interaction.user.id);
  if (!pet) {
    await interaction.reply({ content: '❌ No tenés mascota todavía. Adoptá una con `/pet adoptar`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await renamePet(interaction.guildId, interaction.user.id, nombre);
  await interaction.reply({ content: `✅ Tu mascota ahora se llama **${nombre}**.`, flags: MessageFlags.Ephemeral });
}

export const data = new SlashCommandBuilder()
  .setName('pet')
  .setDescription('Adoptá y cuidá una mascota — bien alimentada y feliz da un bonus a /work y /crime.')
  .addSubcommand((sub) =>
    sub
      .setName('adoptar')
      .setDescription(`Adoptá una mascota por ${ADOPTION_COST} monedas (una sola por usuario).`)
      .addStringOption((o) =>
        o
          .setName('especie')
          .setDescription('Qué especie adoptar')
          .setRequired(true)
          .addChoices(...Object.entries(SPECIES).map(([value, s]) => ({ name: `${s.emoji} ${s.name}`, value }))),
      )
      .addStringOption((o) => o.setName('nombre').setDescription('Nombre de tu mascota (opcional)').setRequired(false).setMaxLength(32)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Muestra el estado de tu mascota (o la de otro usuario).')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario a consultar (opcional)').setRequired(false)),
  )
  .addSubcommand((sub) => sub.setName('alimentar').setDescription('Le das de comer a tu mascota (consume 1x comida de tu inventario).'))
  .addSubcommand((sub) => sub.setName('jugar').setDescription('Jugás con tu mascota (gratis, cooldown de 1 hora).'))
  .addSubcommand((sub) =>
    sub
      .setName('pelear')
      .setDescription('Combate instantáneo contra la mascota de otro usuario. El ganador se lleva una recompensa.')
      .addUserOption((o) => o.setName('usuario').setDescription('Contra quién pelear').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('renombrar')
      .setDescription('Le cambia el nombre a tu mascota.')
      .addStringOption((o) => o.setName('nombre').setDescription('Nuevo nombre').setRequired(true).setMaxLength(32)),
  )
  .addSubcommand((sub) => sub.setName('ayuda').setDescription('Explica cómo funciona todo el sistema de mascotas: hambre, bonus, etapas y combate.'))
  .setDMPermission(false);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'adoptar') return handleAdoptar(interaction);
  if (sub === 'ver') return handleVer(interaction);
  if (sub === 'alimentar') return handleAlimentar(interaction);
  if (sub === 'jugar') return handleJugar(interaction);
  if (sub === 'pelear') return handlePelear(interaction);
  if (sub === 'renombrar') return handleRenombrar(interaction);
  if (sub === 'ayuda') return handleAyuda(interaction);
}
