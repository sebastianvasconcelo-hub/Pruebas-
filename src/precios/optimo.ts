import type { Oferta } from '../tipos.js';
import { precioEfectivo, type Contexto, type Desglose } from './efectivo.js';
import type { PerfilCompra } from './reglas.js';

/**
 * El mejor precio alcanzable y cuanto hay que llevar para conseguirlo.
 *
 * La pregunta no es "cuanto cuesta comprar N", sino al reves: "cual es el
 * precio mas barato al que puedo llegar y que cantidad exige". Quien compra
 * por volumen en un mayorista, con cuotas sin interes y espacio para guardar,
 * decide la cantidad EN FUNCION del precio, no antes de mirarlo.
 *
 * Por eso la cantidad es parte de la respuesta y no un dato de entrada.
 */

export interface Optimo {
  oferta: Oferta;
  /** Al mejor tramo alcanzable. */
  desglose: Desglose;
  cantidad: number;
  /** A la cantidad de referencia, para ver contra que se compara. */
  referencia: Desglose;
  /** Cuanto baja el precio por unidad de medida respecto de la referencia. */
  ahorroPorcentaje: number;
  /** El optimo exige llevar mas que la referencia. */
  exigeLlevarMas: boolean;
}

/** Costo comparable: por unidad de medida si se pudo deducir, si no unitario. */
function costo(d: Desglose): number {
  return d.porUnidadMedida?.valor ?? d.unitarioEfectivo;
}

/**
 * Cantidades que vale la pena evaluar: la de referencia y el minimo de cada
 * tramo que realmente puedes usar.
 *
 * Los tramos que exigen una membresia que no tienes se excluyen: prometer un
 * precio que en caja no se consigue es peor que no comparar.
 */
export function cantidadesCandidatas(
  oferta: Oferta,
  perfil: PerfilCompra,
  opts: { referencia: number; maximo?: number },
): number[] {
  const esSocio = perfil.membresias.some((m) => m.tienda === oferta.tienda && m.usarPrecioSocio);
  const deTramos = oferta.escalas
    .filter((e) => !e.requiereMembresia || esSocio)
    .map((e) => e.minUnidades);

  const todas = [opts.referencia, ...deTramos]
    .filter((c) => Number.isInteger(c) && c >= 1 && (opts.maximo === undefined || c <= opts.maximo));

  return [...new Set(todas)].sort((a, b) => a - b);
}

export function mejorOferta(
  oferta: Oferta,
  perfil: PerfilCompra,
  ctx: Contexto,
  opts: { referencia?: number; maximo?: number } = {},
): Optimo {
  const referencia = opts.referencia ?? 1;
  const candidatas = cantidadesCandidatas(oferta, perfil, { referencia, maximo: opts.maximo });

  const desgloseReferencia = precioEfectivo(oferta, referencia, perfil, ctx);
  const evaluadas = candidatas.map((c) => precioEfectivo(oferta, c, perfil, ctx));

  // Ante igual precio gana la cantidad menor: no tiene sentido inmovilizar
  // plata ni espacio sin ganar nada a cambio.
  const mejor = evaluadas.reduce((a, b) => (costo(b) < costo(a) ? b : a), desgloseReferencia);

  const base = costo(desgloseReferencia);
  return {
    oferta,
    desglose: mejor,
    cantidad: mejor.cantidad,
    referencia: desgloseReferencia,
    ahorroPorcentaje: base > 0 ? Math.round(((base - costo(mejor)) / base) * 1000) / 10 : 0,
    exigeLlevarMas: mejor.cantidad > referencia,
  };
}

export interface ComparacionOptima {
  ranking: Optimo[];
  criterio: 'unidad-medida' | 'unitario';
  advertencias: string[];
}

/**
 * Ordena tiendas por el mejor precio que cada una permite alcanzar.
 *
 * No por lo que cuesta una unidad: una tienda puede ser mas cara al detalle y
 * la mas barata llevando volumen, que es exactamente el caso de un mayorista.
 */
export function compararOptimo(
  ofertas: Oferta[],
  perfil: PerfilCompra,
  ctx: Contexto,
  opts: { referencia?: number; maximo?: number } = {},
): ComparacionOptima {
  const optimos = ofertas.map((o) => mejorOferta(o, perfil, ctx, opts));
  const advertencias: string[] = [];

  const bases = new Set(optimos.map((o) => o.desglose.porUnidadMedida?.base));
  const todasNormalizadas = !bases.has(undefined) && bases.size === 1;

  if (!todasNormalizadas) {
    const sinFormato = optimos.filter((o) => !o.desglose.porUnidadMedida).map((o) => o.oferta.nombre);
    if (sinFormato.length > 0) {
      advertencias.push(`sin formato deducible: ${sinFormato.join(' | ')}`);
    }
    if (bases.size > 1) {
      advertencias.push('los productos no comparten unidad de medida: revisa que sean equivalentes');
    }
  }

  return {
    ranking: [...optimos].sort((a, b) => costo(a.desglose) - costo(b.desglose)),
    criterio: todasNormalizadas ? 'unidad-medida' : 'unitario',
    advertencias,
  };
}
