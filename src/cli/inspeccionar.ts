/**
 * Inspecciona un archivo ya descargado, sin red.
 *
 * Responde la pregunta que importa cuando la extraccion automatica no encuentra
 * nada: los datos estan en el archivo y mi detector falla, o no estan?
 *
 *   npm run inspeccionar -- fixtures/alvi-arroz.html
 *   npm run inspeccionar -- fixtures/jumbo-busqueda.html --buscar tucapel
 */
import { readFile } from 'node:fs/promises';
import {
  buscarProductos,
  buscarTexto,
  extraerFlight,
  extraerJsonIncrustado,
  extraerNextData,
  inventarioClaves,
} from '../descubrir/nextdata.js';

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
const i = args.indexOf('--buscar');
const termino = i >= 0 ? args[i + 1] : undefined;

if (!ruta) {
  console.error('Uso: npm run inspeccionar -- <archivo> [--buscar <texto>]');
  process.exit(1);
}

const contenido = await readFile(ruta, 'utf8');
console.log(`\n${ruta}  (${(contenido.length / 1024).toFixed(0)} KB)\n`);

const bloques: unknown[] = [];

if (ruta.endsWith('.json')) {
  try {
    const datos = JSON.parse(contenido);
    bloques.push(...(Array.isArray(datos) ? datos : [datos]));
  } catch {
    console.log('No es JSON valido.');
  }
} else {
  const nextData = extraerNextData(contenido);
  if (nextData) {
    console.log('__NEXT_DATA__ presente');
    bloques.push(nextData);
  }
  const flight = extraerFlight(contenido);
  if (flight !== '') {
    const rescatados = extraerJsonIncrustado(flight);
    console.log(`payload RSC: ${(flight.length / 1024).toFixed(0)} KB, ${rescatados.length} bloques`);
    bloques.push(...rescatados);

    // El grep crudo no depende de que el JSON parsee: si el nombre esta en el
    // stream pero no en ningun bloque, el problema es el recorte, no el sitio.
    if (termino && flight.toLowerCase().includes(termino.toLowerCase())) {
      const pos = flight.toLowerCase().indexOf(termino.toLowerCase());
      console.log(`\n"${termino}" SI aparece en el stream RSC crudo, en la posicion ${pos}:`);
      console.log(`   ...${flight.slice(Math.max(0, pos - 200), pos + 200).replace(/\s+/g, ' ')}...`);
    }
  }
}

if (bloques.length === 0) {
  console.log('No se pudo extraer ningun bloque JSON.');
  if (termino) {
    const hay = contenido.toLowerCase().includes(termino.toLowerCase());
    console.log(`"${termino}" ${hay ? 'SI' : 'NO'} aparece en el archivo crudo.`);
  }
  process.exit(0);
}

console.log(`\n${bloques.length} bloque(s) para analizar\n`);

const candidatos = bloques.flatMap((b, n) => buscarProductos(b).map((c) => ({ ...c, bloque: n })));
if (candidatos.length > 0) {
  console.log('LISTAS QUE PARECEN PRODUCTOS');
  for (const c of candidatos.sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)) {
    console.log(`   ${c.cantidad} en bloque[${c.bloque}].${c.ruta || '(raiz)'}`);
    console.log(`   claves: ${c.claves.slice(0, 16).join(', ')}`);
  }
} else {
  console.log('Ninguna lista paso el filtro de productos.');
}

const PATRON = /price|precio|valor|amount|name|nombre|title|titulo|product|sku|ean|item|seller|offer/i;
const inventario = bloques.flatMap((b) => inventarioClaves(b, PATRON)).slice(0, 40);

if (inventario.length > 0) {
  console.log('\nCLAVES RELEVANTES ENCONTRADAS');
  for (const c of inventario) {
    const ej = typeof c.ejemplo === 'string' ? `"${c.ejemplo.slice(0, 60)}"` : JSON.stringify(c.ejemplo);
    console.log(`   ${c.clave.padEnd(24)} ${String(ej).slice(0, 70)}`);
    console.log(`   ${' '.repeat(24)} en ${c.ruta}`);
  }
} else {
  console.log('\nNo hay ninguna clave que suene a producto o precio.');
  console.log('Eso confirma que el catalogo NO viaja en este archivo.');
}

if (termino) {
  console.log(`\nRUTAS QUE CONTIENEN "${termino}"`);
  const hits = bloques.flatMap((b, n) => buscarTexto(b, termino).map((r) => `bloque[${n}].${r}`));
  if (hits.length === 0) console.log('   ninguna');
  else for (const h of hits.slice(0, 20)) console.log(`   ${h}`);
}
console.log();
