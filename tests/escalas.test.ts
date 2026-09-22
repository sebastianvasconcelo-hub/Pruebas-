import { describe, expect, it } from 'vitest';
import { escalasPendientes, informarEscalas } from '../src/precios/escalas.js';
import { PERFIL_POR_DEFECTO, type PerfilCompra } from '../src/precios/reglas.js';
import type { Oferta } from '../src/tipos.js';

// Caso real de Alvi: $2.090 de lista, $1.490 desde 3 un, $1.450 desde 10 un.
const ARROZ: Oferta = {
  tienda: 'alvi',
  sku: '438',
  nombre: 'Arroz Tucapel G2 1 Kg',
  precioLista: 2090,
  escalas: [
    { minUnidades: 3, precioUnitario: 1490, requiereMembresia: true, origen: 'socio Alvi, 3+ un' },
    { minUnidades: 10, precioUnitario: 1450, requiereMembresia: true, origen: 'socio Alvi, 10+ un' },
  ],
  contenido: { cantidad: 1, base: 'kg', envases: 1, origen: '1 Kg' },
  promoTexto: [],
  disponible: true,
  capturadoEn: '',
};

describe('informarEscalas', () => {
  it('muestra las escalas aunque la cantidad actual no las alcance', () => {
    const info = informarEscalas(ARROZ, 1, 2090, PERFIL_POR_DEFECTO);
    expect(info).toHaveLength(2);
    expect(info.every((e) => !e.aplicada)).toBe(true);
  });

  it('calcula cuanto baja respecto de lo que pagas hoy', () => {
    const [tres, diez] = informarEscalas(ARROZ, 1, 2090, PERFIL_POR_DEFECTO);
    expect(tres!.ahorroPorcentaje).toBeCloseTo(28.7, 1);
    expect(diez!.ahorroPorcentaje).toBeCloseTo(30.6, 1);
  });

  it('traduce cada tramo a precio por unidad de medida', () => {
    const [tres] = informarEscalas(ARROZ, 1, 2090, PERFIL_POR_DEFECTO);
    expect(tres!.porUnidadMedida).toEqual({ valor: 1490, base: 'kg' });
  });

  it('marca como usable lo que tu membresia permite', () => {
    const info = informarEscalas(ARROZ, 1, 2090, PERFIL_POR_DEFECTO);
    expect(info.every((e) => e.usable)).toBe(true);
  });

  it('marca como no usable el tramo de socio si no eres socio', () => {
    const sinClub: PerfilCompra = {
      ...PERFIL_POR_DEFECTO,
      membresias: PERFIL_POR_DEFECTO.membresias.filter((m) => m.tienda !== 'alvi'),
    };
    const info = informarEscalas(ARROZ, 1, 2090, sinClub);
    // Se informa igual: saber que existe un precio al que no llegas tambien sirve.
    expect(info).toHaveLength(2);
    expect(info.every((e) => !e.usable)).toBe(true);
  });

  it('marca la escala ya aplicada para no ofrecerla de nuevo', () => {
    const info = informarEscalas(ARROZ, 3, 1490, PERFIL_POR_DEFECTO);
    expect(info[0]!.aplicada).toBe(true);
    expect(info[1]!.aplicada).toBe(false);
  });

  it('no inventa precio por unidad de medida sin formato', () => {
    const sinFormato = { ...ARROZ, contenido: undefined, nombre: 'Arroz a granel' };
    expect(informarEscalas(sinFormato, 1, 2090, PERFIL_POR_DEFECTO)[0]!.porUnidadMedida).toBeNull();
  });

  it('devuelve vacio si la oferta no tiene escalas', () => {
    expect(informarEscalas({ ...ARROZ, escalas: [] }, 1, 2090, PERFIL_POR_DEFECTO)).toEqual([]);
  });
});

describe('escalasPendientes', () => {
  it('deja solo las que todavia no aprovechas', () => {
    const pendientes = escalasPendientes(informarEscalas(ARROZ, 3, 1490, PERFIL_POR_DEFECTO));
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]!.minUnidades).toBe(10);
  });

  it('no propone una escala que no mejora el precio actual', () => {
    const pendientes = escalasPendientes(informarEscalas(ARROZ, 10, 1450, PERFIL_POR_DEFECTO));
    expect(pendientes).toEqual([]);
  });
});
