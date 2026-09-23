/**
 * Corre la canasta y deja datos.json listo para la PWA.
 *
 *   npm run publicar                     escribe dist-web/datos.json
 *   npm run publicar -- --salida <ruta>
 *
 * Es el paso que la tarea diaria del PC ejecuta antes de desplegar. Usa la
 * misma corrida que `npm run canasta`, asi que la terminal y el telefono nunca
 * dicen cosas distintas.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { correrCanasta } from '../canasta/correr.js';
import { leerHistorial, type HistorialPrecios } from '../canasta/historial.js';
import { cargar } from '../canonico/catalogo.js';
import { Descartes } from '../diagnostico.js';
import { PERFIL_POR_DEFECTO } from '../precios/reglas.js';
import { construirDatos } from '../publicar/vista.js';

const RUTA_HISTORIAL = 'historial.json';

const args = process.argv.slice(2);
const i = args.indexOf('--salida');
const salida = i >= 0 ? args[i + 1]! : 'dist-web/datos.json';

const catalogo = await cargar();
if (catalogo.productos.length === 0) {
  console.error('\nEl catalogo esta vacio: no hay nada que publicar.');
  console.error('Agrega productos con: npm run emparejar -- "leche colun"\n');
  process.exit(1);
}

let historialPrevio: HistorialPrecios;
try {
  historialPrevio = leerHistorial(JSON.parse(await readFile(RUTA_HISTORIAL, 'utf8')));
} catch {
  historialPrevio = leerHistorial(undefined);
}

const inicio = Date.now();
const descartes = new Descartes();
const corrida = await correrCanasta({
  catalogo,
  historial: historialPrevio,
  fecha: new Date(),
  descartes,
});
const datos = construirDatos(corrida, PERFIL_POR_DEFECTO, { descartes });

/**
 * Si ningun producto trajo datos, lo mas probable es que el PC no tenga
 * internet o que las tiendas esten caidas. Publicar eso reemplazaria los datos
 * buenos del telefono por una canasta vacia; es mejor no publicar y que la PWA
 * siga mostrando los de ayer con su fecha, que ella misma marca como viejos.
 */
if (datos.totales.productosConDatos === 0) {
  console.error('\nNingun producto trajo datos: no se publica para no borrar los buenos.');
  for (const p of datos.problemas.slice(0, 10)) console.error(`  - ${p}`);
  console.error();
  process.exit(1);
}

await mkdir(dirname(salida), { recursive: true });
await writeFile(salida, JSON.stringify(datos) + '\n');
await writeFile(RUTA_HISTORIAL, JSON.stringify(corrida.historial, null, 2) + '\n');

const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
console.log(
  `\n${datos.totales.productosConDatos}/${datos.productos.length} productos con datos, ` +
    `${datos.cambios.length} cambio(s), ${datos.problemas.length} problema(s), ${segundos} s`,
);
console.log(`Escrito ${salida}\n`);
