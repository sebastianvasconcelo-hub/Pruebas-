/**
 * Descubre QUE plataforma usa cada cadena y DONDE esta realmente su API.
 *
 * Se escribio despues de que la sonda inicial recibiera 404 (no 403) en el
 * endpoint clasico de VTEX: la ruta no existe en el dominio publico, pero el
 * catalogo por detras puede seguir siendo VTEX detras de otra ruta u otro host.
 *
 * Hace dos cosas, sin asumir nada:
 *   1. Huella de plataforma: cabeceras y rastros en el HTML de la portada.
 *   2. Prueba una bateria de rutas candidatas y reporta que devuelve cada una.
 *
 *   npm run fingerprint
 *   npm run fingerprint -- --tienda jumbo --query arroz
 */
import { TIENDAS } from '../adapters/index.js';

const args = process.argv.slice(2);
const soloTienda = valorFlag('--tienda');
const query = valorFlag('--query') ?? 'arroz';
const pausaMs = Number(process.env.RATE_LIMIT_MS ?? 800);

function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rutas candidatas, de la mas clasica a la mas moderna. VTEX convivio durante
 * anios con dos APIs de busqueda y muchas tiendas migraron de una a otra.
 */
function candidatas(host: string, q: string): Array<{ etiqueta: string; url: string }> {
  const e = encodeURIComponent(q);
  return [
    {
      etiqueta: 'VTEX catalogo clasico',
      url: `https://${host}/api/catalog_system/pub/products/search?ft=${e}&_from=0&_to=4`,
    },
    {
      etiqueta: 'VTEX Intelligent Search',
      url: `https://${host}/api/io/_v/api/intelligent-search/product_search/trade-policy/1?query=${e}&count=5`,
    },
    {
      etiqueta: 'VTEX Intelligent Search (sin /io)',
      url: `https://${host}/_v/api/intelligent-search/product_search?query=${e}&count=5`,
    },
    {
      etiqueta: 'VTEX sesion (revela el canal de venta)',
      url: `https://${host}/api/sessions?items=*`,
    },
    {
      etiqueta: 'VTEX facets (confirma que el indice existe)',
      url: `https://${host}/api/io/_v/api/intelligent-search/facets/trade-policy/1?query=${e}`,
    },
  ];
}

/** Cabeceras que delatan la plataforma sin necesidad de adivinar. */
const CABECERAS_INTERESANTES =
  /^(server|x-powered-by|x-vtex[\w-]*|x-edge[\w-]*|x-account|cf-ray|x-served-by|x-cache|via|x-nextjs[\w-]*)$/i;

/** Rastros de VTEX en el HTML: si estan, el catalogo ES VTEX aunque la ruta falle. */
const RASTROS: Array<{ patron: RegExp; significa: string }> = [
  { patron: /vtexassets\.com/i, significa: 'VTEX (CDN de assets)' },
  { patron: /vtexcommercestable\.com\.br/i, significa: 'VTEX (host de API expuesto)' },
  { patron: /__RUNTIME__/, significa: 'VTEX IO (storefront React)' },
  { patron: /vtex\.store/i, significa: 'VTEX IO (apps de storefront)' },
  { patron: /"accountName"\s*:\s*"([\w-]+)"/i, significa: 'nombre de cuenta VTEX' },
  { patron: /_next\/static/, significa: 'Next.js (storefront propio)' },
  { patron: /cdn\.shopify\.com/i, significa: 'Shopify' },
];

async function huella(host: string): Promise<void> {
  try {
    const res = await fetch(`https://${host}/`, {
      headers: { accept: 'text/html', 'accept-language': 'es-CL,es;q=0.9' },
      signal: AbortSignal.timeout(20_000),
    });
    console.log(`   portada: HTTP ${res.status}`);

    for (const [k, v] of res.headers) {
      if (CABECERAS_INTERESANTES.test(k)) console.log(`   ${k}: ${v.slice(0, 120)}`);
    }

    const html = (await res.text()).slice(0, 400_000);
    const vistos = new Set<string>();
    for (const { patron, significa } of RASTROS) {
      const m = patron.exec(html);
      if (!m || vistos.has(significa)) continue;
      vistos.add(significa);
      console.log(`   rastro: ${significa}${m[1] ? ` -> ${m[1]}` : ''}`);
    }
    if (vistos.size === 0) console.log('   rastro: ninguno reconocido');
  } catch (e) {
    console.log(`   portada: FALLO ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function probarRuta(etiqueta: string, url: string): Promise<void> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'accept-language': 'es-CL,es;q=0.9' },
      signal: AbortSignal.timeout(20_000),
    });
    const tipo = (res.headers.get('content-type') ?? 'desconocido').split(';')[0]!;
    const esJson = tipo.includes('json');
    let extra = '';

    if (esJson) {
      const cuerpo = await res.text();
      const n = contarProductos(cuerpo);
      extra = n === null ? `  ${cuerpo.length} bytes` : `  ~${n} productos`;
    }

    const veredicto = res.ok && esJson ? 'SIRVE' : '     ';
    console.log(`   ${veredicto} ${String(res.status).padEnd(4)} ${tipo.padEnd(18)} ${etiqueta}${extra}`);
    if (res.ok && esJson) console.log(`          ${url}`);
  } catch (e) {
    console.log(`         ---  ${'timeout/error'.padEnd(18)} ${etiqueta}`);
  }
}

/** Cuenta productos sin conocer el esquema: sirve para ambas APIs de VTEX. */
function contarProductos(cuerpo: string): number | null {
  try {
    const datos = JSON.parse(cuerpo);
    if (Array.isArray(datos)) return datos.length;
    if (datos && typeof datos === 'object') {
      const p = (datos as Record<string, unknown>).products;
      if (Array.isArray(p)) return p.length;
    }
    return null;
  } catch {
    return null;
  }
}

const objetivo = TIENDAS.filter((t) => !soloTienda || t.id === soloTienda);
if (objetivo.length === 0) {
  console.error(`No hay tiendas que coincidan con --tienda ${soloTienda}`);
  process.exit(1);
}

console.log('\nHuella de plataforma y descubrimiento de rutas\n');

for (const cfg of objetivo) {
  console.log(`${cfg.nombre}  (${cfg.host})`);
  await huella(cfg.host);
  console.log();
  for (const { etiqueta, url } of candidatas(cfg.host, query)) {
    await probarRuta(etiqueta, url);
    await dormir(pausaMs);
  }
  console.log();
}

console.log('Si ninguna ruta dice SIRVE, la respuesta definitiva esta en el navegador:');
console.log('  1. Abre el sitio, F12 -> pestana Network -> filtro Fetch/XHR');
console.log('  2. Busca un producto en el buscador del sitio');
console.log('  3. La peticion que devuelve los productos ES la ruta que necesitamos');
console.log('  4. Click derecho -> Copy -> Copy as cURL, y me lo pegas\n');
