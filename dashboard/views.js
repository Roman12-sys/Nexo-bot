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

  const giveawaysRows =
    data.activeGiveaways
      .map((g) => `<tr><td>${escapeHtml(g.prize)}</td><td><code>${escapeHtml(g.messageId)}</code></td></tr>`)
      .join('') || '<tr><td colspan="2" class="muted">Ninguno activo ahora mismo</td></tr>';

  const triviaRows =
    data.topTrivia.map((t) => `<tr><td>${userLabel(usersById, t.userId)}</td><td>${t.points}</td></tr>`).join('') ||
    '<tr><td colspan="2" class="muted">Todavía nadie sumó puntos</td></tr>';

  const punishedRows =
    data.punishedMembers.map((userId) => `<tr><td>${userLabel(usersById, userId)}</td></tr>`).join('') ||
    '<tr><td class="muted">Nadie sancionado ahora mismo</td></tr>';

  // --- Fase 5: secciones nuevas, todas sobre datos que ya existían en Supabase pero
  // el dashboard nunca mostraba (XP, salas de voz, logros individuales, LoL, misiones,
  // actividad diaria) ---

  const xpRows =
    data.topXp.map((x) => `<tr><td>${userLabel(usersById, x.userId)}</td><td>${x.level}</td><td>${x.xp.toLocaleString('es-ES')}</td></tr>`).join('') ||
    '<tr><td colspan="3" class="muted">Todavía nadie ganó XP</td></tr>';

  const voiceOwnerRows =
    data.voiceStats.topOwners
      .map((o) => `<tr><td>${userLabel(usersById, o.ownerId)}</td><td>${o.sessions}</td><td>${Math.round(o.durationSeconds / 60)} min</td></tr>`)
      .join('') || '<tr><td colspan="3" class="muted">Todavía no hubo salas</td></tr>';

  const achieverRows =
    data.topAchievers.map((a) => `<tr><td>${userLabel(usersById, a.userId)}</td><td>${a.count}</td></tr>`).join('') ||
    '<tr><td colspan="2" class="muted">Todavía nadie desbloqueó un logro</td></tr>';

  const dailyStatsRows =
    data.dailyStats
      .map(
        (d) =>
          `<tr><td>${d.date}</td><td>${d.messagesSent}</td><td>${d.commandsExecuted}</td><td>${d.moneyCreated.toLocaleString('es-ES')}</td><td>${d.moneyDestroyed.toLocaleString('es-ES')}</td><td>${d.xpDistributed.toLocaleString('es-ES')}</td></tr>`,
      )
      .join('') || '<tr><td colspan="6" class="muted">Sin datos todavía (se llena en vivo desde hoy)</td></tr>';

  // Fase A, segunda auditoría 2026-08-30 (Parte 12) — única línea "accionable" nueva de
  // esta tarjeta: delta de mensajes vs. la semana anterior, calculado en queries.js sobre
  // los mismos 14 días de guild_daily_stats (sin queries nuevas). Si todavía no hay dos
  // semanas de historial real, messagesDelta es null y no se muestra nada — no se inventa
  // una comparación contra datos que no existen.
  const messagesDeltaLine = data.messagesDelta
    ? `<p class="muted">📨 Mensajes esta semana: <strong>${data.messagesDelta.current.toLocaleString('es-ES')}</strong> (${data.messagesDelta.deltaPct >= 0 ? '+' : ''}${data.messagesDelta.deltaPct}% vs. semana anterior)</p>`
    : '';

  const lolCard = data.lolChannelId
    ? `<div class="card">
        <h2>🎮 League of Legends</h2>
        <p>Avisos de patch notes activos en <code>#${escapeHtml(data.lolChannelId)}</code>.</p>
        ${
          data.lolLastUrl
            ? `<p>Último patch anunciado: <a href="${escapeHtml(data.lolLastUrl)}" target="_blank" rel="noopener">ver nota completa</a>${data.lolLastAnnouncedAt ? ` — ${new Date(data.lolLastAnnouncedAt).toLocaleDateString('es-ES')}` : ''}</p>`
            : '<p class="muted">Todavía no se anunció ningún patch desde que se activó.</p>'
        }
      </div>`
    : '';

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
      <h3 style="margin:1rem 0 0.5rem;">🚫 Sancionados activos (${data.punishedMembers.length})</h3>
      ${data.punishedPossiblyIncomplete ? '<p class="muted">El servidor tiene muchos miembros — esta lista puede no incluirlos a todos.</p>' : ''}
      <table><thead><tr><th>Usuario</th></tr></thead><tbody>${punishedRows}</tbody></table>
    </div>

    <div class="card">
      <h2>🎉 Sorteos y juegos</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.activeGiveaways.length}</div><div class="label">Sorteos activos</div></div>
      </div>
      <table><thead><tr><th>Premio</th><th>ID del mensaje</th></tr></thead><tbody>${giveawaysRows}</tbody></table>
      <!-- QUÉ CAMBIÓ: se sacó la columna "Top reputación" (era la mitad derecha de este
           stat-row) — auditoría 2026-08-29, reputación eliminada por completo. Top trivia
           pasa a ocupar todo el ancho en vez de compartirlo con una columna vacía. -->
      <div class="stat-row" style="margin-top:1rem;">
        <div style="flex:1;">
          <h3 style="margin:0 0 0.5rem;">🧠 Top trivia</h3>
          <table><thead><tr><th>Usuario</th><th>Puntos</th></tr></thead><tbody>${triviaRows}</tbody></table>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>⭐ XP y niveles</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.xpUserCount}</div><div class="label">Usuarios con XP</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Nivel</th><th>XP total</th></tr></thead><tbody>${xpRows}</tbody></table>
    </div>

    <div class="card">
      <h2>🔊 Salas de voz temporales</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.voiceStats.totalSessions}</div><div class="label">Salas creadas (histórico, últimas 500)</div></div>
        <div class="stat"><div class="value">${Math.round(data.voiceStats.totalDurationSeconds / 3600)}</div><div class="label">Horas totales</div></div>
        <div class="stat"><div class="value">${data.voiceStats.peakConcurrent}</div><div class="label">Pico de gente en una sala</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Salas creadas</th><th>Tiempo total</th></tr></thead><tbody>${voiceOwnerRows}</tbody></table>
    </div>

    <div class="card">
      <h2>🏅 Logros más desbloqueados</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.unlockedAchievementIds.size}/${GUILD_ACHIEVEMENTS.length}</div><div class="label">Logros de servidor (colectivos)</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Logros individuales</th></tr></thead><tbody>${achieverRows}</tbody></table>
    </div>

    <div class="card">
      <h2>🗓️ Misiones</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.missionSummary.dailyCompletedUsers}</div><div class="label">Completaron alguna misión diaria hoy</div></div>
        <div class="stat"><div class="value">${data.missionSummary.weeklyCompletedUsers}</div><div class="label">Completaron alguna misión semanal esta semana</div></div>
      </div>
    </div>
    ${lolCard}

    <div class="card">
      <h2>📈 Actividad diaria (últimos 7 días)</h2>
      ${messagesDeltaLine}
      <table><thead><tr><th>Fecha</th><th>Mensajes</th><th>Comandos</th><th>Monedas generadas</th><th>Monedas destruidas</th><th>XP repartida</th></tr></thead><tbody>${dailyStatsRows}</tbody></table>
    </div>`;
}
