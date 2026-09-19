import type { CLP, Escala } from '../tipos.js';

/**
 * "$1.290" -> 1290 ; "$1.290,50" -> 1290.5
 * Formato chileno: punto separa miles, coma separa decimales.
 */
export function parsearCLP(texto: string): CLP | null {
  const limpio = texto.replace(/[^\d.,]/g, '');
  if (limpio === '') return null;
  const n = Number(limpio.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

type Regla = (texto: string, precioBase: CLP) => Escala | null;

const REGLAS: Regla[] = [
  // "Llevando 3 o mas $1.290" / "Llevando 3 a $1.290"
  (t) => {
    const m = /llevando\s+(\d+)\s*(?:o\s*m[aá]s\s*)?(?:a\s*)?\$\s*([\d.,]+)/i.exec(t);
    if (!m) return null;
    const precio = parsearCLP(m[2]!);
    return precio === null ? null : { minUnidades: Number(m[1]), precioUnitario: precio, origen: t };
  },

  // "3 o mas a $1.290"
  (t) => {
    const m = /(\d+)\s*o\s*m[aá]s\s*(?:a\s*)?\$\s*([\d.,]+)/i.exec(t);
    if (!m) return null;
    const precio = parsearCLP(m[2]!);
    return precio === null ? null : { minUnidades: Number(m[1]), precioUnitario: precio, origen: t };
  },

  // "3 x $3.990" y "Lleva 3 por $3.990" -> el precio es el TOTAL del pack
  (t) => {
    const m =
      /(?:lleva\s+)?(\d+)\s*(?:[x×]|por|pagas?)\s*\$\s*([\d.,]+)/i.exec(t);
    if (!m) return null;
    const total = parsearCLP(m[2]!);
    const n = Number(m[1]);
    if (total === null || n <= 0) return null;
    return { minUnidades: n, precioUnitario: total / n, origen: t };
  },

  // "2da unidad 50% dcto" -> precio promedio de las n unidades
  (t, precioBase) => {
    const m = /(\d+)\s*(?:da|ra|ta|va|ma|°|º)?\s*unidad\s*(?:a\s*)?(\d+)\s*%/i.exec(t);
    if (!m) return null;
    const n = Number(m[1]);
    const dcto = Number(m[2]) / 100;
    if (n <= 1 || dcto <= 0 || dcto > 1 || precioBase <= 0) return null;
    const promedio = (precioBase * (n - 1) + precioBase * (1 - dcto)) / n;
    return { minUnidades: n, precioUnitario: promedio, origen: t };
  },

  // "Lleva 3 paga 2"
  (t, precioBase) => {
    const m = /lleva\s+(\d+)\s+paga\s+(\d+)/i.exec(t);
    if (!m) return null;
    const lleva = Number(m[1]);
    const paga = Number(m[2]);
    if (lleva <= 0 || paga <= 0 || paga >= lleva || precioBase <= 0) return null;
    return { minUnidades: lleva, precioUnitario: (precioBase * paga) / lleva, origen: t };
  },
];

/**
 * Convierte los textos de promocion de la tienda en escalas de precio.
 *
 * Los textos son heterogeneos y cambian sin aviso, asi que lo que no se
 * entiende se descarta en silencio: una escala inventada distorsiona la
 * comparacion mas que una escala ausente. `Oferta.promoTexto` conserva el
 * original para poder revisar que se perdio.
 */
export function parsearPromos(textos: string[], precioBase: CLP): Escala[] {
  const encontradas: Escala[] = [];
  for (const texto of textos) {
    for (const regla of REGLAS) {
      const escala = regla(texto, precioBase);
      if (escala && escala.minUnidades > 1 && escala.precioUnitario > 0) {
        encontradas.push(escala);
        break;
      }
    }
  }
  return consolidar(encontradas);
}

/** Una escala por cantidad minima, quedandose con la mas barata. */
export function consolidar(escalas: Escala[]): Escala[] {
  const porMin = new Map<number, Escala>();
  for (const e of escalas) {
    const previa = porMin.get(e.minUnidades);
    if (!previa || e.precioUnitario < previa.precioUnitario) porMin.set(e.minUnidades, e);
  }
  return [...porMin.values()].sort((a, b) => a.minUnidades - b.minUnidades);
}

/** La escala mas conveniente para una cantidad dada, si existe. */
export function escalaAplicable(escalas: Escala[], cantidad: number): Escala | null {
  const candidatas = escalas.filter((e) => cantidad >= e.minUnidades);
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (b.precioUnitario < a.precioUnitario ? b : a));
}
