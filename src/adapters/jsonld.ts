import type { CLP, Oferta } from '../tipos.js';
import type { TiendaConfig } from './tipos.js';

/**
 * Lectura del JSON-LD de schema.org que Jumbo incrusta en su payload RSC.
 *
 * Jumbo no expone su catalogo como datos de aplicacion en el HTML, pero si
 * publica un ItemList de schema.org (pensado para buscadores) con nombre,
 * marca, url y precio de cada resultado.
 *
 * LIMITACION IMPORTANTE: schema.org define un solo precio por oferta. No hay
 * forma de distinguir precio normal de precio Prime, ni de leer escalas por
 * cantidad ni el EAN. Lo que se obtenga aqui es "el precio que muestra la
 * pagina", y para el motor de precios se trata como precio de lista.
 */

interface OfertaLd {
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
  lowPrice?: number | string;
  url?: string;
}

interface ProductoLd {
  '@type'?: string;
  name?: string;
  url?: string;
  brand?: { name?: string } | string;
  offers?: OfertaLd | OfertaLd[];
}

interface ListItemLd {
  '@type'?: string;
  position?: number;
  url?: string;
  name?: string;
  item?: ProductoLd;
}

function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    // schema.org pide punto decimal, pero hay sitios que mandan formato local.
    const n = Number(v.replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function nombreMarca(brand: ProductoLd['brand']): string | undefined {
  if (typeof brand === 'string') return brand;
  if (brand && typeof brand === 'object' && typeof brand.name === 'string') return brand.name;
  return undefined;
}

function precioDe(offers: ProductoLd['offers']): { precio: CLP; disponible: boolean } | null {
  const lista = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of lista) {
    const precio = aNumero(o.price) ?? aNumero(o.lowPrice);
    if (precio === null) continue;
    // availability suele venir como "https://schema.org/InStock".
    const disponible = o.availability === undefined || /instock|limitedavailability/i.test(o.availability);
    return { precio, disponible };
  }
  return null;
}

/** El slug del producto sirve de identificador estable dentro de la tienda. */
function skuDesdeUrl(url: string | undefined, respaldo: string): string {
  if (!url) return respaldo;
  const m = /\/([^/]+)\/p(?:$|[?#])/.exec(url);
  return m?.[1] ?? respaldo;
}

/** true si el bloque es un ItemList de schema.org con elementos. */
function esItemList(b: unknown): b is { itemListElement: ListItemLd[] } {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return o['@type'] === 'ItemList' && Array.isArray(o.itemListElement);
}

/**
 * Convierte los bloques JSON rescatados del HTML en ofertas.
 *
 * Funcion pura: recibe los bloques ya extraidos, no toca la red.
 */
export function mapearJsonLd(cfg: TiendaConfig, bloques: unknown[]): Oferta[] {
  const capturadoEn = new Date().toISOString();
  const ofertas: Oferta[] = [];
  const vistos = new Set<string>();

  for (const bloque of bloques) {
    if (!esItemList(bloque)) continue;

    for (const elemento of bloque.itemListElement) {
      const producto = elemento.item ?? {};
      const nombre = producto.name ?? elemento.name;
      if (typeof nombre !== 'string' || nombre.trim() === '') continue;

      const precio = precioDe(producto.offers);
      if (!precio) continue;

      const url = producto.url ?? elemento.url;
      const sku = skuDesdeUrl(url, nombre);
      // El mismo producto puede aparecer en varios bloques del stream.
      if (vistos.has(sku)) continue;
      vistos.add(sku);

      ofertas.push({
        tienda: cfg.id,
        sku,
        nombre,
        marca: nombreMarca(producto.brand),
        url,
        precioLista: precio.precio,
        // schema.org no distingue precio normal de precio con membresia.
        precioSocio: undefined,
        escalas: [],
        promoTexto: [],
        disponible: precio.disponible,
        capturadoEn,
      });
    }
  }

  return ofertas;
}
