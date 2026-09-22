import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  borrar,
  buscarPorId,
  buscarPorNombre,
  buscarPorSku,
  cargar,
  conCantidades,
  equivalenciaDesdeOferta,
  fijarEquivalencia,
  guardar,
  idDesdeNombre,
  mismaUrl,
  ofertasDe,
  refrescar,
  upsert,
} from '../src/canonico/catalogo.js';
import { CATALOGO_VACIO, type Catalogo, type ProductoCanonico } from '../src/canonico/tipos.js';
import { Descartes } from '../src/diagnostico.js';
import type { Oferta } from '../src/tipos.js';

function oferta(over: Partial<Oferta>): Oferta {
  return {
    tienda: 'alvi',
    sku: '438',
    nombre: 'Arroz Tucapel gran seleccion G2 1 Kg',
    precioLista: 2090,
    escalas: [],
    promoTexto: [],
    disponible: true,
    capturadoEn: '',
    ...over,
  };
}

const ARROZ: ProductoCanonico = {
  id: 'arroz-tucapel-g2-1kg',
  nombre: 'Arroz Tucapel G2 1 kg',
  equivalencias: [
    { tienda: 'alvi', sku: '438', ean: '7801420220138', nombre: 'Arroz Tucapel G2 1 Kg', origen: 'ean', confirmadoEn: '2026-09-19' },
  ],
};

describe('idDesdeNombre', () => {
  it('produce un identificador estable sin tildes ni espacios', () => {
    expect(idDesdeNombre('Arroz Tucapel Gran Selección 1 kg')).toBe('arroz-tucapel-gran-seleccion-1-kg');
  });
});

describe('busquedas', () => {
  const catalogo: Catalogo = { version: 1, productos: [ARROZ] };

  it('encuentra por id', () => {
    expect(buscarPorId(catalogo, 'arroz-tucapel-g2-1kg')?.nombre).toBe('Arroz Tucapel G2 1 kg');
  });

  it('encuentra el canonico al que pertenece un SKU de tienda', () => {
    expect(buscarPorSku(catalogo, 'alvi', '438')?.id).toBe('arroz-tucapel-g2-1kg');
    expect(buscarPorSku(catalogo, 'jumbo', '438')).toBeUndefined();
  });

  it('encuentra por nombre aproximado', () => {
    expect(buscarPorNombre(catalogo, 'arroz tucapel')[0]?.id).toBe('arroz-tucapel-g2-1kg');
    expect(buscarPorNombre(catalogo, 'detergente')).toEqual([]);
  });
});

describe('fijarEquivalencia', () => {
  it('agrega una tienda nueva', () => {
    const p = fijarEquivalencia(ARROZ, equivalenciaDesdeOferta(oferta({ tienda: 'jumbo', sku: 'abc' }), 'manual'));
    expect(p.equivalencias).toHaveLength(2);
  });

  it('reemplaza en vez de duplicar la misma tienda', () => {
    const p = fijarEquivalencia(ARROZ, equivalenciaDesdeOferta(oferta({ tienda: 'alvi', sku: '999' }), 'manual'));
    expect(p.equivalencias).toHaveLength(1);
    expect(p.equivalencias[0]!.sku).toBe('999');
  });

  it('no muta el producto original', () => {
    fijarEquivalencia(ARROZ, equivalenciaDesdeOferta(oferta({ tienda: 'jumbo' }), 'manual'));
    expect(ARROZ.equivalencias).toHaveLength(1);
  });
});

describe('upsert', () => {
  it('inserta si no existe y actualiza si existe', () => {
    const uno = upsert(CATALOGO_VACIO, ARROZ);
    expect(uno.productos).toHaveLength(1);
    const dos = upsert(uno, { ...ARROZ, nombre: 'Otro nombre' });
    expect(dos.productos).toHaveLength(1);
    expect(dos.productos[0]!.nombre).toBe('Otro nombre');
  });
});

describe('ofertasDe', () => {
  it('elige la oferta de cada tienda segun el SKU mapeado', () => {
    const elegidas = ofertasDe(ARROZ, [
      oferta({ tienda: 'alvi', sku: '438' }),
      oferta({ tienda: 'alvi', sku: '999', nombre: 'otro arroz' }),
      oferta({ tienda: 'jumbo', sku: 'zzz' }),
    ]);
    expect(elegidas).toHaveLength(1);
    expect(elegidas[0]!.sku).toBe('438');
  });

  it('cae al EAN si la tienda cambio el SKU', () => {
    const elegidas = ofertasDe(ARROZ, [oferta({ tienda: 'alvi', sku: 'nuevo', ean: '7801420220138' })]);
    expect(elegidas[0]!.sku).toBe('nuevo');
  });

  it('omite las tiendas que no trajeron el producto', () => {
    expect(ofertasDe(ARROZ, [])).toEqual([]);
  });
});

describe('cargar y guardar', () => {
  it('devuelve catalogo vacio si el archivo no existe', async () => {
    expect(await cargar('/no/existe/catalogo.json')).toEqual(CATALOGO_VACIO);
  });

  it('ida y vuelta conserva el contenido', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cat-'));
    const ruta = join(dir, 'catalogo.json');
    await guardar({ version: 1, productos: [ARROZ] }, ruta);
    expect((await cargar(ruta)).productos[0]!.id).toBe(ARROZ.id);
    expect((await readFile(ruta, 'utf8')).endsWith('\n')).toBe(true);
  });

  it('falla ruidosamente si el archivo existe pero tiene otro formato', async () => {
    // Devolver catalogo vacio haria creer que se perdieron los productos,
    // cuando el archivo esta ahi y solo hay que repararlo.
    const dir = await mkdtemp(join(tmpdir(), 'cat-'));
    const ruta = join(dir, 'catalogo.json');
    await guardar({ version: 99, productos: [] } as unknown as Catalogo, ruta);
    await expect(cargar(ruta)).rejects.toThrow(/formato esperado/);
  });

  it('falla ruidosamente si el archivo existe pero no es JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cat-'));
    const ruta = join(dir, 'catalogo.json');
    await writeFile(join(ruta), '{roto');
    await expect(cargar(ruta)).rejects.toThrow(/no es JSON valido/);
  });
});

describe('borrar', () => {
  const catalogo: Catalogo = { version: 1, productos: [ARROZ] };

  it('quita el producto pedido', () => {
    expect(borrar(catalogo, ARROZ.id)?.productos).toEqual([]);
  });

  it('devuelve null si el id no existe, para poder avisar', () => {
    expect(borrar(catalogo, 'no-existe')).toBeNull();
  });

  it('no muta el catalogo original', () => {
    borrar(catalogo, ARROZ.id);
    expect(catalogo.productos).toHaveLength(1);
  });
});

describe('mismaUrl', () => {
  it('ignora protocolo, www, query y barra final', () => {
    expect(mismaUrl('https://www.jumbo.cl/leche/p', 'http://jumbo.cl/leche/p/')).toBe(true);
    expect(mismaUrl('https://www.jumbo.cl/leche/p?sc=1', 'https://www.jumbo.cl/leche/p')).toBe(true);
  });

  it('distingue productos distintos', () => {
    expect(mismaUrl('https://www.jumbo.cl/leche/p', 'https://www.jumbo.cl/arroz/p')).toBe(false);
  });

  it('es falso si falta alguna', () => {
    expect(mismaUrl(undefined, 'https://www.jumbo.cl/leche/p')).toBe(false);
  });
});

describe('ofertasDe: identificadores distintos segun el origen', () => {
  // Jumbo entrega el slug en la busqueda y el skuId numerico en la ficha.
  const JUMBO_DESDE_BUSQUEDA: ProductoCanonico = {
    id: 'leche-colun',
    nombre: 'Leche Colun semidescremada 1 L',
    equivalencias: [
      {
        tienda: 'jumbo',
        sku: 'leche-semidescremada-colun-1-l',
        nombre: 'Leche Colun',
        url: 'https://www.jumbo.cl/leche-semidescremada-colun-1-l/p',
        origen: 'manual',
        confirmadoEn: '2026-09-22',
      },
    ],
  };

  it('reconoce la oferta de la ficha aunque el sku no coincida', () => {
    const desdeFicha = oferta({
      tienda: 'jumbo',
      sku: '10995',
      url: 'https://www.jumbo.cl/leche-semidescremada-colun-1-l/p',
    });
    expect(ofertasDe(JUMBO_DESDE_BUSQUEDA, [desdeFicha])).toHaveLength(1);
  });

  it('no recoge un producto distinto de la misma tienda', () => {
    const otro = oferta({ tienda: 'jumbo', sku: '999', url: 'https://www.jumbo.cl/arroz/p' });
    expect(ofertasDe(JUMBO_DESDE_BUSQUEDA, [otro])).toEqual([]);
  });

  it('el SKU sigue teniendo prioridad sobre la URL', () => {
    const porSku = oferta({ tienda: 'jumbo', sku: 'leche-semidescremada-colun-1-l', nombre: 'por sku' });
    const porUrl = oferta({ tienda: 'jumbo', sku: '10995', url: 'https://www.jumbo.cl/leche-semidescremada-colun-1-l/p', nombre: 'por url' });
    expect(ofertasDe(JUMBO_DESDE_BUSQUEDA, [porUrl, porSku])[0]!.nombre).toBe('por sku');
  });
});

describe('ofertasDe: el nombre como ultimo recurso', () => {
  // Caso real: Jumbo reescribio la direccion del producto y el slug guardado
  // dejo de calzar, aunque el articulo sigue en su catalogo.
  const conSlugCaduco: ProductoCanonico = {
    id: 'leche-colun',
    nombre: 'Leche Colun semidescremada 1 L',
    equivalencias: [
      {
        tienda: 'jumbo',
        sku: 'leche-colun-semi-descremada-1-litro',
        nombre: 'Leche Colun Semidescremada 1 L',
        url: 'https://www.jumbo.cl/leche-colun-semi-descremada-1-litro/p',
        origen: 'manual',
        confirmadoEn: '2026-09-22',
      },
    ],
  };

  const hoy = oferta({
    tienda: 'jumbo',
    sku: 'leche-colun-semidescremada-1-l',
    nombre: 'Leche Colun Semidescremada 1 L',
    url: 'https://www.jumbo.cl/leche-colun-semidescremada-1-l/p',
  });

  it('rescata el producto cuya direccion cambio', () => {
    expect(ofertasDe(conSlugCaduco, [hoy])).toHaveLength(1);
  });

  it('reporta el sku guardado y el recibido, para poder compararlos', () => {
    const d = new Descartes();
    ofertasDe(conSlugCaduco, [hoy], d);
    const porque = d.lista()[0]!.porque;
    expect(porque).toContain('leche-colun-semi-descremada-1-litro');
    expect(porque).toContain('leche-colun-semidescremada-1-l');
  });

  it('exige nombre exacto: no se conforma con parecido', () => {
    const otraLeche = oferta({
      tienda: 'jumbo',
      sku: 'x',
      nombre: 'Leche Colun Descremada 1 L',
      url: 'https://www.jumbo.cl/x/p',
    });
    expect(ofertasDe(conSlugCaduco, [otraLeche])).toEqual([]);
  });

  it('ignora mayusculas y tildes al comparar el nombre', () => {
    const conTildes = oferta({
      tienda: 'jumbo',
      sku: 'x',
      nombre: 'LECHE COLÚN SEMIDESCREMADA 1 L',
      url: 'https://www.jumbo.cl/x/p',
    });
    expect(ofertasDe(conSlugCaduco, [conTildes])).toHaveLength(1);
  });
});

describe('refrescar', () => {
  const eq = {
    tienda: 'jumbo',
    sku: 'viejo',
    nombre: 'Leche Colun',
    url: 'https://www.jumbo.cl/viejo/p',
    origen: 'manual' as const,
    confirmadoEn: '2026-09-01',
  };

  it('actualiza sku, nombre y url con los datos frescos', () => {
    const nueva = refrescar(eq, oferta({ tienda: 'jumbo', sku: 'nuevo', nombre: 'Leche Colun 1 L', url: 'https://www.jumbo.cl/nuevo/p' }));
    expect(nueva).toMatchObject({ sku: 'nuevo', nombre: 'Leche Colun 1 L', url: 'https://www.jumbo.cl/nuevo/p' });
  });

  it('conserva quien confirmo el emparejamiento y cuando', () => {
    // Refrescar un sku caduco no cambia la decision de que son el mismo producto.
    const nueva = refrescar(eq, oferta({ tienda: 'jumbo', sku: 'nuevo' }));
    expect(nueva.origen).toBe('manual');
    expect(nueva.confirmadoEn).toBe('2026-09-01');
  });

  it('no pierde el ean guardado si la oferta nueva no lo trae', () => {
    const nueva = refrescar({ ...eq, ean: '123' }, oferta({ tienda: 'jumbo', sku: 'nuevo', ean: undefined }));
    expect(nueva.ean).toBe('123');
  });
});

describe('conCantidades', () => {
  it('fija la cantidad por compra, que es la que decide la comparacion', () => {
    expect(conCantidades(ARROZ, { cantidadHabitual: 6 }).cantidadHabitual).toBe(6);
  });

  it('fija el consumo mensual, que es otra cosa', () => {
    // Se pueden consumir 24 al mes y llevar 6 por visita: son independientes.
    const p = conCantidades(ARROZ, { cantidadHabitual: 6, consumoMensual: 24 });
    expect(p.cantidadHabitual).toBe(6);
    expect(p.consumoMensual).toBe(24);
  });

  it('cambia solo lo que se le pasa', () => {
    const conAmbas = conCantidades(ARROZ, { cantidadHabitual: 6, consumoMensual: 24 });
    expect(conCantidades(conAmbas, { consumoMensual: 12 }).cantidadHabitual).toBe(6);
  });

  it('rechaza una cantidad por compra que no sea entero positivo', () => {
    expect(() => conCantidades(ARROZ, { cantidadHabitual: 0 })).toThrow();
    expect(() => conCantidades(ARROZ, { cantidadHabitual: 1.5 })).toThrow();
  });

  it('rechaza un consumo mensual no positivo', () => {
    expect(() => conCantidades(ARROZ, { consumoMensual: 0 })).toThrow();
    expect(() => conCantidades(ARROZ, { consumoMensual: Number.NaN })).toThrow();
  });

  it('no muta el producto original', () => {
    conCantidades(ARROZ, { cantidadHabitual: 6 });
    expect(ARROZ.cantidadHabitual).toBeUndefined();
  });
});
