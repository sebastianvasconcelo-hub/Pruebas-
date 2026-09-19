import { describe, expect, it } from 'vitest';
import { interpretarPromociones, type PromocionJumbo } from '../src/adapters/jumboPromos.js';

// Promocion real, copiada del payload RSC de la ficha del queso mantecoso.
const PRIME_REAL: PromocionJumbo = {
  description: 'JUMBO VINA, QUESO Y CERVEZA DEL MES PRIME SEPT',
  type: 'percentual',
  value: 35,
  unitPrice: 4544,
  ppumPrice: 9088,
  mQuantity: 1,
  nQuantity: 0,
  paymentMethods: 'ALL',
  userProperties: 'PRIME_USER',
};

describe('interpretarPromociones', () => {
  it('reconoce el precio Prime desde la primera unidad', () => {
    const r = interpretarPromociones([PRIME_REAL], 5890);
    expect(r.precioSocio).toBe(4544);
    expect(r.escalas).toEqual([]);
  });

  it('conserva la descripcion original para poder auditar', () => {
    expect(interpretarPromociones([PRIME_REAL], 5890).textos).toEqual([PRIME_REAL.description]);
  });

  it('una promocion Prime con minimo de unidades es una escala de socio', () => {
    const r = interpretarPromociones([{ ...PRIME_REAL, mQuantity: 3, unitPrice: 4000 }], 5890);
    expect(r.precioSocio).toBeUndefined();
    expect(r.escalas[0]).toMatchObject({
      minUnidades: 3,
      precioUnitario: 4000,
      requiereMembresia: true,
    });
  });

  it('una promocion abierta se aplica aunque no seas socio', () => {
    const r = interpretarPromociones(
      [{ description: 'Oferta general', unitPrice: 4990, mQuantity: 1 }],
      5890,
    );
    expect(r.precioSocio).toBeUndefined();
    expect(r.escalas[0]).toMatchObject({ minUnidades: 1, precioUnitario: 4990 });
    expect(r.escalas[0]!.requiereMembresia).toBeUndefined();
  });

  it('entre dos promociones Prime desde la primera unidad gana la mas barata', () => {
    const r = interpretarPromociones(
      [PRIME_REAL, { ...PRIME_REAL, unitPrice: 4200, description: 'otra' }],
      5890,
    );
    expect(r.precioSocio).toBe(4200);
  });

  it('ignora promociones que no bajan el precio', () => {
    expect(interpretarPromociones([{ ...PRIME_REAL, unitPrice: 5890 }], 5890).precioSocio).toBeUndefined();
    expect(interpretarPromociones([{ ...PRIME_REAL, unitPrice: 9999 }], 5890).precioSocio).toBeUndefined();
  });

  it('no deduce el precio desde el porcentaje cuando falta unitPrice', () => {
    // 35% de 5890 daria 3828,5: redondear por nuestra cuenta no coincidiria
    // con la caja. Sin unitPrice, no hay precio.
    const r = interpretarPromociones([{ ...PRIME_REAL, unitPrice: undefined }], 5890);
    expect(r.precioSocio).toBeUndefined();
    expect(r.escalas).toEqual([]);
  });

  it('tolera la ausencia de promociones', () => {
    expect(interpretarPromociones(undefined, 5890)).toEqual({ escalas: [], textos: [] });
  });

  it('ordena las escalas por cantidad minima', () => {
    const r = interpretarPromociones(
      [
        { ...PRIME_REAL, mQuantity: 10, unitPrice: 3800 },
        { ...PRIME_REAL, mQuantity: 3, unitPrice: 4200 },
      ],
      5890,
    );
    expect(r.escalas.map((e) => e.minUnidades)).toEqual([3, 10]);
  });
});
