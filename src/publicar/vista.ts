import { tienda as configTienda } from '../adapters/index.js';
import type { ResultadoCorrida } from '../canasta/correr.js';
import { esMinimoRelevante } from '../canasta/historial.js';
import type { Descartes } from '../diagnostico.js';
import { nombreDia } from '../normalizar/fecha.js';
import { escalasPendientes, informarEscalas } from '../precios/escalas.js';
import type { Optimo } from '../precios/optimo.js';
import type { PerfilCompra } from '../precios/reglas.js';
import type { Base, CLP } from '../tipos.js';

/**
 * Lo que la PWA recibe: la canasta ya resuelta.
 *
 * La PWA no calcula nada. Todo lo que muestra sale de aqui, que a su vez sale
 * del mismo codigo probado que usa la terminal. Si la PWA hiciera sus propias
 * cuentas habria dos versiones de la logica, y tarde o temprano dirian cosas
 * distintas.
 *
 * El formato es un contrato con el telefono: se versiona para que una PWA
 * cacheada con una version vieja no interprete mal un archivo nuevo.
 */

export const VERSION_DATOS = 1;

export interface OpcionPWA {
  tienda: string;
  tiendaNombre: string;
  /** Mejor precio por unidad de medida alcanzable, si se pudo normalizar. */
  porMedida?: CLP;
  base?: Base;
  unitario: CLP;
  /**
   * Precio por unidad que muestra el estante: con membresia y escalas, sin el
   * cashback. En el supermercado se ve este numero, no el efectivo, y sin
   * mostrarlo la app pareceria equivocarse.
   */
  gondola: CLP;
  /** Cashback de la tarjeta sobre toda la compra, 0 si ese dia no aplica. */
  cashback: CLP;
  /** Cantidad que exige ese precio. */
  cantidad: number;
  total: CLP;
  origen: 'lista' | 'socio' | 'escala';
  notas: string[];
  url?: string;
  /** Cuanto baja respecto de llevar la cantidad de referencia. */
  ahorroVsReferencia?: { porcentaje: number; cantidad: number };
}

export interface EscalaPWA {
  min: number;
  precio: CLP;
  porMedida?: CLP;
  base?: Base;
  ahorroPorcentaje: number;
  /** Se puede usar con las membresias que tienes. */
  usable: boolean;
}

export interface ProductoPWA {
  id: string;
  nombre: string;
  sinDatos: boolean;
  mejor?: OpcionPWA;
  /** Las otras tiendas, de mejor a peor. */
  alternativas: OpcionPWA[];
  escalasPendientes: EscalaPWA[];
  /** Tiendas que no entraron en la comparacion, por falta de mapeo o de datos. */
  faltan: string[];
  /** Convenia en otra tienda la ultima vez. */
  antesConvenia?: string;
}

export type TipoCambio = 'baja' | 'alza' | 'tramos' | 'tienda';

export interface CambioPWA {
  productoId: string;
  producto: string;
  tienda: string;
  tipo: TipoCambio;
  /** Frase lista para mostrar. */
  texto: string;
  /** La variacion coincide con otro producto de referencia: no es oferta segura. */
  verificar: boolean;
  /** Es el precio mas bajo registrado para ese producto y tienda. */
  minimoHistorico: boolean;
}

export interface DatosPWA {
  version: typeof VERSION_DATOS;
  /** Cuando se genero, en ISO. La PWA lo usa para avisar si los datos estan viejos. */
  generadoEn: string;
  /** Dia al que corresponden los precios y el cashback, YYYY-MM-DD. */
  fecha: string;
  dia: string;
  /** Cashback que aplica ese dia, para explicar por que un precio es mas bajo. */
  cashbackHoy: string[];
  productos: ProductoPWA[];
  cambios: CambioPWA[];
  totales: {
    optimo: CLP;
    porTienda: Array<{ tienda: string; tiendaNombre: string; total: CLP; cubre: number }>;
    ahorroRepartiendo: CLP;
    productosConDatos: number;
  };
  /** Lo que salio mal en la corrida. Se muestra, no se esconde. */
  problemas: string[];
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
/** Porcentaje en formato chileno: coma decimal. */
const pct = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });

function nombreTienda(id: string): string {
  return configTienda(id)?.nombre ?? id;
}

function opcion(o: Optimo): OpcionPWA {
  const d = o.desglose;
  return {
    tienda: o.oferta.tienda,
    tiendaNombre: nombreTienda(o.oferta.tienda),
    ...(d.porUnidadMedida ? { porMedida: d.porUnidadMedida.valor, base: d.porUnidadMedida.base } : {}),
    unitario: d.unitarioEfectivo,
    gondola: d.precioUnitarioBruto,
    cashback: d.descuentoCashback,
    cantidad: o.cantidad,
    total: d.totalEfectivo,
    origen: d.origenPrecio,
    notas: d.notas,
    ...(d.url ? { url: d.url } : {}),
    ...(o.exigeLlevarMas
      ? { ahorroVsReferencia: { porcentaje: o.ahorroPorcentaje, cantidad: o.referencia.cantidad } }
      : {}),
  };
}

/** Frase de un cambio de precio, en el mismo tono que la terminal. */
function describirCambio(c: ResultadoCorrida['cambiosPrecio'][number]): CambioPWA[] {
  const { cambio, minimo } = c;
  const unidad = cambio.actual.base ?? 'un';
  const antes = cambio.anterior.porMedida ?? cambio.anterior.unitario;
  const ahora = cambio.actual.porMedida ?? cambio.actual.unitario;
  const base = {
    productoId: c.productoId,
    producto: c.producto,
    tienda: cambio.tienda,
    verificar: cambio.identidadCambio,
    minimoHistorico: !cambio.identidadCambio && esMinimoRelevante(minimo, ahora),
  };

  const salida: CambioPWA[] = [];
  if (cambio.direccion !== 'igual') {
    const verbo = cambio.direccion === 'baja' ? 'Bajó' : 'Subió';
    salida.push({
      ...base,
      tipo: cambio.direccion,
      texto: `${verbo} ${pct(cambio.porcentaje)}%: ${clp(antes)}/${unidad} → ${clp(ahora)}/${unidad}`,
    });
  }
  for (const t of cambio.tramosNuevos) {
    salida.push({ ...base, tipo: 'tramos', texto: `Tramo nuevo: desde ${t.min} un a ${clp(t.precio)} c/u` });
  }
  for (const t of cambio.tramosIdos) {
    salida.push({ ...base, tipo: 'tramos', texto: `Ya no está: desde ${t.min} un a ${clp(t.precio)} c/u` });
  }
  return salida;
}

export function construirDatos(
  corrida: ResultadoCorrida,
  perfil: PerfilCompra,
  opciones: { generadoEn?: Date; descartes?: Descartes } = {},
): DatosPWA {
  const { resumen, entradas, fecha } = corrida;
  const dia = fecha.getDay();

  const productos: ProductoPWA[] = resumen.lineas.map((l) => {
    const faltan = [...l.tiendasSinMapear, ...l.tiendasSinDatos].map(nombreTienda);
    if (l.sinDatos || !l.ganador) {
      return { id: l.producto.id, nombre: l.producto.nombre, sinDatos: true, alternativas: [], escalasPendientes: [], faltan };
    }

    const g = l.ganador;
    const ofertaGanadora = entradas
      .find((e) => e.producto.id === l.producto.id)
      ?.ofertas.find((o) => o.tienda === g.oferta.tienda);

    const escalas: EscalaPWA[] = ofertaGanadora
      ? escalasPendientes(informarEscalas(ofertaGanadora, g.cantidad, g.desglose.precioUnitarioBruto, perfil)).map(
          (e) => ({
            min: e.minUnidades,
            precio: e.precioUnitario,
            ...(e.porUnidadMedida ? { porMedida: e.porUnidadMedida.valor, base: e.porUnidadMedida.base } : {}),
            ahorroPorcentaje: e.ahorroPorcentaje,
            usable: e.usable,
          }),
        )
      : [];

    return {
      id: l.producto.id,
      nombre: l.producto.nombre,
      sinDatos: false,
      mejor: opcion(g),
      alternativas: l.ranking.slice(1).map(opcion),
      escalasPendientes: escalas,
      faltan,
      ...(l.cambioDeTienda && l.tiendaPrevia ? { antesConvenia: nombreTienda(l.tiendaPrevia) } : {}),
    };
  });

  // Los cambios de tienda van primero: son los que piden una decision.
  const cambios: CambioPWA[] = [
    ...resumen.cambios.map((l) => ({
      productoId: l.producto.id,
      producto: l.producto.nombre,
      tienda: l.ganador!.oferta.tienda,
      tipo: 'tienda' as const,
      texto: `Ahora conviene ${nombreTienda(l.ganador!.oferta.tienda)} (antes ${nombreTienda(l.tiendaPrevia ?? '?')})`,
      verificar: false,
      minimoHistorico: false,
    })),
    ...corrida.cambiosPrecio.flatMap(describirCambio),
  ];

  const problemas = [
    ...corrida.errores,
    ...(opciones.descartes?.resumen().map((d) => `${d.donde}: ${d.porque} (${d.veces}x, ej: ${d.ejemplo})`) ?? []),
  ];

  return {
    version: VERSION_DATOS,
    generadoEn: (opciones.generadoEn ?? new Date()).toISOString(),
    fecha: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`,
    dia: nombreDia(fecha),
    cashbackHoy: perfil.cashback.filter((c) => c.diasSemana.includes(dia)).map((c) => c.etiqueta),
    productos,
    cambios,
    totales: {
      optimo: resumen.totalOptimo,
      porTienda: resumen.totalPorTienda.map((t) => ({ ...t, tiendaNombre: nombreTienda(t.tienda) })),
      ahorroRepartiendo: resumen.ahorroRepartiendo,
      productosConDatos: resumen.lineas.filter((l) => !l.sinDatos).length,
    },
    problemas,
  };
}
