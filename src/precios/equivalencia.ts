import type { Oferta } from '../tipos.js';

/**
 * Deteccion de comparaciones injustas.
 *
 * El comparador busca el mismo texto en cada tienda y se queda con lo mas
 * barato de cada una, asi que nada garantiza que los ganadores sean el mismo
 * producto: "Arroz Merkat 1 Kg" contra "Arroz Tucapel 1 kg" no es una
 * comparacion, es una coincidencia de categoria.
 *
 * Hasta que exista una tabla de producto canonico, lo correcto es avisar en
 * vez de presentar un ahorro que puede no ser real.
 */

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function advertenciasEquivalencia(ofertas: Oferta[]): string[] {
  if (ofertas.length < 2) return [];
  const avisos: string[] = [];

  const eans = ofertas.map((o) => o.ean).filter((e): e is string => !!e);
  // Dos EAN distintos son prueba directa de que no es el mismo producto.
  if (eans.length === ofertas.length && new Set(eans).size > 1) {
    avisos.push('los EAN son distintos: no es el mismo producto');
  }

  const marcas = ofertas.map((o) => o.marca).filter((m): m is string => !!m && m.trim() !== '');
  if (marcas.length >= 2 && new Set(marcas.map(normalizar)).size > 1) {
    avisos.push(
      `marcas distintas (${[...new Set(marcas)].join(' vs ')}): ` +
        'verifica que sean equivalentes antes de fiarte del ahorro',
    );
  }

  const bases = new Set(ofertas.map((o) => o.contenido?.base).filter((b) => b !== undefined));
  if (bases.size > 1) {
    avisos.push(`unidades de medida distintas (${[...bases].join(', ')})`);
  }

  return avisos;
}
