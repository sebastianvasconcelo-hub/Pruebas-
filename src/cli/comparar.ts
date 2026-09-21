/**
 * Compara un producto entre tiendas aplicando tus reglas reales.
 *
 *   npm run comparar -- "arroz"
 *   npm run comparar -- "arroz" --cantidad 3 --fecha 2026-09-24
 *   npm run comparar -- "arroz" --offline      # usa fixtures/, sin red
 */
import { readdir, readFile } from 'node:fs/promises';
import { TIENDAS, tienda } from '../adapters/index.js';
import { buscarPorId, buscarPorNombre, cargar, ofertasDe } from '../canonico/catalogo.js';
import type { ProductoCanonico } from '../canonico/tipos.js';
import { buscarEnSitio } from '../adapters/html.js';
import { traerOfertas } from '../canonico/traer.js';
import { mapearAlvi } from '../adapters/alvi.js';
import { mapearJsonLd } from '../adapters/jsonld.js';
import { mapearVtex } from '../adapters/vtex.js';
import { nombreDia, parsearFechaLocal } from '../normalizar/fecha.js';
import { parsearContenido } from '../normalizar/unidad.js';
import { comparar } from '../precios/efectivo.js';
import { advertenciasEquivalencia } from '../precios/equivalencia.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--'));
const productoPedido = valorFlag('--producto');
const offline = args.includes('--offline');
const cantidad = Number(valorFlag('--cantidad') ?? 1);
// parsearFechaLocal y no new Date(): "2026-09-25" en UTC cae el dia anterior
// en Chile, y el cashback depende del dia de la semana.
const fecha = valorFlag('--fecha') ? parsearFechaLocal(valorFlag('--fecha')!) : new Date();

function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!query && !productoPedido) {
  console.error(
    'Uso: npm run comparar -- "<producto>" [--cantidad N] [--fecha YYYY-MM-DD] [--offline]\n' +
      '     npm run comparar -- --producto <id-canonico> [--cantidad N]',
  );
  process.exit(1);
}
if (Number.isNaN(fecha.getTime())) {
  console.error('Fecha invalida. Formato esperado: YYYY-MM-DD');
  process.exit(1);
}
if (!Number.isInteger(cantidad) || cantidad < 1) {
  console.error('--cantidad debe ser un entero mayor o igual a 1');
  process.exit(1);
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

async function desdeFixtures(q: string): Promise<Oferta[]> {
  const archivos = (await readdir('fixtures')).filter((f) => f.endsWith('.json'));
  const ofertas: Oferta[] = [];

  for (const archivo of archivos) {
    const cfg = tienda(archivo.split('-')[0] ?? '');
    if (!cfg) continue;
    const crudo = JSON.parse(await readFile(`fixtures/${archivo}`, 'utf8'));
    if (cfg.motor === 'nextdata') ofertas.push(...mapearAlvi(cfg, crudo));
    else if (cfg.motor === 'jsonld') ofertas.push(...mapearJsonLd(cfg, [crudo]));
    else ofertas.push(...mapearVtex(cfg, crudo));
  }

  const termino = q.toLowerCase().split(' ')[0]!;
  return ofertas.filter((o) => o.nombre.toLowerCase().includes(termino));
}

async function desdeRed(q: string): Promise<Oferta[]> {
  const soportadas = TIENDAS.filter((t) => t.soportado && t.busqueda);
  const resultados = await Promise.allSettled(soportadas.map((cfg) => buscarEnSitio(cfg, q)));

  const ofertas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') ofertas.push(...r.value);
    else console.error(`  aviso: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  return ofertas;
}

/**
 * Trae las ofertas de un producto canonico buscando en cada tienda por el
 * nombre que esa tienda usa, que da muchas mas coincidencias que buscar el
 * nombre canonico en todas.
 */
async function desdeCatalogo(producto: ProductoCanonico): Promise<Oferta[]> {
  const resultados = await Promise.allSettled(
    producto.equivalencias.map((eq) => traerOfertas(eq)),
  );

  const encontradas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') encontradas.push(...r.value);
    else console.error(`  aviso: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  return ofertasDe(producto, encontradas);
}

const catalogo = await cargar();

// El catalogo manda: si el producto esta registrado, se compara el mismo
// articulo en cada tienda en vez de lo mas barato que suene parecido.
let canonico: ProductoCanonico | undefined;
if (productoPedido) {
  canonico = buscarPorId(catalogo, productoPedido);
  if (!canonico) {
    console.error(`\nNo hay ningun producto canonico con id "${productoPedido}".`);
    console.error('Mira los registrados con: npm run catalogo\n');
    process.exit(1);
  }
} else if (query) {
  canonico = buscarPorNombre(catalogo, query)[0];
}

const todas = canonico && !offline
  ? await desdeCatalogo(canonico)
  : offline
    ? await desdeFixtures(query ?? canonico!.nombre)
    : await desdeRed(query!);
const disponibles = todas.filter((o) => o.disponible);
const universo = disponibles.length > 0 ? disponibles : todas;

if (universo.length === 0) {
  console.log(`\nSin resultados para "${query}"${offline ? ' en fixtures/' : ''}.\n`);
  process.exit(0);
}

/**
 * Una oferta por tienda, elegida por $/kg y no por precio de etiqueta: entre
 * "arroz 1 kg a $1.490" y "arroz 5 kg a $5.990" el barato es el segundo, y
 * elegir por etiqueta reproduciria el error que esta app existe para evitar.
 */
function costoComparable(o: Oferta): number {
  const precio = o.precioSocio ?? o.precioLista;
  const contenido = o.contenido ?? parsearContenido(o.nombre);
  return contenido && contenido.cantidad > 0 ? precio / contenido.cantidad : precio;
}

const porTienda = new Map<string, Oferta>();
for (const o of universo) {
  const previa = porTienda.get(o.tienda);
  if (!previa || costoComparable(o) < costoComparable(previa)) porTienda.set(o.tienda, o);
}

const { ranking, criterio, advertencias } = comparar(
  [...porTienda.values()],
  cantidad,
  PERFIL_POR_DEFECTO,
  { fecha, consumoMensual: canonico?.consumoMensual },
);

const titulo = canonico ? canonico.nombre : `"${query}"`;
console.log(`\n${titulo}  x${cantidad} un  |  ${nombreDia(fecha)} ${fecha.toLocaleDateString('es-CL')}`);
if (canonico) console.log(`producto canonico: ${canonico.id}  (mismo articulo en cada tienda)`);
console.log(`${universo.length} ofertas de ${porTienda.size} tienda(s)`);
console.log(`criterio de orden: ${criterio === 'unidad-medida' ? '$ por kg/L' : '$ por unidad'}\n`);

for (const [i, d] of ranking.entries()) {
  const marca = i === 0 ? '>>' : '  ';
  const unidadMedida = d.porUnidadMedida
    ? `${clp(d.porUnidadMedida.valor)}/${d.porUnidadMedida.base}`
    : 'formato no deducible';
  console.log(`${marca} ${d.tienda.padEnd(12)} ${unidadMedida.padEnd(18)} total ${clp(d.totalEfectivo)}`);
  console.log(`     ${d.nombre}`);
  console.log(
    `     unitario ${clp(d.precioUnitarioBruto)} (${d.origenPrecio})` +
      (d.descuentoCashback > 0 ? `  cashback -${clp(d.descuentoCashback)}` : ''),
  );
  for (const nota of d.notas) console.log(`     - ${nota}`);
  if (d.url) console.log(`     ${d.url}`);
  console.log();
}

for (const a of advertencias) console.log(`aviso: ${a}`);

// Con el catalogo canonico sabemos que es el mismo articulo: el ahorro es real.
const dudas = canonico ? [] : advertenciasEquivalencia([...porTienda.values()]);
const [mejor, segunda] = ranking;

if (mejor && segunda) {
  const ahorro = segunda.totalEfectivo - mejor.totalEfectivo;
  if (ahorro > 0) {
    if (dudas.length === 0) {
      console.log(`\nComprando en ${mejor.tienda} en vez de ${segunda.tienda} ahorras ${clp(ahorro)} en esta compra.`);
    } else {
      // Un ahorro entre productos que no son el mismo no es un ahorro.
      console.log(`\nOJO: la diferencia de ${clp(ahorro)} entre ${mejor.tienda} y ${segunda.tienda}`);
      console.log('no es comparable todavia, porque no son el mismo producto:');
      for (const d of dudas) console.log(`   - ${d}`);
      console.log(`Registralo con: npm run emparejar -- "${query}"`);
    }
  }
}
console.log();
