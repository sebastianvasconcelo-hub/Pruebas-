import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buscarPorId,
  buscarPorNombre,
  buscarPorSku,
  cargar,
  equivalenciaDesdeOferta,
  fijarEquivalencia,
  guardar,
  idDesdeNombre,
  ofertasDe,
  upsert,
} from '../src/canonico/catalogo.js';
import { CATALOGO_VACIO, type Catalogo, type ProductoCanonico } from '../src/canonico/tipos.js';
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

  it('ignora un archivo con version desconocida en vez de reventar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cat-'));
    const ruta = join(dir, 'catalogo.json');
    await guardar({ version: 99, productos: [] } as unknown as Catalogo, ruta);
    expect(await cargar(ruta)).toEqual(CATALOGO_VACIO);
  });
});
