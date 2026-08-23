# Nexo Bot

Bot de Discord multi-servidor: economía, XP/niveles, moderación, sorteos, trivia, salas
de voz temporales (Join to Create), constructor de anuncios, tienda, y comandos de
diversión/acción. Un solo proceso atiende a cualquier cantidad de servidores — cada uno
se configura solo con `/setup` y `/config`, sin tocar código ni variables de entorno.

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

6. **En Discord**: invitar al bot al servidor y correr `/setup` — crea el rol de staff
   y los canales de logs, y activa los módulos que elijas (moderación/economía/XP).
   `/config` cubre lo que `/setup` no crea automáticamente: rol de castigo, rol
   automático para miembros nuevos, canal de bienvenida, canal de confesiones.

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
