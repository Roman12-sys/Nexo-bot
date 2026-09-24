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
- **`/setup`** (`src/commands/admin/setup.js`) — crea canales/categoría/roles
  automáticamente si no existen, y guarda sus IDs. Re-ejecutable sin duplicar (busca por
  ID guardado primero, después por nombre, recién ahí crea). Solo dueño/Administrator —
  no puede gatear con `isStaff()` porque la primera vez no hay `guild_config` todavía.
  Además del rol de staff + canales de log + módulos (moderación/economía/XP), el panel
  tiene 4 "extras" opt-in (togles, apagados por defecto en cualquier plantilla): canal
  de bienvenida, canal de confesiones, rol automático ("Miembro") y rol de castigo
  ("Sancionado"). `resolveRole`/`resolveChannel` son los genéricos que resuelven
  cualquiera de estos (reusar por ID → por nombre → crear), no solo el rol de staff.
  **Esto describe el flujo rápido por plantillas, que sigue intacto.** Desde 2026-09-19
  `/setup` abre primero un panel principal con estado derivado (🟢/🟡/🔴) y secciones
  separadas — ver "NEXO Setup Inteligente" más abajo.
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

### Tres tiers, no dos (PERM-1, Fase 4B)

Hasta Fase 4B, `guild_config` tenía dos columnas (`admin_role_id`/`moderator_role_id`)
pero el código las trataba como intercambiables: `isStaff()` es un OR puro entre las
dos, `/setup` las fijaba siempre al mismo rol, y `/config` no tenía forma de separarlas.
En la práctica, cualquiera con el rol de Staff podía usar `/economia-staff`/`/xp` y
acreditarse balance/XP sin límite — la auditoría 3.0 (PERM-1) marcó esto como riesgo real
una vez que el bot se instala en servidores de terceros, no solo de gente de confianza.

- **Tier 1 — Moderador** (`moderator_role_id`, `isStaff()` tal cual siempre existió):
  moderación completa (`/warn`, `/ban`, `/kick`, `/timeout`, `/punish`, `/sanciones`,
  `/voice`). Sin cambios de código en este tier.
- **Tier 2 — Administrador** (`admin_role_id`, función nueva `isAdmin(interaction)` —
  chequea EXCLUSIVAMENTE `admin_role_id`, sin OR con `moderator_role_id`): todo lo del
  Tier 1, más `/economia-staff`, `/xp` y `/shop-admin` (los únicos comandos que pueden
  acreditar balance/XP sin límite). `isStaffFromRoleIds` sigue dando `true` para un
  usuario que solo tiene `admin_role_id` — el Tier 2 automáticamente pasa el Tier 1 sin
  necesitar asignarle también el rol de moderador a mano.
  **`/shop-admin` se sumó recién en la auditoría del 2026-09-12** — quedó afuera del
  análisis original de PERM-1: permite crear un ítem tipo "caja misteriosa" con precio
  configurable, y el payout real (`buy.js`, `MIN_MYSTERY`-`MAX_MYSTERY`) es una constante
  fija sin relación con ese precio — un precio bajo (ej. 1) lo vuelve una impresora de
  dinero sin límite, alcanzable con Tier 1 puro y sin ninguna condición de carrera.
  Defensa en profundidad agregada en el mismo fix: ni siquiera un Tier 2 legítimo puede
  crear/editar una caja misteriosa con precio por debajo de `MAX_MYSTERY` (400 hoy).
- **Tier 3 — Dueño / Administrator nativo de Discord**: `/setup`, `/config`,
  `/rolreacciones`. Desde el 2026-09-24 `isStaff()`/`isAdmin()` también le dan `true`
  (ver "Qué ve cada rol en el menú de /" abajo).

**Backward-compatible por construcción, no por un caso especial.** `/setup` sigue
fijando `admin_role_id == moderator_role_id` la primera vez (mismo rol de "Staff" de
siempre) — un servidor que nunca corre `/config rol-admin` nunca separa los roles, así
que `isAdmin()` sigue comparando contra el mismo rol de Staff de siempre y el
comportamiento no cambia un bit. `/config rol-admin` (nuevo subcomando) es la única
forma de separarlos, y a propósito el rol ahí es **obligatorio** (sin "vacío para
desactivar" como `rol-castigo`/`rol-automatico`) — si se pudiera vaciar, alguien
corriendo el comando de nuevo pensando en "resetear" dejaría a TODO el mundo sin acceso
a `/economia-staff`/`/xp` (`admin_role_id` null nunca pasa `isAdmin()`), en vez de volver
al comportamiento unificado. Tampoco pasa por `getDangerousRolePermission` — mismo
criterio que `moderator_role_id` en `/setup`: este rol está pensado para tener
privilegios reales.

### Qué ve cada rol en el menú de / (2026-09-24)

Usar un comando exige pasar DOS filtros que no se conocen entre sí: Discord decide si
aparece en el menú de "/" (`setDefaultMemberPermissions`, permiso NATIVO — sin él,
Discord ni manda la interacción) y NEXO decide si se ejecuta (`isStaff`/`isAdmin`).
Cada comando había elegido su permiso nativo por su cuenta, y eso dejó tres problemas,
verificados en vivo contra la API de Discord (registro = código, 0 overrides en
Integraciones en los 4 servidores):
- El rol "Staff" de `/setup` rápido se creaba sin permisos nativos → **0 de 27**
  comandos de staff visibles pese a ser admin+mod en NEXO (pasaba en "Prueba bot").
  Buenos Angeles y Pedritocai no lo sufrían porque su rol tiene `Administrator` nativo,
  que saltea el filtro 1 — por eso nunca apareció.
- `/helpstaff`, `/sanciones`, `/sorteo` pedían `ManageGuild` y `/roles` `ManageRoles`:
  Moderador/Coordinador de la matriz no los veían. Co-Founder (sugerido como admin) no
  veía ningún comando del tier Administrador.
- `/estado`, `/metricas`, `/owner-metricas` no tenían permiso nativo: los veía cualquier
  miembro (rechazo al ejecutar, sin fuga de datos).

Regla desde entonces, con `tests/commandVisibility.test.js` como contrato: tier
Moderador → `ModerateMembers`; tier Administrador → `ManageGuild`; Tier 3 →
`Administrator`. Excepción deliberada: comandos equivalentes 1:1 a una acción nativa
piden esa misma (`/ban`/`/unban` BanMembers, `/kick` KickMembers, `/clear`
ManageMessages, `/lock`/`/unlock`/`/voice` ManageChannels) — el bot nunca deja hacer lo
que Discord no dejaría hacer a mano. **`/anuncio` sigue en `ManageGuild` pese a ser
tier Moderador:** puede mencionar a @everyone (mismo criterio que llevó `/say` al tier
Administrador); bajarlo lo abría a moderadores. Con la mención masiva ya gateada aparte
(ver abajo), bajarlo a `ModerateMembers` sería seguro — no se hizo, queda como decisión
de producto pendiente.

Además: `/setup` rápido crea "Staff" con los permisos del tier Moderador de la matriz
(filtrados por los que tiene el bot — Discord rechaza crear un rol con un permiso que el
bot no tiene; un rol reusado nunca se toca); Co-Founder dejó de sugerirse como admin
(`tierHint: null`); `/owner-metricas` (`export const ownerGuildOnly = true`) se registra
solo en `GUILD_ID_DEV`, nunca global (`deploy-commands.js`); y dueño/`Administrator`
pasan `isStaff`/`isAdmin` sin rol — antes el dueño que recién corría `/setup` no podía
abrir `/staff`, su primer "próximo paso", sin asignarse el rol a mano. No amplía poder
real: `Administrator` ya podía darse el rol o apuntar `/config rol-admin` a uno suyo.
Solo en los wrappers con `interaction` — `isStaffFromRoleIds` (anti-spam, dashboard) no
cambió, así que el dashboard sigue sin mostrarle un servidor a un Administrator que no
es dueño ni tiene rol de staff.

**Mención masiva en `/anuncio` = tier Administrador (cerrado el mismo día).** `/staff`
(tier Moderador) abre el constructor de `/anuncio`, que tenía un toggle de @everyone:
cualquier moderador podía arrobar a todo el servidor pese a que `/say` ya era tier
Administrador (H4). Ahora `isAdmin()` se exige para @everyone **o un rol no mencionable**
(Discord tampoco deja arrobarlo a mano sin "Mencionar @everyone", y un rol que tiene
todo el mundo, como "Miembro", sería la misma puerta) en 4 lugares: abrir el
constructor con la opción ya prendida, el botón, el selector de rol, y el envío
(autoritativo). Rol mencionable queda libre. Sin efecto en servers que nunca separaron
los tiers (`admin_role_id == moderator_role_id`, lo que deja `/setup`).

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

**Catálogo de tienda: todo o nada.** `getGuildShopItems` (`shopStore.js`) devuelve el
catálogo de ejemplo de `shopItems.js` (19 ítems) SOLO si el server no tiene ni una fila
en `shop_items`. El primer ítem propio los reemplaza a todos (`/shop-admin` avisa con
"Tu servidor estaba usando el catálogo de ejemplo..."). Los ítems de ejemplo no se editan
de a uno porque no viven en la base. Y el efecto especial (`mystery_box`/`xp_boost`/
`rob_shield`) depende SOLO de `item.type`, que no se puede cambiar después de crear el
ítem. Pasó en producción: un ítem de prueba llamado `rob_shield`, sin tipo, dejó la tienda
del servidor principal con un único ítem que cobraba y no daba nada, y escondía los 19 de
ejemplo. Se borró el 2026-09-23; nadie lo había comprado. Desde entonces `/shop-admin`
avisa si el nombre sugiere un tipo especial y no se eligió ninguno
(`suggestSpecialType`). Ofrecer "copiar el catálogo de ejemplo a tu tienda" al crear el
primer ítem quedó como decisión de producto pendiente, no implementada.

## Gotchas ya pisados (además del de las columnas de cooldown, arriba)

**Emoji dentro de un canvas.** `@napi-rs/canvas` (usado hoy solo en `rankCardImage.js`;
antes también en `welcomeImage.js`, borrado el 2026-09-23) no tiene ninguna fuente de emoji de color disponible en el
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
  no hay un `GuildMember` de discord.js, solo el JSON crudo de la REST API. Para un
  guild SIN `guild_config` todavía (bot recién invitado, nadie corrió `/setup`) no hay
  roles contra los cuales comparar: solo el dueño real (`guild.owner_id`) lo ve, marcado
  como pendiente — ver "Dashboard — servidores sin /setup, barra de carga, skeleton y
  Manrope" más abajo.
- **Sesión propia con cookie firmada** (`dashboard/session.js`, HMAC-SHA256) en vez de
  `express-session`/`jsonwebtoken` — no hace falta un store de sesiones ni el resto de
  features de esas libs para guardar un solo dato (el user ID).
- **100% solo lectura**: ninguna ruta escribe en Supabase ni en Discord. Si en algún
  momento se necesita escritura (ej. resolver un warn desde el panel), es una decisión
  aparte con su propio análisis de permisos — no asumir que se puede extender directo.

**DASH-1, Fase 4B (2026-09-05) — de vitrina de métricas a algo que explica su propia
configuración.** Antes de esto, `checkGuildAccess()` ya leía `admin_role_id`/
`moderator_role_id` de `guild_config` para el chequeo de acceso pero los descartaba sin
mostrarlos nunca — el dashboard tenía la data a mano y jamás la usaba. Tres cambios,
todos de solo lectura sobre datos que ya existían:
- **Tarjeta "Configuración actual"** en la página de un servidor (`fetchGuildConfigSummary`
  en `queries.js`, un `select` explícito de columnas — no `select('*')`): roles admin/
  moderador, los 3 canales de log, módulos (moderación/XP), extras de `/setup`
  (bienvenida/confesiones/rol automático/rol de castigo). **"Economía" se muestra como
  "Siempre activa", no como un toggle ✅/❌** — `features.economia` se sacó hace tiempo
  porque nunca gateaba nada (ver el comentario de `setup.js`); mostrar un toggle falso
  hubiera sido peor que ser honesto sobre que no existe.
- **Aviso de "solo lectura" repetido en la página real del servidor**, no solo en el
  login — antes alguien que entraba directo por un link guardado nunca lo veía.
- **Invite link real** (`dashboard/html.js`, en el header de todas las páginas — login,
  lista de servers, y la página de un server puntual), armado con `config.clientId`
  (el mismo que usa `src/deploy-commands.js`). **A propósito sin bitmask de permisos en
  la URL** — en vez de adivinar qué permisos hacen falta (fácil de sub o sobre-estimar),
  se deja que la propia pantalla de consentimiento de Discord los pida al instalar.
- **Contacto de soporte** (`config.supportContact`, env var `SUPPORT_CONTACT`) en el
  mismo header, condicional — sin la variable seteada no se muestra nada, nunca un link
  inventado. Mismo campo se muestra en `/help`. **Sin valor real todavía** — es
  infraestructura lista, no un canal de soporte configurado de verdad.

## Sitio web (`website/`, Fase 4/5, 2026-09-11)

Landing + páginas de producto de NEXO (`/`, `/commands`, `/docs`, `/faq`, `/status`,
`/changelog`) — **4to proceso Express** sobre el mismo repo (bot, dashboard, y ahora
esto), server-rendered con template literals a mano, mismo criterio que `dashboard/`
(sin motor de templates, sin frontend framework: mayormente estático, no lo justifica).
Construido a partir de un prompt maestro de 44 secciones que pedía explícitamente "no
inventar funcionalidades" — la auditoría previa a escribir código (comandos reales,
categorías reales, stack real) es la razón de que casi todo acá derive del código en vez
de estar tipeado a mano.

**Por qué es MÁS aislado que el dashboard, no solo "otro servicio más".**
`website/config.js` a propósito NO importa `src/config.js` ni
`src/utils/errorReporter.js` — ambos exigen o usan `DISCORD_TOKEN`/
`SUPABASE_SERVICE_ROLE_KEY`. Un sitio de marketing público no tiene ninguna razón para
tener esos secrets en memoria: si mañana aparece una vulnerabilidad en una dependencia
de Express o del propio código de este proceso, el radio de daño queda acotado a "se
puede desfigurar la landing", nunca a "se filtró el token del bot o el acceso de
escritura a la base". Lo único que exige es `CLIENT_ID` (público, ya viaja tal cual en
la URL de invite) — `DASHBOARD_BASE_URL`/`SUPPORT_CONTACT`/`WEBSITE_BASE_URL` son
opcionales, con fallback honesto (el elemento que dependería de ellos simplemente no se
renderiza, nunca un dominio o contacto inventado). `/login` e "Iniciar sesión" no
reimplementan OAuth — enlazan al dashboard real; reusar, no duplicar.

**`/commands` no puede leer los comandos reales en el proceso siempre-vivo del sitio.**
Importar los 88 `SlashCommandBuilder` (como hace `src/deploy-commands.js`) arrastra
`utils/economyStore.js` y compañía hasta `src/supabaseClient.js`, que exige los secrets
de arriba — justo lo que este servicio no debe tener. Solución: `scripts/
generate-commands-data.js` (mismo mecanismo de import dinámico + `.toJSON()` que
`deploy-commands.js`, pero corrido a mano/en build con el `.env` completo) vuelca
`website/data/commands.generated.json`; el sitio, siempre corriendo, solo lo LEE
(`website/data/commands.js`, con `fs.readFileSync` en un try/catch — si el JSON no
existe todavía, `/commands` muestra "sin datos" en vez de tirar el proceso abajo).
**Correr `npm run website:generate-commands` de nuevo cada vez que se agregue/edite/
saque un comando** — si no, `/commands` queda desactualizado contra el bot real, el
mismo problema que tenía a mano el Artifact de landing viejo ("70+ comandos" cuando ya
eran 88, corregido acá de raíz). `website/data/features.js` (el grid de la landing)
deriva `commandCount`/`sampleCommands` de ESE MISMO JSON en vez de tener sus propios
números a mano — cierra el loop "código → fuente de verdad → web" en las dos
superficies a la vez, no solo en una.

**Categoría de "voz temporal" existe en la landing pero no en el filtro de `/commands`**
— es una feature 100% automática (Join to Create), sin comando propio (0 en el JSON
generado); un chip de filtro que siempre da "0 resultados" es peor que no mostrarlo.
`website/data/categories.js` es la única fuente de emoji/nombre por categoría —
reusados EXACTOS de los que ya usan `/help`/`/helpstaff` adentro de Discord, para que el
sitio nunca use un nombre de categoría distinto al que ve un usuario real del bot.

**`/changelog` sale de las fases reales documentadas en este mismo archivo (con fecha),
nunca de `git log` crudo ni de un número de versión inventado** — el repo no tiene tags
ni `CHANGELOG.md`, y `package.json` quedó fijo en `0.1.0` desde el primer commit pese a
~15 fases reales. `website/data/changelog.js` traduce esas fases a lenguaje de cliente
(nunca la jerga interna de la auditoría que las originó) y omite a propósito sistemas
que se agregaron y sacaron en la misma ventana (`/report`) — mencionarlos generaría más
confusión ("¿esto existe o no?") que valor.

**`/status` es deliberadamente honesto sobre qué puede medir y qué no.** Lo único 100%
en vivo es la plataforma de Discord (`discordstatus.com/api/v2/status.json`, API pública
sin auth — cacheada 60s en `website/data/discordStatus.js`); Bot/Dashboard/Base de datos
se muestran como "sin monitoreo público" con un pointer a `/estado` dentro de Discord,
en vez de fingir un semáforo verde que este proceso no tiene forma honesta de medir
(no tiene ni el token del bot ni acceso a Supabase, a propósito, ver arriba). Evaluar
más adelante si vale un endpoint público chico en el dashboard (que sí tiene esos
accesos) para que esta página sea 100% en vivo — no se hizo en esta fase.

**Sin logo real en todo el repo** (verificado: cero imágenes, solo 2 fuentes .ttf) — el
favicon es un SVG inline (wordmark "N", color de marca real `#7F5AF0`, el mismo que usan
los embeds del bot y el dashboard desde siempre — nunca un segundo color de marca
inventado). Las 2 fuentes Manrope de `src/assets/fonts/` (agregadas en su momento para
`@napi-rs/canvas`) se reusan tal cual vía `express.static` en `/fonts/*` — sin duplicar
archivos, solo para encabezados (`h1`-`h3`); el resto del texto usa la misma pila de
fuentes de sistema que ya usa `dashboard/html.js`, cero requests a Google Fonts. Desde
2026-09-19 el dashboard sirve estas mismas 2 fuentes desde su propio `/fonts/*` y las
usa igual (solo headings) — ver "Dashboard — servidores sin /setup, barra de carga,
skeleton y Manrope".

**Build en 2 sesiones el mismo día:** Fase 4 (landing completa) y Fase 5 (`/commands` +
`/docs` + `/faq` + `/status` + `/changelog`) se acordaron por separado vía
`AskUserQuestion` antes de escribir código — mismo patrón que
[[nexo_bot_phased_post_audit_workflow]] pero para un build nuevo, no un post-auditoría.
Una tercera pasada (autorizada por el usuario para trabajar sola mientras dormía, sin
deploy/dominio/git) fue QA duro, no cosmético — encontró y corrigió 3 bugs reales que
una revisión visual no agarra:
- **Contraste real bajo el mínimo WCAG AA**: `--text-dim` (`#756e91`) daba 4.14:1 contra
  el fondo y hasta 3.86:1 contra las cards (mínimo AA para texto normal: 4.5:1) — usado
  en textos chicos (badges, fechas, labels) que no califican para el umbral reducido de
  "texto grande". Corregido a `#837b9f` (medido con la fórmula de luminancia relativa de
  WCAG, no a ojo — 5.00/4.66/4.75:1 según fondo).
- **Salto de nivel de encabezados en TODAS las páginas**: los `<h4>` del footer y del
  sidebar de `/docs` son rótulos de navegación, no encabezados de contenido — pasaron a
  `<p class="footer-heading">`/`.docs-nav-title`. `/commands`, `/faq`, `/status`,
  `/changelog` no tenían NINGÚN `<h1>` (su título era `<h2>`) — cada página tiene ahora
  exactamente uno.
- Verificado con scripts propios (no a ojo): crawl de las 6 páginas sin links rotos,
  balance de tags en la página más pesada (`/commands`, 88 tarjetas), sintaxis del JS
  embebido, y 32 tests nuevos (`tests/websiteServer.test.js`,
  `tests/websiteData.test.js` — server real vía `node:http`, mismo patrón que
  `dashboardServer.test.js`).

**Actualización 2026-09-19 — desplegado.** Esta sección decía "deploy como 4to servicio
de Railway... a propósito no hecho sin el usuario presente" — ya se hizo. Railway se
upgradeó a plan pago (Hobby, $5/mes) el mismo día para sacar la fricción de free-tier
que venía frenando sumar servicios nuevos con comodidad. El website corre como 4to
servicio (`website-nexo-bot`, Start Command `npm run website`), en el subdominio
gratuito que da Railway (`website-nexo-bot-production.up.railway.app`) — **nunca hizo
falta comprar un dominio propio**, mismo esquema que ya usaba el dashboard.
`WEBSITE_BASE_URL` seteado en los 3 servicios (sitio, dashboard, bot). **Gotcha real
pisado en el deploy:** `website/config.js` solo hace `.replace(/\/$/, '')` sobre esa
variable — nunca valida ni agrega el esquema `https://`. La primera vez que se cargó sin
él, `/sitemap.xml` generó `<loc>` inválidos (URLs sin `https://`) en silencio, sin error
ni warning — se detectó leyendo el output real del sitemap, no por ningún log. Si
`WEBSITE_BASE_URL` alguna vez produce URLs rotas (sitemap, `<link rel="canonical">`),
revisar el esquema de la variable antes de sospechar del código.

QA visual en navegador real sigue sin poder hacerse desde el entorno de build (sin
herramienta de screenshot) — se verificó en cambio con `curl` real contra las URLs en
vivo (`/`, `/commands`, `/sitemap.xml`, `/legal/terminos`, `/legal/privacidad`, todas
`200`, contenido correcto). Compresión gzip sigue evaluada y descartada por ahora — sin
cambios ahí.

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
- **`shopItems.js`** es una plantilla en código con 19 ítems genéricos (sin `roleId`,
  para que funcionen sin configuración) — no el catálogo de gNoX, que tenía roles de
  color con IDs reales de un servidor específico. (Decía "4": ese era el número del
  principio y nunca se actualizó.)

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
- **Cambios visuales en `dashboard/`/`website/`:** no levantar el server real (pide login
  de Discord + sesión + Supabase real). Importar `layout()`/las funciones `render*` por
  `file:///` desde un script de una sola vez y embeber el HTML resultante en un
  `<iframe srcdoc>` dentro de un Artifact "harness" con toggles de página/ancho — ver la
  memoria `nexo_bot_dashboard_visual_preview_technique` (incluye cómo mostrar las fuentes
  reales y cómo disparar la barra de carga desde el preview).
- **Tocar datos de producción (auditorías, limpiezas):** los scripts de verificación son
  de solo lectura. No se sondea la existencia de una RPC haciéndole POST: una que modifica
  datos se ejecuta de verdad (el 2026-09-23 así se creó una fila real en `economy`, que se
  borró enseguida). Para eso está la raíz OpenAPI (`GET /rest/v1/`). Todo borrado pedido
  sigue este orden: respaldo JSON de las filas en el Escritorio, `DELETE` con el filtro
  más estricto posible, y un conteo posterior de lo borrado (→ 0) y de lo que tenía que
  quedar.
- **Respuestas libres de `AskUserQuestion`:** si el usuario escribe su propia respuesta en
  vez de elegir una opción, leerla literal y confirmar el alcance contra ella antes de
  implementar ("los iconos solo en dashboard y en website" era dashboard + website, no
  solo dashboard como decía la primera opción).
- **Pedidos vagos de mejora ("que sea más dinámico", "como lo que hicimos hoy"):** mandar
  UNA `AskUserQuestion` nombrando 2-3 superficies concretas ANTES de leer código o
  escribir un plan. El 2026-09-20 se entregaron dos planes largos de varias fases sobre
  el mismo pedido y los dos se rechazaron por su premisa, no por su contenido (el
  primero proponía features nuevas — prohibidas por el ciclo comercial vigente; el
  segundo asumía que "como lo del setup" significaba seguir con `/setup`, cuando el
  referente era el TIPO de trabajo). Un plan largo es además el formato equivocado para
  abrir: este usuario pide respuestas cortas.

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
seguro barato para el día que algo use el `anon key`.

**Corrección (auditoría completa NEXO, 2026-09-11, DOC-1):** esta sección decía que la
migración de RLS estaba "preparada pero sin ejecutar" — no existe ningún archivo
`migration_*.sql` con `enable row level security` en el repo, ni versionado ni perdido.
La afirmación nunca reflejó un archivo real. Si algún día se decide activar RLS, hay que
escribir esa migración de cero (18 tablas — o el conteo real de `schema.sql` al momento
de escribirla — con `enable row level security`, sin políticas todavía).

## Observabilidad — alertas operativas (`src/utils/errorReporter.js`, COM-1, Fase 4B)

Antes de esto, una falla real en un cliente (una excepción no capturada, un comando que
tira, un loop periódico que falla) solo dejaba rastro en `console.error` → logs de
Railway — nadie se enteraba salvo que alguien estuviera mirando los logs en vivo o el
cliente se quejara directamente. `reportCriticalError(client, context, error)` es la
única pieza nueva: manda un embed a un canal fijo de un servidor **propio de operación**
(nunca `guild_config` — esto es infraestructura interna, no una feature de cliente,
mismo criterio que tenía originalmente `lolPatchEngine.js`), configurado por la variable
de entorno opcional `OPERATOR_ALERT_CHANNEL_ID`. Sin esa variable, la función es un no-op
silencioso — no es un requisito de boot.

**Por qué REST directo y no `client.channels.fetch().send()`.** El bot (`src/index.js`)
y el dashboard (`dashboard/server.js`) son dos procesos separados — el dashboard no tiene
conexión de gateway. `reportCriticalError` manda el mensaje con un `fetch` plano a
`discord.com/api` (`Authorization: Bot <token>`, mismo token que ya usa
`dashboard/discordApi.js` para sus propias llamadas REST) para poder llamarse igual desde
los dos procesos — el parámetro `client` queda en la firma para los call-sites del bot
que ya tienen uno a mano, pero la función nunca lo usa; desde el dashboard se llama con
`null` sin ninguna diferencia de comportamiento.

**Throttle por huella, no por ocurrencia.** Un `Map` en memoria (mismo patrón
autolimpiante que `userUpdate.js`) evita que un error que se repite 500 veces mande 500
alertas — como mucho una alerta por combinación de `context`+`error.message`/`error.name`
cada 10 minutos. La huella incluye el `context` a propósito: el mismo tipo de error en
dos lugares distintos del código sí genera dos alertas separadas.

**Qué nunca incluye.** `redactSecretsInText` (`src/utils/secretDetector.js`, el mismo
detector que ya protegía el chat) se aplica al contexto, al mensaje y al stack antes de
mandarlos — si un error trae un token/secreto filtrado en su mensaje, llega redactado, no
crudo. No se manda ningún dato de usuario más allá de lo que el propio `context` decida
incluir (hoy: nombre de comando + guild ID, nunca username/tag/contenido de mensajes).

**Dónde está conectada:** `uncaughtException`/`unhandledRejection` (bot y dashboard, en
ambos casos esperando el intento de alerta antes de `process.exit(1)` — si no se espera,
el proceso corta la conexión de red a mitad de camino), el catch-all de comandos e
interacciones (`interactionCreate.js`), los 7 loops periódicos con estado propio
(`giveawayEngine`, `reminderEngine`, `punishEngine`, `voiceXpEngine`, `lolPatchEngine`,
`weeklyDigestEngine` y, desde la auditoría 2026-09-12, `logPurgeEngine` — el único que
había quedado afuera de esta lista desde que se agregó) y las 3 rutas del dashboard con
try/catch propio (`/`, `/auth/callback`, `/guild/:id`). Verificado en vivo contra un
canal de prueba real (Fase 4B): el envío llega, el throttle absorbe un segundo disparo
idéntico, y un error distinto sí pasa.

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

## /report — eliminado por completo (2026-09-10)

Decisión de producto: NEXO no va a tener sistema interno de reports. Operativamente
terminaba siendo un sistema parecido a tickets (estados, seguimiento, atención de staff)
— dirección en la que se decidió no seguir invirtiendo. Se eliminó el comando
(`src/commands/utilidad/report.js`), sus dos botones (`report_status_visto`/
`report_status_resuelto`), la categoría `report` de `getGuildLogChannel`
(`guildLogChannels.js`), el extra "Canal de reportes" de `/setup`, el subcomando
`/config canal-reportes`, el campo de reportes de `/config ver`, las referencias en
`/help`/`/helpstaff` y en el dashboard (tarjeta de configuración + `computeConfigIssues`),
y la columna `guild_config.report_channel_id` de `schema.sql` — **columna que sí llegó a
existir en producción** (verificado por API antes de tocar nada: el comentario
"MIGRACIÓN MANUAL PENDIENTE" que había quedado en `schema.sql` estaba desactualizado, la
migración de Fase 4C-1 se había corrido en algún momento sin borrar ese comentario; una
fila tenía valor real, `guild_id` `1182874699169017987`). `migration_2026_09_10_remove_
report.sql` (`alter table guild_config drop column if exists report_channel_id`) **ya se
corrió y está verificada** (2026-09-12, `GET guild_config?select=report_channel_id`
devuelve `42703 column does not exist` contra la base real) — se corrió después del
deploy del código, respetando el orden de siempre. No reintroducir sin un pedido explícito
nuevo — no es un hueco a rellenar. Las secciones "Fase 4C-1" y "Ciclo 2" más arriba
documentan `/report` tal como existió; quedan como historial, no como estado actual.

## Testing (Vitest)

`npm test` corre los tests de `tests/`. Todo lo que toca Supabase se mockea con
`tests/helpers/supabaseMock.js` (un builder encadenable y a la vez "thenable", para
cubrir tanto `select().eq().maybeSingle()` como `update().eq()` sin terminal explícito).
**Que ningún test le pegue a la base real no depende de que cada archivo mockee bien:**
lo garantiza `tests/setup/noLiveSupabase.js` (`setupFiles` de `vitest.config.js`), que
apunta `SUPABASE_URL` a un puerto local cerrado antes de que cargue `src/config.js`
(`dotenv` nunca pisa una variable ya definida). Hasta el 2026-09-23 esa garantía era solo
de palabra: `moderation.test.js` no mockeaba `moderationActionsStore.js`, y cada corrida
insertaba filas de ban/kick en `moderation_actions` de PRODUCCIÓN con la service_role key
del `.env` local (990 filas de `guild-1`/`mod-1` acumuladas desde el 2026-08-23). Un mock
faltante ahora falla en local con `ECONNREFUSED`, nunca llega a la base. Prioriza lo que rompe en silencio si falla: params
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

Estado al 2026-09-23: **128 archivos / 1316 tests**. **El "flaky" de `moderation.test.js`
tenía causa real, ya cerrada (2026-09-23):** los tests de confirmación de `/kick`/`/ban`
vencían a veces el timeout de 5000ms en la suite completa porque hacían un INSERT real de
red a Supabase de producción (ver arriba) — la latencia de red, no la carga de la suite.
Con el mock agregado el archivo corre en ~34ms de tests. Si vuelve a aparecer un timeout
intermitente en cualquier archivo, sospechar primero de una llamada de red real que el
guard ahora convierte en `ECONNREFUSED`. Cuando se agrega un export nuevo a un módulo que
un test mockea entero con `vi.mock(...)` (ej. `dashboard/discordApi.js` en
`dashboardQueries.test.js`), hay que sumarlo al mock: sin él el import a nivel de módulo
devuelve `undefined` y rompe todos los tests del archivo, no solo los del cambio.

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
Fase 2A): música, Pets, Premium/billing/landing. **Commit `85d2a35`, pusheado y
desplegado** (corregido 2026-09-12 — esta sección decía "sin commitear todavía", una
afirmación que llevaba días desactualizada; ver "Higiene de documentación — drift
CLAUDE.md vs git" al final de este archivo).

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

**Y nunca se limpia cuando un comando deja de existir** (verificado contra producción el
2026-09-23): `command_usage` sigue teniendo filas de `play` (54 usos), `pet` (8),
`report` (6) y `volume` (6) — 74 usos de 4 comandos eliminados en Fase 3B/3C y en la
baja de `/report`. `guildDelete.js` borra por `guild_id`, nunca por comando, y no existe
ningún barrido que compare la tabla contra `src/commands/**`. No es un bug (el histórico
es real, esos comandos se usaron de verdad). Desde el 2026-09-23 los dos rankings que
se muestran (`/metricas` y "Comando más usado" del dashboard) pasan por
`getTopLiveCommands(guildId, liveNames, limit)` de `commandUsageStore.js` — una sola
implementación, con 30 filas de margen para que los descartados no dejen el top corto.
El bot le pasa `client.commands`; el dashboard (sin gateway) el catálogo de
`website/data/commands.generated.json`, que ya se versiona y que `websiteData.test.js`
mantiene sincronizado con los archivos de comando. Catálogo vacío = no filtra. El total
("comandos ejecutados") queda histórico a propósito. Cualquier lectura directa nueva de
la tabla SÍ incluye comandos muertos — usar esa función. Al chequear si un comando sigue vivo, grepear
`setName('x')`, NUNCA el nombre de archivo: `/xp` vive en `moderacion/xpStaff.js`.

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
aparte) y Pets (se elimina después) — ninguna de las dos se tocó ni se optimizó.
**Commit `328ab61`, pusheado y desplegado** (corregido 2026-09-12 — decía "sin
commitear todavía").

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
`migration_2026_09_01_fase2c.sql`, **ejecutada y verificada en producción** — Fase 4A,
2026-09-04, confirmado por API contra `gmcqbvrqqpmcqjrbtauk`: ambas RPC existen, firma
correcta, devuelven resultado real con un guild con datos y `0`/`[]` con un guild
inexistente) — cero filas transferidas de más, mismo resultado. `getGuildFrequentReasons`/
`getGuildFrequentWarnReasons`
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

## Fase 3C — eliminación de Music/Spotify (2026-09-03)

Decisión de producto (no un bug ni una auditoría, mismo criterio que Fase 3B): Music no
forma parte del NEXO comercial — podrá renacer como proyecto aparte más adelante, pero
sale entero del bot principal. Alcance: 7 comandos (`src/commands/musica/`), 8 utils
exclusivos (`musicEngine.js`, `musicSessionStore.js`, `musicSource.js`,
`musicPermissions.js`, `musicEmbeds.js`, `musicVoiceState.js`, `spotifyResolver.js`,
`spotifyAuthStore.js`), 1 archivo de dashboard (`dashboard/spotifyAuth.js`), 8 tests
exclusivos, y 5 paquetes npm (`@discordjs/voice`, `@discordjs/opus`, `ffmpeg-static`,
`libsodium-wrappers`, `youtube-dl-exec`). **Commit `136c8a0`, pusheado y desplegado**
(corregido 2026-09-12 — decía "sin commitear todavía").

**Aislamiento confirmado antes de tocar nada** (mismo criterio que Fase 3A/3B: mapa de
dependencias primero, borrado después) — el sistema entero era autocontenido detrás de
9 puntos de contacto con código compartido: `voiceStateUpdate.js` (el hook de música
convivía como un `await` independiente junto al de salas temporales, nunca mezclado con
esa lógica ni con el logging de actividad), `ready.js` (chequeo de arranque de yt-dlp),
`config.js` (`spotifyClientId`/`spotifyClientSecret`), `rateLimiter.js` (categoría
`music`, usada solo por `/play`), `estado.js` (campo "🎵 Música" del embed de
diagnóstico), `help.js` (categoría "🎵 Música" del menú — la fila de botones baja de 2
a 1, las 5 categorías restantes ya entraban en una sola `ActionRow`),
`dashboard/server.js` (rutas `/spotify/authorize`/`/spotify/callback`) y
`dashboard/discordApi.js` (`fetchApplicationOwnerId`, exclusiva del gate de esas dos
rutas — sin otro caller en todo el repo, se eliminó junto con el cache en memoria que la
acompañaba), además de `.env.example`/`package.json`/`schema.sql`.

**Temporary Voice y XP por voz, deliberadamente intactos.** `voiceStateUpdate.js` tenía
TRES sistemas independientes conviviendo en el mismo handler (salas temporales, música,
logging de actividad) — se sacó únicamente el `await handleMusicVoiceStateUpdate(...)`
y su import; el resto del archivo (join-to-create, logging de join/leave/move/cámara)
quedó igual. `voiceXpEngine.js` nunca dependió de `musicSessionStore.js` — no se tocó.

**Aplicando la lección de Fase 3B: código primero, migración después.**
`migration_2026_09_01_remove_pets.sql` se había corrido antes de que el código
estuviera desplegado y dejó producción momentáneamente rota (`/work`/`/crime` rotos
hasta el commit+push+deploy de remediación, ver arriba). Acá el orden es explícito:
analizar dependencias → implementar → tests → diff → commit → push → deploy → verificar
producción → actualizar comandos de Discord → retirar env vars de Railway → **recién
ahí** `migration_2026_09_03_remove_music.sql` (`drop table if exists spotify_auth`, sin
FK/RPC/trigger que la referencien, verificado contra `schema.sql` completo) → verificar
la base. Ningún paso de base de datos corrió en esta fase — la tabla `spotify_auth`
sigue existiendo en producción hasta que se ejecute esa migración a mano, después del
deploy. `src/events/guildDelete.js` nunca la tuvo en `GUILD_SCOPED_TABLES` (fila única a
nivel bot, sin `guild_id` — mismo criterio que `lol_patch_state`), así que no necesitó
ningún cambio.

## Auditoría 3.0 + Fase 4A + Fase 4B (2026-09-04/05)

Con Pets y Música/Spotify ya confirmados afuera (Fase 3B/3C arriba), se corrió una
auditoría completa nueva desde cero ("Auditoría 3.0", mismo criterio de 8 agentes en
paralelo que las rondas anteriores) asumiendo esa base limpia — encontró 53 hallazgos
(2 P0, 15 P1, 27 P2, 9 P3), veredicto ALMOST READY. A diferencia de rondas anteriores,
acá el trabajo se partió en fases chicas y deliberadas en vez de "arreglar todo":

**Fase 4A — cerró los 2 P0.** `SEC-1`/`SEC-2`: `/warn` y el panel compartido de
confirmación (`confirmations.js`, usado por `/ban`/`/clear`/`/unwarn`/`/prestigio`)
interpolaban el `motivo` de staff en un `content` público sin `allowedMentions` — un
motivo con `@everyone` pingeaba al servidor entero. Fix: `allowedMentions: { parse:
['users'] }` en los dos puntos (preserva la mención real del usuario objetivo, bloquea
everyone/here/roles sin importar el texto). `DATA-1` (contradicción sobre si
`migration_2026_09_01_fase2c.sql` había corrido) se cerró **verificando en vivo contra
Supabase real** — las dos RPC existen y funcionan, la nota de la sección de Fase 2C de
arriba ya está corregida. 11 tests nuevos (433→444). **Commit `56951b3`, pusheado y
desplegado** (corregido 2026-09-12 — decía "sin pushear").

**Fase 4B — 9 de los 15 P1, elegidos a mano, no todos.** El resto (reaction-roles,
`/report`, tuning de economía por servidor, PERF-1, revisión legal) se evaluaron y se
dejaron para más adelante a propósito — ver el criterio de priorización en el informe de
la sesión si hace falta retomarlos. **Reaction-roles y tuning de economía por servidor
se implementaron el 2026-09-15** (ver "Plan de ejecución post-auditoría (parte 2)" más
abajo); `/report` se implementó y después se eliminó por completo (ver esa sección);
PERF-1 se cerró en la Fase 3 del primer plan de ejecución post-auditoría; revisión legal
sigue pendiente. Lo que sí se implementó acá en su momento: el modelo de permisos de 3
tiers (`isAdmin()`, ver sección "Permisos" arriba) y la alerta operativa
(`reportCriticalError`, ver sección "Observabilidad" arriba) — las dos piezas grandes,
ya documentadas en detalle en sus propias secciones — más: cooldown en `/confession` y
`/give` (mismo patrón que `/encuesta`, 2 min por guild+usuario), el dashboard mostrando
configuración real + link de invite + contacto de soporte (ver "Dashboard web" abajo), y
las dos coberturas de test que faltaban de dinero/acceso (`casinoHelpers.js`, y el
primer test HTTP real de `dashboard/server.js`, con servidor `node:http` real y cookies
de sesión reales — el `app` exportado existía desde Fase 1 para esto exacto pero nadie
lo había usado). 66 tests nuevos (444→510). **Ya commiteado y pusheado** (corregido
2026-09-12 — decía "sin commitear", working tree pendiente de revisión; el commit real
terminó siendo parte de la serie que llegó a `main` en los días siguientes).

**Corrección de documentación:** la nota de Fase 2C sobre `migration_2026_09_01_fase2c.sql`
decía "preparada, no ejecutada" — era información vieja. Ya corregida (ver esa sección).

## Fase 4C-1 — product foundation: onboarding, reportes, permisos, posicionamiento (2026-09-05)

Distinta de las fases anteriores: la auditoría de Fase 4C (producto, no código) encontró
que NEXO es técnicamente sólido pero el cuello de botella real para un primer cliente es
"instalo el bot → no sé qué hacer" — nada de esto es un bug. Alcance deliberadamente
chico y quirúrgico (4 mejoras puntuales, nada de IA/Premium/monetización/sharding/
reescrituras): `/report`, onboarding posterior a `/setup`, guía + detección de permisos,
y posicionamiento del producto. **Ya commiteado y pusheado** (corregido 2026-09-12 —
decía "sin commitear todavía"; `botPermissions.js` y el onboarding de `/setup` están
confirmados en el `main` actual).

**`/report` — reutiliza infraestructura existente, no un sistema paralelo.** Cualquier
miembro puede reportar un usuario, un mensaje (link completo o ID de este canal) o una
situación (con solo el motivo, los otros dos campos son opcionales). Cooldown de 60s por
guild+usuario, mismo patrón de `Map` autolimpiante que `POLL_COOLDOWN_MS` de
`encuesta.js` — más corto que los 2 min de encuesta porque `/report` es ephemeral (no
genera contenido público que pueda llenar un canal), pero sigue necesitando un piso.
`getGuildLogChannel(client, guildId, 'report')` (columna nueva `report_channel_id`,
sumada a `CATEGORY_COLUMN` de `guildLogChannels.js` junto a `moderation`/`activity`/
`economy`) resuelve el canal; si el servidor no lo configuró, cae a `'moderation'` — el
canal de logs de moderación YA existe en casi cualquier server que corrió `/setup`, así
que `/report` funciona de entrada sin exigir una segunda configuración antes de que el
staff pueda recibir algo. Si ninguno de los dos existe, se lo dice claro al usuario
(nunca un falso "reporte enviado" sobre algo que no llegó a ningún lado). Un link de
mensaje de OTRO servidor se rechaza (comparación de guildId) — nunca se resuelve un
mensaje fuera de este guild. Mensaje borrado/inaccesible: el reporte sigue igual, solo
sin poder mostrarle el contenido al staff (el link queda igual). Quién reporta es
SIEMPRE `interaction.user` — no hay ningún campo que un usuario pueda completar para
falsificar el origen, Discord ya autenticó la interacción.

**`report_channel_id` — campo nuevo, no reuso forzado.** Se evaluó reusar
`log_channel_moderation_id` como ÚNICO destino (ya es staff-only y ya existe) en vez de
sumar una columna — se descartó porque mezclar el audit trail automático (bans/warns ya
aplicados) con reportes pendientes de revisar los enterraría entre logs de acciones ya
resueltas, exactamente lo que la propia auditoría pedía evitar ("que llegue de forma
clara"). El campo es opt-in con fallback (no exige reconfigurar nada) — mismo criterio
que `lol_announce_channel_id`. Migración manual pendiente documentada en `schema.sql`
(`alter table guild_config add column if not exists report_channel_id text;`) — sin
correr todavía, a propósito (ver el gotcha "código antes que el DROP/ALTER", más abajo en
este archivo — acá aplica en la dirección de ALTER ADD COLUMN, mismo criterio de orden).
`/setup` ganó un 5to extra opt-in ("Canal de reportes", crea `#reportes` staff-only,
apagado por defecto como los otros 4) y `/config canal-reportes` apunta a uno ya
existente — mismos dos caminos que ya tenían bienvenida/confesiones/castigo/autoRol.
Dashboard: se agregó a la tarjeta "Configuración actual" (`fetchGuildConfigSummary` +
`configCard` en `views.js`), mismo patrón que el resto de los canales — el dashboard
sigue siendo 100% solo lectura, esto no le agrega ninguna escritura.

**Onboarding de `/setup` — mismo embed final, más contenido, no más comandos.** El título
pasa de "✅ Nexo Bot configurado" a "✅ NEXO está listo" (test `setupRoleSafety.test.js`
actualizado — no es el foco de ese test, que valida que el flujo no queda a mitad de
camino). Se suma UN campo nuevo, "🚀 Próximos pasos", con comandos que existen de
verdad y condicionales al estado real elegido en el panel (`/nivel` solo si `state.xp`,
`/report` solo si `state.moderacion || state.reportes` (cualquiera de los dos le da un
destino real al reporte) — no tiene sentido recomendar probar algo que el propio admin
acaba de dejar apagado). El link al dashboard (`/guild/:id`, la ruta real de
`dashboard/server.js`) solo aparece si `config.dashboardUrl` está seteado — nunca una URL
inventada. Sigue siendo un solo embed, no una segunda pantalla.

**`config.dashboardUrl` — mismo nombre de variable en dos servicios, a propósito.**
`dashboard/config.js` ya EXIGE `DASHBOARD_BASE_URL` para arrancar ese proceso; el bot
(`src/config.js`) ahora también la lee, pero opcional (`|| null`, mismo criterio que
`supportContact`) — el bot no la necesita para nada más que mostrarle el link al admin en
el onboarding. Se reusó el mismo nombre de variable en vez de inventar uno nuevo para el
mismo valor conceptual — hay que configurarla en AMBOS servicios de Railway (son
procesos separados con sus propias variables, ver "Railway topology"), documentado en
`.env.example`.

**Guía y detección de permisos — `src/utils/botPermissions.js`, un solo archivo chico.**
`ESSENTIAL_BOT_PERMISSIONS` es la lista curada (12 permisos) verificada contra el código
REAL de este repo, no inventada: `ManageChannels`/`ManageRoles` los ejerce `/setup` al
crear canales/roles, `ManageMessages` lo usan `/clear`/`/lock`/el filtro de sancionados/
la detección de secretos, `KickMembers`/`BanMembers`/`ModerateMembers` son `/kick`/
`/ban`+`/unban`/`/timeout`, `MoveMembers` ya lo chequeaba `voice.js` a mano para las
salas de voz temporales (mismo patrón, generalizado — `voice.js` no se tocó, sigue con
su propio chequeo ad-hoc), `AttachFiles` las tarjetas de bienvenida/nivel.
Deliberadamente AFUERA: `ViewAuditLog` y `MentionEveryone` (ya degradan solo sin romper
nada, ver comentario del archivo). Tres puntos de uso de la MISMA lista, ninguno
duplicado:
1. `/setup`, al final del panel — si falta algo esencial, un campo "⚠️ Permisos
   faltantes" en el mismo embed de onboarding.
2. `/estado` — mismo chequeo disponible en cualquier momento (ej. un permiso sacado por
   accidente reordenando roles DESPUÉS de `/setup`, que antes no tenía ninguna forma de
   notarse hasta que algo fallaba solo en producción).
3. El link de invite del dashboard (`dashboard/html.js`) ahora lleva
   `permissions=essentialPermissionsBitfield()` — antes no llevaba NINGÚN permiso
   pre-tildado a propósito ("que la pantalla de consentimiento de Discord decida"); la
   auditoría de producto encontró que eso es justo lo que hacía fácil destildar sin
   querer algo que el bot necesita. Discord igual deja desmarcar cualquiera ahí, esto solo
   mejora el default — no se volvió obligatorio ni se le pidió más scope de OAuth al
   dashboard.
`/helpstaff` → "🩺 Bot" lista los 12 permisos por nombre + referencia a `/estado`. No se
tocó el dashboard para detectar permisos del lado del panel — requeriría calcular el
permiso efectivo del bot vía REST (roles + overwrites) sin un `Client` de discord.js a
mano, más trabajo del que vale para esta fase ("pequeño, reutilizable y mantenible", no
un sistema de diagnóstico grande); `/estado` y `/setup` ya cubren esto gratis porque
discord.js calcula `guild.members.me.permissions` solo.

**Posicionamiento — mismo patrón de texto en 3 lugares, ninguno inventa una feature
nueva.** "NEXO es la plataforma para administrar y hacer crecer tu comunidad de Discord —
moderación, economía, progresión y herramientas de gestión, todo en un solo lugar" se
repite (con la misma redacción, no reinventada cada vez) en: la descripción de
`buildMainMenuEmbed` de `/help` (lo primero que ve cualquier miembro), la del selector de
plantilla de `/setup` (lo primero que ve un admin instalando) y la intro de `README.md`.
`package.json` (`description`) se actualizó en la misma línea. Deliberadamente NO
tocado: `dashboard/views.js` (`renderLoginPage`) — su subtítulo actual ("Solo lectura:
actividad, economía y moderación...") describe con precisión el alcance REAL del
dashboard (que sigue siendo 100% solo lectura); reescribirlo con el lenguaje de
"plataforma integral" ahí exageraría lo que esa pantalla puntual hace. `helpstaff.js`
tampoco — el staff ya conoce el producto, ese texto es de navegación, no de
presentación.

## Ciclo 2 — implementación real de hallazgos de Auditoría 3.0 (2026-09-09/10)

A diferencia de las fases anteriores (auditoría → triage → una fase acotada), acá se
tomó una lista ya cerrada de 11 hallazgos ya investigados (concurrencia de `/give`,
`rob_shield` inalcanzable en tienda custom, recovery de Temp Voice, consistencia del
dashboard, confirmación faltante en `/sanciones`, semántica de error de `/crime`,
discoverability de `/helpstaff`, mensaje de diagnóstico de rol de staff, micro-cleanup
de `guildMemberAdd.js`, estado de `/report`, digest semanal) y se implementaron los 11
en el mismo tramo de trabajo, sin volver a auditar entre bloques. **Ya commiteado y
pusheado** (commits `3631224`/`fd7c535`/`80867be`, confirmados ancestros de `main` —
corregido 2026-09-12, decía "sin commitear todavía") — acá solo se documentan las dos
piezas con una decisión arquitectónica real detrás; el resto son fixes puntuales que el
propio diff explica.

**`/give` — el cooldown ya existía (Fase 4B), lo que faltaba era el lock.** Tener un
`Map` de cooldown no alcanza si el read-check-write no está serializado: dos `/give`
del mismo emisor casi simultáneos podían leer el mismo cooldown vencido antes de que
ninguno de los dos lo actualizara. Mismo patrón que `/daily`/`/work`/`/crime`/`/rob`
— `withLock('give:{guild}:{sender}')`, con un pre-check fuera del lock solo por UX
(responder rápido) y la revalidación real DENTRO, justo antes de recién ahí marcar el
cooldown. `transferBalance` en sí ya era atómico (RPC) desde antes — lo que faltaba
serializar era el cooldown, no la transferencia.

**`/report` — estado (Pendiente/Visto/Resuelto) vive en el propio mensaje de Discord,
nunca en Supabase.** Antes era un buzón muerto: llegaba al canal de staff y ahí
terminaba, sin señal de si alguien lo había atendido. En vez de una tabla nueva (el
pedido explícito era evitarla salvo estrictamente necesario), el campo "Estado" del
embed + 2 botones (`report_status_visto`/`report_status_resuelto`, staff-only vía
`isStaff()`) cargan y persisten el estado en el mensaje mismo — un mensaje de Discord ya
sobrevive un restart del bot solo, y `registerButtonPrefix` se re-registra en cada boot,
así que "persistir después de un restart" queda resuelto sin ninguna infraestructura
nueva. Cada click relee `interaction.message.embeds[0]` fresco (nunca un estado
cacheado) y reconstruye los 2 botones desde cero en vez de reusar
`interaction.message.components` (mismo criterio que el resto del proyecto: `.update()`
arma sus componentes de cero). Sin lock entre clicks — dos staff cambiando el estado
casi al mismo tiempo es un "último click gana" (no hay corrupción de datos posible,
`withEstadoField` solo reemplaza el campo "Estado" sin tocar el resto), aceptado porque
esto es coordinación interna de staff, no una acción con consecuencia sobre un usuario.

**Digest semanal — barrido sobre `guild_config`, mismo patrón que `lolPatchEngine.js`,
nunca un scheduler nuevo.** Opt-in por servidor (`/config digest-semanal`,
`weekly_digest_enabled` + `weekly_digest_last_sent_at` epoch ms — mismo criterio que las
columnas de cooldown). `src/utils/weeklyDigestEngine.js` corre cada 1h (guardia
`tickRunning` contra solapamiento, mismo patrón que `voiceXpEngine.js`) y, por cada
guild opt-in, manda un resumen de `guild_daily_stats` (7 días) a
`log_channel_activity_id` SOLO si ya pasó una semana desde el último envío.
`weekly_digest_last_sent_at` avanza recién DESPUÉS de un `send()` exitoso — sin canal
configurado o con un envío fallido, el guild se reintenta solo en el próximo tick, sin
duplicar ni perder nada. Restart-resistente sin reprogramar nada (a diferencia de
sorteos/recordatorios/restricciones): no hay ningún `setTimeout` puntual que reconstruir
al arrancar, cada tick vuelve a leer el estado real de Supabase. Al activar el digest se
siembra `weekly_digest_last_sent_at = ahora` (nunca queda `null` mientras está activo)
para que el primer envío real, 7 días después, refleje una semana completa en vez de un
resumen parcial de actividad de antes de que el server hubiera optado por recibirlo.

**`migration_2026_09_10_cycle2.sql`** (las 2 columnas de arriba) — corrida contra
producción el 2026-09-10 y verificada por API (`guild_config` ya devuelve
`weekly_digest_enabled`/`weekly_digest_last_sent_at`), **antes** de que el código de
este ciclo esté commiteado/pusheado/desplegado — a diferencia del orden que pide el
gotcha de DROP/ALTER más abajo. Sin riesgo real acá porque es un `add column`
aditivo con default: el bot ya desplegado no las conoce ni las consulta, así que
quedan inertes (sin efecto visible) hasta que el código de `weeklyDigestEngine.js`/
`/config digest-semanal` se despliegue — a diferencia del DROP de Pets (2026-09-01),
que sí rompió comandos en vivo porque el código viejo SÍ dependía de lo que se borró.

## Dependencias — CVE de `qs` cerrada sin acción (2026-09-12)

`npm audit` marca una vulnerabilidad moderada en `qs` (2.2.5-6.15.3, llega vía
`express@5.2.1 -> body-parser@2.3.0 -> qs` y directo desde `express`) — investigada, no
explotable en este código: ni `dashboard/server.js` ni `website/server.js` llaman
`express.json()`/`express.urlencoded()`, así que `body-parser`/`qs` nunca procesan un
body de request real; y Express 5 ya cambió su parser de query strings por defecto de
`qs` a `simple`. **No reabrir este hallazgo en la próxima auditoría sin evidencia
nueva** (ej. que alguna ruta empiece a usar esos middlewares). `@napi-rs/canvas`/
`@supabase/supabase-js` actualizados a última patch/minor el mismo día; `dotenv` ya
estaba en el último patch de la 16.x (la 17.x es un major, no se saltó sin revisión);
`vitest` se queda en 4.x a propósito — la 5.x cambia el default de `clearMocks` a
`true` y saca `test.sequential`, cambios que ameritan una ventana de revisión de tests
dedicada, no un bump de rutina.

## Sharding — no hace falta todavía (2026-09-12)

La auditoría de readiness operacional marcó "sin sharding ni documentación de failover"
como riesgo — investigado contra el límite real de Discord: sharding es **obligatorio**
recién arriba de 2500 servidores por shard (no una recomendación temprana). NEXO está
lejos de ese umbral. Decisión: no implementar nada todavía — es trabajo real (Railway no
lo hace solo, hay que particionar el proceso) que no aporta nada por debajo del límite.
Revisar esto de nuevo cuando el bot se acerque a ese número de servidores, no antes.

## Plan de ejecución post-auditoría — Fases 1-4 (2026-09-12)

A partir de "Auditoría NEXO II" (hallazgos qué-falta/bien/más-o-menos/riesgo +
posicionamiento competitivo) se armó un plan de ejecución ordenado en fases, distinto de
"arreglar todo lo que salió" — con un ajuste explícito del usuario a mitad de camino:
**las decisiones de producto puramente reversibles (sin bug funcional real detrás) NO
se implementan solas, quedan pendientes hasta que el usuario decida.**

**Fase 1 (quick wins):** 5 colores corregidos contra el sistema semántico de
`embeds.js` (H1-H5) — `/nivel` BRAND→GOLD, `/roles` informacion BRAND→MAGENTA,
`/encuesta` cerrada y `/say`/`/confession` (×2) con hex hardcodeado → `NEUTRAL_COLOR`/
`INDIGO_COLOR`. `actionCommandFactory.js` sumó `.catch(() => {})` al `editReply` de
error (estándar de Fase 2B). `@napi-rs/canvas`/`@supabase/supabase-js` a última
patch/minor.

**Fase 2 (concurrencia + UX):** `/recordatorio crear` bajo `withLock` — el chequeo de
"10 activos" y la creación no estaban serializados, mismo bug class que `/give` antes
de su fix. `/info` reusa `joinWithOverflow` (antes cortaba a los primeros 15 en
silencio). Los 3 botones de acceso rápido de `/help` (perfil/servidor/avatar) pasan a
ephemeral — posteaban público pese a que `/help` entero ya es ephemeral (H3).
Descartado explícitamente (decisión de producto pendiente, no bug): unificar la
categoría de minijuegos entre `/staff` y `/help` (`/help` mezcla minijuegos con
comandos sociales bajo un color, recolorear entero sería incorrecto para esos otros
comandos), el color combinado de "Sorteos y anuncios" en `helpstaff.js`, y la
visibilidad de `/vender` vs `/buy`.

**Fase 3 (PERF-1, confirmado 100% sin resolver por la auditoría):** las 4 queries que
traían la tabla ENTERA de un server para reducirla a un top-N/conteo en JS —
`xpStore.getRank` (ahora 2 queries chicas: fila propia + COUNT), `xp/ranking.js` y
`economia/leaderboard.js` (paginación real en backend vía `getGuildXpPage`/
`getGuildEconomyPage`, COUNT + `range()`, nunca la tabla completa) y
`warnsStore.getGuildWarns` (reemplazada para su único caller, el panel `/sanciones`, por
`getGuildWarnCounts` — RPC `get_guild_warn_counts`, GROUP BY + `count(*) over()` para el
total real, mismo patrón que `top_guild_achievers` de Fase 2C).
`migration_2026_09_12_perf1_warn_counts.sql` corrida y verificada en producción.

**Fase 4 (riesgos puntuales):** `/say` sube de Tier 1 (moderador) a Tier 2
(`isAdmin()`) — cualquier moderador podía pingear `@everyone` con texto libre sin
fricción extra (H4), mismo criterio que `/economia-staff`/`/xp`; `helpstaff.js`
actualizado para que un Tier 1 no piense que puede usarlo. `/roles` — el riesgo teórico
de tamaño de embed (H6) se cerró por matemática, no por código: 5 categorías × ~1024
chars máx + título/footer nunca supera los 6000 totales de Discord, el guard por-campo
que ya existía alcanza. `describeError()` (traducción de códigos de error de Discord,
antes exclusiva a los ~15 comandos de `moderacion/`) se extiende a `/setup` — crea
canales/roles reales, y un admin instalando el bot por primera vez se merece saber QUÉ
falló si al bot le falta un permiso, no un "probá de nuevo" genérico (H10).

## Plan de ejecución post-auditoría — Fase 5: legal + observabilidad (2026-09-12)

**Legal (H5-2/H5-3, "sell this week" según Fase 4B):** ToS y Privacidad dejaron de ser 2
artifacts privados de claude.ai (nadie fuera de esta cuenta podía abrirlos) para ser
páginas reales del sitio (`website/pages/legal.js`, rutas `/legal/terminos` y
`/legal/privacidad`, mismo patrón que `/docs`/`/faq`) — contenido migrado del texto que
ya existía, con **una corrección real de fondo**: la Política de Privacidad prometía
"borrado de tus datos en un servidor puntual" como si fuera autoservicio; el código
(`guildDelete.js`) solo borra un servidor ENTERO cuando el Bot es expulsado — no existe
ningún mecanismo de autoservicio para que un usuario puntual borre sus propios datos
dentro de un server que sigue activo. Corregido para describir exactamente eso: borrado
de servidor completo es automático, borrado de un usuario puntual es manual/a pedido.
El dashboard (H5-3, no tenía NINGÚN link legal) linkea al sitio real vía
`config.websiteUrl` (`src/config.js`, mismo nombre de variable `WEBSITE_BASE_URL` que
`website/config.js` ya usaba — un valor conceptual, cada servicio de Railway con su
propia copia, mismo criterio que `dashboardUrl`) — condicional, nunca una URL inventada;
el footer entero desaparece si ni `SUPPORT_CONTACT` ni `WEBSITE_BASE_URL` están
configurados, en vez de quedar vacío con solo el borde superior.

**Segunda corrección real de fondo (2026-09-19), encontrada al preparar el sitio para
los primeros clientes reales, no por una auditoría pedida.** `/confession` se vende como
"anónima" — pero `confession.js` manda SIEMPRE (no solo cuando el server pide revisión
previa) un log al canal de moderación con el tag + ID reales del autor
(`{ name: 'Autor real', value: ... }`), que recién se autoborra a los 5 días vía
`logPurgeEngine.js` (`RETENTION_MS`, canal `moderation` incluido en `LOG_CATEGORIES`).
Nunca queda en la base de datos — vive solo como mensaje de Discord con fecha de borrado
real — pero durante esos 5 días cualquier staff con acceso a ese canal puede ver quién
mandó cualquier confesión, y la Política de Privacidad no lo decía en ningún lado.
Corregido el TEXTO (`website/pages/legal.js`), nunca el comportamiento — la feature en sí
es razonable (el staff necesita poder frenar abuso), el problema era la falta de
disclosure. Se sumó también `confession_blocked_ids` (persistido en `guild_config`) a la
lista de datos procesados, que faltaba.

**Observabilidad cross-guild (toda la analítica existente es estrictamente por-guild):**
`bot_guild_events` (migración `migration_2026_09_12_owner_metricas.sql`, tabla mínima:
`guild_id`+`event_type` 'join'/'leave'+`created_at`) registrada desde `guildCreate.js`/
`guildDelete.js` (best-effort, nunca bloquea el mensaje de bienvenida ni la limpieza
real de datos). **Deliberadamente AFUERA de `GUILD_SCOPED_TABLES`** — al contrario que
el resto, el valor de esta tabla es justamente conservar el historial de churn incluso
(sobre todo) cuando un guild se va; borrarla en `guildDelete.js` destruiría el dato que
existe para preservar.

`/owner-metricas` — el ÚNICO comando cross-guild del proyecto (ve datos de TODOS los
servidores, no de uno puntual): total de guilds activos (`client.guilds.cache.size`,
en memoria, sin costo) + altas/bajas de 7 y 30 días. Gate por **identidad real**
(`src/utils/botOwner.js`, `isBotOwner()` vía `GET /oauth2/applications/@me`), nunca por
`isStaff()`/`isAdmin()` de un guild puntual — cualquier admin de un server de cliente
pasa esos dos, y jamás debería poder ver el conteo total de servidores del bot. Mismo
gotcha ya documentado arriba para Spotify: NEXO está bajo un **Team** de Discord, así
que el dueño real está en `team.owner_user_id`, no en `owner.id` (eso sería el team).
Cacheado 5 min para no pegarle a la API de Discord en cada invocación. **Deliberadamente
NO mencionado en `/help` ni `/helpstaff`** — publicitar una herramienta que el 99.9% de
quien la vea jamás va a poder pasar el gate solo genera confusión, mismo criterio que el
reset manual de `lolPatchEngine.js` (existe, funciona, no se promociona).

**Fuera de esta fase, a propósito:** upgrade de Supabase a plan Pro (backup diario) —
acción de negocio/facturación, no de código, queda para que el usuario la haga
directamente en el dashboard de Supabase.

## Auditoría intensa + Fases 1-5 de fixes (2026-09-12, segunda ronda)

Pedido explícito del usuario ("auditoría intensa, revisá que todo esté bien") DESPUÉS
de la Fase 5 post-auditoría del mismo día — no una continuación de esa fase, una
repasada completa nueva desde cero, mismo playbook de
[[nexo_bot_audit_methodology]]: 7 agentes generales en paralelo, un dominio propio cada
uno (economía, moderación/permisos, eventos/engines, dashboard+sitio, integridad de
datos/schema, testing/infra/docs, higiene de git), solo lectura, con un hallazgo de
calibración ya verificado a mano como estándar de evidencia. A diferencia de rondas
anteriores, esta vez el usuario pidió armar un plan de fixes y ejecutarlo en el mismo
tramo (no quedó como "solo investigación, fase de fix aparte").

**Autocorrección real en el medio del proceso — documentada porque es la prueba de que
el método funciona, no para esconderla.** Antes de lanzar los 7 agentes, encontré 2
worktrees de git abandonados en `.claude/worktrees/agent-*` y concluí, mal, que
contenían una rama nunca mergeada con roles autoasignables perdidos — leí mal mi propio
`git branch --contains 0bf35f9` (literalmente decía `* main` en el output y lo pasé por
alto). El agente del dominio de higiene de git lo detectó de forma independiente y me
corrigió: el commit YA era ancestro de `main`, `selfRoles.js` ya vive en producción
(vía `/staff`, commit posterior `6880ad1`), y los worktrees eran solo basura operativa
de una sesión de agente vieja nunca limpiada con `git worktree remove`. **Regla para no
repetirlo:** antes de citar `git branch --contains <sha>` como evidencia de "rama nunca
mergeada", leer la lista completa línea por línea — si `main` aparece ahí, es lo
opuesto de huérfano.

**Impacto real y medible de esos worktrees, más allá del error de lectura:** no existía
`vitest.config.js`, así que `npx vitest run`/`npm test` escaneaban también esos 2
worktrees (148 archivos de test duplicados/desactualizados de ellos), inflando el
conteo que la Fase 5 de ese mismo día reportó como "2251 tests" — el número real,
verificado con y sin los worktrees, es **1001 tests / 109 archivos**. Se agregó
`vitest.config.js` (`exclude: [...configDefaults.exclude, '.claude/**']`) y se
sumó `.claude/` al `.gitignore` versionado (antes solo lo ignoraba
`.git/info/exclude`, local y no portable a un clon nuevo). Los 2 worktrees y sus
branches (`worktree-agent-*`) se borraron con `git worktree remove` + `git branch -d`
— seguro al 100%, `-d` (no `-D`) confirmó que ya estaban mergeados.

**Drift de documentación — ≥7 secciones de fase de este mismo archivo (2B, 2C, 3C, 4A,
4B, 4C-1, Ciclo 2) afirmaban "sin commitear todavía"/"sin pushear"** cuando, verificado
con `git merge-base --is-ancestor <hash> main`, los commits reales ya eran ancestros de
`main` (al día con `origin/main`). Causa raíz: cada fase se documentó al escribir el
código, antes del commit real, y la frase nunca se actualizó cuando el commit
efectivamente ocurrió en una sesión posterior. Las 7 secciones ya llevan el hash real
confirmado — buscar "corregido 2026-09-12" en cada una. **Por qué importa más que un
typo:** una afirmación de "sin commitear" vieja puede hacer que una sesión futura evite
tocar un archivo pensando que hay cambios sin revisar debajo, o commitee de nuevo algo
que ya está en `main`. Regla: verificar contra `git log`/`git merge-base
--is-ancestor` antes de citar el estado de commit/push de cualquier fase como un hecho
actual, nunca confiar en el texto.

**18 hallazgos reales + 1 riesgo arquitectónico, 0 P0.** El más grave (P1, ver sección
"Permisos" arriba): `/shop-admin` gateado con `isStaff()` en vez de `isAdmin()` — un
tercer camino hacia dinero sin límite que PERM-1 no había cubierto. El resto,
implementado en 5 fases el mismo tramo:

- **Fase 1 (dinero + exposición de datos):** `/shop-admin` → `isAdmin()` + piso de
  precio (`price >= MAX_MYSTERY`, exportada desde `buy.js`) para un ítem
  `mystery_box` nuevo o editado — defensa en profundidad aunque ya no sea explotable
  por Tier 1. `/unwarn`/`warnEditar.js`: `autocomplete()` ahora exige `isStaff()` antes
  de devolver los motivos reales de advertencias de un usuario — antes, un rol con el
  permiso nativo `ModerateMembers` de Discord (dado vía Integraciones, sin cargarlo en
  `guild_config`) podía leerlos sin poder ejecutar el borrado real.
- **Fase 2 (cobros parciales en `/buy`):** el rollback de Fase 2B (revertir cobro si
  falla la entrega) solo cubría el caso de rol borrado. Generalizado con un try/catch
  exterior a las 4 ramas (`mystery_box`/`xp_boost`/`rob_shield`/ítem normal) — un fallo
  de red de Supabase DESPUÉS de cobrar ya no deja al usuario pagado sin nada.
  `/daily`/`/work`/`/weekly` ahora guardan el cooldown ANTES de acreditar la
  recompensa (mismo orden que `/crime`, que ya lo hacía bien) — antes, un fallo de red
  entre las dos escrituras podía dejar acreditado sin el cooldown persistido, abriendo
  una ventana de doble cobro.
- **Fase 3 (observabilidad menor):** `logPurgeEngine.js` conectado a
  `reportCriticalError` — era el único de los 7 loops periódicos sin alerta operativa
  (ver la lista corregida en "Observabilidad" arriba: son 7, no 5).
  `punishEngine.revokePunishment` marca el error con `.partialRevoke = true` si
  `roles.remove()` falla después de borrar el estado interno — `/unpunish` ahora avisa
  explícito "se limpió el registro interno pero no se pudo quitar el rol" en vez del
  genérico de siempre. Recompensa de XP de misión pasa `source: 'mission'`
  (`missionsStore.js`) → `economyOrigins.js` la clasifica `'reward'`, cerrando del lado
  de XP el mismo hueco que su análoga en monedas ya cerraba.
- **Fase 4 (dashboard/sitio):** `commands.generated.json` regenerado (faltaban
  `/staff` y `/owner-metricas`, generado el día anterior a que se commitearan) + un
  test nuevo (`websiteData.test.js`) que compara `COMMANDS.length` contra el conteo
  real de archivos y falla si vuelve a desactualizarse. `website/server.js` ahora usa
  `dashboard/rateLimiter.js` tal cual (era el único de los 2 procesos Express públicos
  sin límite por IP). `features.js`: el tagline de "Acción" ya no lleva el número
  "21" en texto libre (fuera del mecanismo anti-drift que ya deriva `commandCount`).
  `dashboard/config.js`: `DASHBOARD_SESSION_SECRET` exige 32+ caracteres al arrancar
  (antes solo chequeaba "no vacío").
- **Fase 5 (documentación + hardening menor):** el drift de "sin commitear" de arriba,
  comentarios desactualizados en `dashboard/queries.js` (decían "migración preparada"
  sobre algo ya ejecutado desde Fase 4A), y `csvExport.js` (usado por
  `/economia-staff historial`/`/warns exportar`) ahora antepone un apóstrofo a valores
  que empiezan con `=`/`+`/`-`/`@` — mitigación estándar OWASP de CSV/formula
  injection (vector staff→staff: el motivo de un warn es texto libre de staff, nunca
  de un usuario común).

**Dejado explícitamente como decisión pendiente, no implementado en esta ronda —
cerrado el 2026-09-15, ver "Plan de ejecución post-auditoría (parte 2)" más abajo:** el
riesgo arquitectónico de que un rol "seguro" (`getDangerousRolePermission`) solo se
valida al guardarlo en `/config`/`/setup`, nunca de nuevo en el momento real de
aplicarlo (`punish.js`, `guildMemberAdd.js`) — si alguien le agrega un permiso
peligroso a un rol de castigo/automático YA configurado desde Discord nativo, el
próximo `/punish` lo escala en vez de restringirlo. El usuario pidió explícitamente
cerrarlo unos días después, ya no queda como decisión pendiente.

**Resultado:** 109→113 archivos de test, 1001→1030 tests, todo verde. Nada commiteado
(el working tree completo queda para el tooling del usuario, como siempre). Puntaje
propio del día, para que quede de referencia: **~85/100 técnico** (seguridad,
atomicidad, cobertura de tests, feature-completeness — todo alto; el único P1 real de
esta ronda ya cerrado) vs. **~35-40/100 comercial** (cero monetización, cero premium,
sitio sin dominio desplegado — el cuello de botella real de NEXO no es el código).

## Plan de ejecución post-auditoría (parte 2): rol peligroso, reaction-roles, tuning de economía (2026-09-15)

De la lista de pendientes que quedaron señalados a propósito en rondas anteriores (el
riesgo arquitectónico de "Auditoría intensa... segunda ronda" de arriba, y los P1 de
Fase 4B diferidos) se implementaron 3 en la misma sesión — elegidos explícitamente por
el usuario vía `AskUserQuestion` entre varias opciones ofrecidas, no los 6 completos.
**Commit `069ae14`, pusheado** (lo corrió el propio usuario con su tooling externo, ver
`[[nexo_bot_no_auto_push]]`).

### A. Revalidación de rol peligroso al aplicar — cierra el riesgo arquitectónico

`getDangerousRolePermission()` (`permissions.js`) solo se chequeaba al GUARDAR
`punish_role_id`/`auto_role_id` (`/config`, `/setup`) — si un admin le sumaba un
permiso peligroso al rol YA configurado desde Discord nativo, el bot lo seguía
aplicando sin volver a revisar. `src/utils/selfRoles.js` ya resolvía exactamente este
problema para roles autoasignables (revalida en vivo en cada uso vía
`resolveLiveSelfRoles`) — ese es el patrón que se copió acá, sin inventar nada nuevo.

Dos sitios de aplicación revalidados: `punish.js` (entre el fetch del rol y
`member.roles.add()`, rechazo ephemeral con el mismo texto que ya usa `/config
rol-castigo`) y `guildMemberAdd.js` — `assignAutoRole()`/`reapplyActivePunishment()`. A
diferencia de `punish.js` (el staff ve la respuesta del comando en el momento), los dos
casos de `guildMemberAdd.js` son eventos silenciosos — además del `console.warn` de
siempre, ahora mandan un aviso al canal de logs de **moderación**
(`warnDangerousRoleApply()`, un `EmbedBuilder` inline, sin builder nuevo en
`logEmbeds.js` para un caso tan puntual): es información accionable (la config de roles
derivó a algo peligroso) a diferencia de "el rol ya no existe", que sigue siendo solo
`console.warn` porque es deriva operativa mundana, no un riesgo de seguridad.

### B. Reaction-roles — panel de botones, builder interactivo (no reacciones literales)

P1 de Fase 4B, evaluado y diferido a propósito — implementado este día. **Decisión
explícita del usuario, vía `AskUserQuestion`: panel de botones, no reacciones de emoji
reales.** El bot no tiene el intent `GuildMessageReactions` ni `Partials.Reaction`, y
agregarlos hubiera sido un cambio de infra (redeploy, nuevo listener
`messageReactionAdd`/`Remove`) solo para esta feature. El panel de botones reusa el
router ya existente (`src/components/buttons.js`), mismo patrón que `giveaway_enter_`
de `sorteo.js` y `selfroles_select` de `selfRoles.js`.

**Modelo de datos — tabla nueva, no una columna de `guild_config`.** A diferencia de
`selfassignable_roles` (una sola lista plana por guild), acá un guild puede tener
VARIOS paneles independientes en canales distintos, con roles distintos.
`reaction_role_panels` (`migration_2026_09_15_reaction_roles.sql`, corrida y
verificada por API contra producción — `GET .../reaction_role_panels?limit=1` → 200,
`[]`): `guild_id`, `channel_id`, `message_id` (unique), `roles jsonb`
(`[{roleId, label, emoji?}]`, hasta 5 — el máximo real de una sola `ActionRow` de
botones, sin paginación a propósito, mismo criterio que el techo de 25 de
`selfassignable_roles`), `created_by`. Sumada a `GUILD_SCOPED_TABLES` (sí es
guild-scoped, a diferencia de `bot_guild_events`).

`src/utils/reactionRolePanels.js` — store + `getRoleValidationError(guild, role)`
(única fuente de verdad de "¿NEXO puede asignar este rol ahora mismo?": permiso
peligroso + jerarquía del bot, mismo patrón que `resolveLiveSelfRoles`), llamada TANTO
al crear el panel como en cada click del botón (`rr_toggle_<roleId>`) — revalidación en
vivo, un admin puede volver peligroso un rol después de publicar el panel.
`buildReactionRolePanelMessage()` arma el embed (`MAGENTA_COLOR`) + la fila de botones,
con soporte de emoji por botón opcional (`.setEmoji()` si el rol tiene uno cargado).

**`/rolreacciones crear` es un builder interactivo, no opciones planas — segunda
iteración dentro de la misma sesión.** La primera versión pedía todo como opciones del
slash command (rol1-5, canal, título, descripción); el usuario pidió explícitamente
reemplazarla por un constructor con vista previa en vivo, "como `/anuncio` pero más
actualizado" — mismo patrón EXACTO que `src/commands/anuncios/anuncio.js` (922 líneas,
el builder más viejo del proyecto), sin inventar uno nuevo: sesión en memoria (`Map`,
key `` `${guildId}:${userId}` ``, TTL 10 min con `refreshSession()` en cada mutación —
mismo motivo que `anuncio.js`: el customId no necesita userId porque un mensaje
efímero ya está scopeado por Discord, pero el Map sí necesita guildId para no pisar la
sesión de un admin con el builder abierto en dos servidores a la vez),
`RoleSelectMenuBuilder`/`ChannelSelectMenuBuilder` nativos (no opciones de comando)
para elegir roles/canal, un modal para título/descripción
(`modal_rrbuilder_content`), y un segundo modal armado DINÁMICAMENTE (un
`TextInputBuilder` por rol ya elegido, hasta 5, `customId` posicional `emoji_<i>`) para
poner el emoji de cada botón — decisión explícita del usuario de sumar esto en la
misma pasada, no como fase aparte. Al reelegir roles en el selector, el emoji ya
cargado se preserva por `roleId` (no se pierde solo por reabrir el selector). Publicar
reusa tal cual `buildReactionRolePanelMessage`/`createReactionRolePanel` ya escritos —
el builder solo cambia CÓMO se arma el draft, nunca la lógica de
persistencia/publicación. `/rolreacciones eliminar`/`listar` NO son builders (no tiene
sentido para "borrar por ID"/"listar") — comandos directos, sin cambios.

**Bug real encontrado y arreglado el mismo día, en código propio recién escrito, antes
de que el usuario lo pidiera.** Mismo bug class que GIVE-1 (`/sorteo crear`, auditoría
completa 2026-09-11): la primera versión de `handleCrear` posteaba el mensaje
(`canal.send`) y RECIÉN DESPUÉS guardaba la fila (`createReactionRolePanel`) — dos
llamadas de red secuenciales sin ack intermedio. Un timeout de red entre las dos dejaba
el panel "fantasma" (visible en el canal, con botones que iban a responder "este panel
ya no es válido" para siempre porque nunca quedó una fila que los respalde). Fix: ack
inmediato (`interaction.reply`/`i.update` con "Creando/Publicando...") antes de las
llamadas lentas, y si el guardado falla DESPUÉS de postear, se borra el mensaje
(`message.delete().catch(() => {})`). Encontrado en una auto-revisión rápida del propio
código, no por un pedido de auditoría del usuario ni por un bug en producción — ver
`[[nexo_bot_same_day_self_review]]`.

### C. Tuning de economía por servidor — núcleo

P1 de Fase 4B, evaluado y diferido a propósito — implementado este día, alcance
acotado por el usuario (vía `AskUserQuestion`) al "núcleo": rangos de pago de `/daily`
`/work` `/crime`, probabilidad de éxito de `/crime` y `/rob`, y % de robo/multa de
`/rob`. Casino, interés de banco y XP quedan con su valor global de siempre — evaluado
y descartado a propósito para esta fase (mucha más superficie, ~8 archivos más).

12 columnas nuevas en `guild_config` (`migration_2026_09_15_economy_tuning.sql`,
corrida y verificada por API — las 12 devuelven `null`), TODAS nullable sin default:
`null` = "usar la constante global de siempre", nunca se toca el valor de la constante
en sí. Los porcentajes se guardan como enteros 1-100 (más cómodo para un admin que un
float) — la capa de resolución los devuelve ya divididos por 100.

`src/utils/economyTuning.js` — ÚNICA fuente de verdad de "valor efectivo", usada tanto
por los comandos (aplicar) como por `/config economia` (mostrar/validar), para que
nunca diverjan: `getEffectiveDailyRange`/`getEffectiveWorkRange`/
`getEffectiveCrimeConfig`/`getEffectiveRobConfig`, cada una `cfg.economy_x ?? DEFAULT`.
Los defaults (`DAILY_DEFAULT`, etc.) viven ACÁ, no en los archivos de comando — antes
`MIN_REWARD`/`MAX_REWARD` etc. eran `const` locales a cada archivo de comando; se
movieron a `economyTuning.js` para evitar un import circular (`daily.js` necesita leer
`economyTuning.js`, que a su vez hubiera necesitado importar las constantes DE
`daily.js`).

`/daily` `/work` `/crime` `/rob` — ninguno importaba `guildConfigStore.js` antes de
esto (son comandos de baja frecuencia, cooldown de 45min-24h: un `getGuildConfig` de
más no es un problema de rendimiento, cache de 30s ya existente). Cada uno hace UN
`getGuildConfig` antes de entrar al `withLock`, no dentro — el rango/probabilidad de
pago no necesita revalidarse "en fresco" dentro del lock como sí necesita el
balance/cooldown (ver el resto de esos archivos, sin cambios en esa parte).

`/config economia` — subcommand GROUP nuevo (no subcomandos sueltos: `/config` ya
tenía ~18, un grupo mantiene el nivel superior dentro del límite real de 25 de
Discord). 5 subcomandos: `diario`/`trabajo` (min+max, ambos obligatorios juntos —
nunca "solo minimo", para que nunca quede un min>max implícito contra el default),
`crimen` (+ éxito 1-100), `robo` (éxito + robo-min/max + multa-min/max, todos 1-100),
`restablecer` (`sistema: diario|trabajo|crimen|robo|todo`, vuelve esos campos a
`null`). `buildConfigSummaryEmbed` suma un campo "💰 Economía" marcando "personalizado"
vs "por defecto (X–Y)" por sistema, usando las mismas funciones de `economyTuning.js`.

### Verificación

Las 2 migraciones (`reaction_role_panels`, columnas `economy_*`) son puramente
aditivas — corridas y verificadas por API contra producción (`gmcqbvrqqpmcqjrbtauk`)
el mismo día, antes del deploy del código (seguro porque no hay ningún DROP/ALTER
destructivo, mismo criterio que `migration_2026_09_12_owner_metricas.sql`). 1090→1098
tests (incluye el fix de GIVE-1 de arriba). `website/data/commands.generated.json`
regenerado DOS VECES el mismo día — una al sumar `/rolreacciones`, otra al cambiarle el
shape de opciones al reemplazar `crear` por el builder — recordatorio de que `npm run
website:generate-commands` hay que correrlo cada vez que el SHAPE de un comando
cambia, no solo cuando se agrega o saca uno.

## Auditoría NEXO V + fixes en vivo sobre /rolreacciones (2026-09-18)

Pedido explícito del usuario: auditoría completa con **2 agentes** en paralelo (no los
7 de rondas anteriores), foco en lo que quedó sin auditar desde la ronda del 2026-09-12
— exactamente las dos features de la sección "Plan de ejecución post-auditoría (parte
2)" de arriba (tuning de economía, reaction-roles). Reporte completo entregado como
Artifact ("Auditoría NEXO V") + copia en el Escritorio. A diferencia de rondas
anteriores, esta vez el usuario aprobó el esquema de fixes propuesto (incluida la Fase
4 de opcionales) por `AskUserQuestion` y todo se implementó en el mismo tramo, sin
volver a auditar entre bloques.

**Resultado del agente de economía/permisos/schema: 0 hallazgos confirmados.** El
tuning de economía (`069ae14`) preserva todos los invariantes de concurrencia
(locks, orden cooldown-antes-de-recompensa, caps duros de `/rob`) — quedó limpio en la
primera pasada. Sí encontró que la revalidación de rol peligroso (sección A de "Parte
2" arriba) ya estaba implementada y testeada en código pese a que, en ese momento, la
propia CLAUDE.md todavía no reflejaba el cierre — drift ya corregido en esa sección.

**Resultado del agente de rolreacciones/dashboard/tests: 1 Alto + 3 Medio + varios
Bajo, todos en `/rolreacciones` (feature nueva del 2026-09-15) o en la tarjeta del
dashboard que todavía no la reflejaba.** Los 4 reales, arreglados el mismo día:

- **Alto — `/rolreacciones eliminar` sin `deferReply()`.** Mutaba Discord/Supabase
  (fetch de canal+mensaje, edit, borrado de fila) ANTES del primer ack — con un
  canal/mensaje no cacheado, la ventana de 3s del token podía vencer con el panel YA
  borrado: el admin veía "la interacción falló" sobre algo que sí se aplicó, y el
  borrado quedaba sin loguear porque el throw cortaba antes de `logConfigChange`.
  Mismo fix que el resto de comandos de moderación desde Fase 2B: defer apenas se
  confirma que el panel existe, `editReply` en vez de `reply` de ahí en más.
- **Medio — Publicar sin lock.** Doble click sobre "✅ Publicar" antes de que el
  primer `i.update()` alcanzara a sacar el botón corría el handler completo dos veces
  sobre el mismo draft → dos paneles idénticos. Fix: `withLock('rolreacciones-publish:
  {guild}:{user}', ...)`, mismo patrón que `/give`/`/daily`/`/rob`/`/crime`.
- **Medio — Dashboard desactualizado.** `fetchGuildConfigSummary` no traía las 12
  columnas `economy_*` ni existía ningún conteo de `reaction_role_panels` — la tarjeta
  "Configuración actual" seguía mostrando los defaults globales aunque el admin hubiera
  personalizado todo. Fix: `dashboard/queries.js` suma las columnas al `select` +
  `fetchReactionRolePanelCount` (mismo patrón `count: 'exact', head: true` que
  `fetchWarnCount`), `dashboard/views.js` reusa `economyTuning.js` tal cual (las mismas
  funciones `getEffective*`/`describeRange`/`describePercent` que ya usa `/config ver`
  del lado del bot) para que el dashboard nunca pueda mostrar un valor distinto al que
  el comando real aplica.
- **Medio (calidad, no reportado como hallazgo pero cerrado igual) — revalidación de
  roles justo antes de publicar.** El selector de roles ya validaba al elegir, pero
  `publishPanel` no volvía a chequear `getRoleValidationError`/existencia del rol justo
  antes de `canal.send()` — con hasta 10 min de TTL de sesión de por medio, un panel
  podía nacer roto sin que el admin se enterara al publicar (el toggle real sí revalida
  en cada click, así que nunca fue explotable — era una ventana de UX). Cerrado.
- **Bajo, cerrado igual (Fase 4 de opcionales, aprobada completa):** sesión de builder
  compartida entre dos `/rolreacciones crear` sin terminar del mismo admin ("último que
  la toca gana") — ahora el builder viejo se invalida (`editReply` con "se abrió un
  constructor nuevo") apenas se abre uno nuevo, vía un `ownerInteraction` guardado en la
  sesión. `MAX_ROLES_PER_PANEL` (antes duplicado como el literal `5` a mano en
  `rolreacciones.js`) ahora se importa de `reactionRolePanels.js`. CHECK constraints
  para las 12 columnas de tuning (`migration_2026_09_18_economy_tuning_checks.sql` —
  **ya corrida en producción**, verificado 2026-09-23 provocando a propósito la violación
  de `economy_daily_range_check` y revirtiendo; esta línea decía "no corrida todavía",
  información vieja), defensa en profundidad barata pero sin ningún
  bypass real hoy: el único escritor, `/config economia`, ya valida `min<=max` y
  Discord acota 1-100 en la opción).

**Trabajo adicional, pedido en vivo por el usuario probando el builder en Discord real
mientras se hacía la auditoría — no eran hallazgos de la auditoría, es UX nueva:**

- **Selector de emoji con búsqueda nativa, reemplaza el modal de texto libre por
  rol.** El modal viejo (`buildEmojisModal`, un `TextInputBuilder` por rol) obligaba a
  cerrar el modal, ir a buscar el emoji en OTRO lado de Discord, copiarlo, volver y
  pegarlo — el usuario lo probó por primera vez en vivo y pidió poder buscar/tocar sin
  salir del flujo. Se reemplazó por **Components V2 de modales** (`LabelBuilder` +
  `StringSelectMenuBuilder`, soporte muy nuevo de Discord — confirmado que discord.js
  14.27.0 ya lo expone, `ModalBuilder.addLabelComponents`/
  `ModalSubmitFields.getStringSelectValues`, nunca usado antes en este proyecto): un
  select por rol con los emojis custom del servidor (`guild.emojis.fetch()`, nunca
  `.cache` a secas — mismo motivo que el gotcha de `interaction.message.reactions.cache`
  de `/encuesta`, el bot no tiene el intent `GuildEmojisAndStickers` así que el cache de
  gateway podría estar desactualizado), con Discord mostrando su propio buscador nativo
  al abrir el desplegable. Opciones fijas "🚫 Sin emoji" y "✏️ Escribir manualmente..."
  — elegir la segunda encadena un SEGUNDO modal (`showModal` llamado DESDE el submit del
  primero, también soportado por discord.js 14.27 vía
  `InteractionResponses.applyToClass(ModalSubmitInteraction, 'showModal')`) con un
  `TextInputBuilder` clásico solo para los roles que lo pidieron — mismo validador de
  formato (`isValidEmojiInput`, nuevo en `reactionRolePanels.js`) que ya se necesitaba
  para el hallazgo Medio de arriba.
  **Riesgo real, no probado contra Discord en vivo (nunca se levanta el bot local
  contra el token de producción — ver el gotcha de siempre):** no hay forma de
  confirmar desde acá si `interaction.update()` sigue apuntando al mensaje correcto
  después de un modal encadenado dentro de OTRO modal — por eso el submit del modal
  manual usa `session.ownerInteraction.editReply(...)` (el token de la interacción de
  comando original, garantizado válido 15 min) en vez de confiar en el `.update()` del
  segundo modal. **Probar en Discord real después del deploy** es el único paso
  pendiente para dar esto por cerrado de verdad.
- **Importar un panel completo pegando JSON.** Botón nuevo "📄 JSON" en el builder
  (`rrbuilder_json` → modal con un `TextInputBuilder` Paragraph de hasta 4000
  caracteres) — pensado para armar un panel de memoria o clonarlo entre servidores sin
  clickear rol por rol. Formato: `{"titulo"?, "descripcion"?, "roles": [{"rol": "<ID>",
  "emoji"?, "etiqueta"?}]}`. Pasa por las MISMAS validaciones que el flujo manual
  (`getRoleValidationError`, `isValidEmojiInput`, tope `MAX_ROLES_PER_PANEL`) y carga el
  resultado en el draft para revisar/editar antes de publicar — nunca publica directo
  desde el JSON, mismo criterio de "todo pasa por el preview" que el resto del builder.
  No incluye el canal a propósito (fuera de pedido, y el `ChannelSelectMenu` nativo ya
  cubre eso sin ambigüedad de qué ID es un canal válido).

**Verificación:** `node --check` en los 4 archivos tocados, `npx vitest run` completo
en verde (117→118 archivos — sumó 1 assert nuevo a `tests/dashboardServer.test.js`,
tests de `rolreacciones.test.js` reescritos para el nuevo flujo de emoji/JSON, ver el
propio diff). Nada commiteado — el working tree queda para el tooling externo del
usuario, como siempre.

## Auditoría UX/UI/Design System (2026-09-18) — plan de fases, Fase 1 ejecutada

Auditoría nueva y distinta de "NEXO V" de arriba: 3 agentes especializados en paralelo
(UX/UI, visual/CSS, investigación competitiva contra 9 bots reales), solo lectura, sin
tocar código — entregada como Artifact ("NEXO — Producto Terminado") con Top 20 cambios,
propuesta de Design System (10 colores, antes 9) y rediseños conceptuales de `/help`/
`/helpstaff`. A partir de eso se armó un plan de 7 fases (color/confianza → contenido de
ayuda → embeds de moderación → confirmaciones/permisos → interfaces nuevas → dashboard/
sitio → pulido menor), y el usuario pidió arrancar por la Fase 1 con autonomía completa
("no consultes nada, tenés vía libre") — implementada y verificada en el mismo tramo.

**Fase 1 — confianza y sistema de color (fundacional, sin features nuevas):**

- **`/staff → Economía → Límites` ya no miente (hallazgo Crítico #2 del Top 20).**
  `buildEconomiaLimitesView()` decía textualmente que los rangos de `/daily /work /crime
  /rob` "son fijos en el código... no son un ajuste por-servidor" — falso desde el
  15/09 (ver "Plan de ejecución post-auditoría (parte 2)" más arriba, tuning de
  economía). `staff.js` nunca importó `economyTuning.js` tras esa fase; el panel
  pensado como "la cara fácil" del bot le daba a un admin un modelo mental incorrecto
  de una feature que puede haber configurado él mismo. Ahora llama las MISMAS
  `getEffective*`/`describeRange`/`describePercent` que ya usa `buildConfigSummaryEmbed`
  (`config.js`) — nunca dos fuentes de verdad para el mismo dato — y aclara qué SÍ sigue
  siendo fijo de verdad (tope de robo 5.000/2.000, escudo 3h, cooldowns), en vez de
  mezclarlo sin aclarar con lo que ahora varía por servidor. El handler pasa `cfg` real
  (antes la vista no recibía ningún argumento). Footer nuevo apunta a `/config economia`
  para editar — el panel se mantiene 100% solo lectura, mover el ajuste de balance/XP de
  staff a una interfaz visual (hallazgo #8 del Top 20) queda para la Fase 5 del plan
  (interfaces nuevas), no es parte de este fix.
- **`logEmbeds.js` tenía su propia paleta paralela a la oficial (hallazgo Crítico #3).**
  Declaraba `OK_COLOR`/`NEUTRAL_COLOR`/`WARN_COLOR` locales — el `NEUTRAL_COLOR` local
  (`#8D99AE`) era un gris ligeramente distinto del oficial de `embeds.js` (`#8A8F9C`),
  invisible para el usuario final pero significaba que el verde de "éxito" que ve el
  staff en un comando nunca era el mismo que el verde del log archivado de esa misma
  acción. `WARN_COLOR` (`#E9C46A`) se formalizó como 10º color oficial del sistema en
  `embeds.js` (antes vivía sin nombre oficial en 3 lugares: esta constante local, y hex
  sueltos en el picker de `/anuncio`) — `logEmbeds.js` ahora importa los 3
  (`SUCCESS_COLOR` en vez del viejo `OK_COLOR`) desde `embeds.js`, cero constantes
  locales de color propias. De paso, el naranja `#F4A261` reusado 2 veces sin nombre
  (kick + compra pendiente de entrega) pasó a `PENDING_ACCENT_COLOR`, una constante
  local con su rol documentado — deliberadamente NO se fusionó con ningún color oficial
  de los 10, es un acento secundario a propósito distinto de `LOG_COLOR` (kick es menos
  severo que ban).
- **Casino con dos colores contradictorios en dos paneles del mismo bot (hallazgo
  Crítico #4).** `staff.js` coloreaba su categoría análoga ("Minijuegos") con
  `GOLD_COLOR` (coherente con "progresión... minijuegos"), pero `help.js` coloreaba
  "🎰 Casino" — los mismos comandos, coinflip/dado/slots/ruleta — con `EMERALD_COLOR`
  (economía). Casino es apuesta+resultado inmediato, no wallet/banco/transferencias:
  `buildCasinoEmbed()` en `help.js` pasa a `GOLD_COLOR`, mismo criterio que ya usaba
  `staff.js`. `EMERALD_COLOR` sigue en uso en `help.js` para `buildEconomiaEmbed` — el
  import no quedó huérfano.
- **`/anuncio` — picker de color con hex redigitados a mano, no constantes con nombre
  (hallazgo Importante).** `color_predefinido` ofrecía 8 valores hardcodeados que
  duplicaban a mano colores de `logEmbeds.js` (`#E9C46A`, `#2A9D8F`) más un "Azul"
  (`#3A86FF`) que NO coincidía con el `SKY_COLOR` real (`#4EA8DE`) — un admin podía
  terminar usando dos "azules de sistema" distintos sin saberlo. Los 8 valores ahora
  importan las constantes con nombre de `embeds.js` (Púrpura→`BRAND_COLOR`,
  Rojo→`LOG_COLOR`, Dorado→`GOLD_COLOR`, Advertencia→`WARN_COLOR` — antes "🟡 Dorado"
  apuntaba al valor que hoy es `WARN_COLOR`, renombrado para que el nombre coincida con
  el color real —, Verde→`SUCCESS_COLOR`, Azul→`SKY_COLOR`); Blanco/Negro quedan como
  hex genéricos a propósito (no son colores semánticos del sistema, no tienen constante
  que los represente).
- **`setup.js` — verde obsoleto de Discord pre-2020 para el rol "Miembro" (pulido).**
  `#43B581` (verde de la marca vieja de Discord, descontinuada en 2020) hardcodeado a
  mano → `SUCCESS_COLOR` oficial.
- **`BRAND_COLOR` diluido como "color por defecto" en 20+ comandos (hallazgo Importante,
  documentación únicamente, sin recolorear nada).** Rol-play (`actionCommandFactory.js`),
  `/trivia /roll /choose /confession /encuesta` comparten el mismo violeta documentado
  como "marca, navegación, home, ayuda, config" — si el violeta está en todo, deja de
  comunicar nada. Solución de la auditoría: documentar que también cubre "social/sin
  categoría propia" (ya cumple ese rol de facto), no forzar una categoría nueva sin
  necesidad real — comentario agregado en `embeds.js`, cero comandos tocados.

**Deliberadamente NO tocado en esta fase — decisión, no olvido:**
- **Colores de estado del dashboard/sitio** (`#4ade80`/`#facc15`/`#f87171` tipo Tailwind
  vs. `SUCCESS_COLOR`/`WARN_COLOR`/`LOG_COLOR` de Discord, hallazgo Importante). Medí a
  mano el contraste WCAG de reemplazar el rojo (`#f87171`→`#E63946` sobre los fondos
  casi negros de `dashboard/html.js`/`website/layout.js`): pasa de ~7.15:1 a ~4.75:1 —
  sigue sobre el mínimo AA (4.5:1) pero con mucho menos margen, un cálculo a mano sin
  poder verificarlo visualmente (no hay herramienta de screenshot en este entorno). Dado
  que este mismo proyecto ya midió contraste WCAG con precisión real en el sitio (ver
  "Sitio web", corrección de `--text-dim`), preferí no introducir una degradación de
  contraste sin poder confirmarla visualmente — queda para la Fase 6 del plan
  (dashboard/sitio), donde además correspondería resolver junto con el hallazgo
  hermano ("dos paletas oscuras primas pero no idénticas", `#0c0a14` vs `#0a0912`) en
  un solo módulo de tokens compartido, en vez de un parche a mano en 2 archivos.
- **Ajuste de balance/XP de staff sin interfaz visual en `/staff`** (hallazgo Importante
  #8) y **`/shop`+`/buy` sin fusionar** (hallazgo Importante) — ambos son features
  nuevas reales (`UserSelectMenu`+modal, `StringSelectMenu` de compra), quedan para la
  Fase 5 del plan (interfaces nuevas), fuera del alcance "rápido y mecánico" de la
  Fase 1.

**Verificación:** `node --check` en los 6 archivos tocados, `npx vitest run` completo en
verde (117 archivos, 1114→1115 tests — el único test que rompió esperaba la mentira
vieja de `/staff → Límites`, reescrito en 2 casos: default y personalizado). Nada
commiteado — working tree para el tooling externo del usuario, como siempre.

**Fase 2 — contenido de `/help` y `/helpstaff` (hallazgo Crítico #1 y afines):**

- **`/help` — Diversión y Acción ya no son 34 nombres de comando sin descripción.**
  `buildDiversionEmbed`/`buildAccionEmbed` mostraban 14 y 20 nombres pegados entre
  backticks — "la lista interminable de comandos" que se pidió evitar explícitamente,
  en las únicas 2 de las 5 categorías que todavía la tenían (Información/Economía/
  Casino ya usaban campo-por-comando). Diversión pasó a 14 campos individuales, mismo
  formato que esas 3 — cabe cómodo bajo el límite de 25 campos de Discord. Acción, con
  20 comandos, se agrupó en 3 sub-bloques temáticos DENTRO de 3 campos en vez de un
  campo por comando (🤗 Cariñosas: hug/kiss/pat/cuddle/feed/highfive/claps/
  handholding/hi · 😤 Molestas: slap/punch/shoot/bite/baka/kickbutt/poke/tickle · 😳
  Reacciones: laugh/angry/scared/stare) — un campo por cada uno de los 20 hubiera sido
  técnicamente posible pero ilegible, y la propia auditoría pidió agrupar por tema acá
  en vez de mantener la lista plana. Cada descripción sale del `description`/
  `selfText`/`targetText` real de `actionCommandFactory.js` o del `.setDescription()`
  real del comando — ninguna inventada.
- **`/help` — Economía dejó de ser una pared de 14 campos idénticos (hallazgo
  Importante).** Reagrupada en 2 campos: "🌱 Para empezar" (`/daily` `/work` `/shop` —
  los mismos 3 que ya recomienda `buildPrimerosPasosLines()` del home, mismo criterio
  en los dos lugares) y "📈 El resto" (los 11 restantes, cada uno con su descripción
  original intacta, solo reagrupados). Bajó de 14 campos a 2, sin perder ninguna
  descripción.
- **Casino recoloreado** — ver Fase 1 arriba (mismo commit conceptual, hallazgo Crítico
  #4 del Top 20).
- **`/helpstaff` — puente hacia `/staff` en el home (hallazgo Importante).** Antes ese
  puente solo existía dentro de `/setup` (una sola vez, al instalar) y en el footer de
  `/config ver` — nunca en el punto de entrada real donde el staff busca ayuda del día
  a día. `buildMainMenuEmbed()` ahora lo menciona explícitamente.
- **`/helpstaff` — Tier 1 vs Tier 2 ya no vive escondido en el texto de un campo
  (hallazgo Importante).** `/say` (Tier 2 desde la Fase 4 de "post-auditoría
  Fases 1-4") era el único comando Tier 2 mezclado campo-a-campo con Tier 1 dentro de
  "🧹 Moderación" — su límite de permiso vivía como una frase en negrita dentro del
  valor de un campo, no como estructura visual. Ahora son 2 campos: "🟢 Cualquier
  staff" (clear/lock/unlock/kick/ban/timeout/voice) y "🔒 Solo Administrador" (`/say`).
  "💰 Economía (staff)" y "⭐ XP y niveles (staff)" son categorías ENTERAS Tier 2 (nunca
  tuvieron un comando Tier 1 mezclado adentro) — ahí el marcador se puso en la
  `description` del embed en vez de fabricar un campo "Cualquier staff" vacío sin
  sentido.
- **`/sanciones` — el único punto de entrada en texto plano pasó a embed (hallazgo
  Mejora).** El resto del panel (historial, las 4 listas paginadas) ya usaba
  `EmbedBuilder` con `INDIGO_COLOR` desde siempre; solo el mensaje inicial ("Elegí qué
  querés revisar...") seguía en `content` plano. Mismo color, mismo texto, ahora en
  embed.

**Deliberadamente NO tocado en esta fase:** `/help` sin buscador ni paginación nueva —
la propia auditoría concluyó que a 74 comandos y 5 categorías ninguna de las dos
resuelve un problema real hoy. Reducir el catálogo de comandos o unificar
Diversión/Acción en un tercer eje "qué tan perdido estás" (patrón Dank Memer/Sapphire
de la investigación competitiva) — decisión de producto reversible, queda pendiente
hasta que se pida explícitamente, mismo criterio que el resto de decisiones de producto
de este proyecto.

**Verificación:** `node --check` en los 4 archivos de código tocados, `npx vitest run`
completo en verde (117 archivos, 1115 tests — 1 test de `helpstaff.test.js` reescrito
para la nueva estructura de 2 campos de Moderación, conteo total sin cambios). Nada
commiteado — working tree para el tooling externo del usuario, como siempre.

**Fase 3 — moderación con embeds propios (hallazgo Crítico #5 del Top 20):**

12 de 17 archivos de `src/commands/moderacion/` (`ban kick unban lock unlock timeout
warn clear unwarn warnEditar unpunish punish`) respondían siempre con texto plano
(`content: '✅ Se expulsó a...'`) — `INDIGO_COLOR` (moderación) solo aparecía en los
paneles de consulta y en los logs, nunca en la respuesta directa del comando. La
categoría de mayor responsabilidad del producto era, visualmente, la más pobre. Los 12
ahora responden con `EmbedBuilder().setColor(INDIGO_COLOR)` + título con emoji +
descripción, mismo esqueleto que ya usan `/daily /work /rob /give` — solo se tocó el
mensaje de ÉXITO final de cada uno, nunca los rechazos ephemeral de validación
("no tenés permisos", "rango", etc.), que siguen en `content` plano, consistente con
el resto del proyecto (`/daily` hace exactamente lo mismo: `content` para su rechazo de
cooldown, embed solo para el resultado).

**Alcance mantenido idéntico a propósito — sin agregar `motivo` donde antes no
aparecía.** Al escribir el primer borrador de `kick.js`/`unban.js`/`timeout.js` agregué
`motivo` a la descripción pública (antes esos 3 comandos NUNCA lo mostraban ahí, solo en
el log de moderación) — autocorregido antes de seguir: `motivo` es texto libre de staff
sin sanear, y mostrarlo en un embed público SIN `allowedMentions` habría sido reabrir
exactamente el vector de SEC-1/SEC-2 (Fase 4A) que ya se cerró para `/warn` y el panel
de confirmación. Revertido a mostrar solo lo que cada comando ya mostraba antes de esta
fase — `warn.js`, `warnEditar.js` y `unwarn.js` siguen con su propio manejo de menciones
sin cambios (`warn.js` preserva `allowedMentions: { parse: ['users'] }` tal cual estaba,
ahora aplicado al mensaje con embed en vez de a `content` — es una opción del mensaje
entero, no de `content` puntualmente).

**Confirmación de `/ban`/`/clear`/`/unwarn` — solo se tocó el mensaje final de
`confirmBan`/`confirmClear`/`confirmUnwarn`, nunca `confirmations.js`.** El panel
genérico "⚠️ Confirmar acción" (`buildConfirmation`) sigue en `content` plano tal cual
— está en la lista "No tocar" de la propia auditoría ("ejemplar"), y el pedido era
moderación con embeds, no rediseñar el panel de confirmación.

**Impacto en tests — 8 archivos de test tenían aserciones directas sobre `content` del
mensaje de éxito** (`moderation.test.js`, `moderationDeferredCommands.test.js`,
`permMatrix.test.js`, `punish.test.js`, `unpunish.test.js`, `warnEditar.test.js`, más
`staffPanel.test.js`/`helpstaff.test.js` de las Fases 1-2) — todas reescritas para leer
`embeds[0].data.description`/`.title` en vez de `content`, sin cambiar qué se verifica.
Detalle curioso sin relación con esta fase: los mocks de `targetUser`/`interaction.channel`
en varios de estos tests no implementan `toString()` como lo hace un `User`/`Channel`
real de discord.js — interpolarlos en una aserción de texto completo da `[object
Object]` en el entorno de test (nunca en producción, donde sí son instancias reales).
No se tocaron esos mocks; las aserciones nuevas evitan depender de esa interpolación.

**Verificación:** `node --check` en los 12 comandos tocados, `npx vitest run` completo
en verde (117 archivos, 1115 tests — mismo conteo, ninguno nuevo ni perdido, todas las
aserciones de contenido migradas a embeds). Nada commiteado — working tree para el
tooling externo del usuario, como siempre.

**Fase 4 — confirmaciones y mensajes de permiso (hallazgos Importantes del Top 20):**

- **`/kick` suma panel de confirmación (antes era el único comando de remoción sin
  uno, sin ningún criterio documentado de por qué quedaba afuera).** Mismo patrón
  EXACTO que `ban.js`: `execute()` valida (permiso, jerarquía, `kickable`) y responde
  con `buildConfirmation()` en vez de expulsar directo; `confirmKick()` (nueva función,
  corre solo si el staff confirma) revalida todo desde cero — incluida una validación
  que `ban.js` no necesita: el usuario puede haberse ido del server durante la espera
  ("❌ Ese usuario ya no está en el servidor" en vez de asumir que sigue ahí). De paso
  se sacó el `deferReply()` que tenía antes — igual que `ban.js`, el primer ack ahora es
  el panel de confirmación (`interaction.reply(confirmation)`), no un defer.
- **Mensajes de permiso denegado en los 4 comandos Tier 2 explican la causa real
  (`/shop-admin` ×2, `/economia-staff` ×3, `/xp` ×1, `/say` ×1 — 7 sitios en total).**
  Todos mostraban "❌ No tenés permisos"/"Solo un administrador puede usar esto" sin
  decir que el gate es un ROL de NEXO (`admin_role_id`, `/config rol-admin`), no un
  permiso nativo de Discord — un moderador con "Gestionar servidor" nativo (dado por
  error vía Integraciones) veía el comando pero se topaba con un rechazo que sonaba a
  bug ("esto está roto") en vez de "te falta un rol puntual". Mensaje nuevo, idéntico en
  los 7 sitios: "❌ Este comando requiere el rol de Administrador configurado con
  `/config rol-admin` — no es un permiso nativo de Discord, un Moderador no puede
  usarlo." Sin constante compartida a propósito — mismo criterio que el resto del
  proyecto con mensajes ephemeral repetidos (ej. "❌ No tenés permisos para usar este
  comando." ya se repite tal cual en decenas de archivos sin extraerse).

**Verificación:** `node --check` en los 5 archivos tocados, `npx vitest run` completo en
verde (117 archivos, 1115→1117 tests — 2 tests nuevos de `/kick` (revalidación de
permisos al confirmar + cancelar), 4 aserciones de mensaje de permiso actualizadas al
texto nuevo en `permMatrix.test.js`/`say.test.js`/`shopAdminCommand.test.js`). Nada
commiteado — working tree para el tooling externo del usuario, como siempre.

**Fase 5 — interfaces nuevas (los 4 hallazgos que necesitaban feature real, no un
fix puntual):**

- **`/shop` + `/buy` fusionados (hallazgo Importante del Top 20).** Eran dos comandos
  separados — ver y comprar exigía copiar el nombre del ítem entre uno y otro. La
  lógica de compra completa de `buy.js` (cobro, las 4 ramas especiales, reembolso si
  falla la entrega) se extrajo a `runBuy(interaction, itemId)` exportada (mismo patrón
  que `runClear()` ya establecido en Fase 2B) — `execute()` de `/buy` queda como
  wrapper fino que solo lee `interaction.options`. `/shop` suma un
  `StringSelectMenu` con los ítems de la categoría/página actual (hasta 25, el máximo
  real de Discord — con más se corta, mismo criterio "+N más" que el resto del
  proyecto) que llama a `runBuy` directo. **El mensaje de `/shop` es público y
  compartido por cualquiera en el canal** — el select handler nunca usa
  `i.update()` (pisaría el catálogo con el resultado de la compra de una sola
  persona); `runBuy` responde con su propio mensaje sobre esa misma interacción,
  dejando el panel intacto para todos los demás. **Bug real encontrado con un test
  propio, no en producción:** el margen de corte del texto de una categoría con
  muchos ítems (950 caracteres) no dejaba espacio de sobra para el sufijo "(+N ítems
  más)" — con la cantidad justa de ítems, el embed terminaba pasándose de los 1024
  reales de Discord y `addFields` tiraba. Bajado a 900, verificado con un test que
  arma 30 ítems en una sola categoría.
- **Ajuste de balance en `/staff` (hallazgo Importante #8 del Top 20).** El panel
  visual solo tenía lectura — acreditar seguía siendo 100% `/economia-staff` de
  memoria, la acción de staff más sensible del bot sin ninguna interfaz.
  `economiaStaff.js` expone `runBalanceAdjust`/`runBalanceSet` (misma extracción que
  `runBuy`) — `/staff → Economía → Ajustar` (botón nuevo, Tier 2 vía `isAdmin()`, NO
  `isOwnerOrAdmin()` — deshabilitado con nota en el footer para un Tier 1) abre un
  `UserSelectMenu` → 3 botones (➕ Agregar / ➖ Quitar / 🛠️ Establecer, el ID del
  usuario codificado en el customId, sin sesión en memoria para este paso) → modal de
  cantidad/motivo. **Las 4 superficies (botón, select, botones de tipo, modal)
  revalidan `isAdmin()` cada una por su cuenta** — un botón deshabilitado en el
  cliente no impide una interacción armada a mano contra la API. Público (no
  ephemeral), mismo criterio que `/economia-staff` directo: un ajuste de balance es
  visible, no una acción para esconder.
- **`/config economia` con modal, desde `/staff → Límites` (hallazgo Mejora).** Tier 3
  (`isOwnerOrAdmin`, el mismo gate que `/config` — nunca se baja el nivel de permiso
  al sumarle una interfaz visual). Un `StringSelectMenu` nuevo en la vista de Límites
  (solo visible con permiso de editar) deja elegir diario/trabajo/crimen/robo; cada
  uno abre un modal con hasta 5 `TextInputBuilder` (robo, el caso con más campos,
  coincide exacto con el máximo real de un modal) **prellenado con el valor EFECTIVO
  real de este server** (personalizado si ya lo estaba, default si no — nunca el
  default a ciegas). La validación (min≤max, porcentajes 1-100) es la misma que
  `handleEconomiaSubcommand` en `config.js`, reimplementada a mano porque un modal no
  tiene `interaction.options` para reusar la función tal cual — mismas reglas, nunca
  puede divergir en lo que acepta. Guardar refresca el panel de Límites en el mismo
  mensaje (`i.update`), mostrando al toque "personalizado" en vez de tener que volver
  a abrir la vista.
- **`/shop-admin agregar/editar` con modal + vista previa (hallazgo Mejora: "se
  beneficiaría de un modal con preview, mismo patrón que /anuncio").** Alcance
  deliberadamente más chico que `/anuncio` (922 líneas) o `/rolreacciones` — un ítem
  de tienda son 7 campos simples, sin imagen. Botones nuevos "🎨 Agregar" / "✏️
  Editar" en `/shop-admin listar` (siempre visibles, no solo con más de una página):
  Agregar abre una vista previa vacía; Editar primero pide elegir el ítem
  (`StringSelectMenu`, hasta 25) y precarga el draft con sus datos reales. La vista
  previa usa el MISMO formato de línea que ya arma `buildListarEmbed` para un ítem
  real (nunca un resumen aparte que puede divergir) y se actualiza en vivo:
  modal de nombre/precio/descripción/categoría, `RoleSelectMenu` nativo para el rol
  (min 0 — se puede dejar sin rol), `StringSelectMenu` para el tipo especial. **Al
  editar, tipo y entrega manual vienen deshabilitados con una nota explícita** —
  `updateShopItem` (`shopStore.js`) nunca aceptó esas dos columnas en un patch, así
  que dejarlas editables ahí habría sido un cambio que el botón "Guardar" ignoraría
  en silencio. Guardar reusa `addShopItem`/`updateShopItem` tal cual, con el mismo
  piso de precio para caja misteriosa que ya tenían `handleAgregar`/`handleEditar`.
  **Efecto secundario correcto, no un bug:** a diferencia de `/shop-admin editar`
  (que solo pisa el campo que se completó, porque todas sus opciones son
  opcionales), el builder SÍ puede vaciar un rol ya asignado — el draft es el estado
  completo del ítem tal como se ve en la vista previa, nunca un patch parcial, y
  `roleId: null` sí limpia la columna porque la clave está presente en el objeto
  (`'roleId' in patch`, ver `shopStore.js`).

**Deliberadamente NO se tocó ninguna SHAPE de comando** (`/shop`, `/buy`, `/staff`,
`/config`, `/shop-admin` conservan exactamente las mismas opciones/subcomandos que
antes) — toda la Fase 5 son superficies visuales nuevas sobre lógica ya existente,
nunca un cambio de contrato. No hace falta regenerar
`website/data/commands.generated.json`.

**Verificación:** `node --check` en los 3 archivos de código tocados
(`buy.js`/`shop.js`/`staff.js`/`economiaStaff.js`/`shopAdmin.js`), `npx vitest run`
completo en verde (118→119 archivos, 1141→1155 tests — sumó `tests/shop.test.js` (5),
11 tests de ajuste de balance + 8 de edición de economía en `staffPanel.test.js`, y
`tests/shopAdminBuilder.test.js` (14)). Nada commiteado — working tree para el
tooling externo del usuario, como siempre.

**Fase 7 — pulido menor (3 ítems chicos, sin relación entre sí):**

- **`/encuesta cerrar` usa `buildProgressBar` en los resultados (hallazgo Mejora).**
  Antes era una pared de números ("👍 — 12 voto(s)") sin ninguna referencia visual de
  qué opción ganaba de un vistazo. Mismo patrón que ya usa `/metricas` — barra
  relativa al MÁXIMO real entre las opciones (no al total de votos), así la opción
  líder siempre se ve con la barra llena y el resto proporcional a ella. Sin
  división por cero si nadie votó todavía (`buildProgressBar` ya lo maneja).
- **Emoji duplicado (📋) en dos botones de `/staff` (hallazgo Bajo).** "Canal de
  logs" (Moderación) y "Logs de actividad" (Canales) usaban el mismo ícono en
  pantallas distintas — nunca aparecen juntos, pero un admin que las compara pierde
  la distinción visual. "Logs de actividad" pasa a 📈, el mismo ícono que ya usa el
  módulo Digest semanal (justo lo que más postea a ese canal) — 📋 queda como el
  ícono real de "log de moderación", consistente con `config.js`.
- **Regla de `ButtonStyle` documentada en `buttons.js` (hallazgo del Design System,
  comentario únicamente — cero código funcional tocado).** Primary/Success/Danger/
  Secondary con su criterio de cuándo usar cada uno, en el router en vez de
  repetirla en cada archivo de comando — es la única regla que aplica a cualquier
  botón nuevo del proyecto sin importar qué feature lo registre.

**Verificación:** `node --check` en los 3 archivos tocados (`encuesta.js`/`staff.js`/
`buttons.js`), `npx vitest run` completo en verde (119 archivos, 1155→1157 tests — 2
tests nuevos de `/encuesta` cubriendo el escalado relativo de la barra y el caso
"nadie votó"). Nada commiteado — working tree para el tooling externo del usuario,
como siempre.

**Corrección:** esta sección decía "con esto se cierran las 7 fases" — inexacto, la
Fase 6 (dashboard/sitio) todavía no se había hecho en ese momento; el usuario eligió
saltar directo a la Fase 7 antes de volver a esta. Implementada después, ver abajo.

**Fase 6 — dashboard/sitio: tokens de color compartidos (los 3 hallazgos de paridad
visual entre `dashboard/` y `website/`):**

- **Módulo nuevo `src/utils/webTheme.js`** — única fuente de los tokens de color que
  usan los DOS procesos Express de solo-interfaz (`dashboard/`, `website/`). No pueden
  compartir estado en runtime (son servicios de Railway separados), pero sí pueden
  importar la misma constante — que es justo lo que faltaba: cada uno tenía su propia
  paleta oscura "prima pero no idéntica" (`#0c0a14`/`#2c2645` en el dashboard vs.
  `#0a0912`/`#2a2440` en el sitio, valores parecidos pero distintos, copiados a mano).
  Se tomó la paleta de `website/layout.js` como la de referencia (no un promedio a
  ciegas entre las dos) — ya había pasado una revisión real de contraste WCAG en su
  propia Fase 5, documentada ahí. `website/layout.js` ahora importa desde este módulo
  nuevo en vez de tener sus propias constantes — la fuente de verdad se movió, el
  valor no cambió para el sitio.
- **`dashboard/html.js` migrado al mismo patrón `:root { --var }` que ya usaba el
  sitio (hallazgo Importante "dashboard sin tokens CSS").** Antes tenía sus valores
  hardcodeados repetidos por toda la hoja de estilos; ahora una sola declaración
  `:root` poblada desde `webTheme.js`, y el resto de la hoja usa `var(--bg)`,
  `var(--surface)`, etc. Los fondos tintados de cada badge (`#123524` para el verde,
  etc.) quedaron como estaban a propósito — la auditoría solo flageó el color de
  texto/estado, no esos tintes de fondo.
- **`dashboard/views.js` — 18 repeticiones de
  `style="text-transform:uppercase;font-size:0.74rem;color:#978fb4;"` en la tarjeta
  "Configuración actual" pasaron a una clase `.label`** (agregada en `dashboard/html.js`,
  mismo valor que el `--text-muted` compartido).
- **Colores de estado (ok/advertencia/peligro) alineados a los que ya usa Discord
  (hallazgo Importante "no coinciden entre Discord y dashboard/sitio").** Antes
  dashboard y sitio usaban una paleta tipo Tailwind (`#4ade80`/`#facc15`/`#f87171`)
  sin relación con `SUCCESS_COLOR`/`WARN_COLOR`/`LOG_COLOR` del bot. Ahora
  `WEB_STATUS_OK`/`WEB_STATUS_WARN`/`WEB_STATUS_DANGER` en `webTheme.js` son
  literalmente esos 3 valores — un solo criterio de color en las 3 superficies del
  proyecto (bot, dashboard, sitio).
  **Contraste verificado con un script real (no a mano esta vez)** — luminancia
  relativa de WCAG contra `#0a0912` (el fondo más oscuro de los 3 reales, el peor
  caso): OK 11.10:1 (antes 11.36:1), WARN 11.85:1 (antes 12.93:1), DANGER **4.75:1**
  (antes 7.16:1) — el único que pierde margen real, documentado en el propio
  `webTheme.js`. Sigue pasando el mínimo AA (4.5:1) pero raspando; **no verificado
  visualmente** (sin herramienta de screenshot en este entorno) — pendiente de que el
  usuario le eche un vistazo una vez desplegado.

**Verificación:** `node --check` en los 4 archivos tocados
(`webTheme.js`/`dashboard/html.js`/`dashboard/views.js`/`website/layout.js`), un
render real de `dashboard/html.js`'s `layout()` y `website/layout.js`'s `renderPage()`
confirmando que los tokens quedan idénticos entre los dos procesos y que ningún
`undefined` se filtró al CSS, `npx vitest run` completo en verde (119 archivos, 1157
tests — mismo conteo, esto es CSS puro sin comportamiento JS nuevo que cubrir). Nada
commiteado — working tree para el tooling externo del usuario, como siempre.

**Con esto sí se cierran las 7 fases completas del plan de la auditoría UX/UI/Design
System (2026-09-18)** — sin ningún ítem pendiente del plan en sí. El único punto
abierto es la verificación visual del contraste de `WEB_STATUS_DANGER` mencionada
arriba, que quedó explícitamente a cargo del usuario.

## Dashboard — rediseño de "Tus servidores" (2026-09-19, pedido aparte del plan de 7 fases)

Pedido explícito y acotado del usuario, sin relación con el plan de la auditoría UX/UI de
arriba (esa ya había cerrado sus 7 fases ese mismo día) — mejorar EXCLUSIVAMENTE la
pantalla de selección de servidor del dashboard (`GET /`, `renderGuildList` en
`dashboard/views.js`), con una lista explícita de qué NO tocar (lógica de auth/selección
de servidor, otras pantallas, estadísticas/features nuevas). 3 archivos tocados
(`dashboard/html.js`/`views.js`/`server.js`), todo presentación — `listManagedGuilds`
(el único dato real por servidor era `id`/`name`/`icon`) no se tocó EN ESTE REDISEÑO;
más tarde ese mismo día sí cambió (devuelve además `needsSetup`), ver "Dashboard —
servidores sin /setup, barra de carga, skeleton y Manrope" más abajo.

**`wide` como flag explícito de `layout()`, no un ancho global nuevo.** El contenedor
angosto (880px) es compartido por TODAS las páginas del dashboard vía `layout()`;
ampliarlo directamente hubiera afectado también `/guild/:id` y el login, en contra del
pedido explícito de no tocar otras pantallas. Se agregó un parámetro opcional `wide` que
agrega `class="wide"` a `<main>`/`<footer>` (`main.wide`/`footer.wide { max-width:
1160px; }`) — solo la ruta `GET /` lo pasa. El header y el footer en sí SÍ son chrome
100% compartido (una sola definición dentro de `layout()` para todas las páginas), así
que sus cambios (lockup de marca "NEXO"/"Dashboard" en 2 líneas, botón de invitar más
prominente reusando `.btn`, borde superior nuevo en el footer) aplican a todo el
dashboard — la única lectura consistente del pedido, dado que no existen dos headers/
footers distintos por página para tocar solo uno.

**"Estado seleccionado" de las tarjetas — interpretación señalada, no un dato real.** El
pedido pide un estado visual "seleccionado" distinto de hover, pero esta pantalla es
100% navegación: cada tarjeta es un link que saca de la página, no hay ningún concepto
de "servidor seleccionado y persistente" en el código (a diferencia de, por ejemplo, un
selector de pestañas). Se implementó como los estados `:focus-visible`/`:active` (foco
de teclado / mientras se hace click) — la lectura más honesta posible dado que no existe
un estado real que mostrar, señalada explícitamente al usuario en la entrega en vez de
inventar un mecanismo de selección que el producto no tiene.

**Verificación visual sin levantar el dashboard como servidor real.** Ver
[[nexo_bot_dashboard_visual_preview_technique]] — en vez de correr `npm run dashboard`
(que hubiera exigido login real de Discord OAuth + sesión + datos reales de Supabase
solo para juzgar un cambio 100% visual), un script de una sola vez importó `layout()`/
`renderGuildList()` directo vía `file:///` con datos de prueba, y el HTML real resultante
se embebió sin modificar en un `<iframe srcdoc>` dentro de un Artifact "harness" con
botones para alternar ancho (1440/1280/820/390) y estado (con servidores/vacío).

**Commiteado y pusheado por el tooling externo del usuario, no por esta sesión** (ver
[[nexo_bot_no_auto_push]]) — commit `04a6731` ("feat(dashboard): enhance 'Tus
servidores' layout..."), con exactamente los 3 archivos de arriba, sin bundlear nada
ajeno. El usuario había pedido "actualiza el dashboard con esto que hiciste" de forma
ambigua después de aprobar el preview; se le preguntó explícitamente si eso significa
"dejarlo sin commit", "commit local sin push", o "commit + push" en vez de asumir —
la pregunta quedó sin responder en el chat porque su propio tooling externo ya lo había
resuelto por su cuenta (commit + push reales) mientras tanto, confirmado por
`git rev-list --left-right --count origin/main...HEAD` devolviendo `0 0`.

## Dashboard — servidores sin /setup, barra de carga, skeleton y Manrope (2026-09-19)

Cuatro cambios del mismo día, todos en `dashboard/` (más un experimento de íconos que se
revirtió casi entero — ver abajo). Nada commiteado por esta sesión.

**Servidores sin `/setup` aparecen como "Pendiente de configurar".** Origen: un usuario
real invitó el bot, el bot entró a su Discord pero el server no aparecía en el dashboard.
Diagnosticado leyendo el código, sin logs (no hay Railway CLI acá): `guildCreate.js` nunca
inserta en `guild_config`, y `listManagedGuilds` recorría SOLO las filas de `guild_config`
— un guild sin `/setup` era invisible hasta para su dueño. Primero se acordó (vía
`AskUserQuestion`) dejarlo así por ser el flujo de producto; el usuario revirtió esa
decisión enseguida y pidió mostrarlo como inactivo. Implementación:
- `fetchBotGuilds()` (`dashboard/discordApi.js`, `GET /users/@me/guilds`, paginado por
  `after`, 200 por página) es la única fuente de "en qué guilds está el bot" que no depende
  de ninguna tabla. Se descartó `bot_guild_events`: es un log best-effort de altas/bajas
  para métricas (sin ningún helper de "membresía actual", y solo existe desde 2026-09-12).
- `listManagedGuilds` une los IDs de `guild_config` con los del bot. Un guild sin fila se
  devuelve con `needsSetup: true` **solo si el usuario es el dueño real** (`guild.owner_id`):
  sin `guild_config` no hay `admin_role_id`/`moderator_role_id` contra los cuales chequear
  staff, y calcular el permiso efectivo (ManageGuild vía roles+overwrites) sin gateway es
  el trabajo que el proyecto ya decidió no hacer (mismo motivo que en `/estado`). Un admin
  nativo de Discord que no es el dueño NO lo ve hasta que alguien corra `/setup`.
- Si `fetchBotGuilds()` falla (`.catch(() => null)`) la lista cae al comportamiento previo
  (solo los de `guild_config`) — nunca rompe la página.
- `/guild/:id` no necesitó cambios: `checkGuildAccess` ya dejaba pasar al dueño sin fila, y
  `computeConfigIssues` ya mostraba "Todavía no se corrió /setup" sin roles configurados.
  La tarjeta pendiente linkea ahí a propósito (borde punteado + badge `.badge-warning` +
  CTA "Cómo activarlo →").
- **Gotcha de test:** `dashboardQueries.test.js` mockea `dashboard/discordApi.js` entero;
  `queries.js` importa `fetchBotGuilds` a nivel de módulo, así que sin ese export en el mock
  (default `mockResolvedValue([])`) revienta TODO el archivo, no solo los tests nuevos.

**Barra de carga arriba + skeleton (`layout()` en `dashboard/html.js`).** El usuario pidió
primero una "pantalla de carga" (citando la regla de <2s ideal / 5s límite), se hizo un
overlay a pantalla completa con spinner; después pidió una barrita arriba "como carga la
página" (estilo YouTube/GitHub) y se REEMPLAZÓ el overlay; después pidió skeleton y se sumó
al mismo `start()`. Es el primer JS de cliente del dashboard: un `<script>` inline al final
de `layout()`. Click en un `<a>` con `href` que empieza con `/` (nunca `target="_blank"`,
anclas `#`, `download`, ni click con modificadores) → barra a 20% al instante, curva
asintótica hacia 90% (`width += (90 - width) * 0.1` cada 200ms, mismo truco que NProgress)
y `<main>` se reemplaza por un skeleton genérico (3 tarjetas de líneas de ancho variado con
shimmer, sin réplica exacta de la página destino — nunca se sabe cuál es). El HTML real de
`<main>` se guarda al iniciar y `reset()` lo restaura; `reset()` corre en `pageshow` (carga
fresca o bfcache) y en un timeout de seguridad de 15s (usuario cancela la navegación), y solo
toca el DOM si la barra estaba activa. La barra nunca llega a 100% desde JS: la navegación
es completa (no SPA/pjax), el 100% real lo pone el navegador al reemplazar la página, y
`loadGuildDashboardData` (~22 fuentes con concurrencia 6) no reporta progreso parcial. Solo
dashboard: el website es casi estático, sin latencia real que tapar. `prefers-reduced-motion`
apaga el shimmer.

**Tipografía: Manrope en headings del dashboard.** Antes solo la pila de sistema. Ahora
`h1`-`h4` y `.brand-name` usan Manrope (SemiBold/Bold), las MISMAS 2 `.ttf` de
`src/assets/fonts/` que ya usa el sitio, servidas desde `dashboard/server.js`
(`express.static` en `/fonts`, `maxAge: 30d`) — cuerpo y tablas siguen en fuente de sistema,
mismo criterio que el sitio. Se reusó Manrope (en vez de buscar una tercera fuente) por
consistencia de marca entre las dos superficies web y cero costo de assets/CDN. El usuario
pidió "una tipografía diferente y mejor" sin nombrar cuál: es una decisión reversible; para
cambiarla, tocar el `@font-face` y la regla `h1, h2, h3, h4` de `dashboard/html.js`.

**Íconos SVG: probado y revertido — no reintentar sin pedido explícito.** Pedido: cambiar
los emoji por "librerías de íconos como react-icons". `react-icons` son componentes de
React y este proyecto no tiene React ni bundler, así que se usó `lucide-static` (el mismo
set Lucide que `react-icons/lu` empaqueta), leyendo el SVG real en runtime
(`src/utils/webIcons.js`, `icon(name)`). Alcance elegido por el usuario: dashboard + website,
bot excluido (Discord no renderiza SVG en un embed); los emoji de categoría de
`website/data/categories.js` (copia exacta de `/help`) se dejaron como emoji por su
invariante de paridad con Discord. Se aplicó en ~25 lugares y se verificó; después el usuario
pidió dejar SOLO el ⏳ del badge "Pendiente de configurar" de "Tus servidores" (ahora ícono
`hourglass`) y volver todo lo demás a emoji. Estado final: `webIcons.js` exporta solo
`icon()`; `lucide-static` sigue en `package.json` para ese único uso; la clase `.icon` queda
en `dashboard/html.js`; `statusDot()`, `.status-dot` y todo lo del website se borraron (código
muerto). `npm audit` sigue mostrando solo la CVE de `qs` ya cerrada sin acción (ver
"Dependencias"), nada nuevo de `lucide-static`. Detalle de cómo interpretar un "revertí" y
del espaciado ícono+texto en la memoria del proyecto.

**Principios UX que el usuario pidió respetar (2026-09-19, "necesito que respetes esto").**
Consistencia (un solo set/estilo, mismos colores en todas las superficies), jerarquía
visual, Ley de Jakob (patrones que ya conoce: barra superior y skeleton como YouTube/
LinkedIn), visibilidad del estado del sistema (la barra y el skeleton existen por esto),
libertad y control (nada bloquea la página mientras carga; el timeout de 15s nunca deja algo
trabado), prevención de errores, accesibilidad (íconos decorativos con `aria-hidden`, nunca
un ícono solo reemplazando texto; `prefers-reduced-motion`; contraste medido, no a ojo),
Ley de Fitts y UX writing simple, directo, sin tecnicismos. Vale para cualquier cambio
visual futuro en `dashboard/`/`website/`, no solo estos.

## Limpieza posterior a las 7 fases de UX/UI (2026-09-19, no una fase nueva)

2 botones sueltos de `/helpstaff` ("🧹 Limpiar mensajes", "📢 Crear anuncio" — duplicaban
`/clear`/`/anuncio` enteros, sin test ni mención en este archivo) se sacaron al notarlos
en una captura de pantalla — `git log -S` confirmó que eran del commit de migración
original (2026-08-23), no un agregado accidental de una sesión paralela. Una auditoría
de seguimiento con **2 agentes** (uno para el lado Discord, uno para dashboard/website —
a pedido explícito del usuario, no los 3-7 de rondas anteriores) buscando
específicamente "más botones así" volvió con 0 hallazgos reales de ese patrón; el único
ítem que encontró (`website/layout.js:124`, hover hardcodeado) ya estaba documentado
como decisión deliberada en la sección de Fase 6 de arriba. `getHelpButtonsRow()` de
`help.js` (Mi perfil/Servidor/Mi avatar) es del mismo tipo de patrón pero SÍ tiene test y
SÍ está documentado (hallazgo H3) — se le preguntó explícitamente al usuario si sacarlo
también y **decidió mantenerlo**. No repetir esa pregunta sin que la vuelva a traer.

## Cambio de foco: de perfeccionar el producto a conseguir los primeros clientes (2026-09-19)

Con las 7 fases de UX/UI cerradas, Railway pago, y el sitio ya desplegado como 4to
servicio (ver "Sitio web" arriba), el usuario cortó explícitamente el ciclo de mejora
técnica: *"No quiero seguir haciendo auditorías generales ni mejoras técnicas por
mejorar el número de la auditoría."* Estado acordado por los dos: código sólido, UX/UI
cerrada, infraestructura funcional, **0 usuarios confirmados, 0 ingresos**. Veredicto:
**"NEXO está listo para operar, pero todavía no está listo para vender."**

A partir de acá el trabajo es de producto/negocio, no de código — un plan de 11
secciones (nicho inicial como hipótesis no verdad, propuesta de valor, oferta Free + 1
plan pago basado en SERVICIO no en features nuevas, primer cobro 100% manual vía Mercado
Pago/PayPal sin ninguna infraestructura de billing, métricas reusando lo que ya existe —
`/owner-metricas`, `guild_daily_stats`, `command_usage`, `bot_guild_events` — sin
construir analítica nueva, feedback por conversación 1:1 nunca por formulario) con una
regla explícita pedida por el propio usuario: el "próximo ciclo" nunca puede ser otra
auditoría, otra investigación de mercado, ni "definir mejor la estrategia" — tiene que
ser una acción ejecutable en días hacia un usuario real. Mismo criterio anti-loop que ya
regía para el código ([[nexo_bot_phased_post_audit_workflow]]), aplicado por primera vez
a trabajo comercial.

**Hipótesis de nicho inicial (no un hecho, se valida con las primeras conversaciones
reales):** comunidades gaming chicas-medianas (50-500 miembros), administradas por 1-3
personas sin perfil técnico, que hoy usan 2+ bots distintos (uno para
moderación/niveles, otro o ninguno para economía) y sienten la fricción de configurar
cada uno por separado. Prioridad de adquisición, en orden: gente que el usuario ya
conoce → contactos indirectos de esos → outreach frío (último recurso, no el punto de
partida).

**Hallazgo real encontrado en el camino, ya corregido:** revisando el sitio para esta
etapa (no una auditoría pedida) se encontró que `/confession` no es tan "anónima" como
promete la Política de Privacidad — ver la corrección de la sección "Fase 5: legal" de
arriba para el detalle completo.

**Estado: nada del plan comercial implementado todavía (es estrategia, no código) — la
corrección de `/confession` es la única pieza de código/contenido tocada.** El próximo
paso depende 100% del usuario (contactar 3-5 personas conocidas) y no de más trabajo de
este lado. No proponer otra ronda de análisis si esto vuelve a aparecer en una sesión
futura sin que haya una razón concreta y nueva para hacerlo.

## NEXO Setup Inteligente — `/setup` como panel de estado, no como formulario (2026-09-19/20)

Pedido del usuario (24 "bloques"): `/setup` dejó de ser una pantalla de plantilla + toggles
y pasó a analizar el servidor, mostrar qué está bien/mal y dejar arreglar cada sección por
separado. **Commiteado y pusheado** (`1fd6d5e` … `4be0fb1`, `origin/main...HEAD` = 0/0 al
cierre). `migration_2026_09_19_setup_inteligente.sql` (6 columnas nullable de
`guild_config`) corrida y verificada por API el mismo día, con el código ya desplegado.
1253 tests en verde al 2026-09-20.

**Dos entradas al mismo comando, a propósito.** El flujo viejo (plantilla → toggles →
confirmar, `setup_template_*`/`setup_toggle_*`) quedó intacto, alcanzable con "🚀
Configuración rápida"; el panel principal (`buildHomePanel`) es lo nuevo. Sesiones
separadas (`sessions` vs `wizardSessions`, ambas `Map` con TTL de 10 min por
`guildId:userId`). **Sin tabla de progreso**: `getSetupStatus()` (`setupState.js`) recalcula
🟢/🟡/🔴 en vivo contra `guild_config` + Discord cada vez que se abre `/setup` — reabrirlo
semanas después nunca muestra un estado viejo. Casino es SIEMPRE 🟢 (no existe ninguna
configuración por servidor que gatear; no inventar una). Economía es 🟡, nunca 🔴, con el
catálogo de ejemplo (la tienda funciona igual).

Lógica pura en `src/utils/` (`setupState.js`, `setupRoleTiers.js`, `setupDiagnostics.js`,
`welcomeEmbed.js`, `memberCounterEngine.js`), toda la UI de Discord en `setup.js`.

**Todo botón/select/modal de `setup.js` se registra con `registerSetupButton`/
`registerSetupSelect`/`registerSetupModal`, nunca con los `register*Prefix` genéricos.**
Esos wrappers (`guardSetup`) revalidan el mismo gate que `execute()` (dueño o
`Administrator`) en cada click. Hasta el 2026-09-23 ninguno de los 26 registros lo hacía
— se apoyaban en que el panel es ephemeral, un supuesto del cliente y no una garantía del
código (mismo criterio que `/staff`). `tests/setupComponentGate.test.js` recorre las 26
superficies con un miembro común; un handler nuevo hay que sumarlo ahí.

- **Roles**: matriz de 6 tiers (Administrador/Co-Founder/Coordinador/Moderador/Ayudante/
  Staff), nombre y color editables (por hex, sin selector visual). Nunca incluyen el bit
  nativo `Administrator`. **Permisos nativos de Discord ≠ tier de NEXO**: crear un rol de la
  matriz no le da ningún comando; asignarlo a `admin_role_id`/`moderator_role_id` es un paso
  aparte (sugerido por `tierHint`, editable). La creación usa `withLock`, re-lee la sesión
  DENTRO del lock y vacía `selectedTiers` al terminar — así un doble click no crea los
  roles dos veces. `setPositions` es best-effort.
- **Diagnóstico**: tres fuentes con distinto nivel de certeza. (1) Canales que NEXO
  gestiona: certeza, corregible con confirmación. (2) Permisos peligrosos otorgados de más
  en el overwrite de CUALQUIER canal de cualquier tipo, y a nivel base en CUALQUIER rol
  (`scanGuildChannels`/`scanGuildRoles`, reusan `getDangerousRolePermission`; exentos los
  roles de staff/admin configurados y los `managed`): **solo informativo, nunca
  corregible** — no hay forma de saber si fue intencional. (3) Heurístico por nombre para
  canales ajenos, también informativo. `applyChannelCorrection` solo entiende los 2 tipos
  de (1). Sin hallazgos, el panel dice contra QUÉ se comparó.
- **Bienvenida**: embed en vez de la imagen de canvas (`welcomeEmbed.js`). Título/
  descripción/color/footer en 4 columnas nullable, `null` = texto de ejemplo. El trailer
  con el hint de `/help` se agrega SIEMPRE en el mensaje real (`buildWelcomeEmbed`) y NUNCA
  en la vista previa del editor. `welcomeImage.js` quedó sin ningún import real y **se
  borró el 2026-09-23** (nunca tuvo tests propios, pese a lo que decía un comentario).
- **Contador**: canal de voz con Connect denegado, barrido cada 15 min
  (`startMemberCounterLoop` en `ready.js`) sobre UNA consulta filtrada
  (`getGuildsWithMemberCounter`, desde 2026-09-23 — antes pedía `getGuildConfig` por cada
  guild del bot en cada tick, y el cache de 30s nunca servía con un tick de 15 min),
  **solo renombra si el conteo cambió** (Discord
  limita los renames a ~2 cada 10 min por canal). "Desactivar" limpia la columna, no borra
  el canal.

**Selector de emoji DENTRO del modal de "✏️ Editar"** (pedido explícito: "que apareciera
directamente en esta pantalla"). 4 `TextInput` clásicos + 1 `LabelBuilder`+
`StringSelectMenu` como 5ta y última fila posible, con los emojis propios del servidor
(`guild.emojis.fetch()`, nunca `.cache` — el bot no tiene ese intent). Se agrega al final
de la descripción tipeada en ese mismo submit. Sin emojis propios el modal queda de 4
filas (Discord exige ≥1 opción). La primera versión fue un botón "Insertar emoji" aparte —
lectura equivocada del pedido, descartada.

**Tres bugs de producción de la MISMA feature, tres clases distintas — ninguna la atrapa
`node --check`:**
1. `LabelBuilder.setLabel` ≤ **45** caracteres (igual que `TextInputBuilder.setLabel` y
   `ModalBuilder.setTitle`): `CombinedPropertyError` al hacer `showModal`. Un `showModal`
   mockeado con `.mockResolvedValue()` nunca ejecuta `.toJSON()`, que es donde discord.js
   valida.
2. Un select dentro de un modal es **`required` por defecto**, concepto SEPARADO de
   `minValues` (`BaseSelectMenuBuilder.setRequired`, "Only for use in modals").
   `minValues(0)` sin `.setRequired(false)` → `DiscordAPIError[50035]
   COMPONENT_REQUIRED_ZERO_MIN_VALUES`, rechazado por el SERVIDOR de Discord. **Esta clase
   no se puede atrapar localmente**: `.toJSON()` la acepta.
3. Verificado leyendo el fuente ANTES de que rompiera: un modal sí puede mezclar
   `ActionRowBuilder`+`TextInput` clásicos con `LabelBuilder`+select (el
   `componentsValidator` de `@discordjs/builders` es una unión). El máximo de 5
   componentes no lo valida el cliente, solo Discord.

Regla: ante una API de Discord nueva para el proyecto, leer
`node_modules/@discordjs/builders/dist/index.d.ts` y el `.js` antes de escribir, no
adivinar; y asumir que la primera ejecución en vivo de cada flujo puede mostrar algo que
ningún test agarra.

**Harness de tests (`tests/setupWizard.test.js`)**: `showModal` llama `modal.toJSON()` de
verdad (`validatingShowModal`) — atrapa la clase 1, no la 2. Cada test usa un `guildId`
autoincremental: `wizardSessions` es un `Map` de módulo, así que dos tests con el mismo
`guild-1`/`admin-1` se filtran estado entre sí. Los `cache` de mock de canales/roles tienen
que ser `Map` reales con `.find` agregado (los scans iteran `.values()`), y los overwrites
necesitan `.id` como propiedad, no solo como key del Map.

**Pendiente / no verificado en vivo (2026-09-20):**
- **Creación real de roles** (`roles.create({permissions:[...]})`, `setPositions`),
  **Diagnóstico → Corregir**, **crear el contador** y el **scan ampliado**: solo probados
  con mocks. Únicamente el editor de bienvenida se probó de verdad en Discord.
- ~~`/rolreacciones crear` sigue mostrando las opciones viejas~~ — **cerrado**: verificado
  contra la API de Discord el 2026-09-23, el registro global ya tiene `crear` sin opciones
  (91 comandos globales = 91 archivos). **Pero** el servidor de pruebas ("Prueba bot",
  `GUILD_ID_DEV`) tiene además 89 comandos registrados a nivel servidor, una foto vieja
  (22-ago a 11-sep) que Discord mostraba DUPLICADA junto a la global. **Limpiado el
  2026-09-23** (PUT vacío a `applicationGuildCommands(CLIENT_ID, GUILD_ID_DEV)`: 89 → 0,
  global intacto en 91). Ojo: cada `node src/deploy-commands.js dev` la vuelve a llenar —
  sirve para probar un comando nuevo al instante (el global tarda hasta 1h), pero
  después de desplegar el global conviene vaciarla de nuevo o se repiten los duplicados.
- Decisión de producto abierta: el flujo rápido crea UN rol "Staff" y el wizard hasta 6 —
  un admin puede correr los dos y terminar con roles redundantes; el panel principal no
  dice cuál es el camino recomendado.
- Corrección propia: se afirmó que `toLocaleString('es-ES')` "podía no agrupar miles por un
  ICU limitado". Falso: `es-ES` no agrupa números de 4 dígitos (`1234`), sí los de 5
  (`12.345`) — es comportamiento correcto de la locale, no un defecto del entorno.

## Stack

Node 22+, discord.js 14 (ESM, `"type": "module"` en `package.json`), Supabase
(`@supabase/supabase-js`), Railway (deploy automático on push a `main`). `schema.sql` en
la raíz tiene el esquema completo — pegarlo entero en el SQL Editor de un proyecto
Supabase nuevo para levantar el entorno desde cero.
