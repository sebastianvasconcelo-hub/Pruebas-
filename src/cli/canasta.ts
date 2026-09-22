/**
 * Tu canasta habitual: donde conviene comprar cada producto hoy.
 *
 *   npm run canasta
 *   npm run canasta -- --fecha 2026-09-24
 *
 * Recorre el catalogo canonico completo, trae los precios de cada tienda y
 * destaca lo que cambio de tienda desde la ultima vez, que es donde estan las
 * ofertas eventuales que de otro modo se pasan por alto.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { TIENDAS } from '../adapters/index.js';
import { traerOfertas } from '../canonico/traer.js';
import { Descartes } from '../diagnostico.js';
import { evaluarCanasta, historialDe, type EntradaCanasta, type Historial } from '../canasta/evaluar.js';
import { cargar, ofertasDe } from '../canonico/catalogo.js';
import { nombreDia, parsearFechaLocal } from '../normalizar/fecha.js';
import { escalasPendientes, informarEscalas } from '../precios/escalas.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';

const RUTA_HISTORIAL = 'historial.json';

const args = process.argv.slice(2);
function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

const fecha = valorFlag('--fecha') ? parsearFechaLocal(valorFlag('--fecha')!) : new Date();
const maximo = valorFlag('--maximo') ? Number(valorFlag('--maximo')) : undefined;
if (maximo !== undefined && (!Number.isInteger(maximo) || maximo < 1)) {
  console.error('--maximo debe ser un entero mayor o igual a 1');
  process.exit(1);
}
if (Number.isNaN(fecha.getTime())) {
  console.error('Fecha invalida. Formato esperado: YYYY-MM-DD');
  process.exit(1);
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

const descartes = new Descartes();
const detallar = args.includes('--diagnostico');

const catalogo = await cargar();
if (catalogo.productos.length === 0) {
  console.log('\nTu canasta esta vacia. Agrega productos con:\n  npm run emparejar -- "leche colun"\n');
  process.exit(0);
}

let previo: Historial = {};
try {
  previo = JSON.parse(await readFile(RUTA_HISTORIAL, 'utf8')) as Historial;
} catch {
  // Primera corrida: sin historial no hay cambios que reportar.
}

console.log(`\nCanasta de ${catalogo.productos.length} producto(s)  |  ${nombreDia(fecha)} ${fecha.toLocaleDateString('es-CL')}`);
console.log('Consultando tiendas...\n');

const entradas: EntradaCanasta[] = [];
for (const producto of catalogo.productos) {
  const resultados = await Promise.allSettled(
    producto.equivalencias.map((eq) => traerOfertas(eq, descartes)),
  );

  const encontradas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') encontradas.push(...r.value);
    else console.error(`  aviso (${producto.id}): ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  entradas.push({
    producto,
    ofertas: ofertasDe(producto, encontradas, descartes),
    tiendasSoportadas: TIENDAS.filter((t) => t.soportado && t.busqueda).map((t) => t.id),
  });
}

const resumen = evaluarCanasta(entradas, PERFIL_POR_DEFECTO, { fecha }, previo, { maximo });

// Lo que cambio de tienda va primero: es lo unico que exige una decision.
if (resumen.cambios.length > 0) {
  console.log('CAMBIOS DESDE LA ULTIMA VEZ\n');
  for (const l of resumen.cambios) {
    const g = l.ganador!;
    const d = g.desglose;
    const medida = d.porUnidadMedida ? `${clp(d.porUnidadMedida.valor)}/${d.porUnidadMedida.base}` : '';
    console.log(`  ${l.producto.nombre}`);
    console.log(
      `     ahora conviene ${g.oferta.tienda} (antes ${l.tiendaPrevia}): ` +
        `${medida} llevando ${g.cantidad} un, total ${clp(d.totalEfectivo)}`,
    );
    console.log(`     ${clp(l.ahorroVsSegunda)} mas barato que la alternativa`);
    if (d.url) console.log(`     ${d.url}`);
    console.log();
  }
} else if (Object.keys(previo).length > 0) {
  console.log('Sin cambios de tienda desde la ultima vez.\n');
}

console.log('DETALLE\n');
for (const l of resumen.lineas) {
  if (l.sinDatos) {
    console.log(`  ?  ${l.producto.nombre.padEnd(44)} sin datos en ninguna tienda`);
    continue;
  }
  const g = l.ganador!;
  const d = g.desglose;
  const medida = d.porUnidadMedida
    ? `${clp(d.porUnidadMedida.valor)}/${d.porUnidadMedida.base}`
    : `${clp(d.unitarioEfectivo)}/un`;
  const marca = l.cambioDeTienda ? '*' : ' ';

  // El titular es el mejor precio alcanzable y la cantidad que exige.
  console.log(
    `  ${marca}  ${l.producto.nombre.slice(0, 40).padEnd(40)} ${g.oferta.tienda.padEnd(8)} ` +
      `${medida.padStart(12)}  x${String(g.cantidad).padStart(3)} un  ${clp(d.totalEfectivo).padStart(10)}`,
  );
  if (g.exigeLlevarMas) {
    console.log(`      -${g.ahorroPorcentaje}% respecto de llevar ${l.cantidad} un`);
  }
  for (const nota of d.notas) console.log(`      - ${nota}`);

  const ofertaGanadora = entradas
    .find((e) => e.producto.id === l.producto.id)
    ?.ofertas.find((o) => o.tienda === g.oferta.tienda);

  if (ofertaGanadora) {
    for (const e of escalasPendientes(
      informarEscalas(ofertaGanadora, g.cantidad, d.precioUnitarioBruto, PERFIL_POR_DEFECTO),
    )) {
      const m = e.porUnidadMedida ? ` (${clp(e.porUnidadMedida.valor)}/${e.porUnidadMedida.base})` : '';
      const candado = e.usable ? '' : '  [necesitas la membresia]';
      console.log(`      llevando ${e.minUnidades}+ un: ${clp(e.precioUnitario)} c/u${m}  -${e.ahorroPorcentaje}%${candado}`);
    }
  }

  if (l.ranking.length < 2) {
    const falta = [...l.tiendasSinMapear, ...l.tiendasSinDatos];
    console.log(`      sin comparacion: falta ${falta.join(', ') || 'otra tienda'}`);
  }
}

console.log(`\nTOTAL comprando la cantidad optima de cada producto donde convenga: ${clp(resumen.totalOptimo)}`);
for (const t of resumen.totalPorTienda) {
  const cobertura = t.cubre < resumen.lineas.filter((l) => !l.sinDatos).length ? `  (solo ${t.cubre} productos)` : '';
  console.log(`   todo en ${t.tienda.padEnd(10)} ${clp(t.total).padStart(10)}${cobertura}`);
}
if (resumen.ahorroRepartiendo > 0) {
  console.log(`\nRepartir la compra te ahorra ${clp(resumen.ahorroRepartiendo)} frente a comprar todo en una sola tienda.`);
}

if (descartes.total > 0) {
  if (detallar) descartes.imprimir(console.log);
  else console.log(`\n(${descartes.total} descarte(s); corre con --diagnostico para verlos)`);
}

await writeFile(RUTA_HISTORIAL, JSON.stringify(historialDe(resumen), null, 2) + '\n');
console.log(`\nHistorial actualizado en ${RUTA_HISTORIAL}\n`);
