import { describe, expect, it } from 'vitest';
import { correrCanasta } from '../src/canasta/correr.js';
import { leerHistorial } from '../src/canasta/historial.js';
import type { Catalogo, Equivalencia } from '../src/canonico/tipos.js';
import { Descartes } from '../src/diagnostico.js';
import { construirDatos, VERSION_DATOS } from '../src/publicar/vista.js';
import { PERFIL_POR_DEFECTO } from '../src/precios/reglas.js';
import type { Oferta } from '../src/tipos.js';

// La leche real: en Alvi $1.250 regular, $1.140 desde 3 y $1.090 desde 12 (socio);
// en Jumbo $1.290.
const CATALOGO: Catalogo = {
  version: 1,
  productos: [
    {
      id: 'colun-semi',
      nombre: 'Leche Colun semidescremada 1 L',
      cantidadHabitual: 6,
      equivalencias: [
        { tienda: 'alvi', sku: 'a1', nombre: 'Leche semidescremada Colun sin tapa 1 L', origen: 'manual', confirmadoEn: '2026-09-22' },
        { tienda: 'jumbo', sku: 'j1', nombre: 'Leche Colun Semidescremada 1 L', origen: 'manual', confirmadoEn: '2026-09-22' },
      ],
    },
  ],
};

function oferta(tienda: string, sku: string, lista: number, tramos: Array<[number, number]> = []): Oferta {
  return {
    tienda,
    sku,
    nombre: 'Leche Colun Semidescremada 1 L',
    marca: 'Colun',
    url: `https://www.${tienda}.cl/leche/p`,
    precioLista: lista,
    escalas: tramos.map(([min, precio]) => ({ minUnidades: min, precioUnitario: precio, requiereMembresia: true })),
    contenido: { cantidad: 1, base: 'L', envases: 1, origen: '1 L' },
    promoTexto: [],
    disponible: true,
    capturadoEn: '',
  };
}

/** Tiendas falsas: devuelven lo que se les diga, sin tocar la red. */
function tiendasFalsas(precios: Record<string, Oferta | Error>) {
  return async (eq: Equivalencia): Promise<Oferta[]> => {
    const r = precios[eq.tienda];
    if (r instanceof Error) throw r;
    return r ? [r] : [];
  };
}

const MARTES = new Date(2026, 8, 22, 12);
const MIERCOLES = new Date(2026, 8, 23, 12);
const JUEVES = new Date(2026, 8, 24, 12);

describe('corrida completa hacia datos.json', () => {
  it('la primera corrida resuelve el mejor precio y no inventa cambios', async () => {
    const corrida = await correrCanasta({
      catalogo: CATALOGO,
      historial: leerHistorial(undefined),
      fecha: MARTES,
      traer: tiendasFalsas({
        alvi: oferta('alvi', 'a1', 1250, [[3, 1140], [12, 1090]]),
        jumbo: oferta('jumbo', 'j1', 1290),
      }),
    });
    const datos = construirDatos(corrida, PERFIL_POR_DEFECTO);

    expect(datos.version).toBe(VERSION_DATOS);
    expect(corrida.habiaHistorial).toBe(false);
    expect(datos.cambios).toEqual([]);

    const [leche] = datos.productos;
    expect(leche!.mejor).toMatchObject({ tienda: 'alvi', tiendaNombre: 'Alvi', porMedida: 1090, base: 'L', cantidad: 12 });
    expect(leche!.mejor!.ahorroVsReferencia).toEqual({ porcentaje: expect.any(Number), cantidad: 6 });
    expect(leche!.alternativas.map((a) => a.tienda)).toEqual(['jumbo']);
  });

  it('la segunda corrida detecta la baja respecto del dia anterior', async () => {
    const primera = await correrCanasta({
      catalogo: CATALOGO,
      historial: leerHistorial(undefined),
      fecha: MARTES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1290), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const segunda = await correrCanasta({
      catalogo: CATALOGO,
      historial: primera.historial,
      fecha: MIERCOLES,
      traer: tiendasFalsas({
        alvi: oferta('alvi', 'a1', 1250, [[3, 1140], [12, 1090]]),
        jumbo: oferta('jumbo', 'j1', 1290),
      }),
    });
    const datos = construirDatos(segunda, PERFIL_POR_DEFECTO);

    const deAlvi = datos.cambios.filter((c) => c.tienda === 'alvi');
    expect(deAlvi.find((c) => c.tipo === 'baja')?.texto).toMatch(/^Bajó 15,5%/);
    expect(deAlvi.filter((c) => c.tipo === 'tramos')).toHaveLength(2);
    expect(deAlvi.every((c) => !c.verificar)).toBe(true);
  });

  it('una tienda que falla queda en problemas y el producto sigue con la otra', async () => {
    const descartes = new Descartes();
    const corrida = await correrCanasta({
      catalogo: CATALOGO,
      historial: leerHistorial(undefined),
      fecha: MARTES,
      descartes,
      traer: tiendasFalsas({ alvi: new Error('HTTP 403'), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const datos = construirDatos(corrida, PERFIL_POR_DEFECTO, { descartes });

    expect(datos.problemas.join(' ')).toContain('HTTP 403');
    expect(datos.productos[0]!.mejor!.tienda).toBe('jumbo');
    expect(datos.productos[0]!.faltan).toContain('Alvi');
  });

  it('informa el cashback del dia', async () => {
    const corrida = await correrCanasta({
      catalogo: CATALOGO,
      historial: leerHistorial(undefined),
      fecha: JUEVES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1250), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const datos = construirDatos(corrida, PERFIL_POR_DEFECTO);
    expect(datos.dia).toBe('jueves');
    expect(datos.cashbackHoy).toEqual(['Jueves 7% tarjeta B6']);
  });

  it('sobrevive la ida y vuelta por JSON, que es como llega al telefono', async () => {
    const corrida = await correrCanasta({
      catalogo: CATALOGO,
      historial: leerHistorial(undefined),
      fecha: MARTES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1250, [[12, 1090]]), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const datos = construirDatos(corrida, PERFIL_POR_DEFECTO, { generadoEn: MARTES });
    expect(JSON.parse(JSON.stringify(datos))).toEqual(datos);
  });
});

describe('el cashback del dia no es un cambio de precio', () => {
  // Detectado al ver la PWA: un miercoles seguido de un jueves hacia que todo
  // "bajara 7%", que era el cashback de la tarjeta y no una rebaja. Cada
  // viernes todo habria "subido 7%", tapando las ofertas reales.
  const precios = {
    alvi: oferta('alvi', 'a1', 1250, [[12, 1090]]),
    jumbo: oferta('jumbo', 'j1', 1290),
  };

  it('mismos precios de gondola el miercoles y el jueves no generan cambios', async () => {
    const miercoles = await correrCanasta({
      catalogo: CATALOGO, historial: leerHistorial(undefined), fecha: MIERCOLES, traer: tiendasFalsas(precios),
    });
    const jueves = await correrCanasta({
      catalogo: CATALOGO, historial: miercoles.historial, fecha: JUEVES, traer: tiendasFalsas(precios),
    });

    // El precio efectivo del jueves si es menor: el cashback aplica.
    expect(jueves.resumen.lineas[0]!.ganador!.desglose.unitarioEfectivo).toBeLessThan(1090);
    // Pero el historial registra la gondola, y ahi nada cambio.
    expect(construirDatos(jueves, PERFIL_POR_DEFECTO).cambios).toEqual([]);
  });

  it('una baja real se mide sobre la gondola, sin el cashback mezclado', async () => {
    const miercoles = await correrCanasta({
      catalogo: CATALOGO, historial: leerHistorial(undefined), fecha: MIERCOLES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1290), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const jueves = await correrCanasta({
      catalogo: CATALOGO, historial: miercoles.historial, fecha: JUEVES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1250, [[12, 1090]]), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const baja = construirDatos(jueves, PERFIL_POR_DEFECTO).cambios.find((c) => c.tipo === 'baja');
    // $1.290 -> $1.090 es 15,5%. Con el cashback mezclado habria dicho 21,4%.
    expect(baja?.texto).toMatch(/^Bajó 15,5%/);
  });
});

describe('"el precio mas bajo registrado" exige historia', () => {
  it('no se afirma con un solo registro previo', async () => {
    const primera = await correrCanasta({
      catalogo: CATALOGO, historial: leerHistorial(undefined), fecha: MARTES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1290), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const segunda = await correrCanasta({
      catalogo: CATALOGO, historial: primera.historial, fecha: MIERCOLES,
      traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', 1190), jumbo: oferta('jumbo', 'j1', 1290) }),
    });
    const datos = construirDatos(segunda, PERFIL_POR_DEFECTO);
    expect(datos.cambios.some((c) => c.minimoHistorico)).toBe(false);
  });

  it('si se afirma con historia suficiente', async () => {
    let historial = leerHistorial(undefined);
    const dias = [1290, 1350, 1290, 1190];
    let ultima;
    for (const [i, precio] of dias.entries()) {
      ultima = await correrCanasta({
        catalogo: CATALOGO, historial, fecha: new Date(2026, 8, 14 + i, 12),
        traer: tiendasFalsas({ alvi: oferta('alvi', 'a1', precio), jumbo: oferta('jumbo', 'j1', 1400) }),
      });
      historial = ultima.historial;
    }
    const cambio = construirDatos(ultima!, PERFIL_POR_DEFECTO).cambios.find((c) => c.tienda === 'alvi');
    expect(cambio?.minimoHistorico).toBe(true);
  });
});
