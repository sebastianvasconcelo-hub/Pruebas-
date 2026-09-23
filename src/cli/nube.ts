/**
 * Etapa 0: ¿responden Alvi y Jumbo desde una IP de datacenter?
 *
 * Desde un PC con IP residencial chilena todo funciona. Una PWA necesita que
 * el scraping corra en la nube, y los sitios con proteccion suelen tratar
 * distinto a las IPs de datacenter. Este chequeo lo mide con las mismas rutas
 * y el mismo parseo que usa la app, no con un test aparte: si pasa aqui, el
 * job diario funciona.
 *
 *   npm run nube                  local, para comparar
 *   (GitHub Actions lo corre en .github/workflows/nube.yml)
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { tienda } from '../adapters/index.js';
import { mapearFicha, mapearHtml, NAVEGADOR, urlBusqueda } from '../adapters/html.js';
import type { Oferta } from '../tipos.js';

interface Chequeo {
  nombre: string;
  url: string;
  ok: boolean;
  status?: number;
  tipo?: string;
  kb?: number;
  ms?: number;
  ofertas?: number;
  detalle: string;
  cabeceras?: Record<string, string>;
}

/** Cabeceras que delatan quien respondio: el sitio, su CDN o su WAF. */
const CABECERAS = /^(server|via|x-cache|cf-ray|cf-mitigated|x-amz-cf-pop|x-amz-cf-id|x-powered-by)$/i;

/** Rastros de una pagina de desafio: 200 pero sin contenido real. */
const DESAFIO = /captcha|challenge-platform|cf-chl|access denied|request blocked|are you a robot|incapsula|perimeterx/i;

async function pedir(url: string): Promise<{
  status: number;
  tipo: string;
  cuerpo: string;
  ms: number;
  cabeceras: Record<string, string>;
}> {
  const inicio = Date.now();
  const res = await fetch(url, { headers: NAVEGADOR, signal: AbortSignal.timeout(30_000) });
  const cuerpo = await res.text();
  const cabeceras: Record<string, string> = {};
  for (const [k, v] of res.headers) if (CABECERAS.test(k)) cabeceras[k] = v.slice(0, 80);
  return {
    status: res.status,
    tipo: (res.headers.get('content-type') ?? '').split(';')[0]!,
    cuerpo,
    ms: Date.now() - inicio,
    cabeceras,
  };
}

/** Explica un fallo en terminos de que hacer, no solo de que paso. */
function diagnostico(status: number, cuerpo: string, ofertas: number): string {
  if (status === 403 || status === 429) return `HTTP ${status}: bloqueo por WAF o rate limit`;
  if (status >= 500) return `HTTP ${status}: error del servidor (reintentar antes de concluir)`;
  if (status === 404) return 'HTTP 404: la ruta cambio';
  if (status !== 200) return `HTTP ${status} inesperado`;
  if (DESAFIO.test(cuerpo)) return 'HTTP 200 pero es una pagina de desafio anti-bot';
  if (ofertas === 0) return 'HTTP 200 pero no se extrajo ningun producto';
  return 'ok';
}

async function chequear(
  nombre: string,
  url: string,
  mapear: (html: string) => Oferta[],
  validar: (ofertas: Oferta[]) => string | null,
): Promise<Chequeo> {
  try {
    const r = await pedir(url);
    const ofertas = r.status === 200 ? mapear(r.cuerpo) : [];
    const base = diagnostico(r.status, r.cuerpo, ofertas.length);
    const problema = base === 'ok' ? validar(ofertas) : base;
    return {
      nombre,
      url,
      ok: problema === null,
      status: r.status,
      tipo: r.tipo,
      kb: Math.round(r.cuerpo.length / 1024),
      ms: r.ms,
      ofertas: ofertas.length,
      detalle: problema ?? `${ofertas.length} ofertas`,
      cabeceras: r.cabeceras,
    };
  } catch (e) {
    return { nombre, url, ok: false, detalle: `sin respuesta: ${e instanceof Error ? e.message : e}` };
  }
}

// Desde donde salimos: el pais importa, porque son cadenas que solo venden en Chile.
let origen = 'desconocido';
try {
  const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(10_000) });
  const d = (await r.json()) as { ip?: string; country?: string; city?: string; org?: string };
  origen = `${d.ip} (${d.city ?? '?'}, ${d.country ?? '?'}) ${d.org ?? ''}`.trim();
} catch {
  // No es critico: el chequeo sigue sin saber el origen.
}

const alvi = tienda('alvi')!;
const jumbo = tienda('jumbo')!;
const consulta = 'leche colun';

const resultados: Chequeo[] = [];

resultados.push(
  await chequear('Alvi: busqueda', urlBusqueda(alvi, consulta)!, (h) => mapearHtml(alvi, h), (o) =>
    // La razon de usar Alvi son sus tramos: sin priceSteps el dato esta incompleto.
    o.some((x) => x.escalas.length > 0) ? null : 'respondio pero ningun producto trae escalas',
  ),
);

const busquedaJumbo = await chequear(
  'Jumbo: busqueda',
  urlBusqueda(jumbo, consulta)!,
  (h) => mapearHtml(jumbo, h),
  () => null,
);
resultados.push(busquedaJumbo);

// La ficha es donde vive el precio Prime. Se usa un producto de la busqueda
// recien hecha para no depender de una url que pueda caducar.
let urlFichaJumbo = 'https://www.jumbo.cl/quesomantecoso-quilque-28laminasenvaseresellablealvacio500grs-2/p';
if (busquedaJumbo.ok) {
  try {
    const r = await pedir(urlBusqueda(jumbo, consulta)!);
    urlFichaJumbo = mapearHtml(jumbo, r.cuerpo).find((o) => o.url)?.url ?? urlFichaJumbo;
  } catch {
    // Se queda con la url conocida.
  }
}
resultados.push(
  await chequear('Jumbo: ficha', urlFichaJumbo, (h) => mapearFicha(jumbo, h), (o) =>
    o[0] && o[0].precioLista > 0 ? null : 'respondio pero sin precio de lista',
  ),
);

// Salida legible en la terminal.
console.log(`\nOrigen: ${origen}\n`);
for (const r of resultados) {
  console.log(`${r.ok ? 'OK   ' : 'FALLA'}  ${r.nombre.padEnd(18)} ${r.detalle}`);
  if (r.status !== undefined) {
    console.log(`       HTTP ${r.status}  ${r.tipo}  ${r.kb} KB  ${r.ms} ms`);
  }
  if (r.cabeceras && Object.keys(r.cabeceras).length > 0) {
    console.log(`       ${Object.entries(r.cabeceras).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
  }
}

const todas = resultados.every((r) => r.ok);
const veredicto = todas
  ? 'VIABLE: el scraping puede correr en la nube.'
  : resultados.some((r) => r.ok)
    ? 'PARCIAL: algunas rutas responden desde la nube y otras no.'
    : 'NO VIABLE desde esta red: el scraping tendria que correr en un PC con IP residencial.';
console.log(`\n${veredicto}\n`);

// Resumen para la pagina del workflow y archivo para conservar el resultado.
await writeFile(
  'resultado-nube.json',
  JSON.stringify({ fecha: new Date().toISOString(), origen, veredicto, resultados }, null, 2),
);

const resumen = process.env.GITHUB_STEP_SUMMARY;
if (resumen) {
  const filas = resultados
    .map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.nombre} | ${r.status ?? '-'} | ${r.ofertas ?? '-'} | ${r.detalle} |`)
    .join('\n');
  await appendFile(
    resumen,
    `## ¿Responden Alvi y Jumbo desde la nube?\n\n**Origen:** ${origen}\n\n` +
      `| | Chequeo | HTTP | Ofertas | Detalle |\n|---|---|---|---|---|\n${filas}\n\n**${veredicto}**\n`,
  );
}

process.exit(todas ? 0 : 1);
