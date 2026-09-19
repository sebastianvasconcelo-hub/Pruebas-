import type { Oferta } from '../tipos.js';

/**
 * Parecido entre productos de distintas cadenas.
 *
 * El EAN es prueba; todo lo demas es indicio. Por eso la funcion devuelve un
 * puntaje y no un veredicto: quien decide es la persona, y el emparejamiento
 * queda guardado para no volver a preguntarlo.
 */

/** Palabras que aparecen en todos los nombres y no aportan a distinguir. */
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'a', 'en',
  'x', 'un', 'una', 'gr', 'grs', 'kg', 'g', 'ml', 'cc', 'lt', 'l',
]);

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizar(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .split(' ')
      .filter((t) => t !== '' && !VACIAS.has(t) && !/^\d+$/.test(t)),
  );
}

/** Coeficiente de Dice: 2|A∩B| / (|A|+|B|). Entre 0 y 1. */
export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const t of a) if (b.has(t)) comunes++;
  return (2 * comunes) / (a.size + b.size);
}

export interface Puntaje {
  valor: number;
  /** Por que se llego a ese puntaje, para que la decision sea informada. */
  razones: string[];
}

/**
 * Puntaje de parecido entre dos ofertas.
 *
 * EAN identico corta la discusion: es 1. Si no, se combina el parecido del
 * nombre con dos indicios fuertes, marca y formato, que son justamente los que
 * distinguen "Arroz Tucapel 1 kg" de "Arroz Merkat 1 kg".
 */
export function puntuar(a: Oferta, b: Oferta): Puntaje {
  if (a.ean && b.ean && a.ean === b.ean) {
    return { valor: 1, razones: ['EAN identico'] };
  }

  const razones: string[] = [];
  let valor = dice(tokenizar(a.nombre), tokenizar(b.nombre));
  razones.push(`nombre ${(valor * 100).toFixed(0)}%`);

  const marcaA = a.marca ? normalizar(a.marca) : '';
  const marcaB = b.marca ? normalizar(b.marca) : '';
  if (marcaA !== '' && marcaB !== '') {
    if (marcaA === marcaB) {
      valor += 0.15;
      razones.push(`misma marca (${a.marca})`);
    } else {
      // Marcas distintas casi siempre significan productos distintos.
      valor -= 0.25;
      razones.push(`marcas distintas (${a.marca} vs ${b.marca})`);
    }
  }

  if (a.contenido && b.contenido) {
    if (a.contenido.base === b.contenido.base && a.contenido.cantidad === b.contenido.cantidad) {
      valor += 0.15;
      razones.push(`mismo formato (${a.contenido.cantidad} ${a.contenido.base})`);
    } else {
      valor -= 0.15;
      razones.push(
        `formato distinto (${a.contenido.cantidad} ${a.contenido.base} vs ` +
          `${b.contenido.cantidad} ${b.contenido.base})`,
      );
    }
  }

  // Dos EAN presentes y distintos son prueba de que no es el mismo producto.
  if (a.ean && b.ean && a.ean !== b.ean) {
    valor -= 0.5;
    razones.push('EAN distintos');
  }

  return { valor: Math.max(0, Math.min(1, valor)), razones };
}

export interface Sugerencia {
  oferta: Oferta;
  puntaje: Puntaje;
}

/** Candidatas ordenadas de mas a menos parecida, sobre un umbral minimo. */
export function sugerir(base: Oferta, candidatas: Oferta[], umbral = 0.3): Sugerencia[] {
  return candidatas
    .filter((c) => c.tienda !== base.tienda)
    .map((oferta) => ({ oferta, puntaje: puntuar(base, oferta) }))
    .filter((s) => s.puntaje.valor >= umbral)
    .sort((a, b) => b.puntaje.valor - a.puntaje.valor);
}

/** Emparejamientos seguros: mismo EAN en distintas tiendas, sin preguntar nada. */
export function agruparPorEan(ofertas: Oferta[]): Map<string, Oferta[]> {
  const grupos = new Map<string, Oferta[]>();
  for (const o of ofertas) {
    if (!o.ean) continue;
    const previo = grupos.get(o.ean) ?? [];
    // Una sola oferta por tienda dentro del grupo.
    if (previo.some((p) => p.tienda === o.tienda)) continue;
    grupos.set(o.ean, [...previo, o]);
  }
  // Solo interesan los que cruzan cadenas.
  return new Map([...grupos].filter(([, v]) => v.length > 1));
}
