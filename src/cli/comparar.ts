/**
 * Compara un producto entre tiendas aplicando tus reglas reales.
 *
 *   npm run comparar -- "arroz grado 1"
 *   npm run comparar -- "arroz grado 1" --cantidad 3 --fecha 2026-09-24
 *   npm run comparar -- "arroz" --offline          # usa fixtures/, sin red
 */
import { readdir, readFile } from 'node:fs/promises';
import { adapters, tienda } from '../adapters/index.js';
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

const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

async function desdeFixtures(q: string): Promise<Oferta[]> {
  const archivos = (await readdir('fixtures')).filter((f) => f.endsWith('.json'));
  const ofertas: Oferta[] = [];
  for (const archivo of archivos) {
    const cfg = tienda(archivo.split('-')[0] ?? '');
    if (!cfg) continue;
    const crudo = JSON.parse(await readFile(`fixtures/${archivo}`, 'utf8'));
    ofertas.push(...mapearVtex(cfg, crudo));
  }
  const termino = q.toLowerCase();
  return ofertas.filter((o) => o.nombre.toLowerCase().includes(termino.split(' ')[0]!));
}

async function desdeRed(q: string): Promise<Oferta[]> {
  const resultados = await Promise.allSettled(
    adapters().map(async (a) => ({ id: a.cfg.id, ofertas: await a.buscar(q, { limite: 10 }) })),
  );
  const ofertas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') ofertas.push(...r.value.ofertas);
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
 * Una oferta por tienda, para no llenar la tabla de ruido.
 *
 * El criterio es $/kg y no precio de etiqueta: entre "arroz 1 kg a $1.490" y
 * "arroz 5 kg a $5.990" el barato es el segundo, y elegir por etiqueta
 * reproduciria exactamente el error que esta app existe para evitar.
 */
function costoComparable(o: Oferta): number {
  const precio = o.precioSocio ?? o.precioLista;
  const contenido = parsearContenido(o.nombre);
  return contenido && contenido.cantidad > 0 ? precio / contenido.cantidad : precio;
}

const porTienda = new Map<string, Oferta>();
for (const o of universo) {
  const previa = porTienda.get(o.tienda);
  if (!previa || costoComparable(o) < costoComparable(previa)) {
    porTienda.set(o.tienda, o);
  }
}

const { ranking, criterio, advertencias } = comparar(
  [...porTienda.values()],
  cantidad,
  PERFIL_POR_DEFECTO,
  { fecha },
);

console.log(`\n"${query}"  x${cantidad} un  |  ${DIAS[fecha.getDay()]} ${fecha.toLocaleDateString('es-CL')}`);
console.log(`criterio de orden: ${criterio === 'unidad-medida' ? '$ por kg/L' : '$ por unidad'}\n`);

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

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
