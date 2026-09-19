import { describe, expect, it } from 'vitest';
import { agruparPorEan, dice, puntuar, sugerir, tokenizar } from '../src/canonico/similitud.js';
import type { Oferta } from '../src/tipos.js';

function oferta(over: Partial<Oferta>): Oferta {
  return {
    tienda: 'alvi',
    sku: 'x',
    nombre: 'Arroz Tucapel gran seleccion G2 1 Kg',
    precioLista: 2090,
    escalas: [],
    promoTexto: [],
    disponible: true,
    capturadoEn: '',
    ...over,
  };
}

describe('tokenizar', () => {
  it('quita tildes, puntuacion, unidades y palabras vacias', () => {
    expect([...tokenizar('Arroz Tucapel gran selección G2 1 Kg')]).toEqual([
      'arroz', 'tucapel', 'gran', 'seleccion', 'g2',
    ]);
  });
});

describe('dice', () => {
  it('es 1 para conjuntos identicos y 0 para disjuntos', () => {
    expect(dice(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(dice(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('es 0 si alguno esta vacio', () => {
    expect(dice(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('puntuar', () => {
  it('EAN identico vale 1 sin mirar nada mas', () => {
    const p = puntuar(
      oferta({ ean: '7801420220138', nombre: 'Arroz Tucapel G2 1 Kg' }),
      oferta({ tienda: 'jumbo', ean: '7801420220138', nombre: 'ARROZ GRADO 2 TUCAPEL 1 KG' }),
    );
    expect(p.valor).toBe(1);
    expect(p.razones).toEqual(['EAN identico']);
  });

  it('penaliza marcas distintas: el caso Merkat contra Tucapel', () => {
    const merkat = oferta({ marca: 'Merkat', nombre: 'Arroz Merkat largo delgado grado 2 1 Kg' });
    const tucapel = oferta({
      tienda: 'jumbo',
      marca: 'Tucapel',
      nombre: 'Arroz Grado 2 Tucapel Blue Grano Largo y Delgado 1 kg',
    });
    const p = puntuar(merkat, tucapel);
    expect(p.razones.join(' ')).toContain('marcas distintas');
    expect(p.valor).toBeLessThan(0.5);
  });

  it('premia misma marca y mismo formato', () => {
    const a = oferta({
      marca: 'Tucapel',
      contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 Kg' },
    });
    const b = oferta({
      tienda: 'jumbo',
      marca: 'Tucapel',
      nombre: 'Arroz Grado 2 Tucapel Gran Seleccion 1 kg',
      contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 kg' },
    });
    const p = puntuar(a, b);
    expect(p.valor).toBeGreaterThan(0.7);
    expect(p.razones.join(' ')).toContain('misma marca');
    expect(p.razones.join(' ')).toContain('mismo formato');
  });

  it('castiga formatos distintos de la misma marca', () => {
    const uno = oferta({ marca: 'Tucapel', contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 kg' } });
    const cinco = oferta({
      tienda: 'jumbo',
      marca: 'Tucapel',
      nombre: 'Arroz Tucapel gran seleccion G2 5 Kg',
      contenido: { cantidad: 5, base: 'kg', envases: 1, origen: '5 kg' },
    });
    expect(puntuar(uno, cinco).razones.join(' ')).toContain('formato distinto');
  });

  it('nunca se sale del rango 0..1', () => {
    const p = puntuar(
      oferta({ marca: 'A', ean: '1', nombre: 'zzz', contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '' } }),
      oferta({ tienda: 'jumbo', marca: 'B', ean: '2', nombre: 'qqq', contenido: { cantidad: 9, base: 'L', envases: 1, origen: '' } }),
    );
    expect(p.valor).toBeGreaterThanOrEqual(0);
    expect(p.valor).toBeLessThanOrEqual(1);
  });
});

describe('sugerir', () => {
  it('ordena de mas a menos parecida y excluye la propia tienda', () => {
    const base = oferta({ marca: 'Tucapel' });
    const sugerencias = sugerir(base, [
      oferta({ tienda: 'alvi', nombre: 'otro de la misma tienda' }),
      oferta({ tienda: 'jumbo', marca: 'Merkat', nombre: 'Arroz Merkat 1 kg' }),
      oferta({ tienda: 'jumbo', marca: 'Tucapel', nombre: 'Arroz Tucapel gran seleccion G2 1 Kg' }),
    ]);
    expect(sugerencias[0]!.oferta.marca).toBe('Tucapel');
    expect(sugerencias.every((s) => s.oferta.tienda !== 'alvi')).toBe(true);
  });

  it('respeta el umbral', () => {
    expect(sugerir(oferta({}), [oferta({ tienda: 'jumbo', nombre: 'detergente liquido' })], 0.9)).toEqual([]);
  });
});

describe('agruparPorEan', () => {
  it('agrupa el mismo EAN entre tiendas distintas', () => {
    const grupos = agruparPorEan([
      oferta({ tienda: 'alvi', ean: '111' }),
      oferta({ tienda: 'jumbo', ean: '111' }),
      oferta({ tienda: 'alvi', ean: '222' }),
    ]);
    expect(grupos.size).toBe(1);
    expect(grupos.get('111')).toHaveLength(2);
  });

  it('ignora los que no cruzan cadenas', () => {
    expect(agruparPorEan([oferta({ ean: '111' }), oferta({ ean: '111', sku: 'y' })]).size).toBe(0);
  });

  it('ignora ofertas sin EAN', () => {
    expect(agruparPorEan([oferta({}), oferta({ tienda: 'jumbo' })]).size).toBe(0);
  });
});
