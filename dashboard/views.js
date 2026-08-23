import { escapeHtml } from './html.js';
import { GUILD_ACHIEVEMENTS } from '../src/utils/guildAchievements.js';

export function renderLoginPage() {
  return `
    <div class="card login-card">
      <h1 style="margin-top:0;">Panel de administración</h1>
      <p class="muted">Solo lectura: actividad, economía y moderación de los servidores donde tenés rol de staff.</p>
      <p><a class="btn" href="/auth/login">Iniciar sesión con Discord</a></p>
    </div>`;
}

export function renderGuildList(guilds) {
  if (guilds.length === 0) {
    return `
      <h1>Tus servidores</h1>
      <div class="card"><p class="muted">No encontramos servidores donde tengas rol de staff configurado (o no sos dueño de ninguno donde esté el bot).</p></div>`;
  }

  const items = guilds
    .map(
      (g) => `
      <a class="guild-item" href="/guild/${g.id}">
        ${
          g.icon
            ? `<img class="guild-icon" src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64" alt="">`
            : '<div class="guild-icon-placeholder"></div>'
        }
        <span>${escapeHtml(g.name)}</span>
      </a>`,
    )
    .join('');

  return `<h1>Tus servidores</h1><div class="guild-list">${items}</div>`;
}

function userLabel(usersById, userId) {
  const user = usersById.get(userId);
  if (!user) return `<code>${escapeHtml(userId)}</code>`;
  return escapeHtml(user.global_name || user.username);
}

export function renderGuildDashboard(guild, data, usersById) {
  const topCommandsRows =
    data.topCommands.map((c) => `<tr><td>/${escapeHtml(c.command_name)}</td><td>${c.uses}</td></tr>`).join('') ||
    '<tr><td colspan="2" class="muted">Sin datos todavía</td></tr>';

  const topBalancesRows =
    data.topBalances
      .map((b) => `<tr><td>${userLabel(usersById, b.user_id)}</td><td>${Number(b.balance).toLocaleString('es-ES')}</td></tr>`)
      .join('') || '<tr><td colspan="2" class="muted">Sin datos todavía</td></tr>';

  const warnsRows =
    data.recentWarns
      .map(
        (w) => `
        <tr>
          <td>${userLabel(usersById, w.user_id)}</td>
          <td>${escapeHtml(w.reason || '—')}</td>
          <td>${userLabel(usersById, w.moderator_id)}</td>
          <td>${new Date(w.created_at).toLocaleDateString('es-ES')}</td>
        </tr>`,
      )
      .join('') || '<tr><td colspan="4" class="muted">Sin advertencias registradas</td></tr>';

  return `
    <a class="muted" href="/">&larr; Tus servidores</a>
    <h1>${escapeHtml(guild.name)}</h1>

    <div class="card">
      <h2>📊 Actividad</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${guild.approximate_member_count ?? '—'}</div><div class="label">Miembros</div></div>
        <div class="stat"><div class="value">${data.totalCommands}</div><div class="label">Comandos ejecutados</div></div>
        <div class="stat"><div class="value">${data.unlockedAchievementIds.size}/${GUILD_ACHIEVEMENTS.length}</div><div class="label">Logros de servidor</div></div>
      </div>
      <table><thead><tr><th>Comando más usado</th><th>Usos</th></tr></thead><tbody>${topCommandsRows}</tbody></table>
    </div>

    <div class="card">
      <h2>💰 Economía</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.totalCoins.toLocaleString('es-ES')}</div><div class="label">Monedas en circulación</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Balance</th></tr></thead><tbody>${topBalancesRows}</tbody></table>
    </div>

    <div class="card">
      <h2>🛡️ Moderación</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.totalWarns}</div><div class="label">Advertencias totales</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Motivo</th><th>Staff</th><th>Fecha</th></tr></thead><tbody>${warnsRows}</tbody></table>
    </div>`;
}
