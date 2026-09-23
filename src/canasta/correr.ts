import { TIENDAS } from '../adapters/index.js';
import { ofertasDe } from '../canonico/catalogo.js';
import { traerOfertas } from '../canonico/traer.js';
import type { Catalogo, Equivalencia } from '../canonico/tipos.js';
import type { Descartes } from '../diagnostico.js';
import { PERFIL_POR_DEFECTO, type PerfilCompra } from '../precios/reglas.js';
import type { Oferta } from '../tipos.js';
import { evaluarCanasta, type EntradaCanasta, type ResumenCanasta } from './evaluar.js';
import {
  anotar,
  compararRegistros,
  fechaISO,
  minimoHistorico,
  registroAnterior,
  registroDesde,
  tiendaAnterior,
  type CambioPrecio,
  type HistorialPrecios,
  type MinimoHistorico,
} from './historial.js';

/**
 * Una corrida completa de la canasta: traer precios, evaluar y comparar con el
 * historial.
 *
 * Es el calculo que comparten la terminal y la PWA. Vive aparte de ambas para
 * que no haya dos versiones de la logica que puedan desalinearse: la PWA solo
 * muestra lo que esta corrida ya resolvio.
 */

export interface CambioPrecioProducto {
  productoId: string;
  producto: string;
  cambio: CambioPrecio;
  minimo?: MinimoHistorico;
}

export interface ResultadoCorrida {
  fecha: Date;
  resumen: ResumenCanasta;
  entradas: EntradaCanasta[];
  cambiosPrecio: CambioPrecioProducto[];
  /** Historial con los registros de hoy ya anotados, listo para guardar. */
  historial: HistorialPrecios;
  /** Habia registros previos: sin ellos no hay cambios que reportar. */
  habiaHistorial: boolean;
  /** Tiendas que fallaron al consultar, por producto. */
  errores: string[];
}

export interface OpcionesCorrida {
  catalogo: Catalogo;
  historial: HistorialPrecios;
  fecha: Date;
  maximo?: number;
  perfil?: PerfilCompra;
  descartes?: Descartes;
  /** Inyectable para poder probar la corrida entera sin red. */
  traer?: (eq: Equivalencia, descartes?: Descartes) => Promise<Oferta[]>;
}

/**
 * Compara cada oferta de hoy contra el ultimo registro de su tienda y anota
 * el de hoy. Funcion pura: recibe el historial y devuelve uno nuevo.
 */
export function calcularCambiosPrecio(
  resumen: ResumenCanasta,
  historial: HistorialPrecios,
  fecha: Date,
): { cambios: CambioPrecioProducto[]; historial: HistorialPrecios } {
  const hoy = fechaISO(fecha);
  const cambios: CambioPrecioProducto[] = [];
  let actualizado = historial;

  for (const linea of resumen.lineas) {
    for (const optimo of linea.ranking) {
      const registro = registroDesde(optimo, fecha);
      const anterior = registroAnterior(historial, linea.producto.id, registro.tienda, hoy);

      if (anterior) {
        const cambio = compararRegistros(anterior, registro);
        const hayTramosDistintos = cambio.tramosNuevos.length > 0 || cambio.tramosIdos.length > 0;
        if (cambio.direccion !== 'igual' || hayTramosDistintos) {
          cambios.push({
            productoId: linea.producto.id,
            producto: linea.producto.nombre,
            cambio,
            minimo: minimoHistorico(historial, linea.producto.id, registro.tienda, hoy),
          });
        }
      }
      actualizado = anotar(actualizado, linea.producto.id, registro);
    }
  }

  return { cambios, historial: actualizado };
}

export async function correrCanasta(opciones: OpcionesCorrida): Promise<ResultadoCorrida> {
  const { catalogo, historial, fecha, maximo, descartes } = opciones;
  const perfil = opciones.perfil ?? PERFIL_POR_DEFECTO;
  const traer = opciones.traer ?? traerOfertas;
  const hoy = fechaISO(fecha);
  const soportadas = TIENDAS.filter((t) => t.soportado && t.busqueda).map((t) => t.id);

  // La tienda que convenia la ultima vez sale del propio historial de precios.
  const previo: Record<string, string> = {};
  for (const producto of catalogo.productos) {
    const anterior = tiendaAnterior(historial, producto.id, hoy);
    if (anterior) previo[producto.id] = anterior;
  }

  const entradas: EntradaCanasta[] = [];
  const errores: string[] = [];

  for (const producto of catalogo.productos) {
    const resultados = await Promise.allSettled(
      producto.equivalencias.map((eq) => traer(eq, descartes)),
    );
    const encontradas: Oferta[] = [];
    for (const [i, r] of resultados.entries()) {
      if (r.status === 'fulfilled') encontradas.push(...r.value);
      else {
        const tienda = producto.equivalencias[i]?.tienda ?? '?';
        errores.push(`${producto.nombre} (${tienda}): ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      }
    }
    entradas.push({
      producto,
      ofertas: ofertasDe(producto, encontradas, descartes),
      tiendasSoportadas: soportadas,
    });
  }

  const resumen = evaluarCanasta(entradas, perfil, { fecha }, previo, { maximo });
  const { cambios, historial: actualizado } = calcularCambiosPrecio(resumen, historial, fecha);

  return {
    fecha,
    resumen,
    entradas,
    cambiosPrecio: cambios,
    historial: actualizado,
    habiaHistorial: Object.keys(historial.registros).length > 0,
    errores,
  };
}
