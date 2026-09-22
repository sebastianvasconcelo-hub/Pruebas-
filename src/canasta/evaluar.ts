import type { CLP, Oferta } from '../tipos.js';
import type { ProductoCanonico } from '../canonico/tipos.js';
import { comparar, type Contexto, type Desglose } from '../precios/efectivo.js';
import type { PerfilCompra } from '../precios/reglas.js';

/**
 * Evaluacion de la canasta habitual.
 *
 * El caso real no es "cual es el arroz mas barato" sino "mi arroz de siempre,
 * donde conviene comprarlo hoy". Los productos son fijos y las marcas tambien;
 * lo que cambia son las ofertas. Por eso lo valioso no es el ranking de cada
 * producto, sino detectar cuando algo cambio de tienda respecto de la ultima
 * vez: esa es la oferta eventual que de otro modo se pasa por alto.
 */

export interface LineaCanasta {
  producto: ProductoCanonico;
  cantidad: number;
  ranking: Desglose[];
  ganador?: Desglose;
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

/** Historial: en que tienda convenia cada producto la vez anterior. */
export type Historial = Record<string, string>;

export function evaluarCanasta(
  entradas: EntradaCanasta[],
  perfil: PerfilCompra,
  ctx: Contexto,
  previo: Historial = {},
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

    const { ranking } = comparar(universo, cantidad, perfil, {
      ...ctx,
      consumoMensual: producto.consumoMensual,
    });
    const ganador = ranking[0];
    const segunda = ranking[1];
    const tiendaPrevia = previo[producto.id];

    lineas.push({
      producto,
      cantidad,
      ranking,
      ganador,
      ahorroVsSegunda: segunda && ganador ? segunda.totalEfectivo - ganador.totalEfectivo : 0,
      tiendaPrevia,
      // Solo es cambio si antes habia un ganador distinto: la primera vez no.
      cambioDeTienda: Boolean(ganador && tiendaPrevia && tiendaPrevia !== ganador.tienda),
      sinDatos: false,
      tiendasSinDatos,
      tiendasSinMapear,
    });
  }

  const totalOptimo = lineas.reduce((suma, l) => suma + (l.ganador?.totalEfectivo ?? 0), 0);

  // Que costaria hacer toda la compra en una sola tienda. Se informa cuantos
  // productos cubre cada una, porque un total bajo con poca cobertura engania.
  const tiendas = new Set(lineas.flatMap((l) => l.ranking.map((d) => d.tienda)));
  const totalPorTienda = [...tiendas]
    .map((tienda) => {
      let total = 0;
      let cubre = 0;
      for (const l of lineas) {
        const d = l.ranking.find((r) => r.tienda === tienda);
        if (!d) continue;
        total += d.totalEfectivo;
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

/** Donde conviene cada producto ahora, para guardar como historial. */
export function historialDe(resumen: ResumenCanasta): Historial {
  const h: Historial = {};
  for (const l of resumen.lineas) if (l.ganador) h[l.producto.id] = l.ganador.tienda;
  return h;
}
