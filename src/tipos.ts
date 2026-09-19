/** Pesos chilenos. Se trabaja con enteros salvo en precios unitarios derivados. */
export type CLP = number;

/** Un tramo de precio por cantidad: "llevando 3 o mas, $1.290 c/u". */
export interface Escala {
  minUnidades: number;
  precioUnitario: CLP;
  /**
   * El tramo exige membresia ademas de la cantidad. Alvi publica sus
   * priceSteps bajo el encabezado "Socio": sin Club Alvi se paga el precio
   * regular por mucho que lleves 10 unidades.
   */
  requiereMembresia?: boolean;
  /** Texto original del que se dedujo, para poder auditar el parser. */
  origen?: string;
}

/** Una oferta concreta de un SKU en una tienda, tal como la expone su API. */
export interface Oferta {
  tienda: string;
  sku: string;
  nombre: string;
  marca?: string;
  ean?: string;
  url?: string;
  /** Precio normal, sin membresia ni promocion. */
  precioLista: CLP;
  /** Precio con membresia (Prime / socio Alvi) cuando la API lo expone. */
  precioSocio?: CLP;
  escalas: Escala[];
  /**
   * Formato declarado por la tienda. Cuando existe se prefiere sobre deducirlo
   * del nombre, que es el plan B.
   */
  contenido?: Contenido;
  /** Precio por unidad de medida segun la tienda, ej "$2.090 x Kg". Sirve de contraste. */
  ppumTienda?: string;
  /** Textos de promocion sin procesar. Se guardan siempre para poder auditar. */
  promoTexto: string[];
  disponible: boolean;
  capturadoEn: string;
}

export type Base = 'kg' | 'L' | 'un';

/** Contenido de un envase, normalizado a una unidad base. */
export interface Contenido {
  /** Cantidad total en la unidad base, incluyendo el multiplicador de pack. */
  cantidad: number;
  base: Base;
  /** Unidades dentro del pack: 1 salvo formatos tipo "6x1,5 L". */
  envases: number;
  origen: string;
}
