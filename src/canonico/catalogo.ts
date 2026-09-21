import { readFile, writeFile } from 'node:fs/promises';
import type { Oferta } from '../tipos.js';
import { normalizar, tokenizar, dice } from './similitud.js';
import { CATALOGO_VACIO, type Catalogo, type Equivalencia, type ProductoCanonico } from './tipos.js';

export const RUTA_CATALOGO = 'catalogo.json';

export async function cargar(ruta = RUTA_CATALOGO): Promise<Catalogo> {
  try {
    const datos = JSON.parse(await readFile(ruta, 'utf8')) as Catalogo;
    if (datos.version !== 1 || !Array.isArray(datos.productos)) return { ...CATALOGO_VACIO };
    return datos;
  } catch {
    // Todavia no existe: se empieza vacio en vez de fallar.
    return { ...CATALOGO_VACIO };
  }
}

export async function guardar(catalogo: Catalogo, ruta = RUTA_CATALOGO): Promise<void> {
  await writeFile(ruta, JSON.stringify(catalogo, null, 2) + '\n');
}

/** Identificador estable a partir del nombre: minusculas, sin tildes, con guiones. */
export function idDesdeNombre(nombre: string): string {
  return normalizar(nombre).replace(/\s+/g, '-').slice(0, 60);
}

export function buscarPorId(catalogo: Catalogo, id: string): ProductoCanonico | undefined {
  return catalogo.productos.find((p) => p.id === id);
}

/** El producto canonico al que pertenece un SKU de una tienda, si esta mapeado. */
export function buscarPorSku(
  catalogo: Catalogo,
  tienda: string,
  sku: string,
): ProductoCanonico | undefined {
  return catalogo.productos.find((p) =>
    p.equivalencias.some((e) => e.tienda === tienda && e.sku === sku),
  );
}

/** Productos canonicos cuyo nombre se parece al texto buscado, de mas a menos. */
export function buscarPorNombre(catalogo: Catalogo, texto: string): ProductoCanonico[] {
  const tokens = tokenizar(texto);
  return catalogo.productos
    .map((p) => ({ p, s: dice(tokens, tokenizar(p.nombre)) }))
    .filter(({ p, s }) => s > 0.3 || normalizar(p.nombre).includes(normalizar(texto)))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);
}

/**
 * Agrega o reemplaza la equivalencia de una tienda dentro de un producto.
 *
 * Reemplaza en vez de acumular: un producto canonico tiene a lo mas un SKU por
 * tienda, y si cambia es porque el anterior dejo de servir.
 */
export function fijarEquivalencia(
  producto: ProductoCanonico,
  equivalencia: Equivalencia,
): ProductoCanonico {
  return {
    ...producto,
    equivalencias: [
      ...producto.equivalencias.filter((e) => e.tienda !== equivalencia.tienda),
      equivalencia,
    ].sort((a, b) => a.tienda.localeCompare(b.tienda)),
  };
}

/** Inserta o actualiza un producto, respetando el resto del catalogo. */
export function upsert(catalogo: Catalogo, producto: ProductoCanonico): Catalogo {
  const existe = catalogo.productos.some((p) => p.id === producto.id);
  return {
    ...catalogo,
    productos: existe
      ? catalogo.productos.map((p) => (p.id === producto.id ? producto : p))
      : [...catalogo.productos, producto],
  };
}

export function equivalenciaDesdeOferta(oferta: Oferta, origen: 'ean' | 'manual'): Equivalencia {
  return {
    tienda: oferta.tienda,
    sku: oferta.sku,
    ean: oferta.ean,
    nombre: oferta.nombre,
    url: oferta.url,
    origen,
    confirmadoEn: new Date().toISOString().slice(0, 10),
  };
}

/**
 * De todas las ofertas recogidas, las que corresponden a un producto canonico.
 *
 * Se empareja por SKU, que es lo que la equivalencia guarda. El EAN sirve de
 * respaldo cuando la tienda cambia el SKU pero mantiene el articulo.
 */
export function ofertasDe(producto: ProductoCanonico, ofertas: Oferta[]): Oferta[] {
  const elegidas: Oferta[] = [];
  for (const eq of producto.equivalencias) {
    const porSku = ofertas.find((o) => o.tienda === eq.tienda && o.sku === eq.sku);
    const porEan = eq.ean
      ? ofertas.find((o) => o.tienda === eq.tienda && o.ean === eq.ean)
      : undefined;
    const elegida = porSku ?? porEan;
    if (elegida) elegidas.push(elegida);
  }
  return elegidas;
}

/** Quita un producto del catalogo. Devuelve null si ese id no existia. */
export function borrar(catalogo: Catalogo, id: string): Catalogo | null {
  if (!catalogo.productos.some((p) => p.id === id)) return null;
  return { ...catalogo, productos: catalogo.productos.filter((p) => p.id !== id) };
}
