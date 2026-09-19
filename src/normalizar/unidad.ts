import type { Base, Contenido } from '../tipos.js';

interface DefUnidad {
  factor: number;
  base: Base;
}

/** Sinonimos que aparecen realmente en los catalogos chilenos. */
const UNIDADES: Record<string, DefUnidad> = {
  kg: { factor: 1, base: 'kg' },
  kgs: { factor: 1, base: 'kg' },
  kilo: { factor: 1, base: 'kg' },
  kilos: { factor: 1, base: 'kg' },
  k: { factor: 1, base: 'kg' },
  g: { factor: 0.001, base: 'kg' },
  gr: { factor: 0.001, base: 'kg' },
  grs: { factor: 0.001, base: 'kg' },
  gramo: { factor: 0.001, base: 'kg' },
  gramos: { factor: 0.001, base: 'kg' },
  mg: { factor: 0.000001, base: 'kg' },
  l: { factor: 1, base: 'L' },
  lt: { factor: 1, base: 'L' },
  lts: { factor: 1, base: 'L' },
  litro: { factor: 1, base: 'L' },
  litros: { factor: 1, base: 'L' },
  ml: { factor: 0.001, base: 'L' },
  cc: { factor: 0.001, base: 'L' },
  cl: { factor: 0.01, base: 'L' },
  un: { factor: 1, base: 'un' },
  u: { factor: 1, base: 'un' },
  uds: { factor: 1, base: 'un' },
  unid: { factor: 1, base: 'un' },
  unidad: { factor: 1, base: 'un' },
  unidades: { factor: 1, base: 'un' },
  rollo: { factor: 1, base: 'un' },
  rollos: { factor: 1, base: 'un' },
};

const ALTERNATIVAS = Object.keys(UNIDADES)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * Captura "500 g", "1,5 L", "6x1,5 L" y "1 kg x 4".
 * El multiplicador de pack puede ir antes o despues del formato.
 */
const PATRON = new RegExp(
  String.raw`(?:(\d+)\s*[x×]\s*)?` +
    String.raw`(\d+(?:[.,]\d+)?)\s*` +
    `(${ALTERNATIVAS})` +
    String.raw`(?![a-záéíóúñ])` +
    String.raw`(?:\s*[x×]\s*(\d+)\b)?`,
  'gi',
);

/** "1.5" y "1,5" son ambos 1.5; los catalogos mezclan ambos. */
function aNumero(texto: string): number {
  return Number(texto.replace(',', '.'));
}

/**
 * Extrae el contenido desde el nombre del producto.
 *
 * Si hay varios formatos en el nombre gana el ultimo, que es donde las cadenas
 * ponen el gramaje por convencion ("Arroz Grado 1 Tucapel 1 kg"). Devuelve
 * null cuando no hay nada parseable: el llamador debe degradar a comparar por
 * unidad, nunca inventar un contenido.
 */
export function parsearContenido(nombre: string): Contenido | null {
  const matches = [...nombre.matchAll(PATRON)];
  if (matches.length === 0) return null;

  // Un formato de masa o volumen siempre gana sobre uno de unidades sueltas:
  // en "Pack 6 un Leche 1 L" lo que importa para comparar es el litro.
  const conMedida = matches.filter((m) => UNIDADES[m[3]!.toLowerCase()]!.base !== 'un');
  const elegido = (conMedida.length > 0 ? conMedida : matches).at(-1)!;

  const def = UNIDADES[elegido[3]!.toLowerCase()]!;
  const envases = elegido[1] ? Number(elegido[1]) : elegido[4] ? Number(elegido[4]) : 1;
  const porEnvase = aNumero(elegido[2]!);
  if (!Number.isFinite(porEnvase) || porEnvase <= 0) return null;

  return {
    cantidad: porEnvase * def.factor * envases,
    base: def.base,
    envases,
    origen: elegido[0]!.trim(),
  };
}

/** Etiqueta para mostrar: "$/kg", "$/L", "$/un". */
export function etiquetaBase(base: Base): string {
  return `$/${base}`;
}
