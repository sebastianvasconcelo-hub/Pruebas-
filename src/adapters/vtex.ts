import type { CLP, Oferta } from '../tipos.js';
import { parsearPromos } from '../normalizar/promo.js';
import type { Adapter, OpcionesBusqueda, TiendaConfig } from './tipos.js';

/**
 * Adapter del catalogo clasico de VTEX.
 *
 * NOTA: a septiembre de 2026 ninguna de las cadenas chilenas probadas expone
 * esta ruta (404/500). Se conserva porque el patron sigue vigente en otros
 * retailers de la region y porque el mapeo es correcto: si alguna vuelve a
 * exponerla, o se encuentra el host de API real, sirve tal cual.
 */

/**
 * Forma parcial de la respuesta de /api/catalog_system/pub/products/search.
 * Solo se declara lo que se usa: VTEX devuelve decenas de campos mas.
 */
interface ProductoVtex {
  productId?: string;
  productName?: string;
  brand?: string;
  linkText?: string;
  items?: ItemVtex[];
}

interface ItemVtex {
  itemId?: string;
  ean?: string;
  name?: string;
  sellers?: SellerVtex[];
}

interface SellerVtex {
  sellerId?: string;
  sellerDefault?: boolean;
  commertialOffer?: {
    Price?: number;
    ListPrice?: number;
    PriceWithoutDiscount?: number;
    AvailableQuantity?: number;
    Teasers?: Array<{ Name?: string }>;
    DiscountHighLight?: Array<{ Name?: string }>;
  };
}

const UA_POR_DEFECTO =
  'comparador-supermercados/0.1 (uso personal; comparacion de precios)';

/** El seller default, o el primero con stock, o simplemente el primero. */
function elegirSeller(item: ItemVtex): SellerVtex | undefined {
  const sellers = item.sellers ?? [];
  return (
    sellers.find((s) => s.sellerDefault) ??
    sellers.find((s) => (s.commertialOffer?.AvailableQuantity ?? 0) > 0) ??
    sellers[0]
  );
}

/**
 * Convierte la respuesta cruda de VTEX en ofertas normalizadas.
 *
 * Funcion pura a proposito: es la pieza que hay que validar contra respuestas
 * reales, y separarla del fetch permite testearla con fixtures guardados.
 *
 * Sobre los precios: VTEX expone `ListPrice` (precio normal) y `Price` (precio
 * vigente para el canal consultado). Cuando `Price` es menor se trata como
 * precio de socio/promocion. OJO: esto es una hipotesis a confirmar contra el
 * sitio real, porque algunas cadenas devuelven el precio de socio solo con
 * sesion iniciada. Ver README, seccion "Que falta validar".
 */
export function mapearVtex(cfg: TiendaConfig, crudo: unknown): Oferta[] {
  if (!Array.isArray(crudo)) return [];
  const capturadoEn = new Date().toISOString();
  const ofertas: Oferta[] = [];

  for (const producto of crudo as ProductoVtex[]) {
    for (const item of producto.items ?? []) {
      const seller = elegirSeller(item);
      const oferta = seller?.commertialOffer;
      if (!oferta) continue;

      const precioVigente = oferta.Price;
      const precioNormal = oferta.ListPrice ?? oferta.PriceWithoutDiscount ?? precioVigente;
      if (typeof precioVigente !== 'number' || typeof precioNormal !== 'number') continue;
      if (precioVigente <= 0 && precioNormal <= 0) continue;

      const precioLista: CLP = Math.max(precioNormal, precioVigente);
      const precioSocio: CLP | undefined =
        precioVigente < precioLista ? precioVigente : undefined;

      const promoTexto = [
        ...(oferta.Teasers ?? []),
        ...(oferta.DiscountHighLight ?? []),
      ]
        .map((t) => t?.Name)
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '');

      const nombre = item.name ?? producto.productName ?? '(sin nombre)';

      ofertas.push({
        tienda: cfg.id,
        sku: item.itemId ?? producto.productId ?? nombre,
        nombre,
        marca: producto.brand,
        ean: item.ean && item.ean !== '' ? item.ean : undefined,
        url: producto.linkText ? `https://${cfg.host}/${producto.linkText}/p` : undefined,
        precioLista,
        precioSocio,
        escalas: parsearPromos(promoTexto, precioSocio ?? precioLista),
        promoTexto,
        disponible: (oferta.AvailableQuantity ?? 0) > 0,
        capturadoEn,
      });
    }
  }

  return ofertas;
}

export function urlBusqueda(cfg: TiendaConfig, query: string, opts: OpcionesBusqueda = {}): string {
  const limite = opts.limite ?? 20;
  const params = new URLSearchParams({
    ft: query,
    _from: '0',
    // VTEX usa un rango inclusivo y tope de 50 por request.
    _to: String(Math.min(limite, 50) - 1),
  });
  const sc = opts.salesChannel ?? cfg.salesChannel;
  if (sc) params.set('sc', sc);
  return `https://${cfg.host}/api/catalog_system/pub/products/search?${params}`;
}

export function crearAdapterVtex(cfg: TiendaConfig): Adapter {
  return {
    cfg,
    mapear: (crudo) => mapearVtex(cfg, crudo),
    async buscar(query, opts = {}) {
      const url = urlBusqueda(cfg, query, opts);
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': opts.userAgent ?? UA_POR_DEFECTO,
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (!res.ok) {
        throw new Error(`${cfg.id}: HTTP ${res.status} en ${url}`);
      }
      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('json')) {
        throw new Error(
          `${cfg.id}: se esperaba JSON y llego "${tipo}". ` +
            'Probablemente hay proteccion anti-bot: hace falta navegador headless.',
        );
      }
      return mapearVtex(cfg, await res.json());
    },
  };
}
