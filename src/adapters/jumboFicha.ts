import type { Base, CLP, Contenido, Oferta } from '../tipos.js';
import { interpretarPromociones, type PromocionJumbo } from './jumboPromos.js';
import type { Descartes } from '../diagnostico.js';
import type { TiendaConfig } from './tipos.js';

/**
 * Lectura de la ficha de producto de Jumbo desde su payload RSC.
 *
 * A diferencia de la pagina de busqueda, que solo publica un ItemList de
 * schema.org con un precio, la ficha manda el objeto `product` completo:
 * precio de lista, precio vigente, formato estructurado y promociones
 * etiquetadas por tipo de usuario.
 *
 * OJO: no trae EAN. El emparejamiento con otras cadenas no se puede automatizar
 * por codigo de barras y queda en confirmacion manual.
 */

interface ItemJumbo {
  skuId?: string;
  name?: string;
  price?: number;
  listPrice?: number;
  ppumPrice?: number;
  ppumMeasurementUnit?: string;
  measurementUnitUn?: string;
  unitMultiplierUn?: number;
  stock?: boolean;
  cartLimit?: number;
  promotions?: PromocionJumbo[];
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
  un: 'un',
  unidad: 'un',
};

/** true si el objeto tiene la forma de un item de ficha de Jumbo. */
function esItem(v: unknown): v is ItemJumbo {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.skuId === 'string' && typeof o.price === 'number';
}

/** Recolecta los items de ficha del arbol, sin depender de una ruta fija. */
function recolectarItems(json: unknown, prof = 0): ItemJumbo[] {
  if (prof > 16 || json === null || typeof json !== 'object') return [];
  if (esItem(json)) return [json];
  const hijos = Array.isArray(json) ? json : Object.values(json);
  return hijos.flatMap((h) => recolectarItems(h, prof + 1));
}

/**
 * Formato del envase, desde `unitMultiplierUn` y `measurementUnitUn`.
 *
 * Para el queso de 500 g, Jumbo declara 0.5 y "kg": el dato viene resuelto y no
 * hay que deducirlo del nombre.
 */
function contenidoDe(item: ItemJumbo): Contenido | undefined {
  const unidad = (item.measurementUnitUn ?? item.ppumMeasurementUnit)?.toLowerCase().trim();
  const base = unidad ? BASES[unidad] : undefined;
  const cantidad = item.unitMultiplierUn;
  if (!base || typeof cantidad !== 'number' || cantidad <= 0) return undefined;
  return { cantidad, base, envases: 1, origen: `${cantidad} ${unidad}` };
}

function marcaDe(brand: unknown): string | undefined {
  if (typeof brand === 'string') return brand;
  if (brand && typeof brand === 'object') {
    const nombre = (brand as { name?: unknown }).name;
    if (typeof nombre === 'string') return nombre;
  }
  return undefined;
}

/** Para comparar nombres entre el schema.org y el objeto interno. */
function normalizarNombre(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Datos de schema.org de la misma ficha, que aportan marca y url.
 *
 * El bloque Product describe UN producto: el principal de la pagina. Pero la
 * ficha incrusta ademas decenas de productos relacionados con la misma forma
 * que el principal, asi que no basta con que haya un solo Product para darle
 * su url a cualquier item. Se le asigna solo al item que le corresponde: por
 * sku si coincide, o por nombre, que en la ficha real es identico en ambos
 * lados. Un producto relacionado queda sin url, que es la verdad.
 */
function datosLd(
  bloques: unknown[],
  sku: string,
  nombre: string,
  unicoItem: boolean,
): { marca?: string; url?: string } {
  const productos = bloques.filter(
    (b): b is Record<string, unknown> =>
      !!b && typeof b === 'object' && !Array.isArray(b) && (b as Record<string, unknown>)['@type'] === 'Product',
  );
  const elegido =
    productos.find((o) => o.sku === sku) ??
    productos.find((o) => typeof o.name === 'string' && normalizarNombre(o.name) === normalizarNombre(nombre)) ??
    // Sin sku ni nombre que coincidan, solo es seguro cuando la pagina no trae
    // otros productos con los que confundirlo.
    (unicoItem && productos.length === 1 ? productos[0] : undefined);
  if (!elegido) return {};
  return {
    marca: marcaDe(elegido.brand),
    url: typeof elegido.url === 'string' ? elegido.url : undefined,
  };
}

/** Mapeo puro de los bloques de una ficha de Jumbo a ofertas. No toca la red. */
export function mapearFichaJumbo(
  cfg: TiendaConfig,
  bloques: unknown[],
  descartes?: Descartes,
): Oferta[] {
  const capturadoEn = new Date().toISOString();
  const ofertas: Oferta[] = [];
  const vistos = new Set<string>();

  const items = bloques.flatMap((b) => recolectarItems(b));
  const skusDistintos = new Set(items.map((i) => i.skuId)).size;

  for (const item of items) {
    const sku = item.skuId!;
    const nombre = item.name;
    if (!nombre) {
      descartes?.registrar(`${cfg.id}:ficha`, sku, 'item sin nombre');
      continue;
    }
    if (vistos.has(sku)) continue;
    vistos.add(sku);

    const precioVigente = item.price!;
    const precioLista: CLP = item.listPrice ?? precioVigente;
    const promos = interpretarPromociones(item.promotions, precioLista);

    const escalas = [...promos.escalas];
    // Si el precio vigente es menor al de lista y ninguna promocion lo
    // representa, se agrega igual: es el precio que paga cualquiera.
    if (precioVigente < precioLista && !escalas.some((e) => e.minUnidades === 1)) {
      escalas.push({
        minUnidades: 1,
        precioUnitario: precioVigente,
        origen: 'precio vigente en la ficha',
      });
    }

    const { marca, url } = datosLd(bloques, sku, nombre, skusDistintos === 1);

    ofertas.push({
      tienda: cfg.id,
      sku,
      nombre,
      marca,
      // Jumbo no expone EAN en la ficha: el emparejamiento queda manual.
      ean: undefined,
      url,
      precioLista,
      ...(promos.precioSocio !== undefined ? { precioSocio: promos.precioSocio } : {}),
      escalas: escalas.sort((a, b) => a.minUnidades - b.minUnidades),
      contenido: contenidoDe(item),
      ...(item.ppumPrice !== undefined
        ? { ppumTienda: `$${item.ppumPrice.toLocaleString('es-CL')} x ${item.ppumMeasurementUnit ?? ''}`.trim() }
        : {}),
      promoTexto: promos.textos,
      disponible: item.stock !== false,
      capturadoEn,
    });
  }

  return ofertas;
}
