import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, BRAND_NAME } from './embeds.js';

// Arma un comando de "acción" completo (como /hug, /slap, etc.) para no repetir la
// misma lógica en cada uno de los 21 archivos. Cada comando individual solo pasa sus
// propios datos (nombre, categoría de nekos.best, textos).
export function createActionCommand({ name, description, category, selfText, targetText }) {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addUserOption((o) => o.setName('usuario').setDescription('A quién va dirigido (opcional)').setRequired(false))
      .setDMPermission(false),

    // Sin costo real (un gif) — comparte un cupo de rate limit más laxo entre sí, en vez
    // de competir por el mismo cupo que un comando de moderación real. Ver rateLimiter.js.
    rateLimitCategory: 'light',

    async execute(interaction) {
      try {
        await interaction.deferReply();

        const rawTargetUser = interaction.options.getUser('usuario');
        // Si se apuntó a sí mismo, tratamos el caso como "sin objetivo" (selfText) — decir
        // "Fran abraza a Fran" queda raro; "Fran se abraza a sí mismo" tiene más sentido.
        const targetUser = rawTargetUser && rawTargetUser.id !== interaction.user.id ? rawTargetUser : null;

        // AbortSignal.timeout evita que la interacción quede "pensando..." para siempre
        // si nekos.best no responde.
        const response = await fetch(`https://nekos.best/api/v2/${category}`, {
          headers: { 'User-Agent': 'Nexo Bot (Discord)' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`nekos.best respondió con estado ${response.status}`);

        const data = await response.json();
        const gifUrl = data.results?.[0]?.url;
        if (!gifUrl) throw new Error('La API no devolvió ninguna imagen.');

        const text = targetUser
          ? targetText.replace('{autor}', `${interaction.user}`).replace('{objetivo}', `${targetUser}`)
          : selfText.replace('{autor}', `${interaction.user}`);

        const embed = new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setDescription(text)
          .setImage(gifUrl)
          .setFooter({ text: BRAND_NAME });

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(`❌ Error ejecutando /${name}:`, error);
        await interaction.editReply({ content: '❌ No se pudo obtener el gif en este momento. Probá de nuevo en un rato.' });
      }
    },
  };
}
