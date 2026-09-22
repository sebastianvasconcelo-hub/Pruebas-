/**
 * Muestra el catalogo canonico, lo repara o borra un producto.
 *
 *   npm run catalogo
 *   npm run catalogo -- --cantidad <id> <n>   unidades por compra
 *   npm run catalogo -- --consumo <id> <n>    unidades al mes
 *   npm run catalogo -- --reparar
 *   npm run catalogo -- --borrar <id>
 */
import { borrar, cargar, conCantidades, guardar, refrescar, upsert } from '../canonico/catalogo.js';
import { traerOfertas } from '../canonico/traer.js';
import { normalizar } from '../canonico/similitud.js';

const args = process.argv.slice(2);
const i = args.indexOf('--borrar');
const aBorrar = i >= 0 ? args[i + 1] : undefined;

let catalogo = await cargar();

/**
 * Ajuste de cantidades sin tener que volver a emparejar.
 *
 * Son dos cosas distintas y confundirlas cambia el resultado: --cantidad es
 * cuantas unidades llevas en cada compra, y decide a que cantidad se compara y
 * que escalas mayoristas aplican; --consumo es cuantas gastas al mes, y solo
 * alimenta el costo de bodega y los meses de stock.
 */
for (const [flag, campo] of [
  ['--cantidad', 'cantidadHabitual'],
  ['--consumo', 'consumoMensual'],
] as const) {
  const j = args.indexOf(flag);
  if (j < 0) continue;

  const id = args[j + 1];
  const valor = Number(args[j + 2]);
  const producto = id ? catalogo.productos.find((p) => p.id === id) : undefined;

  if (!producto) {
    console.error(`\nUso: npm run catalogo -- ${flag} <id> <numero>`);
    console.error('Los productos registrados son:');
    for (const p of catalogo.productos) console.error(`   ${p.id}`);
    console.error();
    process.exit(1);
  }

  try {
    catalogo = upsert(catalogo, conCantidades(producto, { [campo]: valor }));
  } catch (e) {
    console.error(`\n${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
  await guardar(catalogo);
  console.log(`\n${producto.nombre}: ${campo} = ${valor}\n`);
  process.exit(0);
}

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

/**
 * Repara los identificadores caducos.
 *
 * Las tiendas reescriben la direccion de un producto y el sku guardado deja de
 * calzar. Reparar vuelve a consultar y actualiza sku y url cuando el nombre
 * coincide exacto, que es la unica evidencia segura sin EAN de por medio.
 */
if (args.includes('--reparar')) {
  if (catalogo.productos.length === 0) {
    console.log('\nCatalogo vacio: nada que reparar.\n');
    process.exit(0);
  }

  console.log(`\nRevisando ${catalogo.productos.length} producto(s)...\n`);
  let arreglados = 0;

  for (const producto of catalogo.productos) {
    const equivalencias = [...producto.equivalencias];

    for (const [indice, eq] of equivalencias.entries()) {
      let ofertas;
      try {
        ofertas = await traerOfertas(eq);
      } catch (e) {
        console.log(`  ${producto.id} / ${eq.tienda}: fallo la consulta (${e instanceof Error ? e.message : e})`);
        continue;
      }

      const deLaTienda = ofertas.filter((o) => o.tienda === eq.tienda);
      if (deLaTienda.some((o) => o.sku === eq.sku)) continue; // el sku sigue vigente

      const porNombre = deLaTienda.find((o) => normalizar(o.nombre) === normalizar(eq.nombre));
      if (!porNombre) {
        console.log(`  ${producto.id} / ${eq.tienda}: no se encontro el producto, hay que volver a emparejar`);
        continue;
      }

      console.log(`  ${producto.id} / ${eq.tienda}: sku "${eq.sku}" -> "${porNombre.sku}"`);
      equivalencias[indice] = refrescar(eq, porNombre);
      arreglados++;
    }

    catalogo = upsert(catalogo, { ...producto, equivalencias });
  }

  if (arreglados > 0) {
    await guardar(catalogo);
    console.log(`\n${arreglados} equivalencia(s) actualizada(s).\n`);
  } else {
    console.log('\nTodo al dia: no habia nada que reparar.\n');
  }
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
    console.log(`  ${e.tienda.padEnd(10)} ${e.origen.padEnd(7)} sku ${e.sku}`);
    console.log(`  ${' '.repeat(10)} ${e.nombre}`);
    // La url es la llave de respaldo cuando el sku caduca: conviene verla.
    console.log(`  ${' '.repeat(10)} ${e.url ?? '(sin url guardada)'}`);
  }
  console.log();
}
console.log('Reparar identificadores caducos:  npm run catalogo -- --reparar');
console.log('Borrar uno:                       npm run catalogo -- --borrar <id>\n');
