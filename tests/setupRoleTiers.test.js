import { describe, it, expect } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import {
  ROLE_TIERS,
  ROLE_TIER_ORDER,
  DEFAULT_SELECTED_TIERS,
  describeTierPermissions,
  isValidHexColor,
  normalizeHexColor,
  EDITABLE_COLOR_PALETTE,
} from '../src/utils/setupRoleTiers.js';

// NEXO Setup Inteligente, Bloque 1-3 — la matriz de roles de staff es la pieza de diseño
// más delicada de toda la feature: separa a propósito "Discord Permissions" (nativas,
// acá abajo) de "NEXO Staff Tier" (isStaff/isAdmin, solo 2 columnas de guild_config).
// Estos tests protegen los 2 invariantes de seguridad reales, no solo que el archivo cargue.
describe('setupRoleTiers — invariantes de seguridad', () => {
  it('ningún tier incluye el permiso nativo Administrator de Discord', () => {
    for (const key of ROLE_TIER_ORDER) {
      expect(ROLE_TIERS[key].permissions).not.toContain(PermissionFlagsBits.Administrator);
    }
  });

  it('los 6 tiers existen y están en el orden de jerarquía correcto (administrador primero)', () => {
    expect(ROLE_TIER_ORDER).toEqual(['administrador', 'cofounder', 'coordinador', 'moderador', 'ayudante', 'staff']);
    expect(Object.keys(ROLE_TIERS).sort()).toEqual([...ROLE_TIER_ORDER].sort());
  });

  it('solo administrador/cofounder sugieren el tier admin de NEXO, y solo coordinador/moderador el de moderador', () => {
    expect(ROLE_TIERS.administrador.tierHint).toBe('admin');
    expect(ROLE_TIERS.cofounder.tierHint).toBe('admin');
    expect(ROLE_TIERS.coordinador.tierHint).toBe('moderator');
    expect(ROLE_TIERS.moderador.tierHint).toBe('moderator');
    expect(ROLE_TIERS.ayudante.tierHint).toBeNull();
    expect(ROLE_TIERS.staff.tierHint).toBeNull();
  });

  it('la jerarquía de permisos nativos es monótona: cada tier no tiene MÁS permisos que el de arriba', () => {
    // No exige subconjunto estricto (cada nivel tiene su propio foco), pero sí que el
    // conteo de permisos nunca crezca al bajar de tier — si esto se rompe, la matriz
    // dejó de tener sentido como jerarquía.
    const counts = ROLE_TIER_ORDER.map((key) => ROLE_TIERS[key].permissions.length);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('DEFAULT_SELECTED_TIERS no está vacío ni incluye los 6 (punto de partida razonable, no todo/nada)', () => {
    expect(DEFAULT_SELECTED_TIERS.length).toBeGreaterThan(0);
    expect(DEFAULT_SELECTED_TIERS.length).toBeLessThan(ROLE_TIER_ORDER.length);
  });
});

describe('setupRoleTiers — describeTierPermissions', () => {
  it('devuelve una lista legible, no vacía, para un tier real', () => {
    const text = describeTierPermissions('moderador');
    expect(text).toContain('Expulsar miembros');
    expect(text).toContain('Aplicar timeout');
  });

  it('tier inexistente: devuelve string vacío, no tira', () => {
    expect(describeTierPermissions('no-existe')).toBe('');
  });
});

describe('setupRoleTiers — validación de color hex', () => {
  it('acepta hex con y sin #', () => {
    expect(isValidHexColor('#7F5AF0')).toBe(true);
    expect(isValidHexColor('7F5AF0')).toBe(true);
  });

  it('rechaza formatos inválidos', () => {
    expect(isValidHexColor('rojo')).toBe(false);
    expect(isValidHexColor('#ZZZZZZ')).toBe(false);
    expect(isValidHexColor('#FFF')).toBe(false); // 3 dígitos, no soportado a propósito
    expect(isValidHexColor('')).toBe(false);
  });

  it('normalizeHexColor siempre antepone # y pasa a mayúsculas', () => {
    expect(normalizeHexColor('7f5af0')).toBe('#7F5AF0');
    expect(normalizeHexColor('#7f5af0')).toBe('#7F5AF0');
  });

  it('la paleta editable son todos colores válidos del Design System (sin inventar hex nuevos)', () => {
    for (const entry of EDITABLE_COLOR_PALETTE) {
      expect(isValidHexColor(entry.hex)).toBe(true);
    }
  });
});
