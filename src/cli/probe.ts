/**
 * Sonda de viabilidad. Este es el script que hay que correr PRIMERO, en una
 * maquina con salida a internet hacia los supermercados.
 *
 * Responde tres preguntas, por tienda:
 *   1. Responde el endpoint publico de VTEX?
 *   2. Viene JSON con precios, o HTML / un 403 de proteccion anti-bot?
 *   3. Que campos de precio y promocion trae realmente?
 *
 * Guarda la respuesta cruda en fixtures/ para poder desarrollar y testear el
 * mapeo despues sin volver a pegarle a la red.
 *
 *   npm run probe -- arroz
 *   npm run probe -- "aceite 900" --tienda alvi
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { TIENDAS } from '../adapters/index.js';
import { crearAdapterVtex, mapearVtex, urlBusqueda } from '../adapters/vtex.js';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--')) ?? 'arroz';
const soloTienda = valorFlag('--tienda');
const salesChannel = valorFlag('--sc') ?? process.env.VTEX_SALES_CHANNEL;
const pausaMs = Number(process.env.RATE_LIMIT_MS ?? 800);

function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

function slug(texto: string): string {
  return texto.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const objetivo = TIENDAS.filter(
  (t) => t.motor === 'vtex' && t.soportado && (!soloTienda || t.id === soloTienda),
);

if (objetivo.length === 0) {
  console.error(`No hay tiendas VTEX que coincidan con --tienda ${soloTienda}`);
  process.exit(1);
}

await mkdir('fixtures', { recursive: true });
console.log(`\nSonda: "${query}"  (canal de venta: ${salesChannel ?? 'por defecto'})\n`);

let exitosas = 0;

for (const cfg of objetivo) {
  const url = urlBusqueda(cfg, query, { limite: 10, salesChannel });
  process.stdout.write(`${cfg.nombre.padEnd(14)} `);

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const tipo = res.headers.get('content-type') ?? 'desconocido';

    if (!res.ok) {
      console.log(`HTTP ${res.status}  (${tipo})`);
      console.log(`   -> ${diagnostico(res.status)}`);
      continue;
    }
    if (!tipo.includes('json')) {
      console.log(`HTTP 200 pero content-type="${tipo}"`);
      console.log('   -> Devolvio HTML: hay proteccion anti-bot. Hace falta Playwright.');
      continue;
    }

    const crudo = await res.json();
    const ruta = `fixtures/${cfg.id}-${slug(query)}.json`;
    await writeFile(ruta, JSON.stringify(crudo, null, 2));

    const ofertas = mapearVtex(cfg, crudo);
    const conSocio = ofertas.filter((o) => o.precioSocio !== undefined).length;
    const conPromo = ofertas.filter((o) => o.promoTexto.length > 0).length;
    const conEscala = ofertas.filter((o) => o.escalas.length > 0).length;
    const conEan = ofertas.filter((o) => o.ean).length;

    console.log(`OK  ${ofertas.length} ofertas`);
    console.log(
      `   precio socio: ${conSocio} | con texto de promo: ${conPromo} | ` +
        `escalas parseadas: ${conEscala} | con EAN: ${conEan}`,
    );
    console.log(`   crudo guardado en ${ruta}`);

    const muestra = ofertas[0];
    if (muestra) {
      console.log(
        `   ej: ${muestra.nombre} | lista $${muestra.precioLista.toLocaleString('es-CL')}` +
          (muestra.precioSocio
            ? ` | socio $${muestra.precioSocio.toLocaleString('es-CL')}`
            : ''),
      );
      if (muestra.promoTexto.length > 0) {
        console.log(`   promo cruda: ${JSON.stringify(muestra.promoTexto)}`);
      }
    }
    exitosas++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FALLO  ${msg}`);
    if (/timeout|abort/i.test(msg)) console.log('   -> Timeout: puede ser bloqueo por geolocalizacion o rate limit.');
  }

  console.log();
  await dormir(pausaMs);
}

function diagnostico(status: number): string {
  if (status === 403)
    return (
      'Bloqueado. Puede ser el WAF de la tienda, o la politica de red de tu propia maquina/proxy. ' +
      'Abre la URL en el navegador: si ahi funciona, el bloqueo es tuyo y no de la cadena.'
    );
  if (status === 404) return 'Ruta distinta: puede que esta cadena ya no use el catalogo VTEX clasico.';
  if (status === 429) return 'Rate limit. Sube RATE_LIMIT_MS y reintenta.';
  return 'Revisar manualmente abriendo la URL en el navegador.';
}

console.log(`Resumen: ${exitosas}/${objetivo.length} tiendas responden con JSON de precios.`);
console.log(
  exitosas > 0
    ? 'Viable. Commitea los fixtures que quieras conservar y seguimos con el mapeo.\n'
    : 'Ninguna respondio: hay que ir por navegador headless.\n',
);
