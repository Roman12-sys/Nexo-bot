// Sitio oficial de NEXO — 3er servicio Express sobre el mismo repo (junto al bot y al
// dashboard), pero deliberadamente MÁS aislado que los otros dos: no importa
// src/config.js ni src/utils/errorReporter.js (ambos exigen o usan DISCORD_TOKEN/
// SUPABASE_SERVICE_ROLE_KEY) — un sitio público de marketing no tiene ninguna razón para
// tener esos secrets en memoria. Ver website/config.js para el detalle completo de esta
// decisión.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { websiteConfig } from './config.js';
import { renderPage } from './layout.js';
import { renderHomePage } from './pages/home.js';
import { renderCommandsPage } from './pages/commands.js';
import { renderDocsPage } from './pages/docs.js';
import { renderFaqPage } from './pages/faq.js';
import { renderStatusPage } from './pages/status.js';
import { renderChangelogPage } from './pages/changelog.js';
import { renderTermsPage, renderPrivacyPage } from './pages/legal.js';
import { registerShutdown } from '../src/utils/shutdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', 'src', 'assets', 'fonts'); // reusa las mismas 2 fuentes que ya usa @napi-rs/canvas — no se duplican archivos.

// Red de seguridad general, mismo criterio que dashboard/server.js — SIN
// reportCriticalError (ese helper necesita DISCORD_TOKEN, que este proceso no tiene a
// propósito). Un fallo acá se pierde en los logs de Railway, aceptable: es el proceso de
// menor criticidad de los 3 (marketing estático, sin escritura a ningún lado).
process.on('unhandledRejection', (reason) => {
  console.error('❌ Promesa rechazada sin manejar (website):', reason);
});
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada (website), reiniciando el proceso:', error);
  process.exit(1);
});

const app = express();
app.disable('x-powered-by');

app.use('/fonts', express.static(FONTS_DIR, { maxAge: '30d', immutable: true }));

app.get('/', (req, res) => {
  res.send(renderPage({
    title: 'NEXO — Bot para comunidades de Discord',
    description: 'NEXO es la plataforma para administrar y hacer crecer tu comunidad de Discord: moderación, economía, progresión y herramientas de gestión, todo en un solo bot.',
    path: '/',
    bodyHtml: renderHomePage(),
  }));
});

app.get('/commands', (req, res) => {
  res.send(renderPage({
    title: 'Comandos — NEXO',
    description: 'Explorador de comandos de NEXO, generado directo desde el código del bot: buscador y filtro por categoría.',
    path: '/commands',
    bodyHtml: renderCommandsPage(),
  }));
});

app.get('/docs', (req, res) => {
  res.send(renderPage({
    title: 'Documentación — NEXO',
    description: 'Cómo instalar, configurar y usar NEXO: primeros pasos, permisos, roles, canales y funciones.',
    path: '/docs',
    bodyHtml: renderDocsPage(),
  }));
});

app.get('/faq', (req, res) => {
  res.send(renderPage({
    title: 'Preguntas frecuentes — NEXO',
    description: 'Respuestas a las preguntas más comunes sobre NEXO: instalación, permisos, personalización y soporte.',
    path: '/faq',
    bodyHtml: renderFaqPage(),
  }));
});

app.get('/status', async (req, res) => {
  res.send(renderPage({
    title: 'Estado — NEXO',
    description: 'Estado de los servicios de NEXO.',
    path: '/status',
    bodyHtml: await renderStatusPage(),
  }));
});

app.get('/changelog', (req, res) => {
  res.send(renderPage({
    title: 'Changelog — NEXO',
    description: 'Historial real de NEXO, fase por fase.',
    path: '/changelog',
    bodyHtml: renderChangelogPage(),
  }));
});

// Legal (plan de ejecución post-auditoría, Fase 5, 2026-09-12) — antes eran 2 links del
// footer apuntando a artifacts privados de claude.ai (nadie fuera de esta cuenta podía
// abrirlos), ver website/pages/legal.js para el detalle completo de la migración.
app.get('/legal/terminos', (req, res) => {
  res.send(renderPage({
    title: 'Términos de Servicio — NEXO',
    description: 'Condiciones de uso de NEXO: qué está permitido, disponibilidad del servicio y responsabilidad.',
    path: '/legal/terminos',
    bodyHtml: renderTermsPage(),
  }));
});

app.get('/legal/privacidad', (req, res) => {
  res.send(renderPage({
    title: 'Política de Privacidad — NEXO',
    description: 'Qué datos procesa NEXO, para qué, dónde se guardan y cómo pedir su borrado.',
    path: '/legal/privacidad',
    bodyHtml: renderPrivacyPage(),
  }));
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    websiteConfig.siteUrl
      ? `User-agent: *\nAllow: /\nSitemap: ${websiteConfig.siteUrl}/sitemap.xml\n`
      : 'User-agent: *\nAllow: /\n',
  );
});

// Rutas conocidas hoy — se suma cada ruta nueva a medida que se construye. No se listan
// rutas que todavía no existen: un sitemap con URLs que 404 es peor que uno corto.
const KNOWN_ROUTES = ['/', '/commands', '/docs', '/faq', '/status', '/changelog', '/legal/terminos', '/legal/privacidad'];

app.get('/sitemap.xml', (req, res) => {
  if (!websiteConfig.siteUrl) {
    res.status(404).type('text/plain').send('Sitemap no disponible: falta configurar WEBSITE_BASE_URL en este entorno.');
    return;
  }
  const urls = KNOWN_ROUTES.map((route) => `  <url><loc>${websiteConfig.siteUrl}${route}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

app.use((req, res) => {
  res.status(404).send(renderPage({
    title: 'Página no encontrada — NEXO',
    description: 'Esta página no existe.',
    path: req.path,
    bodyHtml: '<section class="tight"><div class="wrap section-head"><h2>404 — Página no encontrada</h2><p><a href="/">Volver al inicio</a></p></div></section>',
  }));
});

// Mismo patrón de testabilidad que dashboard/server.js: exportar `app` y dejar
// app.listen() detrás de un guard que solo corre al ejecutar el archivo directo.
export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = app.listen(websiteConfig.port, () => {
    console.log(`🌐 Sitio de NEXO corriendo en el puerto ${websiteConfig.port}`);
  });

  registerShutdown(['SIGTERM', 'SIGINT'], () => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
}
