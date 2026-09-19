import { describe, expect, it } from 'vitest';
import { nombreDia, parsearFechaLocal } from '../src/normalizar/fecha.js';

describe('parsearFechaLocal', () => {
  it('interpreta YYYY-MM-DD como ese dia, no como UTC', () => {
    // El bug original: new Date('2026-09-25') daba jueves 24 en Chile.
    const f = parsearFechaLocal('2026-09-25');
    expect(f.getFullYear()).toBe(2026);
    expect(f.getMonth()).toBe(8);
    expect(f.getDate()).toBe(25);
  });

  it('el 25 de septiembre de 2026 es viernes, no jueves', () => {
    expect(nombreDia(parsearFechaLocal('2026-09-25'))).toBe('viernes');
  });

  it('el 24 si es jueves', () => {
    expect(nombreDia(parsearFechaLocal('2026-09-24'))).toBe('jueves');
  });

  it('no corre el dia en ninguna fecha del anio', () => {
    for (let dia = 1; dia <= 28; dia++) {
      const texto = `2026-03-${String(dia).padStart(2, '0')}`;
      expect(parsearFechaLocal(texto).getDate()).toBe(dia);
    }
  });

  it('respeta un formato con hora y zona explicita', () => {
    const f = parsearFechaLocal('2026-09-25T15:00:00Z');
    expect(f.toISOString()).toBe('2026-09-25T15:00:00.000Z');
  });

  it('devuelve fecha invalida ante basura, sin inventar', () => {
    expect(Number.isNaN(parsearFechaLocal('no es fecha').getTime())).toBe(true);
  });
});
