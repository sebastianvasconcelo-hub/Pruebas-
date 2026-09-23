import type { Optimo } from '../precios/optimo.js';
import type { Base, CLP } from '../tipos.js';

/**
 * Historial de precios por producto canonico y tienda.
 *
 * Se guarda contra el id canonico, que es nuestro y estable, y no contra la
 * url o el sku de la tienda, que cambian. Asi una direccion reescrita no rompe
 * la serie: afecta a encontrar el producto hoy, no a compararlo con el de ayer.
 *
 * Cada registro anota ademas con que identidad se tomo el precio. Eso permite
 * distinguir dos cosas que se ven igual en los numeros y significan lo
 * contrario: que el precio bajo, o que estamos mirando otro producto.
 */

export interface TramoRegistrado {
  min: number;
  precio: CLP;
}

export interface RegistroPrecio {
  /** YYYY-MM-DD. Un registro por producto, tienda y dia. */
  fecha: string;
  tienda: string;
  /** Mejor precio unitario alcanzable ese dia. */
  unitario: CLP;
  /** El mismo, por unidad de medida, cuando se pudo normalizar. */
  porMedida?: CLP;
  base?: Base;
  /** Cantidad que exigia ese precio. */
  cantidad: number;
  /** Precio de lista, para saber si la baja viene del precio base o de una promo. */
  lista: CLP;
  /** Identidad de la oferta con la que se registro. */
  sku: string;
  tramos: TramoRegistrado[];
}

export interface HistorialPrecios {
  version: 2;
  /** producto canonico -> registros, del mas viejo al mas nuevo. */
  registros: Record<string, RegistroPrecio[]>;
}

export const HISTORIAL_VACIO: HistorialPrecios = { version: 2, registros: {} };

/**
 * Lee el historial guardado, tolerando el formato anterior.
 *
 * La version 1 solo guardaba la tienda ganadora, sin precios, asi que no hay
 * serie que migrar: se empieza de cero en vez de inventar registros.
 */
export function leerHistorial(datos: unknown): HistorialPrecios {
  if (!datos || typeof datos !== 'object') return { ...HISTORIAL_VACIO, registros: {} };
  const d = datos as Partial<HistorialPrecios>;
  if (d.version !== 2 || !d.registros || typeof d.registros !== 'object') {
    return { ...HISTORIAL_VACIO, registros: {} };
  }
  return { version: 2, registros: d.registros };
}

/**
 * Agrega un registro, reemplazando el del mismo dia y tienda.
 *
 * Correr la canasta dos veces el mismo dia no debe inflar la serie ni pesar el
 * doble al mirar la historia.
 */
export function anotar(
  historial: HistorialPrecios,
  productoId: string,
  registro: RegistroPrecio,
  maxPorProducto = 120,
): HistorialPrecios {
  const previos = historial.registros[productoId] ?? [];
  const sinEseDia = previos.filter(
    (r) => !(r.fecha === registro.fecha && r.tienda === registro.tienda),
  );
  const actualizados = [...sinEseDia, registro]
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.tienda.localeCompare(b.tienda)))
    .slice(-maxPorProducto);

  return { ...historial, registros: { ...historial.registros, [productoId]: actualizados } };
}

/** El registro anterior de esa tienda, sin contar el de hoy. */
export function registroAnterior(
  historial: HistorialPrecios,
  productoId: string,
  tienda: string,
  fechaHoy: string,
): RegistroPrecio | undefined {
  return (historial.registros[productoId] ?? [])
    .filter((r) => r.tienda === tienda && r.fecha < fechaHoy)
    .at(-1);
}

/** Costo comparable de un registro: por medida si existe, si no unitario. */
function costo(r: RegistroPrecio): CLP {
  return r.porMedida ?? r.unitario;
}

export interface CambioPrecio {
  tienda: string;
  direccion: 'baja' | 'alza' | 'igual';
  porcentaje: number;
  anterior: RegistroPrecio;
  actual: RegistroPrecio;
  /**
   * El producto de referencia cambio de identidad entre ambos registros. La
   * variacion puede no ser un cambio de precio sino otro articulo, asi que no
   * debe anunciarse como oferta sin revisar.
   */
  identidadCambio: boolean;
  tramosNuevos: TramoRegistrado[];
  tramosIdos: TramoRegistrado[];
}

/** Compara dos registros y describe que cambio entre ellos. */
export function compararRegistros(anterior: RegistroPrecio, actual: RegistroPrecio): CambioPrecio {
  const antes = costo(anterior);
  const ahora = costo(actual);
  const porcentaje = antes > 0 ? Math.round(((ahora - antes) / antes) * 1000) / 10 : 0;

  const clave = (t: TramoRegistrado) => `${t.min}:${t.precio}`;
  const antesTramos = new Set(anterior.tramos.map(clave));
  const ahoraTramos = new Set(actual.tramos.map(clave));

  return {
    tienda: actual.tienda,
    direccion: ahora < antes ? 'baja' : ahora > antes ? 'alza' : 'igual',
    porcentaje: Math.abs(porcentaje),
    anterior,
    actual,
    identidadCambio: anterior.sku !== actual.sku,
    tramosNuevos: actual.tramos.filter((t) => !antesTramos.has(clave(t))),
    tramosIdos: anterior.tramos.filter((t) => !ahoraTramos.has(clave(t))),
  };
}

export interface MinimoHistorico {
  valor: CLP;
  fecha: string;
  registros: number;
}

/** El precio mas bajo visto para ese producto y tienda, antes de hoy. */
export function minimoHistorico(
  historial: HistorialPrecios,
  productoId: string,
  tienda: string,
  fechaHoy: string,
): MinimoHistorico | undefined {
  const previos = (historial.registros[productoId] ?? []).filter(
    (r) => r.tienda === tienda && r.fecha < fechaHoy,
  );
  if (previos.length === 0) return undefined;

  const mejor = previos.reduce((a, b) => (costo(b) < costo(a) ? b : a));
  return { valor: costo(mejor), fecha: mejor.fecha, registros: previos.length };
}

/** La tienda que convenia en el ultimo dia con datos, para detectar el cambio. */
export function tiendaAnterior(
  historial: HistorialPrecios,
  productoId: string,
  fechaHoy: string,
): string | undefined {
  const previos = (historial.registros[productoId] ?? []).filter((r) => r.fecha < fechaHoy);
  if (previos.length === 0) return undefined;

  const ultimaFecha = previos.at(-1)!.fecha;
  const deEseDia = previos.filter((r) => r.fecha === ultimaFecha);
  return deEseDia.reduce((a, b) => (costo(b) < costo(a) ? b : a)).tienda;
}

/** Fecha local en YYYY-MM-DD. En UTC el dia se corre y la serie se desordena. */
export function fechaISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Registro del dia a partir del optimo calculado para una tienda.
 *
 * Guarda el precio alcanzable y la cantidad que lo exige, no el de una unidad:
 * es el numero con el que se decide, y por tanto el que hay que poder comparar
 * con el de la semana pasada.
 */
export function registroDesde(optimo: Optimo, fecha: Date): RegistroPrecio {
  const d = optimo.desglose;
  return {
    fecha: fechaISO(fecha),
    tienda: optimo.oferta.tienda,
    unitario: d.unitarioEfectivo,
    ...(d.porUnidadMedida ? { porMedida: d.porUnidadMedida.valor, base: d.porUnidadMedida.base } : {}),
    cantidad: optimo.cantidad,
    lista: optimo.oferta.precioLista,
    sku: optimo.oferta.sku,
    tramos: optimo.oferta.escalas.map((e) => ({ min: e.minUnidades, precio: e.precioUnitario })),
  };
}
