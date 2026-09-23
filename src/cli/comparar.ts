/**
 * Compara un producto entre tiendas y responde la pregunta que importa:
 * cual es el precio mas barato al que puedes llegar y cuanto tienes que
 * llevar para conseguirlo.
 *
 *   npm run comparar -- --producto <id>
 *   npm run comparar -- --producto <id> --maximo 12   tope de unidades
 *   npm run comparar -- --producto <id> --cantidad 3  precio a esa cantidad exacta
 *   npm run comparar -- "arroz"                       algo no registrado
 *   npm run comparar -- "arroz" --offline             desde fixtures, sin red
 */
import { readdir, readFile } from 'node:fs/promises';
import { TIENDAS, tienda } from '../adapters/index.js';
import { buscarEnSitio, urlRespaldo } from '../adapters/html.js';
import { mapearAlvi } from '../adapters/alvi.js';
import { mapearJsonLd } from '../adapters/jsonld.js';
import { mapearVtex } from '../adapters/vtex.js';
import { buscarPorId, buscarPorNombre, cargar, ofertasDe } from '../canonico/catalogo.js';
import { traerOfertas } from '../canonico/traer.js';
import type { ProductoCanonico } from '../canonico/tipos.js';
import { Descartes } from '../diagnostico.js';
import { nombreDia, parsearFechaLocal } from '../normalizar/fecha.js';
import { parsearContenido } from '../normalizar/unidad.js';
import { advertenciasEquivalencia } from '../precios/equivalencia.js';
import { escalasPendientes, informarEscalas } from '../precios/escalas.js';
import { compararOptimo } from '../precios/optimo.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';

const args = process.argv.slice(2);
function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

const query = args.find((a) => !a.startsWith('--'));
const productoPedido = valorFlag('--producto');
const offline = args.includes('--offline');
const detallar = args.includes('--diagnostico');
const cantidadPedida = valorFlag('--cantidad') ? Number(valorFlag('--cantidad')) : undefined;
const maximoPedido = valorFlag('--maximo') ? Number(valorFlag('--maximo')) : undefined;
const fecha = valorFlag('--fecha') ? parsearFechaLocal(valorFlag('--fecha')!) : new Date();

if (!query && !productoPedido) {
  console.error(
    'Uso: npm run comparar -- "<producto>" [--maximo N] [--cantidad N] [--fecha YYYY-MM-DD] [--offline]\n' +
      '     npm run comparar -- --producto <id-canonico> [--maximo N]',
  );
  process.exit(1);
}
if (Number.isNaN(fecha.getTime())) {
  console.error('Fecha invalida. Formato esperado: YYYY-MM-DD');
  process.exit(1);
}
for (const [nombre, valor] of [['--cantidad', cantidadPedida], ['--maximo', maximoPedido]] as const) {
  if (valor !== undefined && (!Number.isInteger(valor) || valor < 1)) {
    console.error(`${nombre} debe ser un entero mayor o igual a 1`);
    process.exit(1);
  }
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const descartes = new Descartes();

async function desdeFixtures(q: string): Promise<Oferta[]> {
  const archivos = (await readdir('fixtures')).filter((f) => f.endsWith('.json'));
  const ofertas: Oferta[] = [];
  for (const archivo of archivos) {
    const cfg = tienda(archivo.split('-')[0] ?? '');
    if (!cfg) continue;
    const crudo = JSON.parse(await readFile(`fixtures/${archivo}`, 'utf8'));
    if (cfg.motor === 'nextdata') ofertas.push(...mapearAlvi(cfg, crudo, descartes));
    else if (cfg.motor === 'jsonld') ofertas.push(...mapearJsonLd(cfg, [crudo], descartes));
    else ofertas.push(...mapearVtex(cfg, crudo));
  }
  const termino = q.toLowerCase().split(' ')[0]!;
  return ofertas.filter((o) => o.nombre.toLowerCase().includes(termino));
}

async function desdeRed(q: string): Promise<Oferta[]> {
  const soportadas = TIENDAS.filter((t) => t.soportado && t.busqueda);
  const resultados = await Promise.allSettled(
    soportadas.map((cfg) => buscarEnSitio(cfg, q, { descartes })),
  );
  const ofertas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') ofertas.push(...r.value);
    else console.error(`  aviso: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  return ofertas;
}

async function desdeCatalogo(producto: ProductoCanonico): Promise<Oferta[]> {
  const resultados = await Promise.allSettled(
    producto.equivalencias.map((eq) => traerOfertas(eq, descartes)),
  );
  const encontradas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') encontradas.push(...r.value);
    else console.error(`  aviso: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  return ofertasDe(producto, encontradas, descartes);
}

const catalogo = await cargar();

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
  console.log(`\nSin resultados para "${query ?? canonico?.nombre}"${offline ? ' en fixtures/' : ''}.\n`);
  descartes.imprimir(console.log);
  process.exit(0);
}

/** Una oferta por tienda, elegida por $/kg y no por precio de etiqueta. */
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

// Una cantidad exacta pedida fija tambien el tope: se quiere ese precio, no otro.
const referencia = cantidadPedida ?? canonico?.cantidadHabitual ?? 1;
const maximo = cantidadPedida ?? maximoPedido;

const { ranking, criterio, advertencias } = compararOptimo(
  [...porTienda.values()],
  PERFIL_POR_DEFECTO,
  { fecha, consumoMensual: canonico?.consumoMensual },
  { referencia, maximo },
);

const titulo = canonico ? canonico.nombre : `"${query}"`;
console.log(`\n${titulo}  |  ${nombreDia(fecha)} ${fecha.toLocaleDateString('es-CL')}`);
if (canonico) console.log(`producto canonico: ${canonico.id}  (mismo articulo en cada tienda)`);
console.log(
  `${universo.length} ofertas de ${porTienda.size} tienda(s)  |  ` +
    `orden por ${criterio === 'unidad-medida' ? 'mejor $ por kg/L alcanzable' : 'mejor $ por unidad alcanzable'}` +
    `${maximo !== undefined ? `  |  tope ${maximo} un` : ''}\n`,
);

for (const [i, o] of ranking.entries()) {
  const d = o.desglose;
  const medida = d.porUnidadMedida
    ? `${clp(d.porUnidadMedida.valor)}/${d.porUnidadMedida.base}`
    : `${clp(d.unitarioEfectivo)}/un`;

  // El titular es el mejor precio y la cantidad que exige.
  console.log(
    `${i === 0 ? '>>' : '  '} ${o.oferta.tienda.padEnd(10)} ${medida.padEnd(14)} ` +
      `llevando ${String(o.cantidad).padStart(3)} un    total ${clp(d.totalEfectivo)}`,
  );
  console.log(`     ${o.oferta.nombre}`);

  if (o.exigeLlevarMas) {
    const ref = o.referencia.porUnidadMedida
      ? `${clp(o.referencia.porUnidadMedida.valor)}/${o.referencia.porUnidadMedida.base}`
      : clp(o.referencia.unitarioEfectivo);
    console.log(`     -${o.ahorroPorcentaje}% respecto de llevar ${o.referencia.cantidad} un (${ref})`);
  }

  console.log(`     unitario ${clp(d.precioUnitarioBruto)} (${d.origenPrecio})` +
    (d.descuentoCashback > 0 ? `  cashback -${clp(d.descuentoCashback)}` : ''));
  for (const nota of d.notas) console.log(`     - ${nota}`);

  // Tramos que existen y no se estan usando, incluidos los que quedaron fuera
  // del tope: saber que existen es parte de la decision.
  for (const e of escalasPendientes(
    informarEscalas(o.oferta, o.cantidad, d.precioUnitarioBruto, PERFIL_POR_DEFECTO),
  )) {
    const m = e.porUnidadMedida ? ` (${clp(e.porUnidadMedida.valor)}/${e.porUnidadMedida.base})` : '';
    const candado = e.usable ? '' : '  [necesitas la membresia]';
    console.log(`     llevando ${e.minUnidades}+ un: ${clp(e.precioUnitario)} c/u${m}  -${e.ahorroPorcentaje}%${candado}`);
  }

  if (d.url) console.log(`     ${d.url}`);
  // La ficha de algunas tiendas no abre sin sesion: dejar una via que si sirve.
  const respaldo = urlRespaldo(tienda(o.oferta.tienda)!, o.oferta.nombre);
  if (respaldo) console.log(`     si la ficha da 404, busca aqui: ${respaldo}`);
  console.log();
}

for (const a of advertencias) console.log(`aviso: ${a}`);

if (canonico) {
  const mapeadas = canonico.equivalencias.map((e) => e.tienda);
  const conDatos = new Set(universo.map((o) => o.tienda));
  const sinDatos = mapeadas.filter((t) => !conDatos.has(t));
  const soportadas = TIENDAS.filter((t) => t.soportado && t.busqueda).map((t) => t.id);
  const sinMapear = soportadas.filter((t) => !mapeadas.includes(t));

  if (sinDatos.length > 0) {
    console.log(`aviso: ${sinDatos.join(', ')} esta mapeado pero hoy no devolvio datos.`);
  }
  if (sinMapear.length > 0) {
    console.log(`\nEste producto no tiene mapeado: ${sinMapear.join(', ')}.`);
    console.log(`Para agregarla:  npm run emparejar -- "${canonico.nombre}"`);
  }
}

const dudas = canonico ? [] : advertenciasEquivalencia([...porTienda.values()]);
const [mejor, segunda] = ranking;

if (mejor && segunda) {
  const costo = (o: typeof mejor) => o.desglose.porUnidadMedida?.valor ?? o.desglose.unitarioEfectivo;
  const unidad = mejor.desglose.porUnidadMedida?.base ?? 'un';
  const diferencia = costo(segunda) - costo(mejor);

  if (dudas.length > 0) {
    console.log(`\nOJO: ${mejor.oferta.tienda} y ${segunda.oferta.tienda} no son el mismo producto:`);
    for (const d of dudas) console.log(`   - ${d}`);
    console.log(`Registralo con: npm run emparejar -- "${query}"`);
  } else if (diferencia <= 0) {
    console.log(`\nEmpate: ${mejor.oferta.tienda} y ${segunda.oferta.tienda} llegan al mismo precio por ${unidad}.`);
  } else {
    console.log(
      `\nLo mas barato: ${clp(costo(mejor))}/${unidad} llevando ${mejor.cantidad} un en ${mejor.oferta.tienda}` +
        ` (total ${clp(mejor.desglose.totalEfectivo)}).`,
    );
    console.log(
      `Lo mejor de ${segunda.oferta.tienda}: ${clp(costo(segunda))}/${unidad} llevando ${segunda.cantidad} un.`,
    );
  }
}

if (descartes.total > 0) {
  if (detallar) descartes.imprimir(console.log);
  else console.log(`\n(${descartes.total} descarte(s); corre con --diagnostico para verlos)`);
}
console.log();
