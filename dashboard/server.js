// Servicio propio, separado del proceso del bot (src/index.js) — se despliega como un
// segundo servicio de Railway sobre el mismo repo, con su propio start command
// (`npm run dashboard`). No comparte proceso ni conexión de gateway con el bot: solo
// lee de la misma base de Supabase y usa el token del bot para llamadas REST puntuales.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { dashboardConfig } from './config.js';
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser, resolveUsers } from './discordApi.js';
import { createSessionCookie, clearSessionCookie, createStateCookie, clearStateCookie, readSession, parseCookies } from './session.js';
import { listManagedGuilds, checkGuildAccess, loadGuildDashboardData } from './queries.js';
import { layout } from './html.js';
import { renderLoginPage, renderGuildList, renderGuildDashboard } from './views.js';
import { rateLimitMiddleware } from './rateLimiter.js';
import { registerShutdown } from '../src/utils/shutdown.js';
import { reportCriticalError } from '../src/utils/errorReporter.js';

// Red de seguridad general (mismo criterio que src/index.js, no copiado a ciegas: se
// evaluó qué puede fallar acá). Cada ruta de este archivo ya tiene su propio try/catch
// alrededor de la lógica async — eso cubre el camino normal de un request. Lo que NO
// cubre es cualquier rechazo de promesa que escape de ese try/catch (ej. un handler de
// setInterval synchrónico rompiendo, o código futuro que no envuelva su propio await) —
// desde Node 15, una unhandledRejection sin listener tira todo el proceso por default,
// exactamente el mismo riesgo que ya tiene el bot. uncaughtException sale directo con
// process.exit(1) en vez de pasar por registerShutdown (que espera a que las requests en
// curso terminen): tras una excepción no capturada no se sabe en qué estado quedó el
// proceso, así que esperar es más arriesgado que reiniciar ya.
// MOTIVO: auditoría Fase 2C, sección 5.
process.on('unhandledRejection', (reason) => {
  console.error('❌ Promesa rechazada sin manejar (dashboard):', reason);
  reportCriticalError(null, 'dashboard: unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada (dashboard), reiniciando el proceso:', error);
  // Mismo criterio que src/index.js: esperar el intento de alerta (REST puro, no
  // depende de ninguna conexión de gateway) antes de salir, para no cortarla a mitad
  // de camino con el process.exit.
  reportCriticalError(null, 'dashboard: uncaughtException', error).finally(() => process.exit(1));
});

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
    reportCriticalError(null, 'dashboard: /auth/callback', error);
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
    reportCriticalError(null, 'dashboard: GET /', error);
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
    reportCriticalError(null, `dashboard: GET /guild/${req.params.guildId}`, error);
    res.status(500).send(layout({ title: 'Error', body: '<div class="card"><p>No se pudo cargar la información de este servidor.</p></div>', loggedIn: true }));
  }
});

app.use((req, res) => {
  res.status(404).send(layout({ title: 'No encontrado', body: '<div class="card"><p>Página no encontrada. <a href="/">Volver</a>.</p></div>' }));
});

// Export + guard, para poder importar `app` desde un test (Fase 1, auditoría de
// seguridad/economía, 2026-08-30) sin que la sola importación abra un puerto real — el
// listen() de abajo solo corre cuando el archivo se ejecuta directo (`node
// dashboard/server.js`, que es como lo arrancan npm run dashboard/dashboard:dev), nunca
// cuando otro módulo hace `import { app } from './server.js'`. No cambia nada del
// comportamiento en producción.
export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = app.listen(dashboardConfig.port, () => {
    console.log(`📊 Dashboard de Nexo Bot corriendo en el puerto ${dashboardConfig.port}`);
  });

  // Mismo shutdown chico que el bot (src/index.js) — server.close() deja de aceptar
  // conexiones nuevas y espera a que las requests en curso terminen antes de cerrar.
  registerShutdown(['SIGTERM', 'SIGINT'], () => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
}
