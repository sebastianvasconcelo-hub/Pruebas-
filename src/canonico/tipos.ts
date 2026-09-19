/**
 * Producto canonico: la identidad que une el mismo articulo entre cadenas.
 *
 * Sin esto, comparar es una coincidencia de categoria: un arroz Merkat de Alvi
 * contra un Tucapel de Jumbo no es el mismo producto por mucho que ambos digan
 * "arroz 1 kg".
 */

export interface Equivalencia {
  tienda: string;
  /** SKU tal como lo entrega esa tienda. Es la llave para volver a encontrarlo. */
  sku: string;
  ean?: string;
  /** Nombre en esa tienda, para poder auditar el emparejamiento despues. */
  nombre: string;
  /**
   * URL de la ficha. En Jumbo los precios completos (lista, vigente y Prime)
   * solo estan ahi, no en la pagina de busqueda.
   */
  url?: string;
  /** Como se establecio: por EAN identico o confirmado a mano. */
  origen: 'ean' | 'manual';
  confirmadoEn: string;
}

export interface ProductoCanonico {
  /** Identificador estable, en minusculas y con guiones. */
  id: string;
  /** Como lo llamas tu, no como lo llama ninguna cadena. */
  nombre: string;
  /** Unidades que consumes al mes. Habilita el costo de bodega y mejorCantidad. */
  consumoMensual?: number;
  notas?: string;
  equivalencias: Equivalencia[];
}

export interface Catalogo {
  version: 1;
  productos: ProductoCanonico[];
}

export const CATALOGO_VACIO: Catalogo = { version: 1, productos: [] };
