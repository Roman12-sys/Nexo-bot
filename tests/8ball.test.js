import { vi, describe, it, expect } from 'vitest';
import { data, execute } from '../src/commands/diversion/8ball.js';

// /8ball — Fase 2B, sección 6: "pregunta" no tenía setMaxLength (Discord permite hasta
// 6000 por defecto) y se pega tal cual en el VALUE de un campo de embed (límite real:
// 1024) — una pregunta larga rompía el comando entero. Ahora tiene un tope explícito.
describe('/8ball — límite de input', () => {
  it('la opción "pregunta" tiene un maxLength definido, por debajo del límite real de un campo de embed (1024)', () => {
    const option = data.toJSON().options.find((o) => o.name === 'pregunta');

    expect(option.max_length).toBeGreaterThan(0);
    expect(option.max_length).toBeLessThanOrEqual(1024);
  });

  it('una pregunta dentro del límite responde con un embed válido (Pregunta + Respuesta)', async () => {
    const interaction = {
      options: { getString: () => '¿Va a andar bien esta fase?' },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await execute(interaction);

    const embed = interaction.reply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields[0].value).toBe('¿Va a andar bien esta fase?');
    expect(embed.data.fields[1].name).toBe('Respuesta');
  });
});
