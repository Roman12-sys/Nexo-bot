import { vi, describe, it, expect, beforeEach } from 'vitest';
import { extractButtonCustomId, makeButtonInteraction } from './helpers/discordMock.js';

// confirmations.js no depende de Supabase directamente, pero registra sus handlers en
// el router REAL de botones (src/components/buttons.js) — se usa ese router real acá
// (no un mock) para probar el flujo de punta a punta, tal como lo dispararía
// interactionCreate.js en producción.
const { buildConfirmation } = await import('../src/utils/confirmations.js');
const { routeButton } = await import('../src/components/buttons.js');

function buildAndReply({ userId = 'mod-1', guildId = 'guild-1', run } = {}) {
  return buildConfirmation({ userId, guildId, description: 'test', run: run ?? vi.fn().mockResolvedValue(undefined) });
}

describe('confirmations — flujo genérico', () => {
  it('el dueño confirma y run() se ejecuta exactamente una vez', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const panel = buildAndReply({ run });

    const token = extractButtonCustomId(panel, 'Confirmar').slice('confirm_yes_'.length);
    const buttonInteraction = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-1' });

    const handled = await routeButton(buttonInteraction);

    expect(handled).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(buttonInteraction);
  });

  it('otro usuario que clickea "Confirmar" es rechazado y NO consume la sesión', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const panel = buildAndReply({ userId: 'mod-1', run });

    const token = extractButtonCustomId(panel, 'Confirmar').slice('confirm_yes_'.length);
    const intruder = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'otro-usuario', guildId: 'guild-1' });
    await routeButton(intruder);

    expect(run).not.toHaveBeenCalled();
    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no es tuya') }));

    // El dueño real todavía puede confirmarla después — la sesión sigue viva.
    const owner = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-1' });
    await routeButton(owner);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancelar no ejecuta run() y muestra "Acción cancelada"', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const panel = buildAndReply({ run });

    const token = extractButtonCustomId(panel, 'Cancelar').slice('confirm_no_'.length);
    const buttonInteraction = makeButtonInteraction(`confirm_no_${token}`, { userId: 'mod-1', guildId: 'guild-1' });
    await routeButton(buttonInteraction);

    expect(run).not.toHaveBeenCalled();
    expect(buttonInteraction.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('cancelada') }));
  });

  it('doble click del mismo usuario solo ejecuta run() una vez (sin importar el orden de llegada)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const panel = buildAndReply({ run });
    const token = extractButtonCustomId(panel, 'Confirmar').slice('confirm_yes_'.length);

    const click1 = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-1' });
    const click2 = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-1' });

    await Promise.all([routeButton(click1), routeButton(click2)]);

    expect(run).toHaveBeenCalledTimes(1);
    // El segundo click, sea cual sea, tiene que haber visto "expiró o ya se usó".
    const expiredCall = [click1, click2].find((c) => c !== (run.mock.calls[0][0]));
    expect(expiredCall.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });

  it('un guildId distinto al de la sesión también se rechaza como "no es tuya"', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const panel = buildAndReply({ userId: 'mod-1', guildId: 'guild-1', run });

    const token = extractButtonCustomId(panel, 'Confirmar').slice('confirm_yes_'.length);
    const wrongGuild = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-2' });
    await routeButton(wrongGuild);

    expect(run).not.toHaveBeenCalled();
    expect(wrongGuild.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('no es tuya') }));
  });

  it('un token que no existe (expirado o inventado) responde "expiró o ya se usó"', async () => {
    const buttonInteraction = makeButtonInteraction('confirm_yes_token-inexistente', { userId: 'mod-1', guildId: 'guild-1' });
    const handled = await routeButton(buttonInteraction);

    expect(handled).toBe(true);
    expect(buttonInteraction.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('expiró') }));
  });

  it('condiciones que cambiaron antes de confirmar: run() recibe la interaction del botón, no la original — puede revalidar todo de nuevo', async () => {
    let seenInteraction = null;
    const run = vi.fn(async (i) => {
      seenInteraction = i;
    });
    const panel = buildAndReply({ run });
    const token = extractButtonCustomId(panel, 'Confirmar').slice('confirm_yes_'.length);
    const buttonInteraction = makeButtonInteraction(`confirm_yes_${token}`, { userId: 'mod-1', guildId: 'guild-1' });

    await routeButton(buttonInteraction);

    expect(seenInteraction).toBe(buttonInteraction);
  });
});
