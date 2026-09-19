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

const CLAVE_PRECIO =
  /^(price|precio|valor|amount|sellingprice|listprice|pricewithoutdiscount|bestprice|spotprice)/i;
const CLAVE_NOMBRE = /^(name|nombre|title|titulo|productname|displayname|description|descripcion)$/i;

function esNumeroUtil(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  // Muchos storefronts serializan el precio como texto: "1490" o "$1.490".
  if (typeof v === 'string' && /^\s*\$?\s*[\d.,]+\s*$/.test(v) && /\d/.test(v)) {
    const n = Number(v.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0;
  }
  return false;
}

/**
 * Busca un precio en el subarbol del objeto, no solo en su primer nivel.
 *
 * La forma de VTEX deja el precio muy abajo
 * (producto.items[].sellers[].commertialOffer.Price), asi que exigirlo al lado
 * del nombre descarta justamente los catalogos que nos interesan.
 */
function tienePrecio(v: unknown, profundidad = 0): boolean {
  if (profundidad > 5 || v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => tienePrecio(x, profundidad + 1));
  for (const [k, hijo] of Object.entries(v)) {
    if (CLAVE_PRECIO.test(k)) {
      if (esNumeroUtil(hijo)) return true;
      // Envoltorios tipo price: { value: 1490 } o price: { amount, currency }.
      if (hijo && typeof hijo === 'object' && Object.values(hijo).some(esNumeroUtil)) return true;
    }
    if (tienePrecio(hijo, profundidad + 1)) return true;
  }
  return false;
}

/** Un objeto parece producto si tiene algo que suena a nombre y un precio en su subarbol. */
function pareceProducto(o: Record<string, unknown>): boolean {
  const nombre = Object.entries(o).some(
    ([k, v]) => CLAVE_NOMBRE.test(k) && typeof v === 'string' && v.trim() !== '',
  );
  return nombre && tienePrecio(o);
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

export interface ClaveVista {
  clave: string;
  veces: number;
  ruta: string;
  ejemplo: unknown;
}

/**
 * Inventario de claves que coinciden con un patron, con un ejemplo de cada una.
 *
 * Sirve para responder "que trae realmente este payload" sin volcar megabytes
 * de JSON a la consola.
 */
export function inventarioClaves(json: unknown, patron: RegExp, maxProfundidad = 14): ClaveVista[] {
  const vistas = new Map<string, ClaveVista>();
  const vistos = new WeakSet<object>();

  function recorrer(nodo: unknown, ruta: string, prof: number): void {
    if (prof > maxProfundidad || nodo === null || typeof nodo !== 'object') return;
    if (vistos.has(nodo)) return;
    vistos.add(nodo);

    if (Array.isArray(nodo)) {
      // Con los dos primeros elementos basta para conocer la forma.
      nodo.slice(0, 2).forEach((hijo, i) => recorrer(hijo, `${ruta}[${i}]`, prof + 1));
      return;
    }

    for (const [k, v] of Object.entries(nodo)) {
      const rutaHija = ruta === '' ? k : `${ruta}.${k}`;
      if (patron.test(k)) {
        const previa = vistas.get(k);
        if (previa) previa.veces++;
        else if (typeof v !== 'object' || v === null) {
          vistas.set(k, { clave: k, veces: 1, ruta: rutaHija, ejemplo: v });
        } else {
          vistas.set(k, { clave: k, veces: 1, ruta: rutaHija, ejemplo: resumir(v) });
        }
      }
      recorrer(v, rutaHija, prof + 1);
    }
  }

  recorrer(json, '', 0);
  return [...vistas.values()].sort((a, b) => b.veces - a.veces);
}

/** Version acotada de un valor, para mostrarlo sin inundar la consola. */
function resumir(v: unknown): unknown {
  if (Array.isArray(v)) return `[${v.length} elementos]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).slice(0, 8).join(', ')}}`;
  return v;
}

/** Rutas cuyo valor de texto contiene `texto`. Confirma si el dato esta o no. */
export function buscarTexto(json: unknown, texto: string, maxResultados = 20): string[] {
  const objetivo = texto.toLowerCase();
  const rutas: string[] = [];
  const vistos = new WeakSet<object>();

  function recorrer(nodo: unknown, ruta: string, prof: number): void {
    if (rutas.length >= maxResultados || prof > 20) return;
    if (typeof nodo === 'string') {
      if (nodo.toLowerCase().includes(objetivo)) rutas.push(`${ruta} = ${nodo.slice(0, 80)}`);
      return;
    }
    if (nodo === null || typeof nodo !== 'object' || vistos.has(nodo)) return;
    vistos.add(nodo);

    if (Array.isArray(nodo)) {
      nodo.forEach((hijo, i) => recorrer(hijo, `${ruta}[${i}]`, prof + 1));
      return;
    }
    for (const [k, v] of Object.entries(nodo)) {
      recorrer(v, ruta === '' ? k : `${ruta}.${k}`, prof + 1);
    }
  }

  recorrer(json, '', 0);
  return rutas;
}

/** Navega una ruta tipo "a.b[0].c" dentro de un JSON. undefined si no existe. */
export function porRuta(json: unknown, ruta: string): unknown {
  const partes = ruta
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((p) => p !== '');
  let actual: unknown = json;
  for (const parte of partes) {
    if (actual === null || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}
