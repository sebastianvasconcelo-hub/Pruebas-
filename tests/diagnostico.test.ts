import { describe, expect, it } from 'vitest';
import { Descartes } from '../src/diagnostico.js';
import { ofertasDe } from '../src/canonico/catalogo.js';
import { mapearAlvi } from '../src/adapters/alvi.js';
import { tienda } from '../src/adapters/index.js';
import type { ProductoCanonico } from '../src/canonico/tipos.js';
import type { Oferta } from '../src/tipos.js';

const ALVI = tienda('alvi')!;

function oferta(over: Partial<Oferta>): Oferta {
  return {
    tienda: 'jumbo',
    sku: '10995',
    nombre: 'Leche',
    precioLista: 1290,
    escalas: [],
    promoTexto: [],
    disponible: true,
    capturadoEn: '',
    ...over,
  };
}

describe('Descartes', () => {
  it('agrupa por motivo y cuenta, conservando un ejemplo', () => {
    const d = new Descartes();
    d.registrar('alvi', 'uno', 'sin precio');
    d.registrar('alvi', 'dos', 'sin precio');
    d.registrar('jumbo', 'tres', 'sin nombre');

    expect(d.total).toBe(3);
    const resumen = d.resumen();
    expect(resumen[0]).toMatchObject({ donde: 'alvi', porque: 'sin precio', veces: 2, ejemplo: 'uno' });
    expect(resumen[1]).toMatchObject({ donde: 'jumbo', veces: 1 });
  });

  it('no imprime nada cuando no hay descartes', () => {
    const lineas: string[] = [];
    new Descartes().imprimir((l) => lineas.push(l));
    expect(lineas).toEqual([]);
  });
});

describe('ofertasDe deja rastro de lo que no calza', () => {
  const producto: ProductoCanonico = {
    id: 'leche',
    nombre: 'Leche',
    equivalencias: [
      {
        tienda: 'jumbo',
        sku: 'slug-viejo',
        nombre: 'Leche Colun',
        url: 'https://www.jumbo.cl/otra-cosa/p',
        origen: 'manual',
        confirmadoEn: '2026-09-22',
      },
    ],
  };

  it('avisa cuando la tienda respondio pero nada calzo', () => {
    const d = new Descartes();
    ofertasDe(producto, [oferta({ url: 'https://www.jumbo.cl/leche/p' })], d);
    expect(d.lista()[0]!.porque).toContain('ninguna calza');
    expect(d.lista()[0]!.porque).toContain('slug-viejo');
  });

  it('avisa cuando la tienda no devolvio nada', () => {
    const d = new Descartes();
    ofertasDe(producto, [], d);
    expect(d.lista()[0]!.porque).toContain('no devolvio ninguna oferta');
  });

  it('no registra nada cuando si calza', () => {
    const d = new Descartes();
    ofertasDe(producto, [oferta({ sku: 'slug-viejo' })], d);
    expect(d.total).toBe(0);
  });
});

describe('los mapeadores anotan lo que botan', () => {
  it('registra un producto de Alvi sin precio', () => {
    const d = new Descartes();
    const json = {
      availableProducts: [
        { sku: '1', name: 'Leche sin precio', sellers: [] },
        { sku: '2', name: 'Leche con precio', sellers: [{ listPrice: 1290, availableQuantity: 5 }] },
      ],
    };
    expect(mapearAlvi(ALVI, json, d)).toHaveLength(1);
    expect(d.lista()[0]).toMatchObject({ que: 'Leche sin precio', porque: 'sin precio utilizable en sellers' });
  });

  it('sigue funcionando sin registro, como antes', () => {
    expect(() => mapearAlvi(ALVI, { availableProducts: [{ sku: '1' }] })).not.toThrow();
  });
});
