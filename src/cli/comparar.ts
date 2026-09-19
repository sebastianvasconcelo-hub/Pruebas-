/**
 * Compara un producto entre tiendas aplicando tus reglas reales.
 *
 *   npm run comparar -- "arroz"
 *   npm run comparar -- "arroz" --cantidad 3 --fecha 2026-09-24
 *   npm run comparar -- "arroz" --offline      # usa fixtures/, sin red
 */
import { readdir, readFile } from 'node:fs/promises';
import { TIENDAS, tienda } from '../adapters/index.js';
import { buscarEnSitio } from '../adapters/html.js';
import { mapearAlvi } from '../adapters/alvi.js';
import { mapearJsonLd } from '../adapters/jsonld.js';
import { mapearVtex } from '../adapters/vtex.js';
import { parsearContenido } from '../normalizar/unidad.js';
import { comparar } from '../precios/efectivo.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith('--'));
const offline = args.includes('--offline');
const cantidad = Number(valorFlag('--cantidad') ?? 1);
const fecha = valorFlag('--fecha') ? new Date(valorFlag('--fecha')!) : new Date();

function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!query) {
  console.error('Uso: npm run comparar -- "<producto>" [--cantidad N] [--fecha YYYY-MM-DD] [--offline]');
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

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
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

const todas = offline ? await desdeFixtures(query) : await desdeRed(query);
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
  { fecha },
);

console.log(`\n"${query}"  x${cantidad} un  |  ${DIAS[fecha.getDay()]} ${fecha.toLocaleDateString('es-CL')}`);
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

const [mejor, segunda] = ranking;
if (mejor && segunda) {
  const ahorro = segunda.totalEfectivo - mejor.totalEfectivo;
  if (ahorro > 0) {
    console.log(`\nComprando en ${mejor.tienda} en vez de ${segunda.tienda} ahorras ${clp(ahorro)} en esta compra.`);
  }
}
console.log();
