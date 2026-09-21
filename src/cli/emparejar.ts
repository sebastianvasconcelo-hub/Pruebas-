/**
 * Registra un producto canonico: el mismo articulo, identificado en cada cadena.
 *
 *   npm run emparejar -- "arroz tucapel"
 *
 * Busca en todas las tiendas soportadas, empareja solo lo que puede probar
 * (EAN identico) y te pregunta el resto. Lo confirmado queda en catalogo.json
 * y no se vuelve a preguntar.
 */
import { createInterface } from 'node:readline/promises';
import { TIENDAS } from '../adapters/index.js';
import { buscarEnSitio } from '../adapters/html.js';
import {
  cargar,
  equivalenciaDesdeOferta,
  fijarEquivalencia,
  guardar,
  idDesdeNombre,
  upsert,
} from '../canonico/catalogo.js';
import { sugerir } from '../canonico/similitud.js';
import type { ProductoCanonico } from '../canonico/tipos.js';
import type { Oferta } from '../tipos.js';

const query = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!query) {
  console.error('Uso: npm run emparejar -- "<producto>"');
  process.exit(1);
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

function describir(o: Oferta): string {
  const formato = o.contenido ? `${o.contenido.cantidad} ${o.contenido.base}` : 'formato ?';
  const escala = o.escalas[0]
    ? `, desde ${o.escalas[0].minUnidades} un ${clp(o.escalas[0].precioUnitario)}`
    : '';
  return `${o.nombre}  [${formato}] ${clp(o.precioSocio ?? o.precioLista)}${escala}${o.ean ? `  ean ${o.ean}` : ''}`;
}

const soportadas = TIENDAS.filter((t) => t.soportado && t.busqueda);
console.log(`\nBuscando "${query}" en ${soportadas.map((t) => t.nombre).join(', ')}...\n`);

const resultados = await Promise.allSettled(soportadas.map((cfg) => buscarEnSitio(cfg, query)));
const ofertas: Oferta[] = [];
for (const r of resultados) {
  if (r.status === 'fulfilled') ofertas.push(...r.value);
  else console.error(`  aviso: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
}

const disponibles = ofertas.filter((o) => o.disponible);
if (disponibles.length === 0) {
  console.log('Sin resultados disponibles.\n');
  process.exit(0);
}

const porTienda = new Map<string, Oferta[]>();
for (const o of disponibles) porTienda.set(o.tienda, [...(porTienda.get(o.tienda) ?? []), o]);

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  // 1. Elegir el producto base, normalmente en la tienda que trae mas datos.
  const tiendaBase = [...porTienda.keys()].sort(
    (a, b) =>
      porTienda.get(b)!.filter((o) => o.ean).length - porTienda.get(a)!.filter((o) => o.ean).length,
  )[0]!;
  const candidatosBase = porTienda.get(tiendaBase)!.slice(0, 15);

  console.log(`Productos en ${tiendaBase}:\n`);
  candidatosBase.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describir(o)}`));

  const eleccion = Number(await rl.question('\nCual es el producto que quieres registrar? (numero) '));
  const base = candidatosBase[eleccion - 1];
  if (!base) {
    console.log('Numero fuera de rango. No se guardo nada.\n');
    process.exit(0);
  }

  // 2. Nombre canonico: como lo llamas tu, no como lo llama la cadena.
  const nombreSugerido = base.nombre;
  let nombre = (await rl.question(`\nNombre canonico [${nombreSugerido}]: `)).trim() || nombreSugerido;
  // Un nombre de una o dos letras casi siempre es un enter mal dado.
  while (nombre.length < 3) {
    console.log('   Muy corto: escribe al menos 3 caracteres, o enter para usar el sugerido.');
    nombre = (await rl.question(`Nombre canonico [${nombreSugerido}]: `)).trim() || nombreSugerido;
  }

  const consumoTexto = (await rl.question('Cuantas unidades consumes al mes? (enter para omitir) ')).trim();
  const consumoMensual = consumoTexto === '' ? undefined : Number(consumoTexto);

  let producto: ProductoCanonico = {
    id: idDesdeNombre(nombre),
    nombre,
    ...(consumoMensual !== undefined && Number.isFinite(consumoMensual) && consumoMensual > 0
      ? { consumoMensual }
      : {}),
    equivalencias: [],
  };
  producto = fijarEquivalencia(producto, equivalenciaDesdeOferta(base, 'manual'));

  // 3. Una equivalencia por cada otra tienda.
  for (const cfg of soportadas) {
    if (cfg.id === base.tienda) continue;
    const candidatas = porTienda.get(cfg.id) ?? [];
    if (candidatas.length === 0) {
      console.log(`\n${cfg.nombre}: sin resultados.`);
      continue;
    }

    // El EAN es prueba, no indicio: si coincide se registra sin preguntar.
    const porEan = base.ean ? candidatas.find((c) => c.ean === base.ean) : undefined;
    if (porEan) {
      producto = fijarEquivalencia(producto, equivalenciaDesdeOferta(porEan, 'ean'));
      console.log(`\n${cfg.nombre}: emparejado por EAN identico`);
      console.log(`   ${describir(porEan)}`);
      continue;
    }

    const sugerencias = sugerir(base, candidatas).slice(0, 5);
    if (sugerencias.length === 0) {
      console.log(`\n${cfg.nombre}: nada suficientemente parecido.`);
      continue;
    }

    console.log(`\n${cfg.nombre}: candidatas para "${base.nombre}"\n`);
    sugerencias.forEach((s, i) => {
      console.log(`  ${i + 1}. [${(s.puntaje.valor * 100).toFixed(0)}%] ${describir(s.oferta)}`);
      console.log(`      ${s.puntaje.razones.join(' | ')}`);
    });

    const r = (await rl.question('Cual es el mismo producto? (numero, enter para ninguno) ')).trim();
    if (r === '') {
      console.log('   ninguno: esta tienda queda sin mapear.');
      continue;
    }
    const elegida = sugerencias[Number(r) - 1];
    if (!elegida) {
      console.log('   numero fuera de rango: esta tienda queda sin mapear.');
      continue;
    }
    producto = fijarEquivalencia(producto, equivalenciaDesdeOferta(elegida.oferta, 'manual'));
  }

  const catalogo = upsert(await cargar(), producto);
  await guardar(catalogo);

  console.log(`\nGuardado "${producto.nombre}" (${producto.id}) con ${producto.equivalencias.length} tienda(s):`);
  for (const e of producto.equivalencias) {
    console.log(`   ${e.tienda.padEnd(12)} ${e.sku.padEnd(10)} ${e.origen.padEnd(7)} ${e.nombre}`);
  }
  console.log(`\nAhora: npm run comparar -- --producto ${producto.id}\n`);
} finally {
  rl.close();
}
