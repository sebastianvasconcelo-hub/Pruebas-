/**
 * Muestra el catalogo canonico, o borra un producto.
 *
 *   npm run catalogo
 *   npm run catalogo -- --borrar <id>
 */
import { borrar, cargar, guardar } from '../canonico/catalogo.js';

const args = process.argv.slice(2);
const i = args.indexOf('--borrar');
const aBorrar = i >= 0 ? args[i + 1] : undefined;

const catalogo = await cargar();

if (aBorrar) {
  const resultado = borrar(catalogo, aBorrar);
  if (!resultado) {
    console.error(`\nNo hay ningun producto con id "${aBorrar}".`);
    console.error('Los registrados son:');
    for (const p of catalogo.productos) console.error(`   ${p.id}`);
    console.error();
    process.exit(1);
  }
  await guardar(resultado);
  console.log(`\nBorrado "${aBorrar}". Quedan ${resultado.productos.length} producto(s).\n`);
  process.exit(0);
}

if (catalogo.productos.length === 0) {
  console.log('\nCatalogo vacio. Registra el primero con:\n  npm run emparejar -- "leche colun"\n');
  process.exit(0);
}

console.log(`\n${catalogo.productos.length} producto(s) canonico(s)\n`);
for (const p of catalogo.productos) {
  const detalles = [
    p.cantidadHabitual ? `${p.cantidadHabitual} un por compra` : null,
    p.consumoMensual ? `${p.consumoMensual} un/mes` : null,
  ].filter((d) => d !== null);
  console.log(`${p.nombre}${detalles.length > 0 ? `  (${detalles.join(', ')})` : ''}`);
  console.log(`  id: ${p.id}`);
  for (const e of p.equivalencias) {
    console.log(`  ${e.tienda.padEnd(12)} ${e.sku.padEnd(10)} ${e.origen.padEnd(7)} ${e.nombre}`);
  }
  console.log();
}
console.log('Para borrar uno:  npm run catalogo -- --borrar <id>\n');
