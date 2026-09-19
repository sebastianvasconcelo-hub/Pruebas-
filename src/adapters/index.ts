import type { Adapter, TiendaConfig } from './tipos.js';
import { crearAdapterVtex } from './vtex.js';

export const TIENDAS: TiendaConfig[] = [
  {
    id: 'jumbo',
    nombre: 'Jumbo',
    host: 'www.jumbo.cl',
    // App Router: el catalogo solo aparece como JSON-LD de schema.org.
    motor: 'jsonld',
    busqueda: '/busqueda?ft={q}',
    soportado: true,
    notas: 'Solo un precio por producto: schema.org no distingue Prime de precio normal.',
  },
  {
    id: 'alvi',
    nombre: 'Alvi',
    host: 'www.alvi.cl',
    // Pages Router: props completas en __NEXT_DATA__, con priceSteps.
    motor: 'nextdata',
    busqueda: '/search?q={q}',
    soportado: true,
    notas: 'Mayorista: trae priceSteps estructurados, ean y unitMultiplier.',
  },
  {
    id: 'santaisabel',
    nombre: 'Santa Isabel',
    host: 'www.santaisabel.cl',
    motor: 'desconocido',
    soportado: false,
    notas: 'Storefront Cencosud. Falta verificar la ruta de busqueda y el formato.',
  },
  {
    id: 'unimarc',
    nombre: 'Unimarc',
    host: 'www.unimarc.cl',
    motor: 'desconocido',
    soportado: false,
    notas: 'Next.js. Falta verificar la ruta de busqueda y el formato.',
  },
  {
    id: 'lider',
    nombre: 'Lider',
    host: 'www.lider.cl',
    motor: 'desconocido',
    soportado: false,
    notas: 'Next.js con proteccion anti-bot. Probablemente requiere Playwright.',
  },
];

/** Solo las tiendas que todavia responden por el catalogo clasico de VTEX. */
export function adapters(): Adapter[] {
  return TIENDAS.filter((t) => t.soportado && t.motor === 'vtex').map(crearAdapterVtex);
}

/** URL de busqueda del sitio, cuando la conocemos verificada. */
export function urlBusquedaSitio(cfg: TiendaConfig, query: string): string | null {
  if (!cfg.busqueda) return null;
  return `https://${cfg.host}${cfg.busqueda.replace('{q}', encodeURIComponent(query))}`;
}

export function tienda(id: string): TiendaConfig | undefined {
  return TIENDAS.find((t) => t.id === id);
}

export * from './tipos.js';
export * from './vtex.js';
