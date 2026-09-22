import { readFile, writeFile } from 'node:fs/promises';
import type { Descartes } from '../diagnostico.js';
import type { Oferta } from '../tipos.js';
import { normalizar, tokenizar, dice } from './similitud.js';
import { CATALOGO_VACIO, type Catalogo, type Equivalencia, type ProductoCanonico } from './tipos.js';

export const RUTA_CATALOGO = 'catalogo.json';

/**
 * Carga el catalogo.
 *
 * Que el archivo no exista es normal la primera vez y da un catalogo vacio.
 * Que exista pero este corrupto NO es lo mismo, y confundirlos seria grave:
 * el usuario veria "catalogo vacio" y creeria que perdio sus productos, cuando
 * el archivo esta ahi y solo hace falta repararlo. Por eso se distingue.
 */
export async function cargar(ruta = RUTA_CATALOGO): Promise<Catalogo> {
  let texto: string;
  try {
    texto = await readFile(ruta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...CATALOGO_VACIO };
    throw e;
  }

  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error(
      `${ruta} existe pero no es JSON valido. No se borro nada: revisa el archivo ` +
        `o muevelo a un lado para empezar de cero.`,
    );
  }

  const catalogo = datos as Catalogo;
  if (catalogo?.version !== 1 || !Array.isArray(catalogo.productos)) {
    throw new Error(
      `${ruta} no tiene el formato esperado (version 1 con una lista de productos). ` +
        `No se borro nada: revisa el archivo.`,
    );
  }
  return catalogo;
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

/** Dos URL apuntan al mismo producto, ignorando protocolo, query y barra final. */
export function mismaUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const limpiar = (u: string) =>
    u
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[?#]/)[0]!
      .replace(/\/+$/, '');
  return limpiar(a) === limpiar(b);
}

/**
 * De todas las ofertas recogidas, las que corresponden a un producto canonico.
 *
 * Se empareja por SKU, EAN o URL, en ese orden. La URL no es redundante: una
 * misma tienda puede entregar identificadores distintos segun de donde venga
 * el dato. En Jumbo, la busqueda publica un ItemList de schema.org sin sku, asi
 * que se deriva del slug de la direccion, mientras que la ficha entrega su
 * `skuId` numerico. Emparejando solo por SKU, un producto registrado desde la
 * busqueda no se reconocia al leerlo desde la ficha, y como Jumbo no expone EAN
 * la oferta se descartaba en silencio.
 */
export function ofertasDe(
  producto: ProductoCanonico,
  ofertas: Oferta[],
  descartes?: Descartes,
): Oferta[] {
  const elegidas: Oferta[] = [];
  for (const eq of producto.equivalencias) {
    const deLaTienda = ofertas.filter((o) => o.tienda === eq.tienda);
    const elegida =
      deLaTienda.find((o) => o.sku === eq.sku) ??
      (eq.ean ? deLaTienda.find((o) => o.ean === eq.ean) : undefined) ??
      deLaTienda.find((o) => mismaUrl(o.url, eq.url));

    if (elegida) elegidas.push(elegida);
    else if (deLaTienda.length > 0) {
      // La tienda respondio pero ninguna de sus ofertas es este producto: el
      // caso que hacia desaparecer a Jumbo sin dejar rastro.
      descartes?.registrar(
        eq.tienda,
        eq.nombre,
        `${deLaTienda.length} oferta(s) recibidas, ninguna calza con sku "${eq.sku}", ean ni url`,
      );
    } else {
      descartes?.registrar(eq.tienda, eq.nombre, 'la tienda no devolvio ninguna oferta');
    }
  }
  return elegidas;
}

/** Quita un producto del catalogo. Devuelve null si ese id no existia. */
export function borrar(catalogo: Catalogo, id: string): Catalogo | null {
  if (!catalogo.productos.some((p) => p.id === id)) return null;
  return { ...catalogo, productos: catalogo.productos.filter((p) => p.id !== id) };
}
