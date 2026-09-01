import { vi, describe, it, expect } from 'vitest';
import { registerButtonPrefix, routeButton } from '../src/components/buttons.js';
import { registerSelectPrefix, routeSelect } from '../src/components/selects.js';
import { registerModalPrefix, routeModal } from '../src/components/modals.js';

// Fase 2B, sección 13 — el caso real es trivia_ vs trivia_ranking_page_ (ambos en
// trivia.js): el segundo es substring del primero, así que cualquier customId de
// ranking matcheaba los dos. Antes el router tomaba el PRIMER match en el orden de
// REGISTRO (que depende del import dinámico de src/index.js, no de nada controlado a
// mano); ahora toma el más LARGO/específico entre todos los que matchean. Estos tests
// registran a propósito el prefijo corto ANTES que el específico — el orden opuesto al
// que "por casualidad" ya tenía trivia.js — para probar que el resultado no depende de
// eso. Prefijos con namespace "zzz_test_"/"zzz_select_"/"zzz_modal_" para no chocar con
// ningún customId real de otra feature ya registrada en el mismo proceso de test.
describe('routeButton — matching por especificidad, no por orden de registro', () => {
  it('un prefijo corto registrado ANTES no se come un customId que matchea uno más específico registrado después', async () => {
    const shortHandler = vi.fn().mockResolvedValue(undefined);
    const longHandler = vi.fn().mockResolvedValue(undefined);

    registerButtonPrefix('zzz_test_', shortHandler);
    registerButtonPrefix('zzz_test_specific_', longHandler);

    const interaction = { customId: 'zzz_test_specific_123' };
    const handled = await routeButton(interaction);

    expect(handled).toBe(true);
    expect(longHandler).toHaveBeenCalledWith(interaction);
    expect(shortHandler).not.toHaveBeenCalled();
  });

  it('el prefijo corto sigue atendiendo un customId que NO matchea el específico', async () => {
    const shortHandler = vi.fn().mockResolvedValue(undefined);
    registerButtonPrefix('zzz_generic_', shortHandler);

    const interaction = { customId: 'zzz_generic_456' };
    await routeButton(interaction);

    expect(shortHandler).toHaveBeenCalledWith(interaction);
  });

  it('sin ningún prefijo registrado que matchee, devuelve false (no revienta)', async () => {
    const handled = await routeButton({ customId: 'zzz_nadie_lo_registro' });
    expect(handled).toBe(false);
  });
});

describe('routeSelect — mismo fix', () => {
  it('el select más específico gana aunque el corto se haya registrado primero', async () => {
    const shortHandler = vi.fn().mockResolvedValue(undefined);
    const longHandler = vi.fn().mockResolvedValue(undefined);

    registerSelectPrefix('zzz_select_', shortHandler);
    registerSelectPrefix('zzz_select_specific_', longHandler);

    const interaction = { customId: 'zzz_select_specific_1' };
    await routeSelect(interaction);

    expect(longHandler).toHaveBeenCalledWith(interaction);
    expect(shortHandler).not.toHaveBeenCalled();
  });
});

describe('routeModal — mismo fix', () => {
  it('el modal más específico gana aunque el corto se haya registrado primero', async () => {
    const shortHandler = vi.fn().mockResolvedValue(undefined);
    const longHandler = vi.fn().mockResolvedValue(undefined);

    registerModalPrefix('zzz_modal_', shortHandler);
    registerModalPrefix('zzz_modal_specific_', longHandler);

    const interaction = { customId: 'zzz_modal_specific_1' };
    await routeModal(interaction);

    expect(longHandler).toHaveBeenCalledWith(interaction);
    expect(shortHandler).not.toHaveBeenCalled();
  });
});
