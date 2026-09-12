import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

// Mismo criterio que tests/dashboardServer.test.js (TEST-3, Fase 4B): server real
// (node:http) + fetch como cliente, sin supertest — el proyecto no lo tiene como
// dependencia. website/server.js exporta `app` detrás del mismo guard de
// testabilidad que dashboard/server.js (app.listen solo corre si el archivo se
// ejecuta directo), así que importarlo acá nunca abre un puerto real por su cuenta.
//
// getDiscordPlatformStatus se mockea: pega contra discordstatus.com real (API pública,
// sin auth) — un test que dependa de la red real sería lento y flaky. Se verificó a
// mano (sesión de Fase 5) que la integración real funciona; acá solo se prueba que
// /status renderiza lo que esa función devuelva, sea lo que sea.
const getDiscordPlatformStatus = vi.fn().mockResolvedValue({ known: true, indicator: 'none', label: 'Operativo' });
vi.mock('../website/data/discordStatus.js', () => ({ getDiscordPlatformStatus }));

process.env.CLIENT_ID = 'test-client-id-123';

function get(baseUrl, path) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual' });
}

describe('website/server.js — sin DASHBOARD_BASE_URL/SUPPORT_CONTACT/WEBSITE_BASE_URL configuradas', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    delete process.env.DASHBOARD_BASE_URL;
    delete process.env.SUPPORT_CONTACT;
    delete process.env.WEBSITE_BASE_URL;
    vi.resetModules();
    const { app } = await import('../website/server.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET / responde 200 con el hero y sin secrets en el HTML', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('Tu servidor.');
    expect(body).toContain('Añadir NEXO');
    // Nunca debería poder aparecer un token/secreto acá — este proceso ni los tiene en memoria.
    expect(body.toLowerCase()).not.toContain('discord_token');
    expect(body).not.toContain(process.env.CLIENT_ID + '_SECRET');
  });

  it('GET / sin DASHBOARD_BASE_URL: no muestra "Iniciar sesión" y el CTA del dashboard cae a "Añadir NEXO para acceder"', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).not.toContain('Iniciar sesión');
    expect(body).toContain('Añadir NEXO para acceder');
  });

  it('GET / sin SUPPORT_CONTACT: el footer no inventa un contacto', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).not.toMatch(/Soporte<\/h4>\s*<ul>\s*<li>(?!.*FAQ)/s);
  });

  it('GET /commands responde 200 con comandos reales generados desde el código', async () => {
    const res = await get(baseUrl, '/commands');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('/ban');
    expect(body).toContain('Banear miembros');
    expect(body).not.toContain('/sorteo participar'); // subcomando que nunca existió (bug real de Fase 4, corregido en Fase 5)
  });

  it('GET /docs, /faq, /status, /changelog, /legal/terminos, /legal/privacidad responden 200', async () => {
    for (const path of ['/docs', '/faq', '/status', '/changelog', '/legal/terminos', '/legal/privacidad']) {
      const res = await get(baseUrl, path);
      expect(res.status, `${path} debería dar 200`).toBe(200);
    }
  });

  // Plan de ejecución post-auditoría, Fase 5 (2026-09-12) — antes estos 2 links del
  // footer apuntaban a artifacts privados de claude.ai (nadie fuera de esta cuenta podía
  // abrirlos). Ahora son páginas reales del propio sitio.
  it('el footer linkea Términos/Privacidad como rutas propias, nunca a claude.ai', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).toContain('href="/legal/terminos"');
    expect(body).toContain('href="/legal/privacidad"');
    expect(body).not.toContain('claude.ai');
  });

  it('/legal/privacidad es honesta sobre el borrado por usuario: manual, no autoservicio', async () => {
    const res = await get(baseUrl, '/legal/privacidad');
    const body = await res.text();

    expect(body).toContain('no hay todavía un botón de autoservicio');
  });

  it('GET /status usa el valor real de getDiscordPlatformStatus (mockeado)', async () => {
    const res = await get(baseUrl, '/status');
    const body = await res.text();

    expect(getDiscordPlatformStatus).toHaveBeenCalled();
    expect(body).toContain('Operativo');
    expect(body).toContain('Sin datos públicos'); // bot/dashboard/DB, honesto, sin inventar un semáforo
  });

  it('GET /fonts/Manrope-Bold.ttf sirve la fuente real (reusada de src/assets/fonts)', async () => {
    const res = await get(baseUrl, '/fonts/Manrope-Bold.ttf');
    expect(res.status).toBe(200);
  });

  it('GET /robots.txt sin WEBSITE_BASE_URL: no anuncia un Sitemap', async () => {
    const res = await get(baseUrl, '/robots.txt');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain('Sitemap:');
  });

  it('GET /sitemap.xml sin WEBSITE_BASE_URL: 404 explícito, nunca un dominio inventado', async () => {
    const res = await get(baseUrl, '/sitemap.xml');
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(body).not.toMatch(/https?:\/\//); // ninguna URL absoluta inventada en el cuerpo
  });

  it('una ruta desconocida da 404 con el layout real (nunca el 404 default de Express)', async () => {
    const res = await get(baseUrl, '/esto-no-existe');
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(body).toContain('Página no encontrada');
    expect(body).toContain('Volver al inicio');
  });
});

describe('website/server.js — con DASHBOARD_BASE_URL/SUPPORT_CONTACT/WEBSITE_BASE_URL configuradas', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    process.env.DASHBOARD_BASE_URL = 'https://dashboard.ejemplo.test/';
    process.env.SUPPORT_CONTACT = 'discord.gg/soporte-ejemplo';
    process.env.WEBSITE_BASE_URL = 'https://nexo.ejemplo.test/';
    vi.resetModules();
    const { app } = await import('../website/server.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.DASHBOARD_BASE_URL;
    delete process.env.SUPPORT_CONTACT;
    delete process.env.WEBSITE_BASE_URL;
  });

  it('la barra final de DASHBOARD_BASE_URL/WEBSITE_BASE_URL se recorta (mismo criterio que dashboard/config.js)', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).toContain('https://dashboard.ejemplo.test/auth/login');
    expect(body).not.toContain('https://dashboard.ejemplo.test//auth/login');
  });

  it('GET / con DASHBOARD_BASE_URL: muestra "Iniciar sesión" y "Abrir Dashboard"', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).toContain('Iniciar sesión');
    expect(body).toContain('Abrir Dashboard');
  });

  it('GET / con SUPPORT_CONTACT: lo muestra en el footer', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).toContain('discord.gg/soporte-ejemplo');
  });

  it('GET / con WEBSITE_BASE_URL: incluye canonical y og:url absolutos', async () => {
    const res = await get(baseUrl, '/');
    const body = await res.text();

    expect(body).toContain('<link rel="canonical" href="https://nexo.ejemplo.test/">');
    expect(body).toContain('<meta property="og:url" content="https://nexo.ejemplo.test/">');
  });

  it('GET /robots.txt con WEBSITE_BASE_URL: anuncia el Sitemap real', async () => {
    const res = await get(baseUrl, '/robots.txt');
    const body = await res.text();

    expect(body).toContain('Sitemap: https://nexo.ejemplo.test/sitemap.xml');
  });

  it('GET /sitemap.xml con WEBSITE_BASE_URL: 200 con las rutas reales, ninguna 404', async () => {
    const res = await get(baseUrl, '/sitemap.xml');
    const body = await res.text();

    expect(res.status).toBe(200);
    for (const path of ['/', '/commands', '/docs', '/faq', '/status', '/changelog', '/legal/terminos', '/legal/privacidad']) {
      expect(body).toContain(`<loc>https://nexo.ejemplo.test${path}</loc>`);
    }
  });
});

describe('website/config.js', () => {
  it('sin CLIENT_ID, el proceso no puede arrancar (mismo criterio que src/config.js y dashboard/config.js)', async () => {
    const originalClientId = process.env.CLIENT_ID;
    delete process.env.CLIENT_ID;
    vi.resetModules();

    await expect(import('../website/config.js')).rejects.toThrow('CLIENT_ID');

    process.env.CLIENT_ID = originalClientId;
  });
});
