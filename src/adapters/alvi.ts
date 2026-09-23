import type { Base, CLP, Contenido, Oferta } from '../tipos.js';
import { parsearContenido } from '../normalizar/unidad.js';
import type { Descartes } from '../diagnostico.js';
import type { TiendaConfig } from './tipos.js';

/**
 * Lectura del catalogo de Alvi desde el __NEXT_DATA__ de su storefront.
 *
 * Verificado contra el HTML real: los productos viven bajo
 * props.pageProps.dehydratedState.queries[N].state.data.availableProducts
 * y se repiten en props.pageProps.intelliSearchData.availableProducts.
 *
 * Alvi no usa un campo de precio de socio: price, listPrice y
 * priceWithoutDiscount vienen iguales (el "precio regular" de la ficha) y todo
 * el descuento esta en `priceSteps`, estructurado, con minQuantity y
 * promotionalPrice. Eso hace innecesario el parser de textos de promocion.
 *
 * Esos tramos se publican en la ficha bajo el encabezado "Socio", asi que
 * exigen Club Alvi ademas de la cantidad y se marcan `requiereMembresia`.
 */

interface SellerAlvi {
  sellerId?: string;
  price?: number;
  listPrice?: number;
  priceWithoutDiscount?: number;
  availableQuantity?: number;
  inOffer?: boolean;
  /** Precio por unidad de medida segun la tienda, ej "$2.090 x Kg". */
  ppum?: string;
}

interface PriceStepAlvi {
  promotionalPrice?: number;
  minQuantity?: number;
  percentualDiscount?: number;
  ppum?: string;
}

interface ProductoAlvi {
  productId?: string;
  itemId?: string;
  sku?: string;
  name?: string;
  nameComplete?: string;
  /** Formato declarado, ej "1 Kg". Mas confiable que deducirlo del nombre. */
  format?: string;
  ean?: string;
  brand?: string;
  detailUrl?: string;
  measurementUnitUn?: string;
  unitMultiplierUn?: number;
  sellers?: SellerAlvi[];
  priceSteps?: PriceStepAlvi[];
}

const BASES: Record<string, Base> = {
  kg: 'kg',
  kilo: 'kg',
  g: 'kg',
  gr: 'kg',
  l: 'L',
  lt: 'L',
  litro: 'L',
  ml: 'L',
  cc: 'L',
  un: 'un',
  unidad: 'un',
};

/**
 * Contenido del envase, en orden de confianza:
 * 1. `format` ("1 Kg"), que es texto pensado para mostrarse y parsea limpio.
 * 2. `unitMultiplierUn` + `measurementUnitUn`, estructurado pero mas opaco.
 * 3. null, y que el motor lo deduzca del nombre.
 */
function contenidoDe(p: ProductoAlvi): Contenido | undefined {
  if (p.format) {
    const desdeFormato = parsearContenido(p.format);
    if (desdeFormato) return desdeFormato;
  }

  const unidad = p.measurementUnitUn?.toLowerCase().replace(/[.\s]/g, '');
  const base = unidad ? BASES[unidad] : undefined;
  const cantidad = p.unitMultiplierUn;
  if (base && typeof cantidad === 'number' && cantidad > 0) {
    return { cantidad, base, envases: 1, origen: `${cantidad} ${p.measurementUnitUn}` };
  }
  return undefined;
}

/**
 * URL real de la ficha a partir del `detailUrl` del catalogo.
 *
 * Alvi publica `detailUrl` con la convencion de VTEX ("/<slug>/p") pero su
 * storefront sirve las fichas en "/product/<slug>", asi que copiar el campo tal
 * cual produce un enlace que responde 404. Se extrae el slug y se arma la ruta
 * que la tienda usa hoy, declarada en su configuracion.
 */
export function urlFicha(cfg: TiendaConfig, detailUrl: string | undefined): string | undefined {
  if (!detailUrl) return undefined;

  // Por segmentos y no por recortes de texto: "/p" a secas no tiene slug, y
  // quitarle el sufijo dejaria la cadena vacia sin que nadie lo note.
  const segmentos = detailUrl.split('/').filter((t) => t !== '');
  if (segmentos.at(-1) === 'p') segmentos.pop();
  const slug = segmentos.at(-1);
  if (!slug) return undefined;

  const ruta = cfg.rutaFicha ? cfg.rutaFicha.replace('{slug}', slug) : `/${slug}/p`;
  return `https://${cfg.host}${ruta}`;
}

/** El seller con stock, o el primero. Alvi hoy trae uno solo. */
function elegirSeller(p: ProductoAlvi): SellerAlvi | undefined {
  const sellers = p.sellers ?? [];
  return sellers.find((s) => (s.availableQuantity ?? 0) > 0) ?? sellers[0];
}

/**
 * Recolecta todos los arreglos `availableProducts` del arbol.
 *
 * Se busca por nombre de clave en vez de por ruta fija porque el indice dentro
 * de `queries[N]` cambia segun cuantas consultas haya hidratado la pagina.
 */
function recolectarProductos(json: unknown, prof = 0): ProductoAlvi[] {
  if (prof > 14 || json === null || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json.flatMap((h) => recolectarProductos(h, prof + 1));

  const encontrados: ProductoAlvi[] = [];
  for (const [k, v] of Object.entries(json)) {
    if (k === 'availableProducts' && Array.isArray(v)) encontrados.push(...(v as ProductoAlvi[]));
    else encontrados.push(...recolectarProductos(v, prof + 1));
  }
  return encontrados;
}

/** Convierte los priceSteps de Alvi en escalas del motor de precios. */
export function escalasDe(steps: PriceStepAlvi[] | undefined): Oferta['escalas'] {
  return (steps ?? [])
    .filter(
      (s): s is PriceStepAlvi & { minQuantity: number; promotionalPrice: number } =>
        typeof s.minQuantity === 'number' &&
        s.minQuantity > 1 &&
        typeof s.promotionalPrice === 'number' &&
        s.promotionalPrice > 0,
    )
    .map((s) => ({
      minUnidades: s.minQuantity,
      precioUnitario: s.promotionalPrice,
      // La ficha de Alvi publica estos tramos bajo el encabezado "Socio",
      // junto a un "Unete al Club Alvi": exigen membresia ademas de cantidad.
      requiereMembresia: true,
      origen:
        s.percentualDiscount !== undefined
          ? `socio Alvi, ${s.minQuantity}+ un, ${s.percentualDiscount}% dcto`
          : `socio Alvi, ${s.minQuantity}+ un`,
    }))
    .sort((a, b) => a.minUnidades - b.minUnidades);
}

/** Mapeo puro del __NEXT_DATA__ de Alvi a ofertas. No toca la red. */
export function mapearAlvi(cfg: TiendaConfig, json: unknown, descartes?: Descartes): Oferta[] {
  const capturadoEn = new Date().toISOString();
  const ofertas: Oferta[] = [];
  const vistos = new Set<string>();

  for (const p of recolectarProductos(json)) {
    const nombre = p.name ?? p.nameComplete;
    if (!nombre) {
      descartes?.registrar(cfg.id, p.sku ?? p.productId ?? '(sin id)', 'producto sin nombre');
      continue;
    }

    const seller = elegirSeller(p);
    const precioLista: CLP | undefined =
      seller?.listPrice ?? seller?.priceWithoutDiscount ?? seller?.price;
    if (typeof precioLista !== 'number' || precioLista <= 0) {
      descartes?.registrar(cfg.id, nombre, 'sin precio utilizable en sellers');
      continue;
    }

    const sku = p.sku ?? p.itemId ?? p.productId ?? nombre;
    // El mismo catalogo viene duplicado en dehydratedState e intelliSearchData.
    if (vistos.has(sku)) continue;
    vistos.add(sku);

    // Solo se considera precio con descuento si de verdad es menor al de lista.
    const precioVigente = seller?.price;
    const precioSocio =
      typeof precioVigente === 'number' && precioVigente > 0 && precioVigente < precioLista
        ? precioVigente
        : undefined;

    ofertas.push({
      tienda: cfg.id,
      sku,
      nombre,
      marca: p.brand,
      ean: p.ean && p.ean !== '' ? p.ean : undefined,
      url: urlFicha(cfg, p.detailUrl),
      precioLista,
      precioSocio,
      escalas: escalasDe(p.priceSteps),
      contenido: contenidoDe(p),
      ppumTienda: seller?.ppum,
      promoTexto: [],
      disponible: (seller?.availableQuantity ?? 0) > 0,
      capturadoEn,
    });
  }

  return ofertas;
}
