/**
 * Busca los productos dentro del HTML de una pagina de busqueda Next.js.
 *
 * Uso: abre el buscador del supermercado, busca algo, y pegame la URL tal como
 * quedo en la barra de direcciones.
 *
 *   npm run nextdata -- "https://www.jumbo.cl/search?q=arroz"
 *   npm run nextdata -- "https://www.alvi.cl/..." "https://www.unimarc.cl/..."
 *
 * A proposito no adivina rutas de busqueda: cada cadena usa la suya y
 * equivocarse solo produce 404 que no significan nada.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import {
  buscarProductos,
  extraerBuildId,
  extraerFlight,
  extraerJsonIncrustado,
  extraerNextData,
} from '../descubrir/nextdata.js';

const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (urls.length === 0) {
  console.error('Uso: npm run nextdata -- "<url de busqueda del sitio>" [mas urls...]');
  console.error('Ej:  npm run nextdata -- "https://www.jumbo.cl/search?q=arroz"');
  process.exit(1);
}

const NAVEGADOR = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'es-CL,es;q=0.9',
};

await mkdir('fixtures', { recursive: true });

/**
 * Nombre de archivo distintivo.
 *
 * Con el termino buscado si lo hay; si no, con el ultimo tramo de la ruta, para
 * que la ficha de un producto no pise el HTML de una busqueda anterior.
 */
function nombreArchivo(url: URL): string {
  const host = url.hostname.replace(/^www\./, '').split('.')[0]!;
  const termino =
    url.searchParams.get('q') ??
    url.searchParams.get('query') ??
    url.searchParams.get('ft') ??
    url.pathname.split('/').filter((t) => t !== '' && t !== 'p').pop() ??
    'pagina';
  const limpio = termino.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/-+$/, '');
  return `${host}-${limpio}`;
}

/** Endpoint de navegacion cliente de Next.js: suele traer las mismas props en JSON puro. */
function urlDatosNext(url: URL, buildId: string): string {
  const ruta = url.pathname === '/' ? '/index' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/_next/data/${buildId}${ruta}.json${url.search}`;
}

async function analizar(json: unknown, base: string, etiqueta: string): Promise<boolean> {
  const candidatos = buscarProductos(json);
  if (candidatos.length === 0) {
    console.log(`   ${etiqueta}: sin listas que parezcan productos`);
    return false;
  }

  console.log(`   ${etiqueta}: ${candidatos.length} lista(s) candidata(s)`);
  for (const c of candidatos.slice(0, 3)) {
    console.log(`      ${c.cantidad} productos en  ${c.ruta || '(raiz)'}`);
    console.log(`      claves: ${c.claves.slice(0, 14).join(', ')}`);
    const precios = Object.entries(c.muestra as Record<string, unknown>).filter(([k]) =>
      /price|precio|valor|amount/i.test(k),
    );
    if (precios.length > 0) {
      console.log(`      precios: ${JSON.stringify(Object.fromEntries(precios)).slice(0, 220)}`);
    }
  }

  const ruta = `fixtures/${base}.${etiqueta}.json`;
  await writeFile(ruta, JSON.stringify(json, null, 2));
  console.log(`      guardado en ${ruta}`);
  return true;
}

let exitosas = 0;

for (const bruta of urls) {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    console.log(`\n${bruta}\n   URL invalida, la ignoro.`);
    continue;
  }

  console.log(`\n${url.hostname}${url.pathname}${url.search}`);
  const base = nombreArchivo(url);

  try {
    const res = await fetch(url, { headers: NAVEGADOR, signal: AbortSignal.timeout(30_000) });
    console.log(`   HTTP ${res.status}`);
    if (!res.ok) continue;

    const html = await res.text();
    await writeFile(`fixtures/${base}.html`, html);
    console.log(`   ${(html.length / 1024).toFixed(0)} KB de HTML guardados en fixtures/${base}.html`);

    const nextData = extraerNextData(html);
    let buildId: string | null = null;

    if (nextData) {
      buildId = extraerBuildId(nextData);
      console.log(`   __NEXT_DATA__ presente${buildId ? `  buildId=${buildId}` : ''}`);
      if (await analizar(nextData, base, 'html')) {
        exitosas++;
        continue;
      }
    } else {
      // Next.js 13+ (App Router) no emite __NEXT_DATA__: manda el payload de
      // React Server Components en chunks self.__next_f.push([...]).
      const flight = extraerFlight(html);
      if (flight === '') {
        console.log('   ni __NEXT_DATA__ ni chunks de App Router: la pagina se llena por XHR.');
        console.log('   -> toca mirar DevTools (Network / Fetch-XHR) o usar Playwright.');
        continue;
      }

      console.log(`   App Router: ${(flight.length / 1024).toFixed(0)} KB de payload RSC`);
      const bloques = extraerJsonIncrustado(flight);
      console.log(`   ${bloques.length} bloque(s) JSON rescatados del stream`);

      const candidatos = bloques.flatMap((b, i) =>
        buscarProductos(b).map((c) => ({ ...c, bloque: i })),
      );
      if (candidatos.length > 0) {
        candidatos.sort((a, b) => b.cantidad - a.cantidad);
        console.log(`   productos encontrados en el payload RSC:`);
        for (const c of candidatos.slice(0, 3)) {
          console.log(`      ${c.cantidad} productos en  bloque[${c.bloque}].${c.ruta || '(raiz)'}`);
          console.log(`      claves: ${c.claves.slice(0, 14).join(', ')}`);
          const precios = Object.entries(c.muestra as Record<string, unknown>).filter(([k]) =>
            /price|precio|valor|amount/i.test(k),
          );
          if (precios.length > 0) {
            console.log(`      precios: ${JSON.stringify(Object.fromEntries(precios)).slice(0, 220)}`);
          }
        }
        const ruta = `fixtures/${base}.rsc.json`;
        await writeFile(ruta, JSON.stringify(bloques, null, 2));
        console.log(`      guardado en ${ruta}`);
        exitosas++;
        continue;
      }
      console.log('   el payload RSC no trae listas que parezcan productos.');
      console.log('   -> toca mirar DevTools (Network / Fetch-XHR).');
      continue;
    }

    // Ultimo intento: el endpoint de datos de Next, que a veces trae mas
    // props que el HTML inicial.
    if (!buildId) continue;
    const urlDatos = urlDatosNext(url, buildId);
    console.log(`   probando ${urlDatos}`);
    const resDatos = await fetch(urlDatos, {
      headers: { ...NAVEGADOR, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`   HTTP ${resDatos.status}`);
    if (resDatos.ok && (resDatos.headers.get('content-type') ?? '').includes('json')) {
      if (await analizar(await resDatos.json(), base, 'nextdata')) exitosas++;
    }
  } catch (e) {
    console.log(`   FALLO ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n${exitosas}/${urls.length} paginas entregaron productos en el HTML.`);
console.log(
  exitosas > 0
    ? 'Con eso alcanza: se puede leer el catalogo sin API. Pasame la salida y escribo el adapter.\n'
    : 'Ninguna: hay que mirar DevTools -> Network -> Fetch/XHR y copiar la peticion que trae los productos.\n',
);
