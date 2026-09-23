import type { CLP, Oferta } from '../tipos.js';
import type { ProductoCanonico } from '../canonico/tipos.js';
import type { Contexto } from '../precios/efectivo.js';
import { compararOptimo, type Optimo } from '../precios/optimo.js';
import type { PerfilCompra } from '../precios/reglas.js';

/**
 * Evaluacion de la canasta habitual.
 *
 * El caso real no es "cual es el arroz mas barato" sino "mi arroz de siempre,
 * donde y en que cantidad conviene comprarlo hoy". Los productos son fijos y
 * las marcas tambien; lo que cambia son las ofertas.
 *
 * Cada linea se resuelve al mejor precio alcanzable, con la cantidad que ese
 * precio exige: quien compra por volumen con cuotas sin interes decide cuanto
 * llevar en funcion del precio, no antes de mirarlo.
 *
 * Y lo mas valioso no es el ranking de cada producto sino detectar lo que
 * cambio de tienda respecto de la ultima vez: esa es la oferta eventual que de
 * otro modo se pasa por alto.
 */

export interface LineaCanasta {
  producto: ProductoCanonico;
  /** Cantidad de referencia con la que se contrasta el optimo. */
  cantidad: number;
  ranking: Optimo[];
  ganador?: Optimo;
  /** Cuanto se ahorra comprando en la ganadora en vez de la segunda. */
  ahorroVsSegunda: CLP;
  /** Donde convenia la vez anterior, si hay historial. */
  tiendaPrevia?: string;
  /** La ganadora cambio respecto de la vez anterior: eso es lo que hay que mirar. */
  cambioDeTienda: boolean;
  /** Ninguna tienda entrego datos para este producto. */
  sinDatos: boolean;
  /**
   * Tiendas mapeadas que no aparecieron en el resultado, y tiendas soportadas
   * que ni siquiera estan mapeadas. Sin esto, un producto con una sola tienda
   * se ve igual que una comparacion real.
   */
  tiendasSinDatos: string[];
  tiendasSinMapear: string[];
}

export interface ResumenCanasta {
  lineas: LineaCanasta[];
  /** Comprando cada producto donde convenga. */
  totalOptimo: CLP;
  /** Comprando todo en una sola tienda, y cuantos productos cubre esa tienda. */
  totalPorTienda: Array<{ tienda: string; total: CLP; cubre: number }>;
  /** Diferencia entre la mejor tienda unica y la compra repartida. */
  ahorroRepartiendo: CLP;
  cambios: LineaCanasta[];
}

export interface EntradaCanasta {
  producto: ProductoCanonico;
  ofertas: Oferta[];
  /** Tiendas que la app soporta, para detectar las que faltan por mapear. */
  tiendasSoportadas?: string[];
}

export interface OpcionesCanasta {
  /** Tope de unidades por producto, cuando no quieres llevarte la bodega. */
  maximo?: number;
}

/**
 * En que tienda convenia cada producto la vez anterior.
 *
 * Se deriva del historial de precios, que es la fuente: aqui solo entra el
 * dato ya resuelto para no duplicar la logica de lectura.
 */
export type Historial = Record<string, string>;

export function evaluarCanasta(
  entradas: EntradaCanasta[],
  perfil: PerfilCompra,
  ctx: Contexto,
  previo: Historial = {},
  opciones: OpcionesCanasta = {},
): ResumenCanasta {
  const lineas: LineaCanasta[] = [];

  for (const { producto, ofertas, tiendasSoportadas = [] } of entradas) {
    const cantidad = producto.cantidadHabitual ?? 1;
    const mapeadas = producto.equivalencias.map((e) => e.tienda);
    const conDatos = new Set(ofertas.map((o) => o.tienda));
    const tiendasSinDatos = mapeadas.filter((t) => !conDatos.has(t));
    const tiendasSinMapear = tiendasSoportadas.filter((t) => !mapeadas.includes(t));
    const disponibles = ofertas.filter((o) => o.disponible);
    const universo = disponibles.length > 0 ? disponibles : ofertas;

    if (universo.length === 0) {
      lineas.push({
        producto,
        cantidad,
        ranking: [],
        ahorroVsSegunda: 0,
        tiendaPrevia: previo[producto.id],
        cambioDeTienda: false,
        sinDatos: true,
        tiendasSinDatos,
        tiendasSinMapear,
      });
      continue;
    }

    const { ranking } = compararOptimo(
      universo,
      perfil,
      { ...ctx, consumoMensual: producto.consumoMensual },
      { referencia: cantidad, maximo: opciones.maximo },
    );
    const ganador = ranking[0];
    const segunda = ranking[1];
    const tiendaPrevia = previo[producto.id];

    lineas.push({
      producto,
      cantidad,
      ranking,
      ganador,
      ahorroVsSegunda: segunda && ganador ? segunda.desglose.totalEfectivo - ganador.desglose.totalEfectivo : 0,
      tiendaPrevia,
      // Solo es cambio si antes habia un ganador distinto: la primera vez no.
      cambioDeTienda: Boolean(ganador && tiendaPrevia && tiendaPrevia !== ganador.oferta.tienda),
      sinDatos: false,
      tiendasSinDatos,
      tiendasSinMapear,
    });
  }

  const totalOptimo = lineas.reduce((suma, l) => suma + (l.ganador?.desglose.totalEfectivo ?? 0), 0);

  // Que costaria hacer toda la compra en una sola tienda. Se informa cuantos
  // productos cubre cada una, porque un total bajo con poca cobertura engania.
  const tiendas = new Set(lineas.flatMap((l) => l.ranking.map((o) => o.oferta.tienda)));
  const totalPorTienda = [...tiendas]
    .map((tienda) => {
      let total = 0;
      let cubre = 0;
      for (const l of lineas) {
        const o = l.ranking.find((r) => r.oferta.tienda === tienda);
        if (!o) continue;
        total += o.desglose.totalEfectivo;
        cubre++;
      }
      return { tienda, total, cubre };
    })
    .sort((a, b) => b.cubre - a.cubre || a.total - b.total);

  // Solo se compara contra tiendas que cubren la canasta entera: si una cubre
  // la mitad, su total mas bajo no significa nada.
  const completas = totalPorTienda.filter((t) => t.cubre === lineas.filter((l) => !l.sinDatos).length);
  const mejorUnica = completas.length > 0 ? Math.min(...completas.map((t) => t.total)) : 0;

  return {
    lineas,
    totalOptimo,
    totalPorTienda,
    ahorroRepartiendo: mejorUnica > 0 ? mejorUnica - totalOptimo : 0,
    cambios: lineas.filter((l) => l.cambioDeTienda),
  };
}
