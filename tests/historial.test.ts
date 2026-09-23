import { describe, expect, it } from 'vitest';
import {
  anotar,
  compararRegistros,
  fechaISO,
  HISTORIAL_VACIO,
  leerHistorial,
  minimoHistorico,
  registroAnterior,
  registroDesde,
  tiendaAnterior,
  type HistorialPrecios,
  type RegistroPrecio,
} from '../src/canasta/historial.js';

function registro(over: Partial<RegistroPrecio> = {}): RegistroPrecio {
  return {
    fecha: '2026-09-22',
    tienda: 'alvi',
    unitario: 1290,
    porMedida: 1290,
    base: 'L',
    cantidad: 1,
    lista: 1290,
    sku: '438',
    tramos: [],
    ...over,
  };
}

describe('leerHistorial', () => {
  it('parte vacio si no hay archivo', () => {
    expect(leerHistorial(undefined).registros).toEqual({});
  });

  it('descarta el formato anterior en vez de inventar una serie', () => {
    // La version 1 solo guardaba la tienda ganadora, sin precios.
    expect(leerHistorial({ 'colun-semi': 'alvi' }).registros).toEqual({});
    expect(leerHistorial({ version: 1, registros: {} }).registros).toEqual({});
  });

  it('lee el formato actual', () => {
    const h: HistorialPrecios = { version: 2, registros: { leche: [registro()] } };
    expect(leerHistorial(h).registros.leche).toHaveLength(1);
  });
});

describe('anotar', () => {
  it('agrega el registro del dia', () => {
    const h = anotar(HISTORIAL_VACIO, 'leche', registro());
    expect(h.registros.leche).toHaveLength(1);
  });

  it('reemplaza el del mismo dia y tienda en vez de duplicarlo', () => {
    // Correr la canasta dos veces el mismo dia no debe inflar la serie.
    let h = anotar(HISTORIAL_VACIO, 'leche', registro({ unitario: 1290 }));
    h = anotar(h, 'leche', registro({ unitario: 1250 }));
    expect(h.registros.leche).toHaveLength(1);
    expect(h.registros.leche![0]!.unitario).toBe(1250);
  });

  it('convive con otra tienda el mismo dia', () => {
    let h = anotar(HISTORIAL_VACIO, 'leche', registro({ tienda: 'alvi' }));
    h = anotar(h, 'leche', registro({ tienda: 'jumbo' }));
    expect(h.registros.leche).toHaveLength(2);
  });

  it('mantiene el orden cronologico', () => {
    let h = anotar(HISTORIAL_VACIO, 'leche', registro({ fecha: '2026-09-23' }));
    h = anotar(h, 'leche', registro({ fecha: '2026-09-16' }));
    expect(h.registros.leche!.map((r) => r.fecha)).toEqual(['2026-09-16', '2026-09-23']);
  });

  it('acota el largo para que el archivo no crezca sin fin', () => {
    let h: HistorialPrecios = HISTORIAL_VACIO;
    for (let i = 1; i <= 10; i++) {
      h = anotar(h, 'leche', registro({ fecha: `2026-09-${String(i).padStart(2, '0')}` }), 5);
    }
    expect(h.registros.leche).toHaveLength(5);
    expect(h.registros.leche![0]!.fecha).toBe('2026-09-06');
  });

  it('no muta el historial original', () => {
    const h = anotar(HISTORIAL_VACIO, 'leche', registro());
    expect(HISTORIAL_VACIO.registros).toEqual({});
    expect(h.registros.leche).toHaveLength(1);
  });
});

describe('registroAnterior', () => {
  const h = anotar(
    anotar(HISTORIAL_VACIO, 'leche', registro({ fecha: '2026-09-16', unitario: 1390 })),
    'leche',
    registro({ fecha: '2026-09-22', unitario: 1290 }),
  );

  it('devuelve el ultimo previo a hoy', () => {
    expect(registroAnterior(h, 'leche', 'alvi', '2026-09-23')?.unitario).toBe(1290);
  });

  it('ignora el registro de hoy', () => {
    expect(registroAnterior(h, 'leche', 'alvi', '2026-09-22')?.unitario).toBe(1390);
  });

  it('no inventa nada la primera vez', () => {
    expect(registroAnterior(HISTORIAL_VACIO, 'leche', 'alvi', '2026-09-23')).toBeUndefined();
  });
});

describe('compararRegistros', () => {
  it('detecta la baja de precio y su magnitud', () => {
    // El caso real: la leche paso de $1.290 a $1.090 por kilo.
    const c = compararRegistros(
      registro({ porMedida: 1290 }),
      registro({ fecha: '2026-09-23', porMedida: 1090 }),
    );
    expect(c.direccion).toBe('baja');
    expect(c.porcentaje).toBeCloseTo(15.5, 1);
  });

  it('detecta el alza', () => {
    const c = compararRegistros(registro({ porMedida: 1000 }), registro({ porMedida: 1100 }));
    expect(c.direccion).toBe('alza');
    expect(c.porcentaje).toBeCloseTo(10, 1);
  });

  it('reporta los tramos que aparecieron', () => {
    const c = compararRegistros(
      registro({ tramos: [] }),
      registro({ tramos: [{ min: 3, precio: 1140 }, { min: 12, precio: 1090 }] }),
    );
    expect(c.tramosNuevos).toHaveLength(2);
    expect(c.tramosIdos).toEqual([]);
  });

  it('reporta los tramos que desaparecieron', () => {
    const c = compararRegistros(
      registro({ tramos: [{ min: 3, precio: 1140 }] }),
      registro({ tramos: [] }),
    );
    expect(c.tramosIdos).toEqual([{ min: 3, precio: 1140 }]);
  });

  it('marca cuando el producto de referencia cambio de identidad', () => {
    // Una variacion que coincide con otro sku puede ser otro articulo, no una
    // oferta: no debe anunciarse sin revisar.
    const c = compararRegistros(registro({ sku: '438' }), registro({ sku: '999', porMedida: 900 }));
    expect(c.identidadCambio).toBe(true);
    expect(c.direccion).toBe('baja');
  });

  it('no marca identidad cuando el sku se mantiene', () => {
    expect(compararRegistros(registro(), registro({ porMedida: 900 })).identidadCambio).toBe(false);
  });

  it('cae al precio unitario cuando no hay medida', () => {
    const c = compararRegistros(
      registro({ porMedida: undefined, unitario: 2000 }),
      registro({ porMedida: undefined, unitario: 1000 }),
    );
    expect(c.porcentaje).toBeCloseTo(50, 1);
  });
});

describe('minimoHistorico', () => {
  let h = anotar(HISTORIAL_VACIO, 'leche', registro({ fecha: '2026-09-01', porMedida: 1390 }));
  h = anotar(h, 'leche', registro({ fecha: '2026-09-08', porMedida: 1190 }));
  h = anotar(h, 'leche', registro({ fecha: '2026-09-15', porMedida: 1290 }));

  it('encuentra el precio mas bajo visto y cuando fue', () => {
    const m = minimoHistorico(h, 'leche', 'alvi', '2026-09-23');
    expect(m).toMatchObject({ valor: 1190, fecha: '2026-09-08', registros: 3 });
  });

  it('no considera el dia de hoy', () => {
    expect(minimoHistorico(h, 'leche', 'alvi', '2026-09-08')?.valor).toBe(1390);
  });

  it('devuelve nada sin historia previa', () => {
    expect(minimoHistorico(HISTORIAL_VACIO, 'leche', 'alvi', '2026-09-23')).toBeUndefined();
  });
});

describe('tiendaAnterior', () => {
  it('es la mas barata del ultimo dia con datos', () => {
    let h = anotar(HISTORIAL_VACIO, 'leche', registro({ fecha: '2026-09-22', tienda: 'alvi', porMedida: 1290 }));
    h = anotar(h, 'leche', registro({ fecha: '2026-09-22', tienda: 'jumbo', porMedida: 1190 }));
    expect(tiendaAnterior(h, 'leche', '2026-09-23')).toBe('jumbo');
  });

  it('no mira dias anteriores si el ultimo ya tiene datos', () => {
    let h = anotar(HISTORIAL_VACIO, 'leche', registro({ fecha: '2026-09-15', tienda: 'jumbo', porMedida: 900 }));
    h = anotar(h, 'leche', registro({ fecha: '2026-09-22', tienda: 'alvi', porMedida: 1290 }));
    expect(tiendaAnterior(h, 'leche', '2026-09-23')).toBe('alvi');
  });

  it('devuelve nada la primera vez', () => {
    expect(tiendaAnterior(HISTORIAL_VACIO, 'leche', '2026-09-23')).toBeUndefined();
  });
});

describe('fechaISO', () => {
  it('usa el dia local y no el UTC', () => {
    // new Date('2026-09-23') en UTC cae el 22 por la tarde en Chile.
    expect(fechaISO(new Date(2026, 8, 23, 23, 30))).toBe('2026-09-23');
    expect(fechaISO(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});

describe('registroDesde', () => {
  const optimo = {
    oferta: {
      tienda: 'alvi',
      sku: '438',
      nombre: 'Leche Colun 1 L',
      precioLista: 1250,
      escalas: [
        { minUnidades: 3, precioUnitario: 1140 },
        { minUnidades: 12, precioUnitario: 1090 },
      ],
      promoTexto: [],
      disponible: true,
      capturadoEn: '',
    },
    desglose: {
      tienda: 'alvi',
      sku: '438',
      nombre: 'Leche Colun 1 L',
      cantidad: 12,
      precioUnitarioBruto: 1090,
      origenPrecio: 'escala' as const,
      subtotal: 13080,
      descuentoCashback: 0,
      costoFinanciero: 0,
      costoAlmacenamiento: 0,
      totalEfectivo: 13080,
      unitarioEfectivo: 1090,
      porUnidadMedida: { valor: 1090, base: 'L' as const },
      mesesDeStock: null,
      notas: [],
    },
    cantidad: 12,
    referencia: {} as never,
    ahorroPorcentaje: 12.8,
    exigeLlevarMas: true,
  };

  it('guarda el precio alcanzable y la cantidad que lo exige', () => {
    const r = registroDesde(optimo, new Date(2026, 8, 23, 12));
    expect(r).toMatchObject({ fecha: '2026-09-23', tienda: 'alvi', porMedida: 1090, cantidad: 12 });
  });

  it('guarda la identidad, para poder detectar que cambio el producto', () => {
    expect(registroDesde(optimo, new Date(2026, 8, 23, 12)).sku).toBe('438');
  });

  it('guarda los tramos vigentes ese dia', () => {
    expect(registroDesde(optimo, new Date(2026, 8, 23, 12)).tramos).toEqual([
      { min: 3, precio: 1140 },
      { min: 12, precio: 1090 },
    ]);
  });
});
