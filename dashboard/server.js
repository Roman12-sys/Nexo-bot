// Servicio propio, separado del proceso del bot (src/index.js) — se despliega como un
// segundo servicio de Railway sobre el mismo repo, con su propio start command
// (`npm run dashboard`). No comparte proceso ni conexión de gateway con el bot: solo
// lee de la misma base de Supabase y usa el token del bot para llamadas REST puntuales.
import crypto from 'node:crypto';
import express from 'express';
import { dashboardConfig } from './config.js';
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser, resolveUsers } from './discordApi.js';
import { createSessionCookie, clearSessionCookie, createStateCookie, clearStateCookie, readSession, parseCookies } from './session.js';
import { listManagedGuilds, checkGuildAccess, loadGuildDashboardData } from './queries.js';
import { layout } from './html.js';
import { renderLoginPage, renderGuildList, renderGuildDashboard } from './views.js';
import { rateLimitMiddleware } from './rateLimiter.js';

const app = express();
app.disable('x-powered-by');
app.use(rateLimitMiddleware);

// Snowflake de Discord: 17-20 dígitos. Sin este chequeo, un guildId con %2F/.. decodificado
// por Express podía terminar armando una ruta de la REST API de Discord distinta a
// /guilds/{id} (ej. /guilds/0/../../users/@me) usando el token del bot — el chequeo de
// acceso posterior seguía bloqueando, pero esto cierra la primitiva por completo.
const GUILD_ID_RE = /^\d{17,20}$/;

app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', createStateCookie(state));
  res.redirect(buildAuthorizeUrl(state));
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);

    if (!code || !state || state !== cookies.oauth_state) {
      res.setHeader('Set-Cookie', clearStateCookie());
      res.status(400).send(layout({ title: 'Login inválido', body: '<div class="card"><p>El login expiró o es inválido. <a href="/auth/login">Volvé a intentar</a>.</p></div>' }));
      return;
    }

    const token = await exchangeCodeForToken(code);
    const user = await fetchDiscordUser(token.access_token);

    res.setHeader('Set-Cookie', [createSessionCookie(user.id), clearStateCookie()]);
    res.redirect('/');
  } catch (error) {
    console.error('❌ Error en el callback de OAuth del dashboard:', error);
    res.status(500).send(layout({ title: 'Error', body: '<div class="card"><p>No se pudo completar el login con Discord.</p></div>' }));
  }
});

app.get('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.redirect('/');
});

app.get('/', async (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.send(layout({ title: 'Nexo Bot — Dashboard', body: renderLoginPage() }));
    return;
  }

  try {
    const guilds = await listManagedGuilds(session.userId);
    res.send(layout({ title: 'Tus servidores', body: renderGuildList(guilds), loggedIn: true }));
  } catch (error) {
    console.error('❌ Error listando servidores del dashboard:', error);
    res.status(500).send(layout({ title: 'Error', body: '<div class="card"><p>No se pudieron cargar tus servidores.</p></div>', loggedIn: true }));
  }
});

app.get('/guild/:guildId', async (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.redirect('/auth/login');
    return;
  }

  if (!GUILD_ID_RE.test(req.params.guildId)) {
    res.status(400).send(layout({ title: 'ID inválido', body: '<div class="card"><p>Ese ID de servidor no es válido.</p></div>', loggedIn: true }));
    return;
  }

  try {
    const access = await checkGuildAccess(req.params.guildId, session.userId);
    if (!access) {
      res.status(403).send(layout({ title: 'Sin acceso', body: '<div class="card"><p>No tenés acceso a este servidor.</p></div>', loggedIn: true }));
      return;
    }

    const data = await loadGuildDashboardData(req.params.guildId);
    const userIds = [
      ...data.topBalances.map((b) => b.user_id),
      ...data.recentWarns.flatMap((w) => [w.user_id, w.moderator_id]),
      ...data.topTrivia.map((t) => t.userId),
      ...data.punishedMembers,
      // Fase 5: topXp/topAchievers/voiceStats.topOwners son fuentes nuevas del dashboard.
      ...data.topXp.map((x) => x.userId),
      ...data.topAchievers.map((a) => a.userId),
      ...data.voiceStats.topOwners.map((o) => o.ownerId),
    ];
    const usersById = await resolveUsers(userIds);

    res.send(layout({ title: access.guild.name, body: renderGuildDashboard(access.guild, data, usersById), loggedIn: true }));
  } catch (error) {
    console.error('❌ Error cargando el dashboard de un servidor:', error);
    res.status(500).send(layout({ title: 'Error', body: '<div class="card"><p>No se pudo cargar la información de este servidor.</p></div>', loggedIn: true }));
  }
});

app.use((req, res) => {
  res.status(404).send(layout({ title: 'No encontrado', body: '<div class="card"><p>Página no encontrada. <a href="/">Volver</a>.</p></div>' }));
});

app.listen(dashboardConfig.port, () => {
  console.log(`📊 Dashboard de Nexo Bot corriendo en el puerto ${dashboardConfig.port}`);
});
