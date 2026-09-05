# Nexo Bot

**Nexo** es una plataforma para administrar y hacer crecer una comunidad de Discord desde
un solo lugar: moderación, economía, progresión (XP/niveles), reportes de miembros,
sorteos, trivia, salas de voz temporales (Join to Create), constructor de anuncios y
tienda — todo en un único bot multi-servidor, con un dashboard de solo lectura para
seguir la actividad sin entrar a Discord. Un solo proceso atiende a cualquier cantidad de
servidores — cada uno se configura solo con `/setup` y `/config`, sin tocar código ni
variables de entorno.

## Requisitos

- Node.js 22 o superior
- Una app de Discord (Developer Portal) con su token de bot
- Un proyecto de Supabase (Postgres)

## Puesta en marcha

1. **Instalar dependencias**

   ```bash
   npm install
   ```

2. **Completar `.env`** (copiar `.env.example` como base)

   ```
   DISCORD_TOKEN=            # token del bot, Developer Portal → Bot
   CLIENT_ID=                # Application ID, Developer Portal → General Information
   GUILD_ID_DEV=              # ID de un server propio para desarrollo (deploy instantáneo)

   SUPABASE_URL=              # https://<proyecto>.supabase.co  — SIN /rest/v1 al final
   SUPABASE_SERVICE_ROLE_KEY= # Supabase → Project Settings → API → service_role key
   ```

3. **Crear el esquema en Supabase**

   Pegar el contenido completo de [`schema.sql`](schema.sql) en el SQL Editor del
   proyecto de Supabase y ejecutarlo. Crea todas las tablas (incluida `guild_config`,
   la configuración por servidor) y las funciones RPC atómicas que usan los comandos de
   economía/XP/reputación/confesiones.

4. **Registrar los comandos**

   ```bash
   npm run deploy -- dev   # solo en GUILD_ID_DEV, aparece al instante — para desarrollar
   npm run deploy          # global, para cualquier server con el bot invitado (tarda hasta 1h en propagar)
   ```

5. **Arrancar el bot**

   ```bash
   npm start        # producción
   npm run dev       # con --watch, reinicia solo al guardar
   ```

6. **En Discord**: invitar al bot al servidor y correr `/setup` — crea el rol de staff,
   los canales de logs, activa los módulos que elijas (moderación/economía/XP), y de
   forma opcional también canal de bienvenida, canal de confesiones, rol automático
   para miembros nuevos y rol de castigo (todo togleable en el mismo panel). `/config`
   sigue disponible para cuando quieras apuntar a un canal/rol que ya existe en vez de
   crear uno nuevo.

## Estructura

```
src/
  index.js              punto de entrada — auto-carga comandos y eventos
  config.js              lee .env (nada específico de un servidor vive acá)
  supabaseClient.js
  deploy-commands.js      registro de slash commands (dev o global)
  commands/<categoría>/   cada archivo exporta { data, execute } — auto-cargado
  events/                 cada archivo exporta { name, once, execute } — auto-cargado
  components/             routers de botones/selects/modales por prefijo de customId
  utils/                  stores de datos (Supabase) + lógica de Discord separada
dashboard/               panel web de solo lectura — proceso propio, ver más abajo
```

Cada comando/feature que necesita botones o modales se autorregistra en los routers de
`components/` al cargarse — no hay que tocar ningún archivo central para agregar una
feature nueva. Ver [`CLAUDE.md`](CLAUDE.md) para el resto de las decisiones de diseño.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el bot |
| `npm run dev` | Arranca con `--watch` (reinicia al guardar) |
| `npm run deploy -- dev` | Registra los slash commands solo en `GUILD_ID_DEV` |
| `npm run deploy` | Registra los slash commands globalmente |
| `npm test` | Corre la suite de tests (Vitest) |
| `npm run test:watch` | Tests en modo watch |
| `npm run dashboard` | Arranca el panel web (proceso separado del bot) |
| `npm run dashboard:dev` | Panel web con `--watch` |

## Dashboard web

Panel de solo lectura (actividad, economía, moderación por servidor) en `dashboard/`.
Es un proceso Express **separado del bot** — mismo repo, otro entry point — pensado para
correr como un segundo servicio de Railway. No escribe nada: solo lee las mismas tablas
de Supabase, y usa el token del bot vía REST para resolver nombres/roles (no abre una
conexión de gateway propia).

Acceso: login con Discord (OAuth, scope `identify` únicamente). Un usuario solo ve los
servidores donde el bot está y donde es dueño o tiene el rol de staff configurado por
`/setup` — se revalida en cada request, nunca confía en el link.

**Puesta en marcha (además de lo de arriba):**

1. En el Developer Portal de la app (la misma del bot) → **OAuth2**:
   - Copiar el **Client Secret** (distinto del token del bot).
   - Agregar `<DASHBOARD_BASE_URL>/auth/callback` a la lista de **Redirects**
     (ej. `https://nexo-dashboard.up.railway.app/auth/callback`, o
     `http://localhost:3000/auth/callback` en local).
2. Completar en `.env`:
   ```
   CLIENT_SECRET=             # el Client Secret del paso anterior
   DASHBOARD_SESSION_SECRET=  # cualquier string largo random (ej: openssl rand -hex 32)
   DASHBOARD_BASE_URL=        # la URL pública de este servicio, sin barra final
   ```
3. Arrancar:
   ```bash
   npm run dashboard       # producción
   npm run dashboard:dev   # con --watch
   ```

En Railway: crear un **segundo servicio** apuntando a este mismo repo, con start command
`npm run dashboard`. Railway define `PORT` solo; el resto de las variables (`DISCORD_TOKEN`,
`CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` + las 3 de arriba) hay que
cargarlas en ese servicio igual que en el del bot.

## Legal / publicación

- [Landing page](https://claude.ai/code/artifact/3b37f4fd-16d5-475b-9d41-135833fc3039)
- [Términos de Servicio](https://claude.ai/code/artifact/8f9bbee4-665a-4245-93f3-e0329c8760a4)
- [Política de Privacidad](https://claude.ai/code/artifact/89a893fb-8fa2-40d6-8b42-cf3e9fb7c646)

Estas 3 páginas son plantillas de referencia (no revisadas legalmente) publicadas como
Artifacts — no requieren infraestructura propia. Las URLs de ToS/Privacidad van en el
Developer Portal de Discord (tu app → General Information) y son uno de los requisitos
para pedir verificación cuando el bot supere 100 servidores. Eso último es una acción
que solo puede hacer el dueño de la cuenta de Discord de la app (Developer Portal → tu
app → pestaña de verificación), con 2FA activado — no es algo que se pueda automatizar.
Tené en cuenta también que el bot usa 2 intents privilegiados (`GuildMembers`,
`MessageContent`), que Discord revisa con más atención en ese proceso.
