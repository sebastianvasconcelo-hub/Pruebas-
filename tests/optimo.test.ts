import { describe, expect, it } from 'vitest';
import { cantidadesCandidatas, compararOptimo, mejorOferta } from '../src/precios/optimo.js';
import { PERFIL_POR_DEFECTO, type PerfilCompra } from '../src/precios/reglas.js';
import type { Oferta } from '../src/tipos.js';

const MARTES = new Date('2026-09-22T12:00:00');

// Caso real de Alvi: $2.090, $1.490 desde 3 un, $1.450 desde 10 un.
const ALVI: Oferta = {
  tienda: 'alvi',
  sku: '438',
  nombre: 'Arroz Tucapel G2 1 Kg',
  precioLista: 2090,
  escalas: [
    { minUnidades: 3, precioUnitario: 1490, requiereMembresia: true },
    { minUnidades: 10, precioUnitario: 1450, requiereMembresia: true },
  ],
  contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 Kg' },
  promoTexto: [],
  disponible: true,
  capturadoEn: '',
};

const JUMBO: Oferta = {
  ...ALVI,
  tienda: 'jumbo',
  sku: 'j1',
  nombre: 'Arroz Grado 2 Tucapel 1 kg',
  precioLista: 1790,
  escalas: [],
};

describe('cantidadesCandidatas', () => {
  it('evalua la referencia y el minimo de cada tramo', () => {
    expect(cantidadesCandidatas(ALVI, PERFIL_POR_DEFECTO, { referencia: 1 })).toEqual([1, 3, 10]);
  });

  it('excluye los tramos que exigen una membresia que no tienes', () => {
    const sinClub: PerfilCompra = {
      ...PERFIL_POR_DEFECTO,
      membresias: PERFIL_POR_DEFECTO.membresias.filter((m) => m.tienda !== 'alvi'),
    };
    expect(cantidadesCandidatas(ALVI, sinClub, { referencia: 1 })).toEqual([1]);
  });

  it('respeta un maximo cuando no quieres llevarte la bodega entera', () => {
    expect(cantidadesCandidatas(ALVI, PERFIL_POR_DEFECTO, { referencia: 1, maximo: 5 })).toEqual([1, 3]);
  });

  it('no duplica cuando la referencia coincide con un tramo', () => {
    expect(cantidadesCandidatas(ALVI, PERFIL_POR_DEFECTO, { referencia: 3 })).toEqual([3, 10]);
  });
});

describe('mejorOferta', () => {
  it('encuentra el precio mas barato y la cantidad que exige', () => {
    const o = mejorOferta(ALVI, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(o.cantidad).toBe(10);
    expect(o.desglose.porUnidadMedida).toEqual({ valor: 1450, base: 'kg' });
    expect(o.exigeLlevarMas).toBe(true);
  });

  it('informa contra que se compara y cuanto se ahorra', () => {
    const o = mejorOferta(ALVI, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(o.referencia.porUnidadMedida).toEqual({ valor: 2090, base: 'kg' });
    expect(o.ahorroPorcentaje).toBeCloseTo(30.6, 1);
  });

  it('el total refleja la compra completa, no una unidad', () => {
    const o = mejorOferta(ALVI, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(o.desglose.totalEfectivo).toBe(14500);
  });

  it('sin escalas, el optimo es la referencia', () => {
    const o = mejorOferta(JUMBO, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(o.cantidad).toBe(1);
    expect(o.exigeLlevarMas).toBe(false);
    expect(o.ahorroPorcentaje).toBe(0);
  });

  it('un maximo impide proponer mas de lo que estas dispuesto a llevar', () => {
    const o = mejorOferta(ALVI, PERFIL_POR_DEFECTO, { fecha: MARTES }, { maximo: 5 });
    expect(o.cantidad).toBe(3);
  });

  it('el costo de bodega puede hacer que no convenga el tramo mayor', () => {
    const conBodega: PerfilCompra = { ...PERFIL_POR_DEFECTO, costoBodegaMensualPorUnidad: 300 };
    const o = mejorOferta(ALVI, conBodega, { fecha: MARTES, consumoMensual: 2 });
    expect(o.cantidad).toBe(3);
  });

  it('sin membresia no propone tramos que no puedes usar', () => {
    const sinClub: PerfilCompra = {
      ...PERFIL_POR_DEFECTO,
      membresias: PERFIL_POR_DEFECTO.membresias.filter((m) => m.tienda !== 'alvi'),
    };
    const o = mejorOferta(ALVI, sinClub, { fecha: MARTES });
    expect(o.cantidad).toBe(1);
    expect(o.desglose.porUnidadMedida).toEqual({ valor: 2090, base: 'kg' });
  });
});

describe('compararOptimo', () => {
  it('ordena por el mejor precio alcanzable, no por el de una unidad', () => {
    // Jumbo es mas barato al detalle ($1.790 vs $2.090) pero Alvi gana
    // llevando volumen ($1.450). Es exactamente el caso del mayorista.
    const { ranking } = compararOptimo([ALVI, JUMBO], PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(ranking[0]!.oferta.tienda).toBe('alvi');
    expect(ranking[0]!.cantidad).toBe(10);
    expect(ranking[1]!.oferta.tienda).toBe('jumbo');
  });

  it('a una unidad el orden se invierte, y eso es lo que hacia falta ver', () => {
    const { ranking } = compararOptimo([ALVI, JUMBO], PERFIL_POR_DEFECTO, { fecha: MARTES }, { maximo: 1 });
    expect(ranking[0]!.oferta.tienda).toBe('jumbo');
  });

  it('avisa cuando los formatos no son comparables', () => {
    const otroFormato: Oferta = {
      ...JUMBO,
      contenido: { cantidad: 1, base: 'L', envases: 1, origen: '1 L' },
    };
    const { criterio, advertencias } = compararOptimo([ALVI, otroFormato], PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(criterio).toBe('unitario');
    expect(advertencias.join(' ')).toContain('no comparten unidad de medida');
  });
});
