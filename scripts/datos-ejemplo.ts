/**
 * Genera un datos.json de ejemplo para ver la PWA sin haber corrido la canasta.
 *
 *   npm run web:ejemplo
 *
 * Usa la misma corrida y el mismo armado que la publicacion real, con tiendas
 * falsas: dos dias seguidos, para que aparezcan novedades. Los precios son los
 * observados en Alvi y Jumbo en septiembre de 2026.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { correrCanasta } from '../src/canasta/correr.js';
import { leerHistorial } from '../src/canasta/historial.js';
import type { Catalogo, Equivalencia } from '../src/canonico/tipos.js';
import { PERFIL_POR_DEFECTO } from '../src/precios/reglas.js';
import { construirDatos } from '../src/publicar/vista.js';
import type { Base, Oferta } from '../src/tipos.js';

function eq(tienda: string, sku: string, nombre: string): Equivalencia {
  return { tienda, sku, nombre, origen: 'manual', confirmadoEn: '2026-09-20' };
}

const CATALOGO: Catalogo = {
  version: 1,
  productos: [
    { id: 'leche', nombre: 'Leche Colun semidescremada 1 L', cantidadHabitual: 6,
      equivalencias: [eq('alvi', 'a-leche', 'Leche'), eq('jumbo', 'j-leche', 'Leche')] },
    { id: 'arroz', nombre: 'Arroz Tucapel G2 1 kg', cantidadHabitual: 2,
      equivalencias: [eq('alvi', 'a-arroz', 'Arroz'), eq('jumbo', 'j-arroz', 'Arroz')] },
    { id: 'queso', nombre: 'Queso mantecoso Quilque laminado 500 g',
      equivalencias: [eq('alvi', 'a-queso', 'Queso'), eq('jumbo', 'j-queso', 'Queso')] },
    { id: 'aceite', nombre: 'Aceite vegetal Chef 900 cc', cantidadHabitual: 2,
      equivalencias: [eq('alvi', 'a-aceite', 'Aceite'), eq('jumbo', 'j-aceite', 'Aceite')] },
    { id: 'detergente', nombre: 'Detergente líquido Omo 3 L',
      equivalencias: [eq('alvi', 'a-deter', 'Detergente')] },
  ],
};

function oferta(
  tienda: string, sku: string, lista: number, cantidad: number, base: Base,
  opts: { socio?: number; tramos?: Array<[number, number]> } = {},
): Oferta {
  return {
    tienda, sku, nombre: sku, precioLista: lista,
    ...(opts.socio ? { precioSocio: opts.socio } : {}),
    escalas: (opts.tramos ?? []).map(([m, p]) => ({ minUnidades: m, precioUnitario: p, requiereMembresia: tienda === 'alvi' })),
    contenido: { cantidad, base, envases: 1, origen: '' },
    url: `https://www.${tienda}.cl/${sku}/p`,
    promoTexto: [], disponible: true, capturadoEn: '',
  };
}

const AYER: Record<string, Oferta> = {
  'a-leche': oferta('alvi', 'a-leche', 1290, 1, 'L'),
  'j-leche': oferta('jumbo', 'j-leche', 1290, 1, 'L'),
  'a-arroz': oferta('alvi', 'a-arroz', 2090, 1, 'kg', { tramos: [[3, 1490], [10, 1450]] }),
  'j-arroz': oferta('jumbo', 'j-arroz', 1790, 1, 'kg'),
  'a-queso': oferta('alvi', 'a-queso', 5990, 0.5, 'kg'),
  'j-queso': oferta('jumbo', 'j-queso', 6990, 0.5, 'kg', { socio: 5890 }),
  'a-aceite': oferta('alvi', 'a-aceite', 2690, 0.9, 'L', { tramos: [[6, 2390]] }),
  'j-aceite': oferta('jumbo', 'j-aceite', 2590, 0.9, 'L'),
  'a-deter': oferta('alvi', 'a-deter', 11990, 3, 'L', { tramos: [[2, 10990]] }),
};

const HOY: Record<string, Oferta> = {
  ...AYER,
  'a-leche': oferta('alvi', 'a-leche', 1250, 1, 'L', { tramos: [[3, 1140], [12, 1090]] }),
  'j-queso': oferta('jumbo', 'j-queso', 6990, 0.5, 'kg', { socio: 4544 }),
  'j-aceite': oferta('jumbo', 'j-aceite', 2190, 0.9, 'L'),
};

const tiendas = (precios: Record<string, Oferta>) => async (e: Equivalencia) =>
  precios[e.sku] ? [precios[e.sku]!] : [];

const ayer = new Date(2026, 8, 23, 7, 0);
const hoy = new Date(2026, 8, 24, 7, 0);

const primera = await correrCanasta({ catalogo: CATALOGO, historial: leerHistorial(undefined), fecha: ayer, traer: tiendas(AYER) });
const segunda = await correrCanasta({ catalogo: CATALOGO, historial: primera.historial, fecha: hoy, traer: tiendas(HOY) });
const datos = construirDatos(segunda, PERFIL_POR_DEFECTO, { generadoEn: new Date(Date.now() - 2 * 3_600_000) });

await mkdir('dist-web', { recursive: true });
await writeFile('dist-web/datos.json', JSON.stringify(datos, null, 2) + '\n');
console.log(`dist-web/datos.json de ejemplo: ${datos.productos.length} productos, ${datos.cambios.length} novedades`);
