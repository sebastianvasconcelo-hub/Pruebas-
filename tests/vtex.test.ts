import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapearVtex, urlBusqueda } from '../src/adapters/vtex.js';
import { tienda } from '../src/adapters/index.js';

const ALVI = tienda('alvi')!;
const crudo = JSON.parse(readFileSync('fixtures/alvi-arroz.sintetico.json', 'utf8'));

describe('urlBusqueda', () => {
  it('arma el endpoint publico de catalogo con el rango inclusivo de VTEX', () => {
    const url = new URL(urlBusqueda(ALVI, 'arroz', { limite: 10 }));
    expect(url.pathname).toBe('/api/catalog_system/pub/products/search');
    expect(url.searchParams.get('ft')).toBe('arroz');
    expect(url.searchParams.get('_to')).toBe('9');
  });

  it('nunca pide mas de 50, que es el tope de VTEX', () => {
    const url = new URL(urlBusqueda(ALVI, 'arroz', { limite: 500 }));
    expect(url.searchParams.get('_to')).toBe('49');
  });

  it('incluye el canal de venta cuando se especifica', () => {
    const url = new URL(urlBusqueda(ALVI, 'arroz', { salesChannel: '3' }));
    expect(url.searchParams.get('sc')).toBe('3');
  });
});

describe('mapearVtex', () => {
  it('extrae precio de lista, precio vigente y EAN', () => {
    const [primera] = mapearVtex(ALVI, crudo);
    expect(primera).toMatchObject({
      tienda: 'alvi',
      sku: '200001',
      precioLista: 1690,
      precioSocio: 1490,
      ean: '7801610000015',
      disponible: true,
    });
  });

  it('convierte el teaser de mayorista en una escala usable', () => {
    const [primera] = mapearVtex(ALVI, crudo);
    expect(primera!.escalas).toEqual([
      { minUnidades: 3, precioUnitario: 1290, origen: 'Llevando 3 o mas $1.290' },
    ]);
  });

  it('conserva el texto crudo de la promo para poder auditar el parser', () => {
    const [primera] = mapearVtex(ALVI, crudo);
    expect(primera!.promoTexto).toEqual(['Llevando 3 o mas $1.290']);
  });

  it('no inventa precio de socio cuando Price y ListPrice coinciden', () => {
    const segunda = mapearVtex(ALVI, crudo)[1]!;
    expect(segunda.precioSocio).toBeUndefined();
    expect(segunda.precioLista).toBe(5990);
  });

  it('arma la url del producto', () => {
    const [primera] = mapearVtex(ALVI, crudo);
    expect(primera!.url).toBe('https://www.alvi.cl/arroz-grado-1-tucapel-1-kg/p');
  });

  it('tolera respuestas vacias o con forma inesperada', () => {
    expect(mapearVtex(ALVI, [])).toEqual([]);
    expect(mapearVtex(ALVI, { error: 'boom' })).toEqual([]);
    expect(mapearVtex(ALVI, [{ productName: 'sin items' }])).toEqual([]);
    expect(mapearVtex(ALVI, [{ items: [{ itemId: '1', sellers: [] }] }])).toEqual([]);
  });
});
