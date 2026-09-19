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

/**
 * Next.js 13+ (App Router) no emite __NEXT_DATA__: manda el payload de React
 * Server Components en chunks `self.__next_f.push([1,"..."])`, donde el segundo
 * elemento es un string JSON escapado. Concatenados forman el stream completo.
 */
export function extraerFlight(html: string): string {
  const patron = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")/g;
  let out = '';
  for (const m of html.matchAll(patron)) {
    try {
      out += JSON.parse(m[1]!) as string;
    } catch {
      // Chunk truncado o con escapes raros: se ignora y se sigue con el resto.
    }
  }
  return out;
}

/** Fin del objeto/arreglo que empieza en `inicio`, respetando strings. -1 si no cierra. */
function finBloque(texto: string, inicio: number, maxLargo: number): number {
  const abre = texto[inicio];
  const cierra = abre === '{' ? '}' : ']';
  let nivel = 0;
  let enString = false;
  let escapado = false;
  const tope = Math.min(texto.length, inicio + maxLargo);

  for (let i = inicio; i < tope; i++) {
    const c = texto[i]!;
    if (enString) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enString = false;
      continue;
    }
    if (c === '"') enString = true;
    else if (c === abre) nivel++;
    else if (c === cierra) {
      nivel--;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

/**
 * Rescata los fragmentos JSON validos incrustados en un texto cualquiera.
 *
 * El stream de RSC no es JSON: es una secuencia de lineas `id:valor` donde los
 * valores si lo son. En vez de implementar ese formato, que es interno y
 * cambiante, se recorta todo lo que parsee como objeto o arreglo.
 */
export function extraerJsonIncrustado(
  texto: string,
  opts: { minLargo?: number; maxLargo?: number; maxIntentos?: number } = {},
): unknown[] {
  const minLargo = opts.minLargo ?? 120;
  const maxLargo = opts.maxLargo ?? 4_000_000;
  let intentos = opts.maxIntentos ?? 20_000;
  const encontrados: unknown[] = [];

  for (let i = 0; i < texto.length && intentos > 0; i++) {
    const c = texto[i];
    if (c !== '{' && c !== '[') continue;
    // Solo vale la pena intentar si lo que sigue puede abrir JSON real.
    const sig = texto[i + 1];
    if (sig !== '"' && sig !== '{' && sig !== '[') continue;

    intentos--;
    const fin = finBloque(texto, i, maxLargo);
    if (fin === -1 || fin - i + 1 < minLargo) continue;

    try {
      const valor = JSON.parse(texto.slice(i, fin + 1));
      if (valor && typeof valor === 'object') {
        encontrados.push(valor);
        i = fin; // no volver a entrar a lo que ya se rescato
      }
    } catch {
      // No era JSON: seguir buscando desde la siguiente posicion.
    }
  }
  return encontrados;
}
