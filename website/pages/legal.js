// Legal (ToS + Privacidad) — hasta acá vivían como 2 artifacts privados de claude.ai
// linkeados desde el footer del sitio (website/layout.js) y desde ningún lado del
// dashboard. Plan de ejecución post-auditoría, Fase 5 (2026-09-12): páginas reales del
// propio dominio de NEXO, mismo patrón que /docs y /faq (renderPage + secciones planas,
// sin motor de templates). Contenido migrado del texto que ya existía en esos 2
// artifacts (redactado en su momento, nunca revisado por un abogado — sigue sin serlo,
// el aviso de "plantilla genérica" se mantiene a propósito) con UNA corrección real de
// fondo: la sección de derechos de Privacidad prometía "borrado de tus datos en un
// servidor puntual" como si fuera autoservicio — el código de hoy (guildDelete.js) solo
// borra un servidor ENTERO cuando el Bot es expulsado; no existe ningún mecanismo de
// autoservicio para que un usuario puntual borre sus propios datos dentro de un server
// que sigue activo. Corregido para describir lo que el Bot puede hacer HOY (automático
// a nivel servidor, manual/a pedido a nivel de un usuario puntual) — nunca prometer una
// función que no existe.
const LAST_UPDATED = '12 de septiembre de 2026';

function legalNotice(text) {
  return `<div class="docs-card" data-reveal><p><strong>Nota:</strong> ${text}</p></div>`;
}

export function renderTermsPage() {
  return `
<section class="tight">
  <div class="wrap" style="max-width:720px">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Legal · Última actualización: ${LAST_UPDATED}</span>
      <h1>Términos de Servicio</h1>
    </div>

    ${legalNotice('esta es una plantilla genérica de referencia, no un documento revisado por un abogado. Si tu comunidad opera en jurisdicciones con requisitos legales específicos, hacela revisar antes de considerarla vinculante.')}

    <div data-reveal>
      <h2>1. Aceptación</h2>
      <p>Al invitar a NEXO ("el Bot") a un servidor de Discord, o al usar cualquiera de sus comandos, aceptás estos Términos de Servicio. Si administrás un servidor, sos responsable de que quienes lo usan estén de acuerdo con estos términos.</p>

      <h2>2. Qué es el Bot</h2>
      <p>NEXO es un bot de Discord de uso general para comunidades: sistema de economía virtual, niveles/XP, moderación, sorteos, trivia, salas de voz temporales, constructor de anuncios y tienda configurable. No cobra dinero real ni procesa pagos — todas las "monedas" son puntos internos sin valor fuera del servidor donde se usan.</p>

      <h2>3. Uso aceptable</h2>
      <p>No está permitido:</p>
      <ul class="docs-list">
        <li>Usar el Bot para violar los <a href="https://discord.com/terms" target="_blank" rel="noopener">Términos de Servicio</a> o las <a href="https://discord.com/guidelines" target="_blank" rel="noopener">Guías de la Comunidad</a> de Discord.</li>
        <li>Intentar explotar, saturar de solicitudes, o interferir con el funcionamiento normal del Bot.</li>
        <li>Usar el Bot para acosar, amenazar o dañar a otros usuarios.</li>
        <li>Automatizar interacciones con el Bot mediante self-bots o herramientas de terceros no autorizadas.</li>
      </ul>

      <h2>4. Moderación y administradores de servidor</h2>
      <p>El Bot da a los administradores de cada servidor herramientas de moderación (advertencias, expulsiones, baneos, restricciones) y de configuración (<code>/setup</code>, <code>/config</code>). El uso que un servidor hace de esas herramientas es responsabilidad de sus propios administradores, no de quien desarrolla el Bot.</p>

      <h2>5. Disponibilidad</h2>
      <p>El Bot se ofrece "tal cual", sin garantía de disponibilidad continua. Puede haber interrupciones por mantenimiento, actualizaciones, o problemas técnicos de terceros (Discord, el proveedor de hosting, la base de datos). No se garantiza que los datos (balances, niveles, warnings, etc.) se conserven indefinidamente, aunque se hace un esfuerzo razonable por no perderlos.</p>

      <h2>6. Cambios en el servicio</h2>
      <p>Los comandos, funciones y estos Términos pueden cambiar sin aviso previo. El uso continuado del Bot después de un cambio implica la aceptación de la versión actualizada.</p>

      <h2>7. Eliminación de datos</h2>
      <p>Si un servidor expulsa al Bot, su configuración y el resto de sus datos asociados se borran automáticamente (ver la <a href="/legal/privacidad">Política de Privacidad</a> para el detalle exacto de qué se borra). Para pedir el borrado de los datos de un usuario puntual dentro de un servidor que sigue activo — hoy un proceso manual, no un botón de autoservicio — contactá al operador del Bot por los medios que indique en <a href="/faq">soporte</a>.</p>

      <h2>8. Limitación de responsabilidad</h2>
      <p>El Bot se provee sin garantías de ningún tipo. Quien lo opera no es responsable por pérdidas de datos, interrupciones del servicio, ni por el uso que terceros hagan de las herramientas de moderación o economía que el Bot ofrece.</p>

      <p style="margin-top:2rem">Ver también la <a href="/legal/privacidad">Política de Privacidad</a> para el detalle de qué datos procesa el Bot y por qué.</p>
    </div>
  </div>
</section>`;
}

export function renderPrivacyPage() {
  return `
<section class="tight">
  <div class="wrap" style="max-width:720px">
    <div class="section-head" data-reveal>
      <span class="eyebrow">Legal · Última actualización: ${LAST_UPDATED}</span>
      <h1>Política de Privacidad</h1>
    </div>

    ${legalNotice('esta es una plantilla genérica de referencia, no un documento revisado por un abogado. Si tu comunidad tiene usuarios en la UE u otras jurisdicciones con requisitos específicos (ej. GDPR), hacela revisar antes de considerarla vinculante.')}

    <div data-reveal>
      <h2>1. Qué datos procesa el Bot</h2>
      <p>NEXO solo guarda lo que necesita para que sus comandos funcionen. Todo queda asociado a tu ID de Discord (un número, no tu nombre real) y al servidor donde lo usaste — nunca se mezcla entre servidores distintos.</p>

      <div class="docs-card">
        <p><strong>ID de usuario y de servidor</strong> — identificar a quién pertenece cada balance, nivel, warning, etc.</p>
        <p><strong>Balance de economía + historial de movimientos</strong> — que <code>/balance</code>, <code>/daily</code>, <code>/economia-staff historial</code> funcionen.</p>
        <p><strong>XP y nivel</strong> — que <code>/nivel</code>, <code>/ranking</code> y los roles automáticos funcionen.</p>
        <p><strong>Advertencias</strong> (motivo, quién la aplicó) — historial de moderación (<code>/warns</code>, <code>/sanciones</code>).</p>
        <p><strong>IDs de roles/canales configurados</strong> — que <code>/setup</code> y <code>/config</code> recuerden la configuración del servidor.</p>
        <p><strong>Puntos de trivia y logros desbloqueados</strong> — rankings y progreso de <code>/perfil</code>.</p>
        <p style="margin:0"><strong>Estadísticas agregadas de voz</strong> (duración, cantidad de usuarios) — nada visible al usuario todavía; nunca identifica qué dijiste ni con quién hablaste.</p>
      </div>

      <p>El contenido de los mensajes de texto se procesa <strong>de forma transitoria</strong> en dos casos puntuales, sin guardarse nunca: para calcular si un mensaje es elegible para XP (longitud, si es repetido) y para detectar si alguien pegó por accidente un token/secreto (el mensaje se borra automáticamente, nunca se guarda el secreto en texto plano).</p>

      <h2>2. Lo que el Bot NO recolecta</h2>
      <ul class="docs-list">
        <li>Nombre real, email, teléfono o dirección.</li>
        <li>Contraseñas o tokens de tu cuenta de Discord.</li>
        <li>Datos de pago — el Bot no cobra dinero real ni procesa transacciones.</li>
        <li>Historial completo de mensajes (solo lo mínimo, transitorio, descrito arriba).</li>
        <li>Ubicación o dirección IP.</li>
      </ul>

      <h2>3. Dónde se guardan los datos</h2>
      <p>Los datos viven en una base de datos Postgres administrada por <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a>, y el proceso del Bot corre en <a href="https://railway.com" target="_blank" rel="noopener">Railway</a>. Ninguno de los dos se usa para nada más que operar el Bot — no se venden ni se comparten datos con terceros con fines comerciales.</p>

      <h2>4. Con quién se comparte</h2>
      <ul class="docs-list">
        <li><strong>Discord</strong> — recibe lo que cualquier bot recibe para funcionar (mensajes, eventos del servidor), sujeto a la <a href="https://discord.com/privacy" target="_blank" rel="noopener">Política de Privacidad de Discord</a>.</li>
        <li><strong>Los administradores de tu propio servidor</strong> — pueden ver warnings, balances y logs de moderación de los miembros de SU servidor a través de los comandos de staff, igual que con cualquier bot de moderación.</li>
      </ul>

      <h2>5. Cuánto tiempo se conservan los datos</h2>
      <p>Mientras el Bot siga en tu servidor. Si el servidor lo expulsa, la configuración y los datos asociados a ese servidor se borran automáticamente (ver la sección siguiente) — no quedan "colgados" a la espera de un pedido.</p>

      <h2>6. Tus derechos</h2>
      <p>Podés pedir en cualquier momento que se te informe qué datos tuyos hay guardados en un servidor. Sobre el borrado, hay dos caminos reales, no uno solo:</p>
      <ul class="docs-list">
        <li><strong>Servidor completo:</strong> automático — en cuanto el Bot es expulsado de un servidor (o el servidor se borra), todos los datos asociados a ese servidor se eliminan solos, sin que nadie tenga que pedirlo.</li>
        <li><strong>Un usuario puntual, dentro de un servidor que sigue activo:</strong> no hay todavía un botón de autoservicio para esto — se gestiona a mano, a pedido, contactando al operador del Bot por los medios que indique en <a href="/faq">soporte</a>.</li>
      </ul>

      <h2>7. Menores de edad</h2>
      <p>El Bot sigue los mismos requisitos de edad mínima que Discord. No se recolecta intencionalmente información de menores por fuera de lo que ya procesa Discord como plataforma.</p>

      <p style="margin-top:2rem">Ver también los <a href="/legal/terminos">Términos de Servicio</a> para las condiciones de uso del Bot.</p>
    </div>
  </div>
</section>`;
}

