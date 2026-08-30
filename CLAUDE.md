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
sumidero, es una compensación). `/pet pelear` tampoco transfiere plata entre los dos
jugadores — el premio lo pone "la casa", igual que un `/work` — a propósito, para no
abrir la misma puerta de lavado entre alts que ya vigila `giveTracker.js` para `/give`.

`/vender` es el primer lugar donde se puede recuperar parte de lo gastado: 50% del
precio de un ítem de vuelta, pero nunca de ítems con `roleId` (el rol ya se entregó,
"devolverlo" sería cobrar dos veces por el mismo rol si se recompra después).

## Mascotas (`/pet`)

Una mascota por usuario, a propósito — no hay cría/breeding entre mascotas de dos
usuarios. Se evaluó y se descartó: hubiera significado rehacer `getPet`, el cálculo del
bonus y medio comando `/pet`, que asumen una sola mascota en todos lados. En cambio, la
misma mascota "crece" con el cuidado: evoluciona de etapa (Cría → Adulto → Veterano →
Legendario) según el nivel, y el bonus a `/work`/`/crime` escala con la etapa (`getPetStage`
en `src/utils/petsStore.js`).

Hambre y felicidad decaen solas con el tiempo, calculado lazy (sin cron) — pero cada una
decae desde SU PROPIO último toque (`last_fed` para hambre, `last_played` para
felicidad), nunca un reloj único compartido entre las dos. Es el mismo tipo de bug que
el del interés del banco (arriba), evitado desde el diseño en vez de parcheado después.

Descuidar la mascota nunca la "mata" ni le borra progreso — solo le saca el bonus hasta
que se la cuide de nuevo. Decisión deliberada para que el sistema no sea punitivo/de
culpa (a diferencia de un Tamagotchi clásico).

## Gotchas ya pisados (además del de las columnas de cooldown, arriba)

**Emoji dentro de un canvas.** `@napi-rs/canvas` (usado en `welcomeImage.js`,
`rankCardImage.js`, `petCardImage.js`) no tiene ninguna fuente de emoji de color
disponible en el contenedor de Railway — cualquier emoji dibujado con `ctx.fillText()`
se ve como un cuadrado vacío, sin ningún error que lo avise. Pasó dos veces en la misma
sesión (una vez arreglado en `rankCardImage.js`, después repetido sin querer en
`petCardImage.js` recién escrito). Nunca poner un emoji en texto de canvas — usar texto
+ color, o formas dibujadas a mano (`ctx.arc`/`ctx.ellipse`, ver la huella de
`petCardImage.js`). Y no alcanza con que la función no tire error: hay que generar la
imagen de verdad, guardarla y mirarla antes de darla por buena.

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
que una tabla fallando no frene la limpieza de las demás.

**Al agregar una tabla nueva con columna `guild_id`, hay que sumarla a ese array a
mano** — no hay forma automática de detectarlo (introspección de schema es más frágil
que una lista explícita acá). Dos tablas quedan afuera a propósito:
- `reminders` — se entregan por DM, `guild_id` es solo referencia de dónde se creó, no
  acota la entrega; borrar el recordatorio de un usuario porque el bot se fue de ESE
  server no tiene sentido.
- `lol_patch_state` — una sola fila fija (`league_of_legends`), sin `guild_id`.

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
  `pet_battle_win`/`sell`, mensaje o voz). Cuenta para todo.
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

## Stack

Node 22+, discord.js 14 (ESM, `"type": "module"` en `package.json`), Supabase
(`@supabase/supabase-js`), Railway (deploy automático on push a `main`). `schema.sql` en
la raíz tiene el esquema completo — pegarlo entero en el SQL Editor de un proyecto
Supabase nuevo para levantar el entorno desde cero.
