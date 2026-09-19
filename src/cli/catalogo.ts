/** Muestra el catalogo canonico. npm run catalogo */
import { cargar } from '../canonico/catalogo.js';

const catalogo = await cargar();

if (catalogo.productos.length === 0) {
  console.log('\nCatalogo vacio. Registra el primero con:\n  npm run emparejar -- "arroz tucapel"\n');
  process.exit(0);
}

console.log(`\n${catalogo.productos.length} producto(s) canonico(s)\n`);
for (const p of catalogo.productos) {
  const consumo = p.consumoMensual ? `  (${p.consumoMensual} un/mes)` : '';
  console.log(`${p.nombre}${consumo}`);
  console.log(`  id: ${p.id}`);
  for (const e of p.equivalencias) {
    console.log(`  ${e.tienda.padEnd(12)} ${e.sku.padEnd(10)} ${e.origen.padEnd(7)} ${e.nombre}`);
  }
  console.log();
}
