import { vi, describe, it, expect, beforeEach } from 'vitest';

// reportCriticalError manda por REST directo (no client.channels.fetch) para poder
// llamarse desde el bot Y desde el dashboard, que son dos procesos separados — ver el
// comentario del propio archivo. Se mockea src/config.js (mismo objeto mutado entre
// tests, no reasignado — la referencia que ve errorReporter.js es siempre la misma) y
// fetch global (mismo patrón que lolPatchMonitor.test.js).
const mockConfig = { operatorAlertChannelId: null, discordToken: 'test-bot-token' };
vi.mock('../src/config.js', () => ({ config: mockConfig }));

const { reportCriticalError } = await import('../src/utils/errorReporter.js');

beforeEach(() => {
  mockConfig.operatorAlertChannelId = '999999999999999999';
  mockConfig.discordToken = 'test-bot-token';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) }));
});

describe('reportCriticalError — configuración', () => {
  it('no manda nada si OPERATOR_ALERT_CHANNEL_ID no está configurado', async () => {
    mockConfig.operatorAlertChannelId = null;

    await reportCriticalError(null, 'contexto-sin-canal', new Error('no debería mandarse'));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('nunca tira una excepción, incluso si fetch rechaza', async () => {
    fetch.mockRejectedValue(new Error('network down'));

    await expect(reportCriticalError(null, 'contexto-fetch-falla', new Error('algo'))).resolves.toBeUndefined();
  });

  it('nunca tira una excepción si Discord responde con error', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });

    await expect(reportCriticalError(null, 'contexto-discord-404', new Error('algo'))).resolves.toBeUndefined();
  });
});

describe('reportCriticalError — payload real', () => {
  it('manda un POST a la URL del canal configurado, con el token del bot', async () => {
    await reportCriticalError(null, 'contexto-payload-url', new Error('fallo de prueba'));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`https://discord.com/api/v10/channels/${mockConfig.operatorAlertChannelId}/messages`);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Bot ${mockConfig.discordToken}`);
  });

  it('el body incluye el contexto y el mensaje del error como campos del embed', async () => {
    await reportCriticalError(null, 'contexto-de-prueba-especifico', new Error('mensaje de error especifico'));

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    const fields = body.embeds[0].fields;
    expect(fields.find((f) => f.name === 'Contexto').value).toBe('contexto-de-prueba-especifico');
    expect(fields.find((f) => f.name === 'Mensaje').value).toBe('mensaje de error especifico');
  });

  it('redacta un secreto que aparezca en el mensaje del error antes de mandarlo', async () => {
    const leaked = 'DISCORD_TOKEN=abcd1234efgh5678ijklmnop';
    await reportCriticalError(null, 'contexto-con-secreto', new Error(`fallo real: ${leaked}`));

    const rawBody = fetch.mock.calls[0][1].body;
    expect(rawBody).not.toContain(leaked);
    expect(rawBody).not.toContain('abcd1234efgh5678ijklmnop');
  });
});

describe('reportCriticalError — throttle por huella', () => {
  it('el mismo contexto+error dos veces seguidas solo manda UNA alerta', async () => {
    const error = new Error('mismo error repetido');

    await reportCriticalError(null, 'contexto-throttle-identico', error);
    await reportCriticalError(null, 'contexto-throttle-identico', error);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('500 ocurrencias del mismo error dentro de la ventana siguen mandando UNA sola alerta', async () => {
    const error = new Error('error que se repite 500 veces');

    for (let i = 0; i < 500; i++) {
      await reportCriticalError(null, 'contexto-throttle-masivo', error);
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('un contexto distinto para el mismo error SÍ manda una alerta nueva', async () => {
    const error = new Error('error compartido');

    await reportCriticalError(null, 'contexto-A-distinto', error);
    await reportCriticalError(null, 'contexto-B-distinto', error);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un mensaje de error distinto para el mismo contexto SÍ manda una alerta nueva', async () => {
    await reportCriticalError(null, 'contexto-mismo-C', new Error('primer mensaje'));
    await reportCriticalError(null, 'contexto-mismo-C', new Error('segundo mensaje distinto'));

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
