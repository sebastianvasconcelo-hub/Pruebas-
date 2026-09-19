/**
 * Extraccion de datos desde storefronts Next.js.
 *
 * Las cinco cadenas chilenas resultaron ser aplicaciones Next.js que ya no
 * exponen el API de su plataforma en el dominio publico. Pero una app Next.js
 * tiene que entregarle los datos al navegador: normalmente los incrusta en un
 * bloque <script id="__NEXT_DATA__"> con las props resueltas en el servidor.
 *
 * Si los productos vienen ahi, no hace falta API: basta pedir el HTML de la
 * pagina de busqueda. Este modulo es puro y testeable sin red.
 */

/** Extrae el JSON de __NEXT_DATA__ del HTML, o null si la pagina no lo trae. */
export function extraerNextData(html: string): unknown | null {
  const m = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** El buildId habilita el endpoint /_next/data/<buildId>/<ruta>.json */
export function extraerBuildId(nextData: unknown): string | null {
  if (nextData && typeof nextData === 'object') {
    const id = (nextData as Record<string, unknown>).buildId;
    if (typeof id === 'string' && id !== '') return id;
  }
  return null;
}

const CLAVE_PRECIO = /^(price|prices?|precio|valor|amount|sellingprice|listprice|value)/i;
const CLAVE_NOMBRE = /^(name|nombre|title|titulo|productname|displayname|description|descripcion)$/i;

function esNumeroUtil(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Un objeto parece producto si tiene algo que suena a nombre y algo que suena a precio. */
function pareceProducto(o: Record<string, unknown>): boolean {
  let nombre = false;
  let precio = false;
  for (const [k, v] of Object.entries(o)) {
    if (!nombre && CLAVE_NOMBRE.test(k) && typeof v === 'string' && v.trim() !== '') nombre = true;
    // El precio puede venir suelto o anidado (price: { value: 1490 }).
    if (!precio && CLAVE_PRECIO.test(k)) {
      if (esNumeroUtil(v)) precio = true;
      else if (v && typeof v === 'object' && Object.values(v).some(esNumeroUtil)) precio = true;
    }
    if (nombre && precio) return true;
  }
  return false;
}

export interface Candidato {
  /** Ruta dentro del JSON, ej: props.pageProps.searchResult.products */
  ruta: string;
  cantidad: number;
  /** Claves del primer elemento, para saber que trae sin volcar todo. */
  claves: string[];
  muestra: unknown;
}

/**
 * Recorre un JSON arbitrario y devuelve los arreglos que parecen listas de
 * productos, ordenados de mas a menos elementos.
 *
 * Es deliberadamente generico: no sabemos que forma tiene el payload de cada
 * cadena, y el objetivo es descubrirlo, no asumirlo.
 */
export function buscarProductos(json: unknown, profundidadMax = 12): Candidato[] {
  const encontrados: Candidato[] = [];
  const vistos = new WeakSet<object>();

  function recorrer(nodo: unknown, ruta: string, profundidad: number): void {
    if (profundidad > profundidadMax || nodo === null || typeof nodo !== 'object') return;
    if (vistos.has(nodo)) return;
    vistos.add(nodo);

    if (Array.isArray(nodo)) {
      const objetos = nodo.filter(
        (x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x),
      );
      const productos = objetos.filter(pareceProducto);
      // Se exige mayoria para no confundir un arreglo de banners con uno de productos.
      if (productos.length >= 2 && productos.length >= objetos.length / 2) {
        encontrados.push({
          ruta,
          cantidad: productos.length,
          claves: Object.keys(productos[0]!),
          muestra: productos[0],
        });
        return; // no seguir hacia adentro: ya es la lista que buscabamos
      }
      nodo.forEach((hijo, i) => recorrer(hijo, `${ruta}[${i}]`, profundidad + 1));
      return;
    }

    for (const [k, v] of Object.entries(nodo)) {
      recorrer(v, ruta === '' ? k : `${ruta}.${k}`, profundidad + 1);
    }
  }

  recorrer(json, '', 0);
  return encontrados.sort((a, b) => b.cantidad - a.cantidad);
}
