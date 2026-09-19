import { describe, expect, it } from 'vitest';
import { escalaAplicable, parsearCLP, parsearPromos } from '../src/normalizar/promo.js';

describe('parsearCLP', () => {
  it('lee el formato chileno de miles', () => {
    expect(parsearCLP('$1.290')).toBe(1290);
  });
  it('lee decimales con coma', () => {
    expect(parsearCLP('$1.290,50')).toBe(1290.5);
  });
});

describe('parsearPromos', () => {
  it('entiende la escala mayorista de Alvi', () => {
    expect(parsearPromos(['Llevando 3 o mas $1.290'], 1490)).toEqual([
      { minUnidades: 3, precioUnitario: 1290, origen: 'Llevando 3 o mas $1.290' },
    ]);
  });

  it('reparte el total en los packs tipo "3 x $3.990"', () => {
    const [escala] = parsearPromos(['3 x $3.990'], 1490);
    expect(escala).toMatchObject({ minUnidades: 3, precioUnitario: 1330 });
  });

  it('promedia la segunda unidad con descuento', () => {
    const [escala] = parsearPromos(['2da unidad 50% dcto'], 2000);
    expect(escala).toMatchObject({ minUnidades: 2, precioUnitario: 1500 });
  });

  it('entiende "lleva 3 paga 2"', () => {
    const [escala] = parsearPromos(['Lleva 3 paga 2'], 1500);
    expect(escala).toMatchObject({ minUnidades: 3, precioUnitario: 1000 });
  });

  it('descarta lo que no entiende en vez de inventar una escala', () => {
    expect(parsearPromos(['Producto destacado de la semana'], 1490)).toEqual([]);
  });

  it('se queda con la escala mas barata cuando hay dos para la misma cantidad', () => {
    const escalas = parsearPromos(['Llevando 3 o mas $1.290', '3 x $3.990'], 1490);
    expect(escalas).toHaveLength(1);
    expect(escalas[0]!.precioUnitario).toBe(1290);
  });
});

describe('escalaAplicable', () => {
  const escalas = [
    { minUnidades: 3, precioUnitario: 1290 },
    { minUnidades: 12, precioUnitario: 1150 },
  ];

  it('no aplica bajo el minimo', () => {
    expect(escalaAplicable(escalas, 2)).toBeNull();
  });
  it('aplica el tramo alcanzado', () => {
    expect(escalaAplicable(escalas, 3)?.precioUnitario).toBe(1290);
  });
  it('elige el tramo mas barato disponible', () => {
    expect(escalaAplicable(escalas, 12)?.precioUnitario).toBe(1150);
  });
});
