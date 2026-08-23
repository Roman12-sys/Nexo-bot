# Nexo Bot

Bot de Discord multi-servidor (economía, XP, moderación, sorteos, trivia, salas de voz
temporales, constructor de anuncios, tienda). Basado en gNoX Bot (`c:\Users\Fran\OneDrive\Escritorio\gnoX-bot`),
que es un bot de un solo servidor con toda su configuración fija en `.env`. Nexo Bot es
el mismo código y las mismas features, pero corre como **un único proceso que sirve a
cualquier cantidad de servidores a la vez** — nunca importa nada de gNoX en tiempo de
ejecución, es solo la referencia de la que se copió código a mano.

Este archivo documenta el *por qué* de las decisiones, no el *qué* (eso lo dice el código).

## El cambio central: guild_config en vez de .env

gNoX lee roles de staff, canales de log, etc. de variables de entorno, fijas al
desplegar — tiene sentido porque es una instancia por servidor. Nexo Bot no puede hacer
eso: el mismo proceso atiende servidores distintos con configuraciones distintas. Toda
esa configuración vive en la tabla `guild_config` (ver `schema.sql`), una fila por
servidor, con cache en memoria de 30s (`src/utils/guildConfigStore.js`) para no pegarle
a Supabase en cada mensaje.

Dos comandos llenan `guild_config`:
- **`/setup`** (`src/commands/admin/setup.js`) — crea canales/categoría/rol de staff
  automáticamente si no existen, y guarda sus IDs. Re-ejecutable sin duplicar (busca por
  ID guardado primero, después por nombre, recién ahí crea). Solo dueño/Administrator —
  no puede gatear con `isStaff()` porque la primera vez no hay `guild_config` todavía.
- **`/config`** (`src/commands/admin/config.js`) — para los campos que NO tienen
  creación automática porque son cosas que ya existen en el server y el admin elige
  cuál usar: rol de castigo, rol automático, canal de bienvenida, canal de confesiones.

Cualquier comando/evento que en gNoX leía `config.js` ahora hace
`await getGuildConfig(interaction.guildId)` y lee la columna correspondiente.

## Arquitectura de componentes (botones/selects/modales)

gNoX tenía un `components/buttons.js` gigante con un `if (customId === ...)` por cada
feature. Acá cada feature se autorregistra en un router genérico:

- `src/components/buttons.js` — `registerButtonPrefix(prefix, handler)` / `routeButton`
- `src/components/selects.js` — `registerSelectPrefix(prefix, handler)` / `routeSelect`
- `src/components/modals.js` — `registerModalPrefix(prefix, handler)` / `routeModal`

Un archivo de comando (ej. `src/commands/sorteos/sorteo.js`) llama
`registerButtonPrefix('giveaway_enter_', handler)` como side-effect al final del
archivo. Como `src/index.js` importa dinámicamente todos los archivos de
`src/commands/**` al arrancar, el registro ocurre solo con que el archivo exista — no
hace falta tocar ningún router central al agregar una feature nueva.

`src/events/interactionCreate.js` despacha `isChatInputCommand()` → `client.commands`,
y `isButton()` / `isModalSubmit()` / `isAnySelectMenu()` → los tres routers de arriba.

## Logs de auditoría

`guild_config` tiene 3 columnas de canal de log: `log_channel_moderation_id`,
`log_channel_activity_id`, `log_channel_economy_id`. `src/utils/guildLogChannels.js`
expone `getGuildLogChannel(client, guildId, 'moderation' | 'activity' | 'economy')`,
que resuelve la columna correcta y valida que el canal siga existiendo. Todos los
builders de embed de log (bans, kicks, warns, cambios de rol/canal/invite/emoji/
sticker/hilo, mensajes editados/borrados, etc.) viven consolidados en
`src/utils/logEmbeds.js` — a diferencia de gNoX, que los tenía repartidos entre
`utils/embeds.js` y `utils/logEmbeds.js`.

## Permisos

`src/utils/permissions.js`: `isStaff(interaction)` y `isStaffConfigured(guildId)` son
**async** (leen `guild_config`), a diferencia de gNoX donde eran síncronas (leían
`config.js` una sola vez al arrancar). Cualquier comando que llame `isStaff()` tiene que
hacer `await`. `getModerationBlockReason()` sigue siendo síncrona — no depende de
config, solo de jerarquía de roles de Discord.

## Gotcha real ya pisado: columnas de cooldown

Las columnas tipo "última vez que pasó X" (`last_daily`, `last_work`, `last_xp_ts`,
`last_given`) tienen que ser `bigint` (epoch en milisegundos), **no** `timestamptz` — el
código hace aritmética cruda tipo `Date.now() - economy.lastDaily`, nunca
`new Date(...)`. Crearlas como `timestamptz` rompe en producción con
`date/time field value out of range` la primera vez que se usan (ya pasó una vez con
`/daily`/`/work`). Columnas que sí se leen con `new Date(x).getTime()` (ej.
`warnings.created_at`) están bien como `timestamptz`.

## Dashboard web (`dashboard/`)

Panel de solo lectura (actividad/economía/moderación por servidor) — **proceso Express
separado del bot**, no un módulo dentro de `src/`. Se pensó así porque el bot y el
dashboard tienen perfiles totalmente distintos: el bot necesita una conexión de gateway
persistente y baja latencia; el dashboard es HTTP request/response de bajo tráfico. Correr
ambos en el mismo proceso acoplaría su ciclo de vida sin necesidad (un crash del server
HTTP no debería tirar el bot, y viceversa) — por eso son dos servicios de Railway
separados que comparten el mismo repo y la misma base de Supabase.

Decisiones puntuales:
- **Sin conexión de gateway propia** (`dashboard/discordApi.js`): todo lo que necesita de
  Discord (info de guild, roles de un miembro, datos de un usuario) lo pide por REST con
  el token del bot, on-demand. Levantar un `Client` de discord.js entero (intents, caché,
  reconexión) solo para consultas puntuales de bajo tráfico sería una segunda conexión de
  gateway innecesaria al mismo bot.
- **Acceso vía OAuth de Discord** (scope `identify` únicamente, nunca `guilds`): en vez de
  pedirle a Discord la lista de servers del usuario, el dashboard usa lo que el bot YA
  sabe (roles del usuario en cada guild donde está el bot, comparados contra
  `admin_role_id`/`moderator_role_id` de `guild_config`) — mismo criterio que `isStaff()`
  de `src/utils/permissions.js`, reimplementado en `dashboard/permissions.js` porque acá
  no hay un `GuildMember` de discord.js, solo el JSON crudo de la REST API.
- **Sesión propia con cookie firmada** (`dashboard/session.js`, HMAC-SHA256) en vez de
  `express-session`/`jsonwebtoken` — no hace falta un store de sesiones ni el resto de
  features de esas libs para guardar un solo dato (el user ID).
- **100% solo lectura**: ninguna ruta escribe en Supabase ni en Discord. Si en algún
  momento se necesita escritura (ej. resolver un warn desde el panel), es una decisión
  aparte con su propio análisis de permisos — no asumir que se puede extender directo.

## Qué se dejó afuera a propósito

- **Sistema de "presence" rotativo** (`utils/presence.js`/`botStatus.js` en gNoX) —
  cosmético (rota el status "Jugando a..." del bot), se sacaron todas las llamadas a
  `refreshPresence()` de los eventos migrados.
- **Easter egg de "hola"** en `messageCreate.js` — reaccionaba con 2 emojis custom
  subidos a un servidor específico de gNoX, no existen acá.
- **Dashboard de monitoreo de gNoX, streams (Kick/YouTube), páginas legales de gNoX** —
  excluidos desde el blueprint original: son específicos de un operador o de una
  comunidad, no aportan a "que funcione para cualquier servidor". (Distinto del panel
  genérico multi-tenant de `dashboard/` agregado después — ver arriba.)
- **`shopItems.js`** es una plantilla en código con 4 ítems genéricos (sin `roleId`,
  para que funcionen sin configuración) — no el catálogo de gNoX, que tenía roles de
  color con IDs reales de un servidor específico.

## Flujo de trabajo de esta sesión (seguir así)

- Cada bloque de features: migrar → `node --check` en los archivos tocados → levantar
  el bot local un momento (`node src/index.js`, matar el proceso viejo primero) para
  pescar errores de import/circularidad que `--check` no detecta → `node
  src/deploy-commands.js dev` (registra en `GUILD_ID_DEV`, instantáneo) → probar en el
  server de test.
- **Nunca `git push` sin que el usuario lo pida explícitamente** — se comitea local y
  se avisa que hay un push pendiente. El push dispara un redeploy automático en
  Railway, y el usuario quiere controlar cuándo pasa eso.
- Mensajes de commit con body detallado (qué se agregó, qué se dejó afuera y por qué,
  qué se verificó) — no una línea sola. El usuario los usa para saber el estado del
  branch sin releer el diff.
- `node src/deploy-commands.js` (sin `dev`) registra los comandos **globalmente** —
  correrlo solo cuando se confirma explícitamente, porque afecta a cualquier server que
  tenga el bot invitado (no solo el de test) y tarda hasta 1h en propagar.

## Stack

Node 22+, discord.js 14 (ESM, `"type": "module"` en `package.json`), Supabase
(`@supabase/supabase-js`), Railway (deploy automático on push a `main`). `schema.sql` en
la raíz tiene el esquema completo — pegarlo entero en el SQL Editor de un proyecto
Supabase nuevo para levantar el entorno desde cero.
