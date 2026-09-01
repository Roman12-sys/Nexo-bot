import { describe, it, expect } from 'vitest';
import { createRoleChangeLogEmbed, createGiveSuspiciousLogEmbed } from '../src/utils/logEmbeds.js';

// Fase 2B, sección 7 — createRoleChangeLogEmbed y createGiveSuspiciousLogEmbed armaban
// sus listas con un .join() sin ninguna cota: con suficientes roles/receptores, Discord
// rechaza el embed entero (campo > 1024). joinWithOverflow() corta antes del límite y
// avisa "(+N más)" — lo que importa probar es que el resultado NUNCA exceda 1024, no la
// implementación interna del helper.
function fakeRole(id) {
  return { toString: () => `<@&${id}>` };
}

describe('createRoleChangeLogEmbed — truncamiento de listas largas', () => {
  const member = { user: { id: 'u1', tag: 'user#0001' } };
  const executor = { id: 'e1', tag: 'exec#0001' };

  it('pocos roles: se listan todos, sin sufijo de overflow', () => {
    const embed = createRoleChangeLogEmbed({ member, executor, added: [fakeRole('1'), fakeRole('2')], removed: [] });
    const field = embed.data.fields.find((f) => f.name.includes('agregados'));

    expect(field.value).toBe('<@&1>, <@&2>');
  });

  it('muchos roles agregados: el campo nunca supera 1024 caracteres y avisa cuántos faltan', () => {
    const added = Array.from({ length: 80 }, (_, i) => fakeRole(`11111111111111${String(i).padStart(4, '0')}`));
    const embed = createRoleChangeLogEmbed({ member, executor, added, removed: [] });
    const field = embed.data.fields.find((f) => f.name.includes('agregados'));

    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toMatch(/\*\(\+\d+ más\)\*$/);
  });

  it('removed vacío: no agrega el campo de roles quitados (comportamiento previo intacto)', () => {
    const embed = createRoleChangeLogEmbed({ member, executor, added: [fakeRole('1')], removed: [] });

    expect(embed.data.fields.some((f) => f.name.includes('quitados'))).toBe(false);
  });

  it('muchos roles quitados: mismo truncamiento aplica también a ese campo', () => {
    const removed = Array.from({ length: 80 }, (_, i) => fakeRole(`22222222222222${String(i).padStart(4, '0')}`));
    const embed = createRoleChangeLogEmbed({ member, executor, added: [], removed });
    const field = embed.data.fields.find((f) => f.name.includes('quitados'));

    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toMatch(/\*\(\+\d+ más\)\*$/);
  });
});

describe('createGiveSuspiciousLogEmbed — truncamiento de receptores', () => {
  const sender = { id: 's1', tag: 'sender#0001' };

  it('pocos receptores: lista completa, sin overflow', () => {
    const embed = createGiveSuspiciousLogEmbed({ sender, pattern: { pattern: 'fanout', receiverIds: ['a', 'b'], count: 2, windowMinutes: 5 } });
    const field = embed.data.fields.find((f) => f.name === 'A quiénes');

    expect(field.value).toBe('<@a>, <@b>');
  });

  it('muchos receptores (patrón de distribución masiva real): el campo nunca supera 1024 caracteres', () => {
    const receiverIds = Array.from({ length: 200 }, (_, i) => `11111111111111${String(i).padStart(4, '0')}`);
    const embed = createGiveSuspiciousLogEmbed({
      sender,
      pattern: { pattern: 'fanout', receiverIds, count: 200, windowMinutes: 5 },
    });
    const field = embed.data.fields.find((f) => f.name === 'A quiénes');

    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toMatch(/\*\(\+\d+ más\)\*$/);
  });

  it('patrón "repeat" (receptor único) no usa la lista de receptores — no aplica overflow', () => {
    const embed = createGiveSuspiciousLogEmbed({
      sender,
      pattern: { pattern: 'repeat', receiverId: 'r1', count: 5, windowMinutes: 10, totalAmount: 5000 },
    });

    expect(embed.data.fields.some((f) => f.name === 'A quiénes')).toBe(false);
  });
});
