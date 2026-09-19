import type { Oferta } from '../tipos.js';
import {
  extraerFlight,
  extraerJsonIncrustado,
  extraerNextData,
} from '../descubrir/nextdata.js';
import { mapearAlvi } from './alvi.js';
import { mapearJsonLd } from './jsonld.js';
import type { TiendaConfig } from './tipos.js';

/**
 * Lectura del catalogo desde el HTML de los storefronts.
 *
 * Las cadenas dejaron de exponer el API de su plataforma en el dominio
 * publico, pero siguen mandando los datos al navegador dentro del HTML. Cada
 * motor sabe donde mirar.
 */

/** Cabeceras de navegador: el HTML que sirven depende de que parezca uno. */
const NAVEGADOR = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'es-CL,es;q=0.9',
};

/** Mapeo puro: del HTML a ofertas, segun el motor de la tienda. */
export function mapearHtml(cfg: TiendaConfig, html: string): Oferta[] {
  if (cfg.motor === 'nextdata') {
    const datos = extraerNextData(html);
    return datos ? mapearAlvi(cfg, datos) : [];
  }
  if (cfg.motor === 'jsonld') {
    const flight = extraerFlight(html);
    if (flight === '') return [];
    return mapearJsonLd(cfg, extraerJsonIncrustado(flight));
  }
  return [];
}

export function urlBusqueda(cfg: TiendaConfig, query: string): string | null {
  if (!cfg.busqueda) return null;
  return `https://${cfg.host}${cfg.busqueda.replace('{q}', encodeURIComponent(query))}`;
}

export async function buscarEnSitio(
  cfg: TiendaConfig,
  query: string,
  opts: { timeoutMs?: number } = {},
): Promise<Oferta[]> {
  const url = urlBusqueda(cfg, query);
  if (!url) throw new Error(`${cfg.id}: no hay ruta de busqueda verificada`);

  const res = await fetch(url, {
    headers: NAVEGADOR,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) throw new Error(`${cfg.id}: HTTP ${res.status} en ${url}`);

  const ofertas = mapearHtml(cfg, await res.text());
  if (ofertas.length === 0) {
    throw new Error(
      `${cfg.id}: la pagina respondio pero no se extrajo ningun producto. ` +
        `Revisa con: npm run inspeccionar -- <html guardado>`,
    );
  }
  return ofertas;
}
