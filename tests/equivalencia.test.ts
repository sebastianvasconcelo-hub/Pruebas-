import { describe, expect, it } from 'vitest';
import { advertenciasEquivalencia } from '../src/precios/equivalencia.js';
import type { Oferta } from '../src/tipos.js';

function oferta(over: Partial<Oferta>): Oferta {
  return {
    tienda: 'alvi',
    sku: 'x',
    nombre: 'Arroz 1 kg',
    precioLista: 1000,
    escalas: [],
    promoTexto: [],
    disponible: true,
    capturadoEn: '',
    ...over,
  };
}

describe('advertenciasEquivalencia', () => {
  it('avisa cuando las marcas son distintas', () => {
    // El caso real: Merkat (marca propia de Alvi) contra Tucapel en Jumbo.
    const avisos = advertenciasEquivalencia([
      oferta({ tienda: 'alvi', marca: 'Merkat' }),
      oferta({ tienda: 'jumbo', marca: 'Tucapel' }),
    ]);
    expect(avisos.join(' ')).toContain('Merkat vs Tucapel');
  });

  it('no avisa cuando la marca es la misma escrita distinto', () => {
    expect(
      advertenciasEquivalencia([
        oferta({ marca: 'Tucapel' }),
        oferta({ tienda: 'jumbo', marca: 'TUCAPEL' }),
      ]),
    ).toEqual([]);
  });

  it('usa el EAN como prueba directa cuando ambos lo traen', () => {
    const avisos = advertenciasEquivalencia([
      oferta({ ean: '7801420220138' }),
      oferta({ tienda: 'jumbo', ean: '7801420220999' }),
    ]);
    expect(avisos.join(' ')).toContain('EAN son distintos');
  });

  it('no avisa por EAN cuando coinciden', () => {
    expect(
      advertenciasEquivalencia([
        oferta({ ean: '7801420220138', marca: 'Tucapel' }),
        oferta({ tienda: 'jumbo', ean: '7801420220138', marca: 'Tucapel' }),
      ]),
    ).toEqual([]);
  });

  it('avisa cuando las unidades de medida no coinciden', () => {
    const avisos = advertenciasEquivalencia([
      oferta({ contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 kg' } }),
      oferta({ tienda: 'jumbo', contenido: { cantidad: 1, base: 'L', envases: 1, origen: '1 L' } }),
    ]);
    expect(avisos.join(' ')).toContain('unidades de medida distintas');
  });

  it('no dice nada con una sola oferta', () => {
    expect(advertenciasEquivalencia([oferta({ marca: 'Merkat' })])).toEqual([]);
  });
});
