import { describe, expect, it } from 'vitest';
import { evaluarCanasta, historialDe, type EntradaCanasta } from '../src/canasta/evaluar.js';
import { PERFIL_POR_DEFECTO } from '../src/precios/reglas.js';
import type { ProductoCanonico } from '../src/canonico/tipos.js';
import type { Oferta } from '../src/tipos.js';

const MARTES = new Date('2026-09-22T12:00:00');

function producto(over: Partial<ProductoCanonico> = {}): ProductoCanonico {
  return { id: 'leche-colun-semi-1l', nombre: 'Leche Colun semidescremada 1 L', equivalencias: [], ...over };
}

function oferta(tienda: string, precio: number, over: Partial<Oferta> = {}): Oferta {
  return {
    tienda,
    sku: `${tienda}-1`,
    nombre: 'Leche Colun semidescremada 1 L',
    marca: 'Colun',
    precioLista: precio,
    escalas: [],
    promoTexto: [],
    contenido: { cantidad: 1, base: 'L', envases: 1, origen: '1 L' },
    disponible: true,
    capturadoEn: '',
    ...over,
  };
}

describe('evaluarCanasta', () => {
  const entradas: EntradaCanasta[] = [
    { producto: producto(), ofertas: [oferta('alvi', 1090), oferta('jumbo', 1290)] },
  ];

  it('elige la tienda mas barata y dice cuanto se ahorra', () => {
    const r = evaluarCanasta(entradas, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(r.lineas[0]!.ganador!.tienda).toBe('alvi');
    expect(r.lineas[0]!.ahorroVsSegunda).toBe(200);
  });

  it('respeta la cantidad habitual del producto', () => {
    const r = evaluarCanasta(
      [{ producto: producto({ cantidadHabitual: 6 }), ofertas: entradas[0]!.ofertas }],
      PERFIL_POR_DEFECTO,
      { fecha: MARTES },
    );
    expect(r.lineas[0]!.cantidad).toBe(6);
    expect(r.lineas[0]!.ganador!.totalEfectivo).toBe(6540);
  });

  it('la primera vez no reporta cambio de tienda', () => {
    const r = evaluarCanasta(entradas, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(r.cambios).toEqual([]);
  });

  it('detecta la oferta eventual: el producto cambio de tienda', () => {
    // Jumbo baja la leche por debajo de Alvi esta semana.
    const conOferta: EntradaCanasta[] = [
      { producto: producto(), ofertas: [oferta('alvi', 1090), oferta('jumbo', 990)] },
    ];
    const r = evaluarCanasta(conOferta, PERFIL_POR_DEFECTO, { fecha: MARTES }, {
      'leche-colun-semi-1l': 'alvi',
    });
    expect(r.cambios).toHaveLength(1);
    expect(r.cambios[0]!.tiendaPrevia).toBe('alvi');
    expect(r.cambios[0]!.ganador!.tienda).toBe('jumbo');
  });

  it('no reporta cambio si la ganadora sigue siendo la misma', () => {
    const r = evaluarCanasta(entradas, PERFIL_POR_DEFECTO, { fecha: MARTES }, {
      'leche-colun-semi-1l': 'alvi',
    });
    expect(r.cambios).toEqual([]);
  });

  it('marca sin datos el producto que ninguna tienda entrego', () => {
    const r = evaluarCanasta([{ producto: producto(), ofertas: [] }], PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(r.lineas[0]!.sinDatos).toBe(true);
    expect(r.lineas[0]!.ganador).toBeUndefined();
    expect(r.totalOptimo).toBe(0);
  });

  it('prefiere lo disponible sobre lo agotado', () => {
    const r = evaluarCanasta(
      [{ producto: producto(), ofertas: [oferta('alvi', 900, { disponible: false }), oferta('jumbo', 1290)] }],
      PERFIL_POR_DEFECTO,
      { fecha: MARTES },
    );
    expect(r.lineas[0]!.ganador!.tienda).toBe('jumbo');
  });
});

describe('totales de la canasta', () => {
  const dos: EntradaCanasta[] = [
    { producto: producto(), ofertas: [oferta('alvi', 1090), oferta('jumbo', 1290)] },
    {
      producto: producto({ id: 'arroz', nombre: 'Arroz' }),
      ofertas: [oferta('alvi', 2000), oferta('jumbo', 1500)],
    },
  ];

  it('compara repartir la compra contra comprar todo en una tienda', () => {
    const r = evaluarCanasta(dos, PERFIL_POR_DEFECTO, { fecha: MARTES });
    // Optimo: leche en alvi (1090) + arroz en jumbo (1500) = 2590.
    expect(r.totalOptimo).toBe(2590);
    // Todo en jumbo: 1290 + 1500 = 2790. Es la mejor tienda unica.
    expect(r.ahorroRepartiendo).toBe(200);
  });

  it('informa cuantos productos cubre cada tienda', () => {
    const r = evaluarCanasta(dos, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(r.totalPorTienda.every((t) => t.cubre === 2)).toBe(true);
  });

  it('no compara contra una tienda que no cubre la canasta entera', () => {
    const parcial: EntradaCanasta[] = [
      { producto: producto(), ofertas: [oferta('alvi', 1090), oferta('jumbo', 1290)] },
      { producto: producto({ id: 'arroz' }), ofertas: [oferta('alvi', 2000)] },
    ];
    const r = evaluarCanasta(parcial, PERFIL_POR_DEFECTO, { fecha: MARTES });
    // Jumbo solo cubre 1 de 2: su total no sirve de referencia.
    expect(r.ahorroRepartiendo).toBe(0);
  });
});

describe('historialDe', () => {
  it('guarda donde convino cada producto', () => {
    const r = evaluarCanasta(
      [{ producto: producto(), ofertas: [oferta('alvi', 1090), oferta('jumbo', 1290)] }],
      PERFIL_POR_DEFECTO,
      { fecha: MARTES },
    );
    expect(historialDe(r)).toEqual({ 'leche-colun-semi-1l': 'alvi' });
  });

  it('omite los productos sin datos', () => {
    const r = evaluarCanasta([{ producto: producto(), ofertas: [] }], PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(historialDe(r)).toEqual({});
  });
});
