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
import { traerOfertas } from '../canonico/traer.js';
import { evaluarCanasta, historialDe, type EntradaCanasta, type Historial } from '../canasta/evaluar.js';
import { cargar, ofertasDe } from '../canonico/catalogo.js';
import { nombreDia, parsearFechaLocal } from '../normalizar/fecha.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';

const RUTA_HISTORIAL = 'historial.json';

const args = process.argv.slice(2);
function valorFlag(nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

const fecha = valorFlag('--fecha') ? parsearFechaLocal(valorFlag('--fecha')!) : new Date();
if (Number.isNaN(fecha.getTime())) {
  console.error('Fecha invalida. Formato esperado: YYYY-MM-DD');
  process.exit(1);
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

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
    producto.equivalencias.map((eq) => traerOfertas(eq)),
  );

  const encontradas: Oferta[] = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') encontradas.push(...r.value);
    else console.error(`  aviso (${producto.id}): ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
  entradas.push({ producto, ofertas: ofertasDe(producto, encontradas) });
}

const resumen = evaluarCanasta(entradas, PERFIL_POR_DEFECTO, { fecha }, previo);

// Lo que cambio de tienda va primero: es lo unico que exige una decision.
if (resumen.cambios.length > 0) {
  console.log('CAMBIOS DESDE LA ULTIMA VEZ\n');
  for (const l of resumen.cambios) {
    const g = l.ganador!;
    console.log(`  ${l.producto.nombre}`);
    console.log(`     ahora conviene ${g.tienda} (antes ${l.tiendaPrevia}), ${clp(g.totalEfectivo)} por ${l.cantidad} un`);
    console.log(`     ${clp(l.ahorroVsSegunda)} mas barato que la alternativa`);
    if (g.url) console.log(`     ${g.url}`);
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
  const medida = g.porUnidadMedida ? `${clp(g.porUnidadMedida.valor)}/${g.porUnidadMedida.base}` : '';
  const marca = l.cambioDeTienda ? '*' : ' ';
  console.log(
    `  ${marca}  ${l.producto.nombre.slice(0, 44).padEnd(44)} ${g.tienda.padEnd(8)} ` +
      `${clp(g.totalEfectivo).padStart(9)}  ${medida}`,
  );
  if (l.cantidad > 1) console.log(`      ${l.cantidad} un a ${clp(g.precioUnitarioBruto)} c/u (${g.origenPrecio})`);
  for (const nota of g.notas) console.log(`      - ${nota}`);
}

console.log(`\nTOTAL comprando cada cosa donde convenga: ${clp(resumen.totalOptimo)}`);
for (const t of resumen.totalPorTienda) {
  const cobertura = t.cubre < resumen.lineas.filter((l) => !l.sinDatos).length ? `  (solo ${t.cubre} productos)` : '';
  console.log(`   todo en ${t.tienda.padEnd(10)} ${clp(t.total).padStart(10)}${cobertura}`);
}
if (resumen.ahorroRepartiendo > 0) {
  console.log(`\nRepartir la compra te ahorra ${clp(resumen.ahorroRepartiendo)} frente a comprar todo en una sola tienda.`);
}

await writeFile(RUTA_HISTORIAL, JSON.stringify(historialDe(resumen), null, 2) + '\n');
console.log(`\nHistorial actualizado en ${RUTA_HISTORIAL}\n`);
