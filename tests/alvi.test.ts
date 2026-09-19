import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escalasDe, mapearAlvi } from '../src/adapters/alvi.js';
import { tienda } from '../src/adapters/index.js';
import { precioEfectivo } from '../src/precios/efectivo.js';
import { PERFIL_POR_DEFECTO } from '../src/precios/reglas.js';

const ALVI = tienda('alvi')!;
// Recorte real de alvi.cl, no sintetico: es el contrato que debemos respetar.
const REAL = JSON.parse(readFileSync('fixtures/alvi-arroz.real.json', 'utf8'));
const MARTES = new Date('2026-09-22T12:00:00');

describe('mapearAlvi sobre datos reales', () => {
  const ofertas = mapearAlvi(ALVI, REAL);

  it('deduplica el catalogo repetido en dehydratedState e intelliSearchData', () => {
    expect(ofertas).toHaveLength(1);
  });

  it('extrae identificadores, marca y EAN', () => {
    expect(ofertas[0]).toMatchObject({
      tienda: 'alvi',
      sku: '438',
      marca: 'Tucapel',
      ean: '7801420220138',
      disponible: true,
      url: 'https://www.alvi.cl/arroz-tucapel-gran-seleccion-g2-1-kg/p',
    });
  });

  it('no inventa precio de socio: en Alvi el descuento son las escalas', () => {
    expect(ofertas[0]!.precioLista).toBe(2090);
    expect(ofertas[0]!.precioSocio).toBeUndefined();
  });

  it('convierte priceSteps en escalas ordenadas', () => {
    expect(ofertas[0]!.escalas).toEqual([
      { minUnidades: 3, precioUnitario: 1490, origen: 'priceSteps: 3+ un, 29% dcto' },
      { minUnidades: 10, precioUnitario: 1450, origen: 'priceSteps: 10+ un, 31% dcto' },
    ]);
  });

  it('toma el formato declarado por la tienda y no el nombre', () => {
    expect(ofertas[0]!.contenido).toMatchObject({ cantidad: 1, base: 'kg', origen: '1 Kg' });
  });

  it('conserva el ppum de la tienda para poder contrastar', () => {
    expect(ofertas[0]!.ppumTienda).toBe('$2.090 x Kg');
  });
});

describe('el precio calculado coincide con el que publica la tienda', () => {
  const [oferta] = mapearAlvi(ALVI, REAL);

  it('1 unidad: $2.090/kg, igual que el ppum de Alvi', () => {
    const d = precioEfectivo(oferta!, 1, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.porUnidadMedida).toEqual({ valor: 2090, base: 'kg' });
    expect(oferta!.ppumTienda).toContain('2.090');
  });

  it('3 unidades: cae a $1.490/kg por la escala mayorista', () => {
    const d = precioEfectivo(oferta!, 3, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.origenPrecio).toBe('escala');
    expect(d.porUnidadMedida).toEqual({ valor: 1490, base: 'kg' });
  });

  it('10 unidades: cae al segundo tramo, $1.450/kg', () => {
    const d = precioEfectivo(oferta!, 10, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.porUnidadMedida).toEqual({ valor: 1450, base: 'kg' });
  });
});

describe('escalasDe', () => {
  it('descarta tramos incompletos o sin sentido', () => {
    expect(
      escalasDe([
        { promotionalPrice: 1490 },
        { minQuantity: 3 },
        { minQuantity: 1, promotionalPrice: 2090 },
        { minQuantity: 5, promotionalPrice: 0 },
      ]),
    ).toEqual([]);
  });

  it('tolera la ausencia de priceSteps', () => {
    expect(escalasDe(undefined)).toEqual([]);
  });
});
