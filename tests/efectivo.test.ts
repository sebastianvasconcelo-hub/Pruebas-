import { describe, expect, it } from 'vitest';
import { comparar, mejorCantidad, precioEfectivo } from '../src/precios/efectivo.js';
import { PERFIL_POR_DEFECTO, type PerfilCompra } from '../src/precios/reglas.js';
import type { Oferta } from '../src/tipos.js';

// 2026-09-24 es jueves; 2026-09-22 es martes.
const JUEVES = new Date('2026-09-24T12:00:00');
const MARTES = new Date('2026-09-22T12:00:00');

function oferta(over: Partial<Oferta> = {}): Oferta {
  return {
    tienda: 'alvi',
    sku: '200001',
    nombre: 'Arroz Grado 1 Tucapel 1 kg',
    precioLista: 1690,
    precioSocio: 1490,
    escalas: [{ minUnidades: 3, precioUnitario: 1290 }],
    promoTexto: [],
    disponible: true,
    capturadoEn: new Date().toISOString(),
    ...over,
  };
}

describe('precioEfectivo', () => {
  it('usa el precio de socio cuando tienes la membresia', () => {
    const d = precioEfectivo(oferta(), 1, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(1490);
    expect(d.origenPrecio).toBe('socio');
  });

  it('ignora el precio de socio si no eres socio de esa tienda', () => {
    const sinMembresia: PerfilCompra = { ...PERFIL_POR_DEFECTO, membresias: [] };
    const d = precioEfectivo(oferta(), 1, sinMembresia, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(1690);
    expect(d.origenPrecio).toBe('lista');
  });

  it('aplica la escala al llegar al minimo', () => {
    const d = precioEfectivo(oferta(), 3, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(1290);
    expect(d.origenPrecio).toBe('escala');
    expect(d.subtotal).toBe(3870);
  });

  it('no aplica la escala si es peor que el precio de socio', () => {
    const o = oferta({ escalas: [{ minUnidades: 3, precioUnitario: 1600 }] });
    const d = precioEfectivo(o, 3, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(1490);
  });

  it('descuenta el 7% de cashback solo los jueves', () => {
    const martes = precioEfectivo(oferta(), 3, PERFIL_POR_DEFECTO, { fecha: MARTES });
    const jueves = precioEfectivo(oferta(), 3, PERFIL_POR_DEFECTO, { fecha: JUEVES });

    expect(martes.descuentoCashback).toBe(0);
    expect(jueves.descuentoCashback).toBeCloseTo(3870 * 0.07, 2);
    expect(jueves.totalEfectivo).toBeLessThan(martes.totalEfectivo);
  });

  it('respeta el tope de cashback por compra', () => {
    const perfil: PerfilCompra = {
      ...PERFIL_POR_DEFECTO,
      cashback: [{ etiqueta: 'tope', tiendas: '*', diasSemana: [4], porcentaje: 0.07, topePorCompra: 100 }],
    };
    const d = precioEfectivo(oferta(), 10, perfil, { fecha: JUEVES });
    expect(d.descuentoCashback).toBe(100);
  });

  it('no cobra costo financiero con cuotas sin interes', () => {
    expect(precioEfectivo(oferta(), 3, PERFIL_POR_DEFECTO, { fecha: MARTES }).costoFinanciero).toBe(0);
  });

  it('cobra costo financiero cuando las cuotas tienen interes', () => {
    const conInteres: PerfilCompra = { ...PERFIL_POR_DEFECTO, cuotasSinInteres: false };
    const d = precioEfectivo(oferta(), 3, conInteres, { fecha: MARTES });
    expect(d.costoFinanciero).toBeCloseTo(3870 * 0.025 * 3, 2);
  });

  it('cobra la bodega segun cuantos meses de stock compras', () => {
    const conBodega: PerfilCompra = { ...PERFIL_POR_DEFECTO, costoBodegaMensualPorUnidad: 50 };
    const d = precioEfectivo(oferta(), 12, conBodega, { fecha: MARTES, consumoMensual: 2 });
    expect(d.mesesDeStock).toBe(6);
    // 50 * 12 unidades * (6 meses / 2) = 1800
    expect(d.costoAlmacenamiento).toBe(1800);
  });

  it('normaliza a $/kg para poder comparar formatos distintos', () => {
    const d = precioEfectivo(oferta(), 1, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.porUnidadMedida).toEqual({ valor: 1490, base: 'kg' });

    const cinco = precioEfectivo(
      oferta({ nombre: 'Arroz Grado 2 Miraflores 5 kg', precioLista: 5990, precioSocio: undefined, escalas: [] }),
      1,
      PERFIL_POR_DEFECTO,
      { fecha: MARTES },
    );
    expect(cinco.porUnidadMedida).toEqual({ valor: 1198, base: 'kg' });
  });

  it('avisa cuando no puede deducir el formato', () => {
    const d = precioEfectivo(oferta({ nombre: 'Palta Hass a granel' }), 1, PERFIL_POR_DEFECTO, {
      fecha: MARTES,
    });
    expect(d.porUnidadMedida).toBeNull();
    expect(d.notas.join(' ')).toContain('no se pudo deducir el formato');
  });

  it('rechaza cantidades invalidas', () => {
    expect(() => precioEfectivo(oferta(), 0, PERFIL_POR_DEFECTO, { fecha: MARTES })).toThrow();
    expect(() => precioEfectivo(oferta(), 1.5, PERFIL_POR_DEFECTO, { fecha: MARTES })).toThrow();
  });
});

describe('comparar', () => {
  it('ordena por $/kg y no por precio de etiqueta', () => {
    const jumbo = oferta({ tienda: 'jumbo', nombre: 'Arroz Grado 1 Tucapel 1 kg', precioLista: 1390, precioSocio: undefined, escalas: [] });
    const alvi = oferta({ tienda: 'alvi', nombre: 'Arroz Grado 1 Tucapel 5 kg', precioLista: 5900, precioSocio: undefined, escalas: [] });

    const { ranking, criterio } = comparar([jumbo, alvi], 1, PERFIL_POR_DEFECTO, { fecha: MARTES });

    // Alvi es mas caro en la etiqueta ($5.900 vs $1.390) pero mas barato por kilo.
    expect(criterio).toBe('unidad-medida');
    expect(ranking[0]!.tienda).toBe('alvi');
    expect(ranking[0]!.porUnidadMedida!.valor).toBe(1180);
  });

  it('cae a precio unitario y avisa cuando algun formato no se pudo deducir', () => {
    const a = oferta({ tienda: 'jumbo', nombre: 'Palta Hass a granel', precioSocio: undefined, escalas: [] });
    const b = oferta({ tienda: 'alvi', precioSocio: undefined, escalas: [] });

    const { criterio, advertencias } = comparar([a, b], 1, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(criterio).toBe('unitario');
    expect(advertencias.join(' ')).toContain('sin formato deducible');
  });
});

describe('mejorCantidad', () => {
  // Caso Alvi real: el precio sigue bajando en un segundo tramo mayorista.
  const dosTramos = oferta({
    escalas: [
      { minUnidades: 3, precioUnitario: 1290 },
      { minUnidades: 12, precioUnitario: 1150 },
    ],
  });

  it('llena la bodega cuando hay un tramo mayor y guardar no cuesta', () => {
    const { mejor } = mejorCantidad(dosTramos, [1, 3, 12], PERFIL_POR_DEFECTO, {
      fecha: JUEVES,
      consumoMensual: 2,
    });
    expect(mejor.cantidad).toBe(12);
  });

  it('deja de convenir cuando la bodega cuesta cara', () => {
    const bodegaCara: PerfilCompra = { ...PERFIL_POR_DEFECTO, costoBodegaMensualPorUnidad: 300 };
    const { mejor } = mejorCantidad(dosTramos, [1, 3, 12], bodegaCara, {
      fecha: JUEVES,
      consumoMensual: 2,
    });
    expect(mejor.cantidad).toBe(3);
  });

  it('ante igual costo prefiere la cantidad menor, para no inmovilizar plata de gratis', () => {
    // Con un solo tramo (3+), comprar 12 cuesta lo mismo por kilo que comprar 3.
    const { mejor } = mejorCantidad(oferta(), [3, 12], PERFIL_POR_DEFECTO, {
      fecha: JUEVES,
      consumoMensual: 2,
    });
    expect(mejor.cantidad).toBe(3);
  });
});
