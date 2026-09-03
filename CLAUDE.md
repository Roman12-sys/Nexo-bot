# Nexo Bot

Bot de Discord multi-servidor (economía, XP, moderación, sorteos, trivia, salas de voz
temporales, constructor de anuncios, tienda, música con soporte de Spotify). Basado en gNoX Bot (`c:\Users\Fran\OneDrive\Escritorio\gnoX-bot`),
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
- **`/setup`** (`src/commands/admin/setup.js`) — crea canales/categoría/roles
  automáticamente si no existen, y guarda sus IDs. Re-ejecutable sin duplicar (busca por
  ID guardado primero, después por nombre, recién ahí crea). Solo dueño/Administrator —
  no puede gatear con `isStaff()` porque la primera vez no hay `guild_config` todavía.
  Además del rol de staff + canales de log + módulos (moderación/economía/XP), el panel
  tiene 4 "extras" opt-in (togles, apagados por defecto en cualquier plantilla): canal
  de bienvenida, canal de confesiones, rol automático ("Miembro") y rol de castigo
  ("Sancionado"). `resolveRole`/`resolveChannel` son los genéricos que resuelven
  cualquiera de estos (reusar por ID → por nombre → crear), no solo el rol de staff.
- **`/config`** (`src/commands/admin/config.js`) — para cuando el admin quiere apuntar
  a un canal/rol que YA existe en el server en vez de crear uno nuevo (ej. usar un rol
  de castigo que ya tenía armado de antes). No quedó redundante con la ampliación de
  `/setup`: son dos caminos al mismo campo de `guild_config`, "crear de cero" vs
  "reusar algo mío" — decisión explícita, no una casualidad de la migración.

Cualquier comando/evento que en gNoX leía `config.js` ahora hace
`await getGuildConfig(interaction.guildId)` y lee la columna correspondiente.

`/config ver` no muestra solo los 4 campos que `/config` puede tocar — es el resumen
completo de `guild_config` (`buildConfigSummaryEmbed`), incluido lo que dejó armado
`/setup`. Y a diferencia de los cambios NATIVOS de Discord (roles, canales — logueados
por los 32 listeners de `src/events/`), pisar un campo de `guild_config` no dejaba
ningún rastro: `/setup` y las 4 subcommands de escritura de `/config` ahora mandan
`createBotConfigLogEmbed` al canal de logs de **actividad** (nunca al de moderación —
esto no es una sanción a un usuario). `/config exportar` es de solo lectura (un JSON
descargable de respaldo) y a propósito NO loguea nada — no cambia nada.

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

## /estado vs /metricas

Dos comandos de staff que se pueden confundir: `/metricas` es popularidad de comandos
(qué se usa más, vía `commandUsageStore.js`). `/estado` (`src/commands/admin/estado.js`)
es salud del sistema — latencia del gateway, conectividad real a Supabase
(`pingSupabase()` en `src/supabaseClient.js`, un round-trip real, nunca cacheado — a
diferencia de `getGuildConfig`), y cuántos sorteos/salas de voz temporales siguen
activos en ese server. Sirve para diagnosticar sin ir a mirar Railway.

## Voz: qué eventos se procesan

`voiceStateUpdate.js` solo arma un `action` (y por lo tanto solo consulta `guild_config`/
loguea) para join/leave/move y cambio de cámara. Mute/deafen/compartir pantalla se
descartan a propósito, antes de tocar Supabase — un usuario los toca cientos de veces por
sesión de voz y no aportan nada al log de actividad. El sistema de salas temporales
(`tempVoiceEngine.js`) es independiente de este filtro: tiene su propio early-return
(`oldState.channelId === newState.channelId`) desde antes.

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

## Economía: wallet, banco, casino y sumideros

`economy.balance` ("wallet") y `economy.bank` son deliberadamente dos columnas
separadas, no una sola. `/rob` solo puede tocar el wallet — el banco es el lugar donde
"guardar y estar a salvo", y encima rinde un interés simple (2%/día, tope de 14 días
acumulados) que se calcula lazy (sin cron) cuando el usuario mira `/bank ver`. El interés
se reinicia en CADA depósito/retiro (columna `last_interest_ts`, ver
`deposit_to_bank`/`withdraw_from_bank` en `schema.sql`) — sin ese reset hay un bug real
que pisamos una vez: vaciar la cuenta y depositar de nuevo mucho después cobraba interés
de un período en que el banco estuvo en 0, porque el reloj de interés seguía anclado al
último movimiento viejo.

`/coinflip`, `/dado`, `/slots`, `/ruleta` comparten `src/utils/casinoHelpers.js`
(chequeo de saldo, lock, cobro atómico, resolución, embed) para no triplicar esa
cascada. Coinflip y dado son 50/50 limpio, sin ventaja de la casa — slots y ruleta sí
tienen una ventaja natural, pero viene sola del paytable/probabilidades, no de ningún
ajuste oculto.

`/crime` (alternativa arriesgada a `/work`) y `/rob` reparten "multas" de forma
DISTINTA a propósito: la multa de `/crime` se destruye (no va a nadie — es el único
sumidero real de dinero que no sea comprar en la tienda, algo que la economía casi no
tenía: `/daily`+`/work`+interés del banco crean plata de la nada sin límite, pero antes
de esto casi nada la destruía). La multa de `/rob`, en cambio, va a la víctima (no es un
sumidero, es una compensación).

`/vender` es el primer lugar donde se puede recuperar parte de lo gastado: 50% del
precio de un ítem de vuelta, pero nunca de ítems con `roleId` (el rol ya se entregó,
"devolverlo" sería cobrar dos veces por el mismo rol si se recompra después).

## Gotchas ya pisados (además del de las columnas de cooldown, arriba)

**Emoji dentro de un canvas.** `@napi-rs/canvas` (usado en `welcomeImage.js` y
`rankCardImage.js`) no tiene ninguna fuente de emoji de color disponible en el
contenedor de Railway — cualquier emoji dibujado con `ctx.fillText()` se ve como un
cuadrado vacío, sin ningún error que lo avise. Pasó dos veces en la misma sesión (una
vez arreglado en `rankCardImage.js`, después repetido sin querer en la tarjeta de
mascota que existió hasta la Fase 3B). Nunca poner un emoji en texto de canvas — usar
texto + color, o formas dibujadas a mano (`ctx.arc`/`ctx.ellipse`). Y no alcanza con que
la función no tire error: hay que generar la imagen de verdad, guardarla y mirarla antes
de darla por buena.

**Nunca levantar el bot local.** `DISCORD_TOKEN` es el MISMO en local y en Railway — no
existe un bot de desarrollo separado (`GUILD_ID_DEV` solo acota dónde se registran
comandos, no la identidad del bot). Correr `node src/index.js` en la máquina local abre
una SEGUNDA conexión de gateway al mismo bot de producción, con riesgo real de procesar
el mismo evento dos veces — se descubrió en vivo (una sesión de boot local pareció estar
procesando la interacción real de un usuario). Verificación se hace con `node --check` +
`npm test` (la suite mockea Supabase, es 100% segura); si hace falta un chequeo de boot
real (ej. sospecha de un `SlashCommandBuilder` que revienta al cargar, ver el límite de
100 caracteres más abajo), pedírselo al usuario explícitamente en vez de hacerlo uno mismo.

**Límites de longitud de Discord, ninguno de los cuales atrapa `node --check`:**
- Descripción de un comando, subcomando u opción: **100 caracteres**. Se revienta recién
  al bootear el bot (`❌ No se pudo cargar el comando...`), no al editar el archivo — le
  pasó a `/crime`. `node --check` no lo detecta (es un error de validación de discord.js,
  no de sintaxis) — pero **no bootear el bot local para probarlo** (ver el gotcha de más
  abajo, "nunca levantar el bot local"): para un `SlashCommandBuilder` nuevo o editado,
  contar caracteres a mano o pedirle al usuario que confirme con un boot suyo.
- Valor de un campo de embed (`addFields`): **1024 caracteres**. Sin un chequeo explícito,
  una lista armada con `.join()` que crece (categorías de `/shop`, inventario en
  `/economia-staff perfil`) se corta en silencio sin avisar que faltó contenido. Patrón
  para arreglarlo: cortar antes del límite y agregar `"(+N más)"` en vez de un
  `.slice(0, 1024)` mudo — ver `roles.js`/`shop.js`.
- `content` de un mensaje normal (no embed): **2000 caracteres** — le pasó al aviso de
  AFK cuando se mencionaba a varios usuarios ausentes a la vez.

**`youtube-dl-exec` (sistema de música) pide Python para INSTALARSE, no para correr.**
`npm install` puede fallar con "youtube-dl-exec needs Python" si la máquina no tiene
`python`/`python3` en PATH — es un chequeo del **preinstall script** de la librería
(`scripts/preinstall.mjs`), no algo que el bot necesite en runtime (el binario que
termina descargando es standalone, con Python embebido). Se resuelve con
`YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install` una vez, o instalando Python. En Railway
(Linux) no pasa nada de esto porque `YOUTUBE_DL_FILENAME=yt-dlp_linux` (ver
`.env.example`) fuerza a bajar el binario standalone directo, sin pasar por el chequeo.

**`interaction.message.reactions.cache` puede estar desactualizado — el bot no tiene el
intent `GuildMessageReactions`.** Pisado en vivo en producción 2026-09-01: `/encuesta
cerrar` mostraba siempre "0 votos" en todas las opciones, sin importar cuánta gente
hubiera votado. discord.js mantiene el conteo de reacciones al día vía eventos de
gateway (`MESSAGE_REACTION_ADD`/`_REMOVE`), que dependen de ese intent — sin él, el
conteo queda congelado en el momento en que el mensaje se cacheó por última vez (para
una encuesta recién creada, eso es justo después de que el bot sembrara sus propias
reacciones, antes de que nadie vote). Fix en `encuesta.js`: `await
interaction.message.fetch()` antes de leer `.reactions.cache` — pega un GET directo a
la API, no depende de ningún intent ni del cache de gateway. Cualquier otro lugar que
lea reacciones de un mensaje desde una interaction vieja tiene el mismo riesgo.

**`guild.members.fetch()` sin argumentos usa el GATEWAY (opcode 8), con su propio rate
limit aparte del de REST.** Pisado en vivo en producción 2026-09-01:
`sanciones_punish` (panel `/sanciones`) reventó con `GatewayRateLimitError` (`retry_after`
de hasta ~30s) — confirmado leyendo el código fuente de discord.js instalado
(`GuildMemberManager.js`), no adivinado: `fetch()` sin un `user` puntual manda
`RequestGuildMembers` por el WebSocket, un mecanismo que Discord throttlea aparte del
límite normal de REST, y que discord.js no reintenta solo (a diferencia de un 429 de
REST común). `/roles` tenía el mismo patrón. Fix: `guild.members.list({ limit, after })`
paginado (REST puro, mismo rate limit generoso que el resto del proyecto) — ver
`fetchAllMembers()` en `src/utils/sanctions.js`, reusado por `roles.js`. Nunca usar
`guild.members.fetch()` sin argumentos para "traer todos los miembros" de nuevo.

**Correr un `DROP TABLE`/`DROP COLUMN` antes de que el código nuevo esté desplegado
rompe producción de verdad, no en teoría.** Pisado en vivo 2026-09-03 (Fase 3B,
eliminación de Pets): el usuario corrió `migration_2026_09_01_remove_pets.sql` en
Supabase apenas se la mostré, sin esperar el commit/push/deploy del código que dejaba
de usar `pets` — el orden exacto que el propio plan de la fase pedía respetar. Con la
tabla ya borrada pero Railway todavía sirviendo el commit viejo (`pet.js`/`petsStore.js`
sin tocar), `/work` y `/crime` tiraron error real en cada uso (ambos llamaban `getPet()`
sin ningún `try/catch` propio) hasta que se commiteó y pusheó el código nuevo — `/perfil`
fue el único que no se rompió, porque esa lectura YA tenía `.catch(() => null)` alrededor
por otro motivo. Se detectó al toque verificando por API (nunca confiar en el orden que
alguien dice haber seguido, ver `[[nexo_bot_sql_verification]]`) en vez de asumir que el
plan se había respetado paso a paso. Para la próxima eliminación de tabla (`spotify_auth`
en Fase 3C, música): no asumir que el DROP se va a esperar — verificar el estado real
(`git log -1`, y la tabla por API) apenas se menciona cualquier acción sobre Supabase,
sin importar en qué paso del plan se supone que está el usuario.

## Dos proyectos de Supabase — no confundirlos

El usuario tiene DOS proyectos de Supabase que se prestan a confundir (pueden estar los
dos abiertos en pestañas del navegador a la vez): **`gmcqbvrqqpmcqjrbtauk`** es el real
de Nexo Bot (coincide con `SUPABASE_URL` en Railway y en `.env` — el `.env` tiene un
comentario que lo dice: "proyecto nuevo, separado del de gNoX"). **`wglbcbwgrtadcnavtpxg`**
es el proyecto viejo de gNoX — tiene una tabla `stream_state` (feature exclusiva de
gNoX que Nexo no tiene) y le falta `guild_config` por completo (gNoX usa `.env`, no esa
tabla). Correr una migración de Nexo en el proyecto equivocado da "Success" en el SQL
Editor pero no arregla nada — verificar contra la base real por API después de correr
cualquier SQL, no confiar solo en el mensaje de éxito.

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
  cosmético (rota el status "Jugando a..." del bot cada tanto), se sacaron todas las
  llamadas a `refreshPresence()` de los eventos migrados. Lo que sí existe es una
  presencia **fija** ("Escuchando /help", seteada una sola vez en `ready.js`) — no es
  lo mismo que el sistema rotativo descartado, es solo un aviso estático de cómo usar
  el bot.
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

- Cada bloque de features: migrar → `node --check` en los archivos tocados → `npm test`
  → probar en el server de test (o pedirle al usuario que corra `node
  src/deploy-commands.js dev` y pruebe él). **Nunca levantar el bot local
  (`node src/index.js`) para verificar** — ver el gotcha "nunca levantar el bot local"
  más abajo: no hay bot de desarrollo separado, es el mismo `DISCORD_TOKEN` que
  producción. Esto reemplaza el paso que había antes ("levantar el bot local un
  momento... para pescar errores de import/circularidad") — ese riesgo real (imports
  circulares, errores de validación de discord.js que `--check` no ve) sigue existiendo,
  pero se acepta cubrirlo con `node --check` + la suite de tests en vez de un boot real.
- **Nunca `git push` sin que el usuario lo pida explícitamente** — se comitea local y
  se avisa que hay un push pendiente. El push dispara un redeploy automático en
  Railway, y el usuario quiere controlar cuándo pasa eso.
- Mensajes de commit con body detallado (qué se agregó, qué se dejó afuera y por qué,
  qué se verificó) — no una línea sola. El usuario los usa para saber el estado del
  branch sin releer el diff.
- `node src/deploy-commands.js` (sin `dev`) registra los comandos **globalmente** —
  correrlo solo cuando se confirma explícitamente, porque afecta a cualquier server que
  tenga el bot invitado (no solo el de test) y tarda hasta 1h en propagar.

## Anunciador de patch notes de League of Legends

`src/utils/lolPatchEngine.js` manda un embed a un canal fijo (`1542041482918109235`, un
solo servidor) cada vez que sale un patch nuevo de LoL. A propósito **no** es una
feature de `guild_config`: el pedido fue "este canal, este server", no "cualquier
servidor pueda configurar esto" — mismo criterio que la presencia fija de `ready.js`.

Riot no tiene API pública de patch notes. Se lee el JSON `__NEXT_DATA__` embebido en
`leagueoflegends.com/en-us/news/tags/patch-notes/` (el mismo dato que renderiza la
grilla de artículos del sitio) — un endpoint no documentado, puede romperse si Riot
cambia el markup. Si eso pasa, `fetchLatestPatchArticle` tira o devuelve `null` y el
barrido queda en no-op silencioso (logueado en consola), nunca tira el bot abajo. Barre
cada 20 minutos (`lolPatchEngine.js`), guarda la última URL anunciada en
`lol_patch_state` (una sola fila, no por guild) para no duplicar avisos entre reinicios
— y en la primera corrida siembra el estado sin anunciar, para no mandar como "nuevo"
un patch que puede tener semanas.

Para forzar un reenvío manual (probar el embed, o mandar de nuevo el patch actual):
`update lol_patch_state set last_url = 'reset' where id = 'league_of_legends';` y
reiniciar el bot (o esperar el próximo barrido de 20 min) — al no coincidir con la URL
real, la anuncia y pisa `last_url` con la correcta. No hay comando de staff para esto
a propósito, es un caso de uso raro (una vez cada tanto, para debug).

### Monitor secundario de Data Dragon (detección de scraper roto)

`src/utils/lolPatchMonitor.js` (investigado y agregado 2026-08-26) es una señal
ADITIVA, no reemplaza el scraper de arriba ni anuncia nada en Discord — solo deja un
`console.warn` si parece que el scraper se rompió. Investigación previa (ver historial
de esa fecha) confirmó que Riot no tiene webhook/API/RSS oficial para parches: 13
categorías del Developer API (`developer.riotgames.com/apis`) y ninguna es de
versiones/changelog; no hay `rss.xml`/`sitemap.xml` reales en leagueoflegends.com (dan
404 o el shell de Next.js). Data Dragon es lo más "oficial" que hay, pero Riot mismo
documenta que "*Updating Data Dragon after each patch is a manual process, so it is not
always updated immediately after a patch*" — sin SLA de timing, y sin contenido de
patch notes.

Por eso Data Dragon nunca es la fuente de anuncio, solo un chequeo de salud: cada 20
min compara `ddragon/api/versions.json`\[0\] contra `last_ddragon_version` guardado. Si
cambió, guarda la nueva versión + `ddragon_version_detected_at` (epoch ms — mismo
criterio que `last_daily`/`last_work`, ver el gotcha de columnas de cooldown más abajo)
y arranca de cero la ventana de tolerancia. Si pasan más de
`DDRAGON_PATCH_WARNING_DELAY_HOURS` (24h, constante en el propio archivo) sin que
`lol_patch_state.updated_at` (que el scraper ya toca solo cuando encuentra un artículo
nuevo — no hizo falta una columna nueva para eso) se haya movido **en una ventana
simétrica** alrededor de ese momento, deja el warning una sola vez (`ddragon_warning_sent_at`,
se resetea a null cada vez que la versión de Data Dragon vuelve a cambiar).

La ventana es simétrica (hacia atrás Y hacia adelante) a propósito: en el orden real
más común el artículo de patch notes se publica ANTES de que Data Dragon se actualice
(por la demora manual de arriba), así que exigir progreso del scraper *después* del
cambio de versión generaría un falso positivo en casi todos los parches. Limitación
conocida y aceptada: si el atraso real de Data Dragon supera esas 24h hacia atrás,
puede saltar un falso positivo igual — es un heurístico de "avisale al staff para que
mire", no una garantía.

## Timers en memoria: qué persiste y qué no

Recordatorios (`reminderEngine.js`) y sorteos (`giveawayEngine.js`) se reprograman al
arrancar (`ready.js` → `rescheduleReminders`/`rescheduleActiveGiveaways`) leyendo de
Supabase — si el bot estuvo caído más tiempo del que faltaba, disparan al toque en vez de
perderse, no hace falta ningún cron externo. Las salas de voz temporales hacen lo mismo
con su timer de "borrar si quedó vacía" (`reconcileOnStartup`). El resto de los `Map` en
memoria del proyecto (`rateLimiter`, `spamDetector`, `giveTracker`, `guessSessions`,
sesiones de `/setup`/`/anuncio`) son ventanas cortas a propósito — perderlas en un
restart no rompe nada de negocio, así que NO se persisten en Supabase; cada uno se
auto-limpia solo (barrido periódico con `setInterval(...).unref()`, o timeout por
entrada) para no crecer sin límite.

## Limpieza al salir de un servidor (`guildDelete`)

Hasta la auditoría de 2026-08-27 no existía la contraparte de `guildCreate.js` — si el
bot era expulsado o el servidor se borraba, `guild_config` y el resto de las tablas
por-guild quedaban huérfanas para siempre. `src/events/guildDelete.js` borra por
`guild_id` en un array explícito (`GUILD_SCOPED_TABLES`), con `Promise.allSettled` para
que una tabla fallando no frene la limpieza de las demás. El borrado en sí es idempotente
sin necesitar ningún chequeo extra (cada paso es un `DELETE ... WHERE guild_id = X`, no
un `UPDATE` relativo) — correrlo dos veces para el mismo guild borra 0 filas la segunda
vez, nunca falla ni toca otros guilds.

**Al agregar una tabla nueva con columna `guild_id`, hay que sumarla a ese array a
mano** — no hay forma automática de detectarlo (introspección de schema es más frágil
que una lista explícita acá). Fase 2A (2026-08-31) encontró y sumó 3 que faltaban
(`active_punishments`, `user_missions`, `guild_daily_stats` — agregadas en fases
posteriores a la auditoría original de 2026-08-27, nunca sincronizadas acá) comparando
el array a mano contra CADA `create table` de `schema.sql` con columna `guild_id`, no
solo contra hallazgos previos de auditoría. Tres tablas quedan afuera a propósito:
- `reminders` — se entregan por DM, `guild_id` es solo referencia de dónde se creó, no
  acota la entrega; borrar el recordatorio de un usuario porque el bot se fue de ESE
  server no tiene sentido.
- `lol_patch_state` / `spotify_auth` — una sola fila fija cada una, sin `guild_id`: no
  son guild-scoped, son estado global del bot.

Desde Fase 2A, `guildDelete` también invalida el cache en memoria de `guildConfigStore`
(`invalidateGuildConfig`) y limpia las entradas de `afkStore` de ese guild
(`clearGuildAfk`) — ninguno de los dos vive en Supabase, así que ninguna de las `DELETE`
de arriba los toca; sin esto, un guild que el bot vuelve a sumar en la misma vida del
proceso (kick + re-invite antes de que expiren los 30s de cache) podía seguir viendo
config vieja un rato.

## Seguridad Supabase: RLS preparado pero apagado (a propósito)

Bot y dashboard usan el mismo cliente con la `service_role` key (`src/supabaseClient.js`)
— no existe ningún `anon key` en el proyecto, y el dashboard nunca expone Supabase al
browser (server-rendered, sesión propia firmada, nunca `express-session`/JWT de
Supabase). `service_role` bypassea RLS siempre, esté activado o no — activarlo hoy no
cambia nada de lo que el bot/dashboard hacen. No es una vulnerabilidad activa; es un
seguro barato para el día que algo use el `anon key`. Migración (`enable row level
security` en las 18 tablas, sin políticas) preparada pero sin ejecutar — decisión
pendiente del usuario.

## Event Engine (`src/utils/eventBus.js`)

Antes de esto, "se desbloqueó un logro" era una llamada directa a mano
(`unlockAchievement()` + `announceUnlockedAchievements()`) copiada en 13+ archivos —
cada integración nueva entre sistemas significaba ir a tocar el archivo de la feature de
origen. `EventBus` es un pub/sub en memoria (`Map<evento, handler[]>`, sin cola externa:
el bot corre en un solo proceso, no hace falta más) que desacopla "algo pasó" de "quién
reacciona". `emit()` corre todos los handlers de un evento con `Promise.allSettled`,
cada uno envuelto en su propio `try/catch` — un handler roto nunca tumba a los demás ni
al emisor, y queda logueado (`❌ Error en handler de <evento>`).

8 eventos existen hoy: `ACHIEVEMENT_CHECK`, `MESSAGE_SENT`, `COMMAND_EXECUTED`,
`MEMBER_JOINED`, `COINS_EARNED`, `COINS_DESTROYED`, `XP_GAINED`, `LEVEL_UP`,
`TRIVIA_CORRECT`. Los productores (`economyStore.addBalance`, `xpStore.addXp`,
`commandUsageStore.trackCommandUsage`) NO hacen `await` sobre `emit()` — el bus es
best-effort (sin persistencia, sin reintentos) y no debe bloquear la operación de
dominio que lo disparó esperando a consumidores secundarios (misiones, analítica) que no
tienen nada que ver con esa operación. `ACHIEVEMENT_CHECK` es la excepción: en la
práctica es una llamada de función indirecta (un solo consumidor posible, payload con
objetos de UI como `interaction`/`channel`), no un evento de dominio real — no usarlo
como plantilla para el próximo evento nuevo.

### Semántica de origen (`src/utils/economyOrigins.js`)

`COINS_EARNED`/`XP_GAINED` NO significan "el usuario ganó esto de forma orgánica" —
significan "se acreditó un monto positivo". Este archivo es el único lugar que traduce
`meta.type` (economía) / `extra.source` (XP) a un concepto común, `origin`, que
`missionsStore.js`/`guildDailyStatsStore.js` consumen para decidir qué cuenta:

- **`activity`** — el usuario hizo algo (`daily`/`work`/`crime_win`/`trivia`/`guess`/
  `sell`, mensaje o voz). Cuenta para todo.
- **`reward`** — recompensa de una misión ya pagada (`type: 'mission'`). Cuenta para
  `money_created` (es plata nueva real) pero NUNCA para el progreso de OTRA misión — si
  contara, pagar una misión completaría otra en cadena (`COINS_EARNED → misión →
  recompensa → addBalance → COINS_EARNED`). Ver el comentario de guarda explícita en
  `missionsStore.incrementMissionProgress`.
- **`stake`** — casino/caja misteriosa (`gamble_win`/`mystery_box`). El monto que le
  llega a `addBalance` es el PAYOUT BRUTO (necesario para el balance real); quien apostó
  (`casinoHelpers.js`, `buy.js`) pasa además `meta.netGain` con la ganancia real (payout
  − apuesta/precio), que es lo que cuenta para misiones/analítica — nunca el bruto.
- **`admin`** — ajuste de staff (`/economia-staff`, `/xp agregar`/`quitar`). Nunca cuenta
  como actividad orgánica del servidor.

Un `type`/`source` no listado en el mapa cae en `activity` por defecto — mismo
comportamiento que existía antes de que este archivo existiera, para que una fuente de
coins/XP nueva que alguien agregue sin actualizar el mapa no quede excluida en silencio.

## Misiones (`/mision`, `src/utils/missionsStore.js`)

Catálogo fijo en código (`MISSION_CATALOG`), mismo criterio que `ACHIEVEMENTS` — sin
tabla `mission_definitions` ni UI de admin (evaluado y descartado por falta de necesidad
real, no por pereza). Sin botón de "reclamar": la recompensa se paga en el mismo
instante en que `increment_mission_progress` (RPC con `for update`) confirma que la
misión se completó — mismo criterio que un logro o una subida de nivel, ninguno pide una
acción extra. Sin misiones "seasonal" ni ranking histórico, a propósito.

`ensureCurrentMissions()` (upsert idempotente de las 6 filas del catálogo al primer
evento del período) tiene un caché en memoria por `guild:user` para no reupsertear las 6
filas en CADA evento de XP/coins — se invalida solo cuando cambia el día (mismo criterio
que el resto de los `Map` en memoria del proyecto, ver "Timers en memoria" más abajo). La
caché es puramente de rendimiento: si el proceso reinicia, el próximo evento vuelve a
upsertear (no-op idempotente contra Postgres), nunca es la fuente de verdad de si el
período está inicializado.

## Logros — consolidados en un solo handler

11 call-sites que antes llamaban `unlockAchievement()`+`announceUnlockedAchievements()`
a mano quedaron en un solo handler de `ACHIEVEMENT_CHECK` (`src/utils/achievements.js`).
La unicidad la garantiza una constraint compuesta en Postgres (`achievements_unlocked`,
código `23505` = "ya lo tenía"), no un chequeo de aplicación. `confession.js` es la única
excepción deliberada: sigue llamando `unlockAchievement` directo porque necesita el
valor de retorno en el mismo reply efímero sin desanonimizar a nadie — algo que un bus
fire-and-forget no puede devolverle al caller.

## Analítica diaria (`guild_daily_stats`, dashboard)

Se llena EN VIVO por el Event Engine (`increment_guild_daily_stat`), nunca por un cron
nocturno — no existe ningún otro lugar del esquema donde ya viva "mensajes de hoy" para
que un job los agregue después. `money_created` filtra `origin === 'admin'` y usa la
ganancia neta (no el payout bruto) en `origin === 'stake'` — ver la semántica de origen
arriba; sin ese filtro, un ajuste de staff o una racha de casino inflaban la métrica sin
que fuera plata nueva real. `money_destroyed` cubre solo los dos sumideros reales ya
documentados arriba (multa de `/crime`, precio de una compra en `/shop`) — deliberadamente
NO cubre apuestas de casino perdidas (separarlas del payout bruto tocaría el flujo
central de `casinoHelpers.js`). `xp_distributed` excluye XP otorgada a mano por staff
(`/xp agregar`, `source: 'admin'`).

## Restricciones con expiración (`src/utils/punishEngine.js`)

`/punish` con duración (`1h`/`6h`/`1d`/`7d`) crea una fila en `active_punishments` y
programa un `setTimeout` que quita el rol solo — mismo split store/engine que
`reminderEngine.js`/`giveawayEngine.js` (el store no toca Discord, el engine sí). Se
reprograma al arrancar (`rescheduleActivePunishments` en `ready.js`) igual que
recordatorios y sorteos, por el mismo motivo (sobrevivir un redeploy sin perder timers).

## Permisos compartidos entre bot y dashboard

`isStaffFromRoleIds(cfg, roleIds)` (`src/utils/permissions.js`) es el núcleo booleano
puro — acepta cualquier array plano de IDs — que usan `isStaff()` acá,
`messageCreate.js` (chequeo de staff del anti-spam) y `dashboard/permissions.js`. Antes
cada uno tenía su propia copia de la misma lógica adaptada a su propio shape de datos
(`member.roles.cache` de discord.js vs. el array crudo de la REST API), con riesgo real
de que una cambiara y la otra no.

## Reputación — eliminada por completo

El sistema de reputación (`/reputation`, tabla `reputation`, RPC `increment_reputation`)
se eliminó enteramente: cero consumidores reales (solo alimentaba un logro cosmético que
también se sacó). No reintroducir sin un pedido explícito nuevo — no es un hueco a
rellenar ni una feature "que faltó migrar".

## Testing (Vitest)

`npm test` corre los tests de `tests/`. Todo lo que toca Supabase se mockea con
`tests/helpers/supabaseMock.js` (un builder encadenable y a la vez "thenable", para
cubrir tanto `select().eq().maybeSingle()` como `update().eq()` sin terminal explícito) —
ningún test le pega a la base real. Prioriza lo que rompe en silencio si falla: params
exactos a los RPCs atómicos de economía (`increment_balance`, `transfer_balance`, etc.),
mapeo de `insufficient_funds` a `.code`, los 3 filtros anti-farm de `grantMessageXp`, el
cache de 30s + aislamiento entre guilds de `guildConfigStore`, y la matriz de roles de
`isStaff`/`isStaffConfigured`. No hay tests por comando individual (74 comandos) — la
lógica compartida que todos ellos llaman sí está cubierta, que es donde un bug se
replicaría a muchos comandos a la vez.

El Event Engine y todo lo que corre sobre él tiene su propia batería, agregada recién en
la consolidación de Fase A (2026-08-30) — antes de eso tenía cobertura cero pese a ser
la infraestructura más nueva y más riesgosa del proyecto: `eventBus.test.js` (aislamiento
de errores entre handlers), extensiones a `economyStore.test.js`/`xpStore.test.js` (que
`addBalance`/`addXp` emiten con el `origin`/`netAmount` correcto y sin bloquear),
`missionsStore.test.js` (filtro de origen, no-doble-pago, caché de
`ensureCurrentMissions`), `guildDailyStatsStore.test.js` (mismo filtro de origen del
lado de la analítica) y `achievements.test.js`/`punishEngine.test.js`.

El sistema de música (2026-08-30) sigue el mismo criterio: `musicSessionStore.test.js`
(cola/loop/aislamiento entre guilds, puro), `musicEngine.test.js` (integración real con
`@discordjs/voice`/`musicSource.js`/`spotifyResolver.js` mockeados, incluido el panel y
sus botones vía el router real de interacciones), `spotifyResolver.test.js` (detección de
URL, auth completa — Client Credentials y Authorization Code Flow, rotación de refresh
token, 401/403/404/429), `spotifyAuthStore.test.js` y `musicSourceSpotify.test.js`. Las
dos rutas nuevas del dashboard (`/spotify/authorize`/`/spotify/callback`) no tienen test
HTTP directo — el proyecto no tiene infraestructura para eso (ni supertest ni
equivalente), se verificaron a mano contra Spotify real.

Fase 2A (2026-08-31) sumó 52 tests nuevos (394→446), la mayoría de concurrencia real, no
solo de lógica: `giveawayEngine.test.js` reproduce carreras genuinas con
`Promise.all(...)` sobre el `asyncLock.js` REAL (nunca mockeado) — participar vs cierre,
reroll simultáneo, cancelar vs timer, dos reconciliaciones sobre el mismo pendiente — y
fue la que encontró un bug real durante la escritura del test (`endGiveaway` no
chequeaba `cancelled`, así que un `cancelGiveaway` ganando la carrera contra el timer
podía terminar igual anunciando ganadores de un sorteo cancelado). Mismo patrón de
"carrera real, no mockeada" en `xpEngineLogic.test.js` (cooldown de `grantMessageXp`) y
`xpStore.test.js` (`applyPrestige`, simulando el `for update` de Postgres con estado
mutable compartido en el mock). Tests multi-guild nuevos (mismo `user-123` en
`guild-a`/`guild-b`) en `economyStore`/`xpStore`/`missionsStore`/`punishEngine.test.js` —
en `missionsStore` y `punishEngine` es el caso de mayor riesgo real porque ambos tienen
estado en memoria keyeado por string (`${guildId}:${userId}`), no solo una query
filtrada. `guildDelete.test.js` dejó de mantener una lista manual de tablas: compara
contra `GUILD_SCOPED_TABLES`, la constante real exportada por el propio módulo.

## Sistema de música (`src/utils/music*.js`, `src/commands/musica/`)

`/play` acepta texto de búsqueda, una URL de YouTube (o cualquier sitio que yt-dlp
soporte), o un link de Spotify — pero **Spotify nunca es la fuente de audio real**, solo
identifica qué canción es; yt-dlp sigue resolviendo el audio para absolutamente todo,
igual que si se hubiera escrito el nombre a mano. Esta separación está en el nombre de
los módulos: `spotifyResolver.js` es el único archivo que sabe que Spotify existe;
`musicSource.js` (yt-dlp) es el único que sabe cómo conseguir audio; `musicEngine.js`
(el único que toca `@discordjs/voice`) no tiene ni un `if` de lógica de Spotify más allá
de un despacho de una línea en `playRequest`.

**yt-dlp, no ytdl-core/play-dl** (investigado 2026-08-30 contra developer.spotify.com y
npm, no de memoria): las reimplementaciones JS del cifrado de YouTube se rompen con cada
cambio de YouTube y tardan en arreglarse (`play-dl` está reportado como abandonado).
yt-dlp, en cambio, saca releases cada pocos días reaccionando específicamente a bloqueos
nuevos — mejor apuesta para algo que depende de que YouTube no cambie nada, aunque sigue
siendo, en el fondo, el mismo juego del gato y el ratón: un `/play` que falla porque
YouTube cambió algo esa semana no es un bug de esta implementación. Se usa vía
`youtube-dl-exec` (descarga y gestiona el binario solo), pero **nunca
`youtubedl.exec()` para el streaming de audio** — la librería interna que usa
(`tinyspawn`) bufferea toda la salida en memoria hasta que el proceso termina, pensado
para JSON chico, no para varios MB de audio por canción; eso hubiera sido un memory leak
real. `musicSource.js` spawnea yt-dlp directo con `child_process` para el streaming, y
usa `youtubedl()` (con su buffering) solo para metadata, que sí es texto corto.

**Panel de botones en vez de la mitad de los comandos pedidos.** El plan original tenía
12 comandos slash (`/play /pause /resume /skip /stop /queue /nowplaying /volume /shuffle
/remove /loop /disconnect`) — pero eso llevaba al bot de 89 a 101 comandos globales,
arriba del límite de 100 de Discord. En vez de agrupar todo bajo subcomandos (`/sorteo`
ya usa ese patrón, hubiera sido consistente pero peor UX — "/music play" en vez de
"/play"), pausar/reanudar/saltar/mezclar/loop-cycle/ver-cola pasaron a ser botones del
panel de "reproduciendo ahora" (`musicEmbeds.js` → `buildControlPanelRow`,
`musicEngine.js` → los `handlePanel*` del final del archivo). Quedaron 7 comandos reales
(`/play /stop /queue /nowplaying /volume /remove /loop`) — los que necesitan texto o un
número, o que tiene sentido poder llamar sin tener el panel a mano (`/stop` como "botón
de pánico", `/queue`/`/nowplaying` de solo lectura). 96/100 comandos con esto, margen
real para seguir creciendo.

**Multi-servidor:** un `Map<guildId, session>` en `musicSessionStore.js` (mismo patrón
que `guessSessions.js`/`giveTracker.js` — en memoria, nunca Supabase, se acepta perder la
cola en un redeploy). Cada sesión tiene su propia conexión de voz, cola, volumen, loop y
mensaje de panel — nunca hay estado compartido entre servidores.

**Resolución de audio SIEMPRE lazy, nunca por adelantado.** Un track recién agregado a
la cola (sea de una búsqueda normal o de una playlist de Spotify) puede tener `url: null`
— es la señal explícita de "todavía no tiene de dónde sacar audio". `musicEngine.js` lo
resuelve recién en `playTrack()`, justo antes de que le toque sonar de verdad
(`musicSource.resolveAudioForKnownTrack`, genérico — no sabe qué es Spotify). Sin esto,
agregar una playlist de 80 canciones dispararía 80 procesos de yt-dlp de una — el mismo
tipo de problema de recursos que el resto del proyecto evita con timers cortos y colas
acotadas.

**El panel se repostea al cambiar de canción, se edita in-place para todo lo demás**
(agregado 2026-08-30, después de que en producción quedara "pegado" arriba del canal con
actividad normal). `refreshPanel()` edita el mismo mensaje — para pausa/resume/volumen/
loop/shuffle, y para "se agregó algo a una cola que ya estaba sonando" (el `queueLength`
cambia pero no la canción). `repostPanel()` borra el mensaje viejo y manda uno nuevo al
final del canal — solo cuando cambia la canción de verdad (avance normal, `/skip`, un
fallo que saltea a la siguiente, o la cola se vacía). La regla es "¿cambió lo que está
sonando?" — si sí, repost; si no, edit. `destroySession()` sigue editando in-place el
mensaje final (evento terminal, no hace falta que siga la conversación).

**Canción que falla nunca se repite**, sin importar el modo de loop —
`musicSessionStore.markCurrentTrackFailed()` la marca `.failed`, y `advance()` la trata
como si el loop estuviera apagado únicamente para esa transición. Sin esto, `loop:
canción actual` sobre un video borrado reintentaría para siempre (consumo de CPU sin
límite, justo lo que se pidió evitar en el pedido original).

## Spotify — identificación de metadata, nunca la fuente de audio (`spotifyResolver.js`)

Igual que arriba: Spotify identifica, yt-dlp reproduce. Nada en este archivo extrae,
descarga ni retransmite audio de Spotify de ninguna forma (nada de Web Playback SDK,
nada de streaming no oficial) — es una regla de diseño explícita, no solo cómo terminó
dando la implementación.

**Dos formas de autenticarse, elegidas automáticamente según qué haya configurado:**

- **Client Credentials Flow** (server-to-server, sin login de nadie) — alcanza para
  tracks y álbumes sueltos (catálogo público puro). Es el modo por defecto, con solo
  `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` configurados.
- **Authorization Code Flow** (login real, una vez, con la cuenta de Spotify del dueño
  del bot) — es el ÚNICO camino que puede listar el contenido de una playlist.
  Confirmado en producción 2026-08-30: Client Credentials da 401 en
  `/playlists/{id}/items` aunque el track suelto funcione bien con el mismo token. El
  flujo vive en el **dashboard** (`dashboard/spotifyAuth.js`, rutas `/spotify/authorize`
  → `/spotify/callback` en `dashboard/server.js`), reusando la MISMA infraestructura
  OAuth que ya existía para el login de Discord (`session.js`, cookie de estado
  anti-CSRF) — no se inventó un mecanismo nuevo. El refresh token queda en la tabla
  `spotify_auth` (una fila fija, `src/utils/spotifyAuthStore.js`) porque lo escribe un
  proceso (dashboard) y lo lee otro (el bot) — un env var no sirve para eso, es la única
  vez que hizo falta una tabla nueva para todo Spotify.

`spotifyResolver.getAccessToken()` prefiere el refresh token guardado; si no hay uno, o
si el guardado ya no sirve (revocado, expirado), cae solo a Client Credentials —
tracks/álbumes siguen andando, playlists vuelven a fallar con un mensaje claro, nunca un
crash. Si Spotify rota el refresh token en una respuesta, se persiste el nuevo solo.

**Quién puede autorizar:** solo el dueño real de la aplicación de Discord — se resuelve
con `GET /oauth2/applications/@me` (`dashboard/discordApi.js` →
`fetchApplicationOwnerId`), nunca un ID hardcodeado. **Gotcha real ya pisado:** si la app
está bajo un **Team** de Discord (no un dueño individual — es el caso de Nexo Bot), el
campo `owner` del response representa al Team, NO a la persona — el dueño real está en
`team.owner_user_id`. Sin ese fallback, el dueño real de una app en team queda bloqueado
por su propio gate.

**Qué SÍ se puede leer de una playlist, y qué nunca va a andar** (confirmado con datos
reales en producción, no solo teoría):
- ✅ Cualquier track o álbum (catálogo público).
- ✅ Playlist pública de cualquiera.
- ✅ Playlist privada del dueño del bot (scope `playlist-read-private`, ya autorizado).
- ✅ Playlist donde el dueño es colaborador (`playlist-read-collaborative`).
- ❌ Playlist privada de OTRA persona que no lo agregó como colaborador — privacidad de
  Spotify funcionando como debe, no es arreglable con código, ni por esta app ni por
  ninguna otra.
- ❌ Playlists oficiales/algorítmicas de Spotify (Top 50, Discover Weekly, Release Radar
  — se reconocen por el ID `37i9dQZ...`) — Spotify las bloquea para cualquier app fuera
  de "Extended Quota Mode" (requiere ser una empresa con 250k+ usuarios activos), sin
  importar que la app de Spotify diga "pública". Tira 404, no es un bug de acá.
- Un "link para compartir" de la app de Spotify (`?si=...`) NO es lo mismo que "pública"
  para la Web API — se puede compartir y escuchar una playlist privada dentro de la app
  sin que deje de ser privada para cualquier integración externa.

**Riesgo real de plataforma, no de esta implementación:** Spotify cambió su política de
Developer Mode en febrero 2026 — toda app nueva exige que el dueño tenga Premium activo
para seguir funcionando (si la suscripción vence, la integración se apaga hasta
renovarla; el resto del bot sigue andando igual, solo Spotify se apaga). También
removieron `external_ids` (el ISRC) de varias respuestas — el campo existe en el track
normalizado, pero en la práctica viene `null` casi siempre.

## Fase 1 + Fase 1.1 — auditoría de seguridad/economía (2026-08-30/31)

Primer punto estable post-auditorías: 7 fixes críticos (Fase 1) + cierre de cabos
sueltos (Fase 1.1). Commit `fc14277`, migrado y confirmado en producción el 2026-08-31
(ver verificación abajo). El *qué* está en el diff; esto documenta el *por qué* de cada
decisión, mismo criterio que el resto de este archivo.

**`/rob` — revalidación en fresco dentro del lock.** El pre-check (cooldown del
atacante, protección de la víctima) fuera de `withLock` sigue existiendo, pero solo por
UX/latencia (responder ephemeral rápido sin arriesgar la ventana de 3s de Discord) —
nunca es el chequeo autoritativo. El lock (`rob:{guildId}:{userId}`) solo serializa
ejecuciones del MISMO atacante entre sí; sin releer y revalidar cooldown/protección con
datos frescos DENTRO del lock, la segunda ejecución en cola (nunca rechazada, solo en
espera) robaba de nuevo ignorando lo que la primera ya había escrito. Mismo patrón que
ya usaban `/daily` y `/crime` — `/rob` era el que le faltaba.

**Roles peligrosos — política centralizada, dos superficies.** `getDangerousRolePermission()`
(`src/utils/permissions.js`) es la ÚNICA lista de permisos peligrosos (Administrator,
ManageGuild/Roles/Channels/Webhooks, Kick/Ban/ModerateMembers, ManageMessages/Nicknames,
MentionEveryone — deliberadamente NO incluye permisos "molestos pero no peligrosos" como
ManageEmojisAndStickers/ManageEvents/ViewAuditLog, para no bloquear roles normales sin
necesidad). La usan `/config` (`rol-castigo`/`rol-automatico`, valida antes de guardar,
rechaza sin persistir nada) y `/setup` (`resolveRole(..., rejectDangerous: true)`, SOLO
en los llamados de `auto_role_id`/`punish_role_id` — el rol de Staff está pensado para
tener privilegios reales, nunca pasa por esta validación). Cuando `/setup` encuentra un
candidato de reuso (por ID guardado o por nombre "Miembro"/"Sancionado") que resulta
peligroso, NO aborta el flujo (rompería la promesa de "/setup siempre termina, nunca
duplica") — descarta ese candidato, crea un rol nuevo seguro en su lugar, y lo deja
explícito en el resumen final/log de actividad. Efecto secundario conocido y aceptado:
puede quedar un rol viejo (el peligroso, sin usar) con el mismo nombre visible que el
nuevo — cosmético, no se borra solo (borrar un rol existente sin que se pida
explícitamente sería una acción destructiva fuera de lugar).

**Dashboard — XSS + TOCTOU del owner de Spotify.** `/spotify/callback` interpolaba el
parámetro `error` de Spotify sin escapar (ahora usa `escapeHtml`, ya existente en
`html.js`) y NO revalidaba el owner antes de persistir el refresh token — vector real:
`/spotify/callback` comparte la MISMA cookie `oauth_state` que usa `/auth/login` (login
normal de Discord), así que cualquier usuario logueado en el dashboard podía pegarle a
`/auth/login` para setear esa cookie, armar a mano una URL de autorización de Spotify
con ese mismo `state` apuntando a `/spotify/callback`, autorizar con SU propia cuenta, y
pisar la fila global `spotify_auth` sin pasar nunca por el gate de `/spotify/authorize`.
Ahora `/spotify/callback` revalida `fetchApplicationOwnerId()` de nuevo, antes de
`exchangeSpotifyCode`/`saveSpotifyRefreshToken`.

**Dashboard — rate limiter y la topología real de Railway.** El limiter tomaba la
PRIMERA entrada de `X-Forwarded-For` — un cliente podía mandar cualquier valor ahí y
resetear su propio límite en cada request. Railway pone exactamente UN proxy de borde
entre internet y el proceso; cualquier proxy estándar (Railway incluido) AGREGA (nunca
reemplaza) al FINAL de esa cabecera la IP de quien se conectó directo a él — la ÚLTIMA
entrada es la única que un cliente no puede falsificar. El fix toma la última entrada,
mismo criterio que `trust proxy: 1` de Express, implementado a mano (no con `req.ip`)
para que los tests sigan usando objetos `req` simples en vez de tener que replicar el
cálculo interno de `proxy-addr`.

**`increment_inventory_item` — guard atómico, no solo lock de JS.** Dos consumos
concurrentes del mismo ítem por FEATURES distintas (ej. `/vender`, lock
`vender:{guild}:{user}`, y `/buy` revirtiendo una compra fallida, lock
`buy:{guild}:{user}` — namespaces DISTINTOS, nunca se excluyen entre sí) podían dejar
una cantidad en negativo. La RPC ahora hace `select ... for update` (bloquea la fila) y
`raise exception 'insufficient_inventory'` si el resultado daría negativo, antes de
escribir. El wrapper de JS (`incrementInventoryItem`) mapea eso a
`.code === 'insufficient_inventory'`. `/vender` lo atrapa con un mensaje de negocio
claro ("ya no tenés ese ítem, puede que se haya usado justo ahora"); cualquier otro
error se re-lanza tal cual. `/buy` en su compra normal NO necesita este manejo — su
delta ahí es siempre `+1`, matemáticamente no puede disparar `insufficient_inventory`
(su propio delta `-1` de reversión, agregado después en Fase 2B, sí puede, y lo trata
como best-effort con solo un log — ver `buy.js`).

**`economy_transactions.delivered` — schema drift cerrado.** El código
(`getGuildPurchasesByReason`/`markPurchaseDelivered`, `/economia-staff pendientes`) ya
usaba esta columna antes de que `schema.sql` la declarara. `migration_2026_08_30_fase1.sql`
(mismo patrón que `migration_2026_08_27_criticos.sql`) trae la columna nueva + el guard
de `increment_inventory_item` — corrida y verificada contra producción (Table Editor +
`select prosrc from pg_proc where proname = 'increment_inventory_item'`) el 2026-08-31.

**Suite de tests — 356→394 passed, 24→0 failed.** Los 24 fallos preexistentes (antes de
Fase 1, no causados por ella) tenían DOS causas distintas, no una:
1. **Mock de `roles.cache` incompleto** (`{ has: fn }` en vez de un `Map` real) en
   `tests/helpers/discordMock.js`, `tests/isStaff.test.js`, `tests/estado.test.js` —
   `isStaff()` hace `[...roles.cache.keys()]` (igual que la `Collection` real de
   discord.js, que extiende `Map`); un objeto sin `.keys()` revienta. **Al escribir un
   mock de `member.roles.cache` nuevo, usar un `Map` real, nunca un objeto ad-hoc.**
2. **Test desactualizado** (`giveawayEngine.test.js`): asertaba `unlockAchievement`
   llamado directo, pero ese call-site fue migrado al Event Engine
   (`eventBus.emit('ACHIEVEMENT_CHECK', ...)`) en la consolidación de logros de la
   auditoría 2026-08-29 y el test nunca se actualizó — sin relación con el bug de mocks.

**`dashboard/server.js` — patrón de testabilidad.** `app` se exporta y `app.listen()`
queda detrás de un guard (`process.argv[1] === fileURLToPath(import.meta.url)`) — solo
corre cuando el archivo se ejecuta directo (`node dashboard/server.js`, que es como lo
arrancan `npm run dashboard`/`dashboard:dev`), nunca al importarlo desde un test. Permite
testear rutas HTTP reales (`node:http` + `app`, sin supertest — el proyecto no lo tiene
como dependencia) sin abrir un puerto real solo por importar el módulo. Verificado
empíricamente (no solo leído) que el guard resuelve igual con invocación relativa,
absoluta, y bajo `--watch`.

## Fase 2A + Fase 2A.1 — recovery, concurrencia e integridad de datos (2026-08-31)

Commit `ad80cd8`, migrado y confirmado en producción el 2026-08-31 (deploy limpio en
Railway + `/sorteo crear`/participar probado a mano en Discord). A diferencia de Fase 1
(bugs puntuales encontrados por auditoría), esta fase fue un endurecimiento deliberado de
tres ejes — recuperación tras crash, concurrencia, e invariantes de base de datos — sobre
partes del código que ya funcionaban pero no estaban blindadas contra fallas parciales.
Alcance explícitamente excluido: música (tiene su propio proyecto de eliminación
después), features nuevas de Pets (solo constraints de integridad, cero comportamiento
nuevo), Premium/billing/dashboard visual.

**Sorteos — estado de 2 fases, no 1.** `giveaways.winners_announced_at` (epoch ms,
nullable) separa "se calcularon los ganadores" de "se avisó de verdad" — antes
`endGiveaway` hacía ambas cosas como si fueran un solo paso, así que un crash (o un
`channel.send()` fallando por rate limit/timeout) entre persistir `ended+winners` y
mandar el anuncio dejaba el sorteo marcado como terminado pero sin ganador anunciado,
sin ninguna forma de detectarlo. La recuperación tiene DOS capas, no una:
`reconcilePendingGiveawayAnnouncements()` corre una vez al arrancar (cubre un crash real
del proceso) y `startGiveawayReconcileLoop()` la repite cada 5 minutos durante toda la
vida del proceso (Fase 2A.1 — cierra el caso de que el fallo sea transitorio, no un
crash, y el proceso siga corriendo días sin reiniciar). Ambas reusan `endGiveaway` tal
cual: como el sorteo ya está `ended=true`, entra directo a la rama de "reintentar el
anuncio sin recalcular ganadores" — nunca hay una segunda tirada de `pickWinners` sobre
un sorteo ya resuelto. Índice parcial (`giveaways_pending_announcement_idx`) con el
MISMO predicado que la query, para que el barrido periódico no escanee historial.

**Un solo lock para las 4 formas de tocar un sorteo.** `giveaway:{guildId}:{messageId}`
(el lock que ya usaba `endGiveaway`) ahora también envuelve `rerollGiveaway`,
`cancelGiveaway` (las dos movidas de `sorteo.js` a `giveawayEngine.js` para poder
compartirlo) y el botón "Participar" (`toggleParticipant` en el handler de
`sorteo.js`). El botón ya no muestra `ended: false` hardcodeado — lee el estado real
después de escribir, así que si el sorteo cerró en el instante entre soltar el lock y
responder, el embed refleja "finalizado" en vez de mentir. Reroll excluye del pool a los
ganadores ya elegidos cuando hay otra gente para elegir (si no, vuelve a elegir de todos).

**`/prestigio` — RPC atómica, no read-calculate-write.** `apply_prestige` (schema.sql,
`for update`) reemplaza lo que antes era `getUserXp` → `+1` en JS → `update` — dos
`/prestigio` casi simultáneos podían leer el mismo `prestige` viejo y las dos escribir
`+1`, perdiendo un incremento (quedaba en `+1` en vez de `+2`). Mismo patrón que
`increment_xp`/`increment_balance`, que ya eran atómicas desde antes.

**`grantMessageXp` bajo lock por guild+usuario.** El cooldown de 60s entre mensajes que
dan XP se leía y escribía sin lock — dos mensajes del mismo usuario procesados casi al
mismo tiempo (doble entrega del gateway, dos mensajes con <1 tick de diferencia) podían
los dos leer el mismo `lastXpTs` viejo y los dos ganar XP. El lock (`xp-message:{guild}:
{user}`) es por usuario, no global — el resto del tráfico de XP por mensaje nunca se
serializa entre sí, solo dos mensajes del MISMO usuario compitiendo por su propio
cooldown. XP por voz (`voiceXpEngine.js`) se evaluó aparte y quedó sin cambios de
comportamiento — ver el comentario propio del archivo: no existe una señal de "está
hablando de verdad" en discord.js sin unirse al canal de voz (fuera de alcance, invasivo
y caro para lo que es solo un barrido de XP).

**28 CHECK constraints + 2 enums, uno por uno verificado contra código real antes de
agregarlo** (no una pasada genérica) — `balance`/`bank`/`daily_streak`/`rob_shield_until`
en `economy`, `xp`/`level`/`prestige` en `xp`, `price > 0` en `shop_items`,
`level`/`xp`/`wins`/`losses` + `hunger`/`happiness BETWEEN 0 AND 100` en `pets` (sin
cambiar comportamiento — el JS ya clampeaba esos valores desde antes de esta fase),
contadores de `voice_channel_stats`/`trivia_user_stats`/`guild_daily_stats`, y enums
`IN (...)` en `temporary_voice_channels.type`/`guild_config.level_roles_mode`.
**`economy_transactions.type` deliberadamente SIN CHECK** — el comentario que lo
documenta ya estaba desactualizado una vez (le faltaban `mystery_box`/`mission`/
`admin_set_level`, corregido en esta fase); una lista que ya demostró desincronizarse
sola no es un buen candidato para una constraint que rompería inserts legítimos en
silencio ante la próxima feature de economía.

**Shutdown limpio, chico a propósito.** `src/utils/shutdown.js` (`registerShutdown`) es
lo único nuevo — un guard contra doble ejecución + `process.exit()` con el código
correcto. Se llama UNA vez en `src/index.js` (`client.destroy()`) y UNA vez en
`dashboard/server.js` (`server.close()`, detrás del mismo guard `process.argv[1]` que ya
protegía `app.listen()`). No intenta drenar interacciones en curso ni nada más
sofisticado — pedido explícito de la fase ("pequeña y robusta", no un sistema de
graceful shutdown completo) y a propósito no diseñado pensando en conservar sesiones de
música activas (se van a eliminar en un proyecto aparte).

**guildDelete — 22 tablas reales, no las que auditoría había encontrado hasta ahora.**
Ver la sección "Limpieza al salir de un servidor" más arriba — el array se comparó
tabla por tabla contra `schema.sql`, no contra la lista previa.

## Fase 2B — Discord, moderación, error handling y consistencia (2026-08-31)

No es una fase de features nuevas — es la que hace que lo que ya existe se comporte de
forma predecible frente a usuarios reales. Alcance explícitamente excluido (igual que
Fase 2A): música, Pets, Premium/billing/landing. Código de esta fase, a diferencia de
Fase 2A, **sin commitear todavía** — ver el informe final de la sesión para el estado
exacto de tests.

**Panel `/sanciones` — dos inconsistencias reales contra los comandos directos.**
(1) El select para borrar TODAS las advertencias de un usuario no aplicaba
`getModerationBlockReason` — a diferencia de `/unwarn` directo, el panel podía borrarle
las warns a alguien con rango igual/superior (o gatillar sobre el propio staff/el bot,
aunque esos casos son más de forma que de riesgo real). (2) Quitar una restricción con
duración desde el panel no cancelaba el timer en memoria ni borraba la fila de
`active_punishments` — a diferencia de `/unpunish`, que sí lo hacía. El timer disparaba
igual más tarde, quitaba un rol que ya no estaba (no-op silencioso) pero mandaba un log
de "expiración automática" falso sobre algo que el staff ya había resuelto a mano. Fix
centralizado en `revokePunishment()` (`punishEngine.js`) — cancela el timer y borra el
estado persistido ANTES de tocar Discord (no al revés, que era el orden que tenía
`/unpunish`), usado ahora tanto por `/unpunish` como por el select del panel, para que
los dos caminos quedaran garantizados equivalentes en vez de mantener la secuencia
duplicada en dos archivos. `warn-editar.js` sumó el mismo chequeo de jerarquía que el
resto de moderación — antes era el único comando de moderación sin ninguno.

**`/economia-staff` y `/xp` — decisión: NO aplicarles jerarquía, documentado a
propósito.** Ninguno de los dos llama `getModerationBlockReason`, a diferencia de
ban/kick/timeout/warn/punish — evaluado explícitamente si eso era un bug o una decisión,
no asumido. Se mantiene la asimetría por 3 motivos concretos: (1) ya tienen una barrera
de Discord más alta por defecto (`ManageGuild`, tier admin) que la moderación normal
(`ModerateMembers`/`BanMembers`/`KickMembers`, tier mod) — la asimetría de acceso ya
existe por diseño. (2) Son herramientas de ajuste/configuración de recursos, no acciones
coercitivas contra otro miembro — más parecidas a `/config`/`/setup` (que tampoco tienen
jerarquía de target, porque no actúan "contra" un usuario) que a un ban. (3) Aplicar
jerarquía estricta rompería el caso legítimo de "un admin premia a otro admin/mod" — en
un server con roles de staff más o menos al mismo nivel de posición, eso bloquearía casi
cualquier intercambio entre staff. Riesgo real que SÍ queda abierto y aceptado: nada
impide que un staff se autoasigne saldo/XP infinitos con estos comandos — mitigado (no
eliminado) por el log de auditoría que ya mandan a los canales de economía/actividad en
CADA ajuste (`logStaffAction`), igual que cualquier otra acción de staff queda expuesta a
revisión. No se tocó código de estos dos comandos en esta fase.

**Defer/reply — barrido de los 17 comandos de moderación.** Clasificados A (ya
correcto)/B (necesitaba defer)/C (rápido, no amerita cambio). Necesitaban
`deferReply()`/`deferUpdate()` antes de su operación lenta: `kick`, `timeout`, `punish`,
`unpunish`, `unban`, `lock`, `unlock`, `warn-editar`, y 6 handlers de botón/select
(`sanciones_hist_page_`, los 4 selects de `sanciones.js`, `ecostaff_hist_page_` y
`ecostaff_pendiente_entregada` de `economia-staff`) — todos hacían la llamada mutante a
Discord/Supabase ANTES del primer ack, arriesgando "Unknown interaction" (interacción
vencida a los 3s) aunque la acción SÍ se hubiera aplicado. `ban`, `clear`, `unwarn` ya
estaban bien (su mutación real ocurre en el paso de confirmación, que ya deferría
primero). `warn`, `warns`, `economia-staff`, `/xp`, `voice` ya deferían desde el
principio. `voice.js` quedó en C a propósito: sus tres escrituras lentas son upserts
únicos a Supabase (no una llamada a la API de Discord), mismo orden de magnitud que el
`getGuildConfig` que ya hace `isStaff()` en CUALQUIER comando — no es una inconsistencia
nueva, es el mismo costo aceptado en todos lados.

Para los comandos SIN flujo de confirmación (kick/timeout/punish/unpunish/unban/lock/
unlock/warn-editar), el defer se puso apenas se confirma el permiso, ANTES de leer
`guild_config`/fetchear al member — no "justo antes" de la llamada lenta, porque eso no
mueve el problema (el reloj de 3s ya corre desde que llega la interacción, no desde el
primer await). Esto implica un cambio de visibilidad real: como el defer se hace UNA vez
y compromete ephemeral-o-no para toda la respuesta, y el mensaje de éxito de estos
comandos siempre fue público (no ephemeral), los mensajes de error/validación que antes
eran ephemeral (jerarquía, "no encontrado", etc.) pasan a ser públicos también — mismo
trade-off que ya tenía `/warn` desde antes (se usó como referencia exacta, no se inventó
un patrón nuevo). De paso, esos catches se simplificaron a `editReply(...).catch(() =>
{})` — el patrón viejo (`replied || deferred ? followUp : reply`) hubiera dejado un
"Pensando..." fantasma sin editar en el error, porque después de un defer-sin-reply real
`followUp()` no toca el mensaje diferido, solo manda uno nuevo al lado. Los selects de
`sanciones.js`/`economia-staff` no tuvieron este dilema — ahí TODAS las ramas (éxito y
error) ya eran ephemeral desde antes, así que deferir ephemeral no cambió ninguna
respuesta visible.

**Timeout — duración visible en `/sanciones <usuario>`.** `moderation_actions.extra.until`
se guardaba bien desde que existe `/timeout` pero el render del historial lo ignoraba
por completo. Solo se tocó el render (`buildHistorialEmbed`), no la persistencia.

**Errores de interacción — revisado el resto (botones/selects/modals/comandos) sin
hallazgos nuevos confirmados fuera de moderación.** Se leyó `interactionCreate.js`
(dispatcher central), los 3 routers y `confirmations.js` (usado por `/ban`, `/clear`,
`/unwarn`) buscando reply-tardío/doble-reply/editReply-sin-defer — sin bugs adicionales
confirmados ahí. No se hizo una pasada por los ~74 comandos restantes (fuera del alcance
explícito de esta fase: "no refactor general").

**`/8ball` sin límite de input.** `pregunta` no tenía `setMaxLength` (Discord permite
hasta 6000 por defecto en un string option) y se pega tal cual en el VALUE de un campo de
embed (límite real: 1024) — una pregunta larga rompía el comando entero con un error sin
manejar. Ahora `setMaxLength(200)`. `/choose` se revisó y ya estaba acotado
(`opciones` ya tenía `setMaxLength(500)`, muy por debajo del límite de 4096 de una
`description` — no usa `addFields`), no se tocó.

**`logEmbeds.js` — 2 builders sin cota real, el resto ya estaba a salvo.**
`createRoleChangeLogEmbed` (roles agregados/quitados) y `createGiveSuspiciousLogEmbed`
("a quiénes") armaban listas con `.join()` sin ningún límite — con suficientes roles o
receptores el embed entero fallaba al mandarse. Nuevo helper `joinWithOverflow()` (mismo
patrón "+N más" que ya usan `roles.js`/`shop.js`, no uno inventado) aplicado a esos dos
lugares únicamente. El resto de los builders con listas (`createChannelLogEmbed`,
`createRoleLogEmbed`, `createGuildUpdateLogEmbed`, `createBotConfigLogEmbed`) ya tenían
`.slice(0, 1024)` — corte mudo pero YA a salvo de un payload inválido, así que se
dejaron como estaban (no era el pedido: "no quiero una refactorización completa").
Título/descripción/footer de todo el archivo son texto estático o campos ya acotados
(motivo ≤512) — revisado, sin riesgo real de exceder ningún límite de Discord.

**`userUpdate.js` — throttle de 2 minutos por usuario.** Antes CADA cambio de
avatar/username/nombre visible disparaba un fan-out completo a todos los servidores
mutuos, sin límite — alguien cambiando de foto varias veces seguidas (o presente en
muchos servidores con el bot) multiplicaba envíos de log innecesarios. Mismo patrón de
`Map` en memoria autolimpiante que el resto del proyecto (`rateLimiter.js`), nunca
Supabase. El throttle se marca solo cuando de verdad hay algo para loguear (no en
cualquier `UserUpdate`, que dispara por más campos de los que a NEXO le importan).

**`/help` y `/helpstaff` — un admin nuevo.** `/help` (para todo el mundo) ya estaba bien
organizado (Información/Economía/Casino/Diversión/Acción/Música) y ya menciona logros
desbloqueados dentro de la descripción de `/perfil` — no se tocó. `/helpstaff` (staff)
tenía un hueco real: `/setup` y `/config` — las dos entradas fundamentales de toda la
configuración de un servidor — no aparecían en NINGÚN lugar. Categoría nueva
"⚙️ Administración", resumida por tema (no las ~15 subcommands de `/config` una por
una, para no volver esto una enciclopedia) — separada de "🧹 Moderación" (sanciones del
día a día), que ya estaba completa.

**`command_usage` — aclarado que mide intentos, no éxitos de negocio (sin cambiar
comportamiento).** El comentario del archivo afirmaba "ejecución exitosa"; en la
práctica cuenta "`command.execute()` no tiró excepción", y casi todos los comandos
atrapan sus propios rechazos (permiso, cooldown, saldo insuficiente, target inválido) sin
volver a tirarla. Evaluado como decisión, no como bug: para lo que esto alimenta hoy
(`/metricas` y el logro de servidor por actividad total) "intentos" es la semántica
correcta — un `/rob` rechazado por su 40% de éxito documentado sigue siendo interacción
real, contarlo como "no-uso" subestimaría la popularidad real del comando. Migrar a una
métrica de "solo éxitos" necesitaría una señal explícita por comando en cada rama de
rechazo — cambio grande, fuera de esta fase. Solo se corrigió el comentario para que
describa lo que el código realmente hace.

**`/buy` — rol borrado de Discord ya no cobra sin entregar nada.** Dos capas: (1) chequeo
de que el rol configurado siga existiendo (`guild.roles.cache`, siempre completo y
gratis, sin fetch) ANTES de cobrar — si no existe, se rechaza la compra sin descontar
nada. (2) Por si el rol se borra justo en la ventana entre ese chequeo y
`member.roles.add()` (condición de carrera real pero rara), el catch que antes solo
logueaba y confirmaba éxito ahora revierte todo lo ya aplicado (inventario −1 vía
`incrementInventoryItem`, reembolso vía `addBalance` con `type: 'purchase_refund'`) y le
avisa al usuario — nunca un "compraste con éxito" sin el beneficio. `purchase_refund` se
sumó a `economyOrigins.js` como `origin: 'admin'` (no es actividad orgánica, es una
corrección del sistema — sin esto caía en `'activity'` por defecto y contaba como si el
usuario hubiera "ganado" esas monedas) y a `TYPE_LABELS` de `/economia-staff historial`.
Nota menor aceptada: la compra original ya había contado como `COINS_DESTROYED` (sumidero,
`money_destroyed` del día) en el momento del cobro; el reembolso no revierte esa métrica
retroactivamente (`guild_daily_stats` es solo-incremento, sin cron de recálculo) — un
desvío cosmético de un evento ya de por sí raro, no vale la complejidad de revertirlo.

**`/encuesta` — cooldown de 2 minutos por guild+usuario.** No existía ningún límite.
Se evaluó un tope de "encuestas activas simultáneas" además del cooldown y se descartó:
no hay ningún tracking de qué encuestas siguen abiertas (se resuelven solas por
reacciones; cerrarlas con el botón es opcional, no un estado que el sistema seguía) —
armarlo hubiera sido una función nueva real, no la "solución sencilla" pedida. El
cooldown solo, por guild+usuario (no global — mismo criterio multi-tenant que el resto
del proyecto), ya cubre el vector real (spam de creación) sin bloquear un uso legítimo
espaciado. Mismo patrón de `Map` en memoria autolimpiante, guardado local al archivo del
comando (mismo criterio que la sesión de `/setup`).

**Routers de botones/selects/modals — matching por especificidad, no por orden de
registro.** `trivia_` y `trivia_ranking_page_` (ambos en `trivia.js`) son el caso real: el
segundo es substring del primero, así que cualquier customId de ranking matchea los DOS
prefijos. Hoy no falla porque `trivia.js` los registra en el orden correcto por
casualidad de escritura del archivo — pero `routeButton`/`routeSelect`/`routeModal`
tomaban el PRIMER match encontrado en el array, que depende del orden de `import`
dinámico de `src/index.js`, no de nada controlado a mano. Se revisaron los ~90 prefijos
registrados en todo el proyecto buscando otras relaciones de substring reales — no
apareció ninguna otra (los que parecen candidatos, como `voice_admin_select` vs
`voice_admin_transfer_select_`, divergen antes de que ninguno termine). Fix igual en los
3 routers: buscar el prefijo MÁS LARGO entre todos los que matchean, no el primero — dejó
de depender del orden de registro, sin tocar ningún prefijo existente.

## Fase 2C — performance, escalabilidad y operación (2026-09-01)

Objetivo explícito de esta fase: no "más rápido por las dudas", sino sacar costos
reales y confirmados. Alcance excluido a propósito: música (sale del bot en un proyecto
aparte) y Pets (se elimina después) — ninguna de las dos se tocó ni se optimizó. Código
de esta fase, **sin commitear todavía** al momento de escribir esto — ver el informe de
la sesión para el estado exacto de tests.

**Dashboard — `listManagedGuilds` (home): cache de metadata, NUNCA de autorización.**
Recorre TODOS los `guild_config` del bot (no solo los del usuario) para saber a cuáles
tiene acceso — antes eso significaba 1-2 requests REST a Discord POR GUILD, en CADA
carga de "/", sin importar cuántos admins pidieran la página en la misma ventana. Fix:
`fetchGuildCached()` (local a `queries.js`, TTL 5 min) cachea nombre/ícono/`owner_id`
—viajan en la MISMA respuesta de Discord, no se pueden pedir por separado— compartido
entre TODOS los usuarios que cargan la home. El chequeo de ROL de staff
(`fetchGuildMember`, lo que determina acceso para quien no es dueño) se sigue pidiendo
fresco SIEMPRE, sin ninguna excepción — deliberadamente NO se tocó el `fetchGuild()`
compartido de `discordApi.js`, que también usa `checkGuildAccess()` (el gate real de la
página de un servidor puntual): cachear ahí hubiera hecho que una autorización real
dependiera de un cache stale. Si la lista muestra algo desactualizado por hasta 5
minutos, lo peor que pasa es un click que `checkGuildAccess()` rechaza fresco — nunca se
llega a mostrar un dato sensible sin re-verificar.

**Dashboard — `fetchPunishedMembers`: recorte con total real, no un límite mudo.** Antes
devolvía hasta 1000 IDs (el máximo de una página de Discord) y el caller los resolvía
UNO POR UNO contra la API de Discord solo para mostrar sus nombres — con un server que
acumuló sancionados con el tiempo, cientos de requests para una tabla que la UI ya
truncaba visualmente. Ahora se corta en 20 (`PUNISHED_MEMBERS_DISPLAY_LIMIT`) pero se
devuelve el conteo REAL aparte (`punishedTotal`) — el título de la tarjeta sigue diciendo
el número correcto, con un "(+N más)" cuando corresponde (mismo patrón que
`roles.js`/`shop.js`).

**Dashboard — agregaciones movidas a Postgres.** `fetchAllBalances` (traía la columna
`balance` de CADA fila de `economy` del server para sumarlas en JS) y `fetchTopAchievers`
(traía TODAS las filas de `achievements_unlocked`, sin límite, para agrupar y contar en
JS) reemplazadas por `sum_guild_balances`/`top_guild_achievers` (RPC, ver
`migration_2026_09_01_fase2c.sql`, **preparada, no ejecutada**) — cero filas transferidas
de más, mismo resultado. `getGuildFrequentReasons`/`getGuildFrequentWarnReasons`
(moderación) y `getTotalUsage` (command_usage) se revisaron con el mismo criterio y se
dejaron como estaban: el primer par ya tiene un `.limit(200)` explícito y consciente: el
segundo está acotado por el tamaño del catálogo de comandos (~100), nunca crece con la
actividad del server — ninguno de los dos es el patrón "trae todo, crece sin límite" que
sí tenían los otros dos.

**Dashboard — concurrencia hacia Supabase acotada, sin pool global.**
`loadGuildDashboardData` disparaba sus 18 fuentes de datos en un solo `Promise.all` sin
ningún límite — una sola carga de página no es el problema, lo es que esto puede correr
muchas veces a la vez (varios admins, varios servidores) contra la MISMA base que
también usa el bot para todo lo demás. `allWithConcurrency` (mismo patrón que
`mapWithConcurrency` de `discordApi.js`, pero para thunks heterogéneos en vez de la
misma función aplicada a una lista) lo acota a 6 en vuelo — límite chico y explícito,
local a esta función, no una cola/pool global nueva.

**Dashboard — errores globales.** `dashboard/server.js` no tenía ningún
`process.on('unhandledRejection'/'uncaughtException')`, a diferencia de `src/index.js`.
Evaluado (no copiado a ciegas): cada ruta de Express ya tiene su propio try/catch
alrededor de la lógica async, así que el camino normal de un request ya estaba cubierto
— lo que no cubre es cualquier promesa rechazada que escape de eso (código futuro, un
`setInterval` sincrónico rompiendo), y desde Node 15 eso tira el proceso entero por
default sin un listener. Mismo criterio que el bot: se loguea siempre, y
`uncaughtException` sale con `process.exit(1)` directo (no por `registerShutdown`, que
espera a que terminen requests en curso — después de una excepción no capturada no se
sabe en qué estado quedó el proceso).

**`grantMessageXp` — camino rápido en memoria para el hot path real del bot.** Cada
mensaje elegible pagaba un lock + una lectura real a Supabase (`getUserXp`) solo para,
la mayoría de las veces en un canal activo, descubrir que el usuario seguía en cooldown
(60s). `lastGrantedLocally` (Map en memoria, `guildId:userId` → timestamp del último
otorgamiento de ESTE proceso) corta ese round-trip cuando ya se sabe, con certeza, que
el cooldown real en la base también rechazaría — nunca puede hacer que se otorgue XP de
más, solo rechazar más rápido: el otorgamiento en sí sigue yendo 100% por el camino con
lock + Supabase de siempre. Seguro porque esta función es la ÚNICA que escribe
`last_xp_ts` de mensaje-XP y en producción corre un solo proceso del bot a la vez (ver
"nunca levantar el bot local" más abajo) — el caché nunca puede ir por delante de la
base, como mucho atrasado (proceso recién reiniciado), y ahí simplemente cae al camino
real.

**`voiceXpEngine.js` — guardia contra ticks solapados.** El barrido de XP por voz (cada
5 min) recorre guilds/canales/miembros en secuencia con awaits reales a Supabase por
cada humano presente — con mucha actividad de voz simultánea, un barrido puede tardar
más que el intervalo. `setInterval` no espera a que el callback anterior termine antes
de disparar el siguiente: sin guardia, dos barridos solapados podían darle XP doble a
quien siguiera conectado en los dos (a diferencia de `grantMessageXp`, este barrido no
tenía ningún lock). Un flag booleano (`tickRunning`) salta el tick si el anterior sigue
en curso, con log de aviso. No se paralelizó el barrido en sí: el costo real lo determina
la actividad de voz simultánea (no la cantidad total de guilds, que se descarta rápido
si no tienen canales activos), y no hay evidencia de que eso sea hoy el cuello de
botella — la guardia resuelve la duplicación real sin una reescritura que todavía no
hace falta.

**`/estado` — Supabase "lento" como estado distinto de "OK"/"caído", y el caso `-1ms`
del gateway.** Antes Supabase era binario; un round-trip que responde pero tarda >1s
(`SUPABASE_SLOW_MS`, umbral operativo, no una medición) se mostraba igual que uno de
50ms. Y `client.ws.ping` vale `-1` cuando discord.js todavía no completó ningún
heartbeat ACK (recién conectado/reconectando) — mostrar "-1ms" crudo no dice nada útil
sin leer el código. Ningún sistema nuevo: son dos umbrales/labels sobre datos que
`/estado` ya pedía.

**Revisado sin cambios (ya estaba bien):** `userUpdate.js` (el throttle de Fase 2B ya
filtra por campo relevante antes de marcar/consumir la ventana; el gate de "¿hay canal
de logs configurado?" es inherentemente por-guild, no se puede adelantar sin romper el
soporte multi-guild); `giveawayEngine.js`/`reminderEngine.js`/`lolPatchEngine.js`/
`lolPatchMonitor.js`/`logPurgeEngine.js` (loops ya acotados: índice parcial, tick largo,
circuit breaker de páginas, o volumen bajo por diseño); `spamDetector.js`/
`guessSessions.js`/`giveTracker.js`/`tempVoiceEngine.js`/`afkStore.js`/
`guildConfigStore.js`/`missionsStore.js` (`ensuredCache`) — todos los Map en memoria
revisados ya tenían barrido periódico o limpieza atada a un evento real (`guildDelete`,
`guildMemberRemove`, fin de sala) desde antes de esta fase. Rate limits (`rateLimiter.js`
del bot: usuario, cruza guilds a propósito; `dashboard/rateLimiter.js`: IP, protege el
proceso completo; cooldown de `/encuesta` y throttle de `userUpdate.js`: guild+usuario y
usuario respectivamente, Fase 2B) revisados sin encontrar ninguna inconsistencia real de
scope — ninguno se tocó.

**Reglas de arquitectura para features futuras** (sección 13 de la auditoría — generales
a propósito, no un framework):
- Un `SELECT` que solo existe para reducirse a un número/top-N en JS (`sum`, `count`,
  agrupar+contar) va en Postgres, no trayendo todas las filas — salvo que ya esté
  acotado con un `.limit()` explícito y consciente (ver `getGuildFrequentReasons`/
  `getTotalUsage` arriba: acotados no es lo mismo que sin límite).
- Si la UI muestra top-N, el backend nunca trae más que eso (+ margen chico para un
  indicador "+N más") — nunca "total posible" solo porque ya se estaba pidiendo.
- Concurrencia hacia Supabase o Discord disparada por UN request: límite explícito
  (`mapWithConcurrency`/`allWithConcurrency` o equivalente), nunca un `Promise.all` sin
  tope sobre algo que puede crecer con el catálogo del bot o la base de usuarios.
- `guild.members.fetch()` sin argumentos (gateway, opcode 8) nunca para "traer todos los
  miembros" — usar `guild.members.list()` (REST paginado, ver `sanctions.js`/
  `roles.js`), el gateway tiene su propio rate limit aparte del de REST.
- Todo loop periódico nuevo: `.unref()`, try/catch propio por iteración (un guild roto
  no debe tumbar el barrido de los demás), y guardia contra solapamiento si el trabajo
  por tick puede tardar más que el intervalo.
- Todo `Map`/`Set` en memoria nuevo necesita una estrategia de limpieza desde el día en
  que se crea (TTL + barrido periódico, o atada a un evento real como `guildDelete`) —
  no un "ya lo vemos después".
- En un hot path real (`messageCreate` y similares), un atajo en memoria contra una
  consulta cara solo se justifica si, en el peor caso, puede rechazar de más — nunca
  aceptar/otorgar de más.

## Fase 3B — eliminación de Pets (2026-09-01, confirmada en producción 2026-09-03)

Decisión de producto (no un bug ni una auditoría): Pets no forma parte del NEXO
comercial. Fase 3A (mapa de dependencias) ya había confirmado que el sistema estaba
bien aislado — 3 archivos exclusivos (`src/commands/economia/pet.js`,
`src/utils/petsStore.js`, `src/utils/petCardImage.js`, ninguno con botón/select/modal
registrado, cero dependencia npm propia, cero variable de entorno, cero ruta de
dashboard) más 7 puntos de fuga hacia sistemas genéricos (bonus en `/work`/`/crime`,
2 entradas de `achievements.js`, 1 de `economyOrigins.js`, 1-2 de `shopItems.js`, 1
campo de `/perfil`, 1 línea de `/help`, 1 entrada de `GUILD_SCOPED_TABLES`). Fase 3B
ejecutó esa lista completa.

Commit `d7126b0` (`refactor: remove pets system from Nexo`), pusheado y confirmado en
producción el 2026-09-03: deploy limpio en Railway (bot y dashboard, sin
`❌ No se pudo cargar el comando` ni restart loop) + `/work`/`/crime`/`/perfil`
probados a mano en Discord (recompensa sin bonus, embed sin campo de mascota) +
`/pet` confirmado fuera del registro global de comandos verificando directo contra la
API de Discord (`GET /applications/{id}/commands` → 95 comandos, sin `pet`, contra los
96 de antes) tras correr `node src/deploy-commands.js`. 565/565 tests en verde (línea
base 554 → −3 del bloque de test de `/pet alimentar` en
`inventoryErrorHandling.test.js` → +14 nuevos: `work.test.js`, `crime.test.js`,
`perfil.test.js`, `shopItems.test.js`, `startup.test.js` — este último reproduce el
`import()` dinámico real de `src/index.js`/`deploy-commands.js` sobre TODOS los
comandos y eventos, la forma más fiel de probar "arranca sin Pets" sin levantar el bot
contra producción — + 1 en `achievements.test.js`).

**Verificación de datos ANTES de tocar código** (lectura pura contra Supabase de
producción, sin modificar nada): `economy.inventory` tenía una sola fila con la clave
`comida_mascota` en **0 unidades** (nadie perdía nada real al sacar el ítem del
catálogo) y cero filas con `amuleto_mascota`. La tabla `pets` tenía una sola fila y
`achievements_unlocked` una sola fila de `primera_mascota` — las tres coincidiendo con
el mismo `guild_id` (el de `GUILD_ID_DEV`, el server de pruebas), consistente con que
Pets nunca tuvo adopción real fuera de desarrollo. Cero usuarios reales afectados.

**`amuleto_mascota` — retexturizado, no eliminado.** Investigado antes de decidir por
nombre: no tenía ningún `type` especial ni lógica propia en `buy.js`/`vender.js` (a
diferencia de `comida_mascota`, que si dependía de `/pet alimentar` buscándolo por
`type: 'pet_food'` — ese sí se eliminó, quedaba funcionalmente muerto). El único vínculo
de `amuleto_mascota` con Pets era el texto de nombre/descripción. Con cero inventarios
reales que lo tuvieran (verificado arriba), no había ninguna razón de compatibilidad
para conservar el texto — pero tampoco alguna para borrar un coleccionable cosmético
más del catálogo de ejemplo. Se mantuvo el `id` interno (nunca visible, es la clave de
inventario) y se retexturizó a "🍀 Amuleto de la Suerte" / "Para los que confían en la
suerte." — mismo precio, misma categoría "Trofeos".

**`/pet` — cómo desaparece realmente de Discord.** `src/deploy-commands.js` hace un
`PUT` (bulk overwrite, `Routes.applicationCommands`/`applicationGuildCommands`) con la
lista completa de comandos descubiertos en `src/commands/**` — no hay `create`/`delete`
individual por comando. Borrar `pet.js` hace que `/pet` deje de estar en esa lista, pero
Discord solo se entera cuando alguien corre ese script a mano (nunca automático: ni el
boot del bot —que solo llena `client.commands` en memoria, nunca toca la API de
Discord— ni el deploy de Railway lo disparan). Hasta que eso pase, `/pet` sigue visible
y invocable en Discord; `interactionCreate.js:53` (`if (!command) return;`) responde con
un no-op silencioso — Discord le muestra "La interacción falló" a quien lo intente,
sin que el bot tire ningún error ni loguee nada. Ventana de UX aceptada, no un bug: el
mismo mecanismo ya existente para cualquier comando viejo que se borra sin redeploy
inmediato de comandos.

**`achievements_unlocked` con `primera_mascota`/`primera_pelea` — huérfanas, inertes a
propósito.** El catálogo (`ACHIEVEMENTS` en `achievements.js`) es la única fuente de
verdad de qué logros existen; la tabla solo guarda IDs desbloqueados, sin FK hacia el
catálogo. Sacar las 2 entradas del array no rompe `getUnlockedAchievementIds` (sigue
devolviendo lo que haya en la tabla) ni `/perfil` (solo muestra
`achievements.size/ACHIEVEMENTS.length`, un conteo). Esas filas quedan como historial
inerte — no se tocan en esta fase.

**Migración `migration_2026_09_01_remove_pets.sql` — corrida fuera del orden previsto,
verificada y ya sin efecto negativo.** El criterio del proyecto es código desplegado y
confirmado estable ANTES del `drop table`, nunca al revés — acá se corrió apenas se
mostró la migración, antes de commitear/pushear el código que dejaba de usar `pets` (ver
el gotcha nuevo más arriba, "Correr un DROP TABLE... antes de que el código esté
desplegado"). Verificado por API al toque (`PGRST205: Could not find the table
'public.pets'`), y remediado en la misma sesión commiteando y pusheando el código ya
listo — la ventana real de `/work`/`/crime` rotos en producción duró lo que tardó ese
commit+push+deploy, no más. `schema.sql` (estado actual deseado) ya no declara `pets`
ni sus 6 CHECK constraints; las migraciones históricas (`migration_2026_08_31_fase2a.sql`,
que las agregó) no se reescriben — son historial, no el estado deseado.

## Stack

Node 22+, discord.js 14 (ESM, `"type": "module"` en `package.json`), Supabase
(`@supabase/supabase-js`), Railway (deploy automático on push a `main`). `schema.sql` en
la raíz tiene el esquema completo — pegarlo entero en el SQL Editor de un proyecto
Supabase nuevo para levantar el entorno desde cero.
