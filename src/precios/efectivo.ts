import type { Base, CLP, Oferta } from '../tipos.js';
import { parsearContenido } from '../normalizar/unidad.js';
import { escalaAplicable } from '../normalizar/promo.js';
import type { PerfilCompra } from './reglas.js';

export type OrigenPrecio = 'lista' | 'socio' | 'escala';

export interface Desglose {
  tienda: string;
  sku: string;
  nombre: string;
  url?: string;
  cantidad: number;
  /** Precio por unidad antes de cashback y costos, ya con membresia y escalas. */
  precioUnitarioBruto: CLP;
  origenPrecio: OrigenPrecio;
  subtotal: CLP;
  descuentoCashback: CLP;
  costoFinanciero: CLP;
  costoAlmacenamiento: CLP;
  /** Lo que realmente te cuesta llevarte `cantidad` unidades. */
  totalEfectivo: CLP;
  unitarioEfectivo: CLP;
  /** Comparable entre tiendas. null si el nombre no permitio deducir el formato. */
  porUnidadMedida: { valor: CLP; base: Base } | null;
  /** Cuantos meses de consumo cubre la compra, si declaraste consumo mensual. */
  mesesDeStock: number | null;
  notas: string[];
}

export interface Contexto {
  fecha: Date;
  /** Unidades que consumes al mes de este producto. Habilita el costo de bodega. */
  consumoMensual?: number;
}

function redondear(n: CLP): CLP {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula lo que de verdad te cuesta una oferta, no lo que dice la etiqueta.
 *
 * El orden importa: membresia y escalas definen el precio de lista efectivo,
 * el cashback se calcula sobre ese subtotal (es un reembolso de la tarjeta,
 * no un descuento en caja), y recien despues se suman los costos de financiar
 * y de almacenar.
 */
export function precioEfectivo(
  oferta: Oferta,
  cantidad: number,
  perfil: PerfilCompra,
  ctx: Contexto,
): Desglose {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new Error(`cantidad debe ser un entero >= 1, recibido: ${cantidad}`);
  }
  const notas: string[] = [];

  // 1. Precio base segun membresia.
  const membresia = perfil.membresias.find((m) => m.tienda === oferta.tienda);
  let unitario = oferta.precioLista;
  let origen: OrigenPrecio = 'lista';
  if (membresia?.usarPrecioSocio && oferta.precioSocio !== undefined && oferta.precioSocio < unitario) {
    unitario = oferta.precioSocio;
    origen = 'socio';
    notas.push(`precio socio/membresia en ${oferta.tienda}`);
  }
  if (membresia?.descuentoAdicional) {
    unitario *= 1 - membresia.descuentoAdicional;
    notas.push(`descuento adicional de membresia ${(membresia.descuentoAdicional * 100).toFixed(1)}%`);
  }

  // 2. Escalas por cantidad: solo si mejoran el precio ya obtenido.
  const escala = escalaAplicable(oferta.escalas, cantidad);
  if (escala && escala.precioUnitario < unitario) {
    unitario = escala.precioUnitario;
    origen = 'escala';
    notas.push(`escala desde ${escala.minUnidades} un: ${escala.origen ?? 'sin texto'}`);
  }

  const subtotal = unitario * cantidad;

  // 3. Cashback: reembolso de la tarjeta, depende del dia de la compra.
  const dia = ctx.fecha.getDay();
  let descuentoCashback = 0;
  for (const regla of perfil.cashback) {
    const aplicaTienda = regla.tiendas === '*' || regla.tiendas.includes(oferta.tienda);
    if (!aplicaTienda || !regla.diasSemana.includes(dia)) continue;
    const bruto = subtotal * regla.porcentaje;
    const aplicado = regla.topePorCompra ? Math.min(bruto, regla.topePorCompra) : bruto;
    descuentoCashback += aplicado;
    notas.push(`${regla.etiqueta}: -$${Math.round(aplicado).toLocaleString('es-CL')}`);
  }

  // 4. Costo de financiar. Cuotas sin interes -> cero, que es tu caso habitual.
  const costoFinanciero = perfil.cuotasSinInteres
    ? 0
    : subtotal * perfil.tasaMensual * perfil.cuotas;
  if (costoFinanciero > 0) notas.push(`${perfil.cuotas} cuotas con interes`);

  // 5. Costo de tener la bodega ocupada. En promedio cada unidad pasa guardada
  //    la mitad del tiempo que dura el stock, de ahi el /2.
  let costoAlmacenamiento = 0;
  let mesesDeStock: number | null = null;
  if (ctx.consumoMensual && ctx.consumoMensual > 0) {
    mesesDeStock = cantidad / ctx.consumoMensual;
    costoAlmacenamiento =
      perfil.costoBodegaMensualPorUnidad * cantidad * (mesesDeStock / 2);
    if (costoAlmacenamiento > 0) {
      notas.push(`${mesesDeStock.toFixed(1)} meses de stock`);
    }
  }

  const totalEfectivo = subtotal - descuentoCashback + costoFinanciero + costoAlmacenamiento;
  const unitarioEfectivo = totalEfectivo / cantidad;

  // 6. Normalizacion a $/kg o $/L: sin esto la comparacion entre cadenas miente.
  //    El formato declarado por la tienda manda; deducirlo del nombre es el plan B.
  const contenido = oferta.contenido ?? parsearContenido(oferta.nombre);
  let porUnidadMedida: Desglose['porUnidadMedida'] = null;
  if (contenido && contenido.cantidad > 0) {
    porUnidadMedida = {
      valor: redondear(unitarioEfectivo / contenido.cantidad),
      base: contenido.base,
    };
  } else {
    notas.push('no se pudo deducir el formato desde el nombre: se compara por unidad');
  }

  return {
    tienda: oferta.tienda,
    sku: oferta.sku,
    nombre: oferta.nombre,
    url: oferta.url,
    cantidad,
    precioUnitarioBruto: redondear(unitario),
    origenPrecio: origen,
    subtotal: redondear(subtotal),
    descuentoCashback: redondear(descuentoCashback),
    costoFinanciero: redondear(costoFinanciero),
    costoAlmacenamiento: redondear(costoAlmacenamiento),
    totalEfectivo: redondear(totalEfectivo),
    unitarioEfectivo: redondear(unitarioEfectivo),
    porUnidadMedida,
    mesesDeStock,
    notas,
  };
}

/**
 * Ordena ofertas de distintas tiendas de mas barata a mas cara.
 *
 * Compara por $/kg o $/L cuando todas comparten la misma base; si alguna no se
 * pudo normalizar cae a precio unitario efectivo y lo deja dicho, porque
 * mezclar ambas escalas produciria un ranking sin sentido.
 */
export function comparar(
  ofertas: Oferta[],
  cantidad: number,
  perfil: PerfilCompra,
  ctx: Contexto,
): { ranking: Desglose[]; criterio: 'unidad-medida' | 'unitario'; advertencias: string[] } {
  const desgloses = ofertas.map((o) => precioEfectivo(o, cantidad, perfil, ctx));
  const advertencias: string[] = [];

  const bases = new Set(desgloses.map((d) => d.porUnidadMedida?.base));
  const todasNormalizadas = !bases.has(undefined) && bases.size === 1;

  if (!todasNormalizadas) {
    const sinFormato = desgloses.filter((d) => !d.porUnidadMedida).map((d) => d.nombre);
    if (sinFormato.length > 0) {
      advertencias.push(`sin formato deducible: ${sinFormato.join(' | ')}`);
    }
    if (bases.size > 1) {
      advertencias.push('los productos no comparten unidad de medida: revisa que sean equivalentes');
    }
  }

  const criterio = todasNormalizadas ? 'unidad-medida' : 'unitario';
  const ranking = [...desgloses].sort((a, b) =>
    criterio === 'unidad-medida'
      ? a.porUnidadMedida!.valor - b.porUnidadMedida!.valor
      : a.unitarioEfectivo - b.unitarioEfectivo,
  );

  return { ranking, criterio, advertencias };
}

/**
 * Responde tu pregunta real: comprar poco y seguido, o llenar la bodega.
 *
 * Evalua la misma oferta a distintas cantidades y devuelve la que minimiza el
 * costo por unidad de medida, ya descontado el cashback y sumado el costo de
 * tener el stock guardado.
 */
export function mejorCantidad(
  oferta: Oferta,
  cantidades: number[],
  perfil: PerfilCompra,
  ctx: Contexto,
): { mejor: Desglose; evaluadas: Desglose[] } {
  if (cantidades.length === 0) throw new Error('hay que evaluar al menos una cantidad');
  const evaluadas = cantidades.map((c) => precioEfectivo(oferta, c, perfil, ctx));
  const costo = (d: Desglose) => d.porUnidadMedida?.valor ?? d.unitarioEfectivo;
  const mejor = evaluadas.reduce((a, b) => (costo(b) < costo(a) ? b : a));
  return { mejor, evaluadas };
}
