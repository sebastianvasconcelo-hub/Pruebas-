/** Pesos chilenos. Se trabaja con enteros salvo en precios unitarios derivados. */
export type CLP = number;

/** Un tramo de precio por cantidad: "llevando 3 o mas, $1.290 c/u". */
export interface Escala {
  minUnidades: number;
  precioUnitario: CLP;
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
