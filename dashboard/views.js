import { escapeHtml } from './html.js';
import { GUILD_ACHIEVEMENTS } from '../src/utils/guildAchievements.js';
import { config } from '../src/config.js';

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

// ---------------------------------------------------------------------------
// Dashboard 2.0 (MEJORA 1/2, CICLO 1) — "Resumen" arriba de todo (stats + accesos
// rápidos + actividad reciente), estado de sistemas, y problemas de configuración.
// Todo sobre datos que loadGuildDashboardData ya calculaba o ya traía (ver
// dashboard/queries.js: computeSystemsStatus/computeConfigIssues) — acá solo se
// renderiza, no se decide nada nuevo.
// ---------------------------------------------------------------------------

const STATUS_BADGE = {
  ok: '<span class="badge badge-ok">🟢</span>',
  warning: '<span class="badge badge-warning">🟡</span>',
  off: '<span class="badge badge-off">⚪</span>',
};

const SEVERITY_BADGE = {
  danger: '<span class="badge badge-danger">🔴 Urgente</span>',
  warning: '<span class="badge badge-warning">🟡 Atención</span>',
};

// Accesos rápidos: anclas a secciones que YA existen más abajo en esta misma página
// (nunca un botón decorativo a algo que no existe) — mismo criterio pedido: si una
// función solo se configura por comando de Discord, el link lleva a donde el dashboard
// YA muestra esa configuración (la tarjeta "Configuración actual"), no a un /config
// gigante nuevo. "Abrir servidor" y "Ayuda" son los únicos dos links externos, y
// "Ayuda" solo aparece si config.supportContact está seteado (nunca un link inventado).
function buildQuickActions(guild) {
  const links = [
    ['#config', '⚙️ Configuración'],
    ['#moderacion', '🛡️ Moderación'],
    ['#economia', '💰 Economía'],
    ['#xp', '⭐ XP'],
    ['#giveaways', '🎉 Giveaways'],
    ['#tempvoice', '🔊 Temp Voice'],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join('');

  const externalLinks = [
    `<a href="https://discord.com/channels/${escapeHtml(guild.id)}" target="_blank" rel="noopener">🎮 Abrir servidor</a>`,
    config.supportContact ? `<a href="${escapeHtml(config.supportContact)}" target="_blank" rel="noopener">🆘 Ayuda</a>` : '',
  ].join('');

  return `<div class="quick-actions">${links}${externalLinks}</div>`;
}

// Reusa recentWarns/activeGiveaways (ya cargados por loadGuildDashboardData para sus
// propias tarjetas) — a propósito NO se agrega ninguna tabla/columna nueva de analytics
// solo para esta lista.
function buildRecentActivity(data, usersById) {
  const items = [
    ...data.recentWarns
      .slice(0, 3)
      .map(
        (w) =>
          `<li>⚠️ Advertencia a ${userLabel(usersById, w.user_id)} — ${escapeHtml(w.reason || 'sin motivo')} <span class="muted">${new Date(w.created_at).toLocaleDateString('es-ES')}</span></li>`,
      ),
    ...data.activeGiveaways.slice(0, 2).map((g) => `<li>🎉 Sorteo activo: <strong>${escapeHtml(g.prize)}</strong></li>`),
  ];

  if (items.length === 0) return '<p class="muted" style="margin:0.75rem 0 0;">Sin actividad reciente registrada.</p>';
  return `<ul class="activity-list">${items.join('')}</ul>`;
}

function buildResumenCard(guild, data, usersById) {
  const systemsStatus = data.systemsStatus || [];
  const configIssues = data.configIssues || [];
  const activeSystems = systemsStatus.filter((s) => s.status === 'ok').length;

  return `
    <div class="card">
      <h2>📋 Resumen</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${guild.approximate_member_count ?? '—'}</div><div class="label">Miembros</div></div>
        <div class="stat"><div class="value">${activeSystems}/${systemsStatus.length}</div><div class="label">Sistemas activos</div></div>
        <div class="stat"><div class="value">${configIssues.length}</div><div class="label">${configIssues.length === 1 ? 'Problema detectado' : 'Problemas detectados'}</div></div>
      </div>
      ${buildQuickActions(guild)}
      <h3 style="margin:1.25rem 0 0.25rem;font-size:0.95rem;">🕒 Actividad reciente</h3>
      ${buildRecentActivity(data, usersById)}
    </div>`;
}

// Solo se renderiza si hay al menos un problema real — el propio Resumen ya muestra
// "0 problemas detectados" cuando no hay nada, no hace falta una segunda tarjeta vacía
// para confirmarlo (menos información irrelevante).
function buildIssuesCard(configIssues) {
  if (!configIssues || configIssues.length === 0) return '';

  const items = configIssues
    .map(
      (issue) => `
      <div class="issue-item">
        ${SEVERITY_BADGE[issue.severity] || SEVERITY_BADGE.warning}
        <div class="issue-body">
          <h4>${escapeHtml(issue.title)}</h4>
          <p>${escapeHtml(issue.detail)}</p>
        </div>
      </div>`,
    )
    .join('');

  return `
    <div class="card">
      <h2>⚠️ Problemas de configuración (${configIssues.length})</h2>
      ${items}
    </div>`;
}

function buildSystemsCard(systemsStatus) {
  const items = (systemsStatus || [])
    .map(
      (s) => `
      <div class="system-item">
        <span>${escapeHtml(s.label)}</span>
        <span>${STATUS_BADGE[s.status] || ''} <span class="muted">${escapeHtml(s.detail)}</span></span>
      </div>`,
    )
    .join('');

  return `
    <div class="card">
      <h2>🧩 Sistemas</h2>
      <div class="systems-grid">${items}</div>
    </div>`;
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

  // QUÉ CAMBIÓ (Fase 2C, sección 2): punishedMembers ahora viene recortado desde
  // queries.js (a lo sumo 20) — punishedTotal es el conteo real, para no perder el
  // número correcto en el título de la tarjeta ni fingir que no hay más de 20.
  const punishedRows =
    data.punishedMembers.map((userId) => `<tr><td>${userLabel(usersById, userId)}</td></tr>`).join('') ||
    '<tr><td class="muted">Nadie sancionado ahora mismo</td></tr>';
  const punishedOverflow =
    data.punishedTotal > data.punishedMembers.length
      ? `<p class="muted">(+${data.punishedTotal - data.punishedMembers.length} más)</p>`
      : '';

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

  // DASH-1, Fase 4B: antes "solo lectura" aparecía UNA vez, en letra chica, solo en el
  // login — quien entraba directo a /guild/:id (link guardado) nunca lo veía. Se repite
  // acá, en la página real, con el mismo mensaje accionable (dónde SÍ se cambian las
  // cosas) en vez de un simple "esto es de solo lectura".
  const readOnlyBanner = `
    <div class="card">
      <p class="muted" style="margin:0;">👁️ Este panel es <strong>solo lectura</strong>. Para cambiar cualquier cosa (roles, canales, módulos) usá <code>/setup</code> o <code>/config</code> directamente en Discord.</p>
    </div>`;

  const role = (id) => (id ? `<code>&lt;@&amp;${escapeHtml(id)}&gt;</code>` : '<span class="muted">— sin configurar</span>');
  const channel = (id) => (id ? `<code>#${escapeHtml(id)}</code>` : '<span class="muted">— sin configurar</span>');
  const toggle = (on) => (on ? '✅ Activo' : '❌ Apagado');
  const cfg = data.guildConfig || {};
  const features = cfg.features || {};

  // "Economía" no tiene un toggle real (features.economia se eliminó — nunca gateó
  // ningún comando, ver setup.js) — se muestra como "Siempre activa" en vez de
  // inventar un estado on/off que el código no tiene.
  const configCard = `
    <div class="card" id="config">
      <h2>⚙️ Configuración actual</h2>
      <p class="muted" style="margin-top:-0.5rem;">Datos reales de este servidor — para cambiar algo de acá, usá <code>/setup</code> o <code>/config</code>.</p>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Rol de administrador</div>${role(cfg.admin_role_id)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Rol de moderador</div>${role(cfg.moderator_role_id)}</div>
      </div>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Log de moderación</div>${channel(cfg.log_channel_moderation_id)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Log de actividad</div>${channel(cfg.log_channel_activity_id)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Log de economía</div>${channel(cfg.log_channel_economy_id)}</div>
      </div>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Moderación</div>${toggle(features.moderacion)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">XP</div>${toggle(features.xp)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Economía</div>💰 Siempre activa</div>
      </div>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Canal de bienvenida</div>${channel(cfg.welcome_channel_id)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Canal de confesiones</div>${channel(cfg.confession_channel_id)}</div>
      </div>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Rol automático</div>${role(cfg.auto_role_id)}</div>
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Rol de castigo</div>${role(cfg.punish_role_id)}</div>
      </div>
      <div class="stat-row" style="margin-top:0.75rem;">
        <div><div class="label" style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;">Canal de reportes</div>${cfg.report_channel_id ? channel(cfg.report_channel_id) : '<span class="muted">— usa el log de moderación</span>'}</div>
      </div>
    </div>`;

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
    ${buildResumenCard(guild, data, usersById)}
    ${buildIssuesCard(data.configIssues)}
    ${buildSystemsCard(data.systemsStatus)}
    ${readOnlyBanner}
    ${configCard}

    <div class="card">
      <h2>📊 Actividad</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${guild.approximate_member_count ?? '—'}</div><div class="label">Miembros</div></div>
        <div class="stat"><div class="value">${data.totalCommands}</div><div class="label">Comandos ejecutados</div></div>
        <div class="stat"><div class="value">${data.unlockedAchievementIds.size}/${GUILD_ACHIEVEMENTS.length}</div><div class="label">Logros de servidor</div></div>
      </div>
      <table><thead><tr><th>Comando más usado</th><th>Usos</th></tr></thead><tbody>${topCommandsRows}</tbody></table>
    </div>

    <div class="card" id="economia">
      <h2>💰 Economía</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.totalCoins.toLocaleString('es-ES')}</div><div class="label">Monedas en circulación</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Balance</th></tr></thead><tbody>${topBalancesRows}</tbody></table>
    </div>

    <div class="card" id="moderacion">
      <h2>🛡️ Moderación</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.totalWarns}</div><div class="label">Advertencias totales</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Motivo</th><th>Staff</th><th>Fecha</th></tr></thead><tbody>${warnsRows}</tbody></table>
      <h3 style="margin:1rem 0 0.5rem;">🚫 Sancionados activos (${data.punishedTotal})</h3>
      ${data.punishedPossiblyIncomplete ? '<p class="muted">El servidor tiene muchos miembros — esta lista puede no incluirlos a todos.</p>' : ''}
      <table><thead><tr><th>Usuario</th></tr></thead><tbody>${punishedRows}</tbody></table>
      ${punishedOverflow}
    </div>

    <div class="card" id="giveaways">
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

    <div class="card" id="xp">
      <h2>⭐ XP y niveles</h2>
      <div class="stat-row">
        <div class="stat"><div class="value">${data.xpUserCount}</div><div class="label">Usuarios con XP</div></div>
      </div>
      <table><thead><tr><th>Usuario</th><th>Nivel</th><th>XP total</th></tr></thead><tbody>${xpRows}</tbody></table>
    </div>

    <div class="card" id="tempvoice">
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
