import { buscarEnSitio, leerFicha } from '../adapters/html.js';
import { tienda } from '../adapters/index.js';
import type { TiendaConfig } from '../adapters/tipos.js';
import type { Descartes } from '../diagnostico.js';
import type { Oferta } from '../tipos.js';
import type { Equivalencia } from './tipos.js';

/**
 * Obtencion de las ofertas de una equivalencia.
 *
 * La ficha de producto solo hace falta donde la busqueda se queda corta. En
 * Jumbo la busqueda publica un ItemList de schema.org con un unico precio, que
 * no distingue el precio Prime; en Alvi la busqueda ya trae precios,
 * priceSteps, formato y EAN, asi que pedir la ficha no agrega nada y ademas
 * falla, porque la ruta de ficha que declara su catalogo devuelve 404.
 */
export function necesitaFicha(cfg: TiendaConfig): boolean {
  return cfg.motor === 'jsonld';
}

export async function traerOfertas(eq: Equivalencia, descartes?: Descartes): Promise<Oferta[]> {
  const cfg = tienda(eq.tienda);
  if (!cfg) {
    descartes?.registrar(eq.tienda, eq.nombre, 'tienda desconocida en el registro');
    return [];
  }
  if (!cfg.soportado) {
    descartes?.registrar(eq.tienda, eq.nombre, `tienda no soportada: ${cfg.notas ?? 'sin adapter'}`);
    return [];
  }

  if (necesitaFicha(cfg) && eq.url) {
    try {
      const ofertas = await leerFicha(cfg, eq.url, { descartes });
      // La ficha puede no declarar su propia direccion, pero la acabamos de
      // pedir: sin enlace, la recomendacion no se puede seguir.
      if (ofertas.length > 0) return ofertas.map((o) => ({ ...o, url: o.url ?? eq.url }));
    } catch (e) {
      // La ficha puede mudarse de ruta; la busqueda sigue sirviendo.
      console.error(`  aviso: ficha de ${eq.tienda} fallo (${e instanceof Error ? e.message : e}), uso la busqueda`);
    }
  }

  if (!cfg.busqueda) {
    descartes?.registrar(eq.tienda, eq.nombre, 'sin ruta de busqueda verificada');
    return [];
  }
  return buscarEnSitio(cfg, eq.nombre, { descartes });
}
