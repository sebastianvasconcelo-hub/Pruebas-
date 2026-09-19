import type { Oferta } from '../tipos.js';

export type Motor = 'vtex' | 'nextdata' | 'jsonld' | 'desconocido';

export interface TiendaConfig {
  id: string;
  nombre: string;
  host: string;
  motor: Motor;
  /** Canal de ventas VTEX. Los precios cambian por tienda/comuna. */
  salesChannel?: string;
  /** Ruta de busqueda del sitio, con {q} donde va el termino. Verificada a mano. */
  busqueda?: string;
  /** false = todavia no implementado; la CLI lo salta con un aviso. */
  soportado: boolean;
  notas?: string;
}

export interface OpcionesBusqueda {
  limite?: number;
  salesChannel?: string;
  /** Firma del request, por cortesia y para poder ser bloqueado limpiamente. */
  userAgent?: string;
  timeoutMs?: number;
}

export interface Adapter {
  cfg: TiendaConfig;
  buscar(query: string, opts?: OpcionesBusqueda): Promise<Oferta[]>;
  /** Mapeo puro de la respuesta cruda a ofertas. Testeable sin red. */
  mapear(crudo: unknown): Oferta[];
}
