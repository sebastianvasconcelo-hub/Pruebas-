import type { CLP } from '../tipos.js';

export interface Membresia {
  tienda: string;
  /** Usar el precio de socio cuando la tienda lo exponga. */
  usarPrecioSocio: boolean;
  /** Descuento extra que la API no refleja y sabes que se aplica en caja (0..1). */
  descuentoAdicional?: number;
}

export interface ReglaCashback {
  etiqueta: string;
  /** Tiendas donde aplica, o '*' para todas. */
  tiendas: string[] | '*';
  /** 0 = domingo ... 4 = jueves ... 6 = sabado. */
  diasSemana: number[];
  /** Fraccion, no porcentaje: 0.07 = 7%. */
  porcentaje: number;
  /** Tope por transaccion, si tu tarjeta lo tiene. */
  topePorCompra?: CLP;
}

export interface PerfilCompra {
  membresias: Membresia[];
  cashback: ReglaCashback[];
  /** Si compras en cuotas sin interes el costo financiero es cero. */
  cuotasSinInteres: boolean;
  /** Tasa mensual si NO son cuotas sin interes (0.025 = 2,5% mensual). */
  tasaMensual: number;
  cuotas: number;
  /**
   * Cuanto te cuesta tener una unidad guardada un mes. Ponlo en 0 si te sobra
   * espacio; subelo si la bodega es escasa y comprar 6 meses te estorba.
   */
  costoBodegaMensualPorUnidad: CLP;
}

/**
 * Perfil por defecto: Jumbo Prime, Alvi socio, 7% de cashback los jueves
 * pagando con la B6, y compras en cuotas sin interes.
 *
 * Los porcentajes de membresia van en 0 porque las APIs ya devuelven el precio
 * con descuento cuando lo exponen; subelos solo si compruebas que en caja te
 * hacen un descuento adicional que el sitio no muestra.
 */
export const PERFIL_POR_DEFECTO: PerfilCompra = {
  membresias: [
    { tienda: 'jumbo', usarPrecioSocio: true, descuentoAdicional: 0 },
    { tienda: 'alvi', usarPrecioSocio: true, descuentoAdicional: 0 },
    { tienda: 'santaisabel', usarPrecioSocio: true, descuentoAdicional: 0 },
  ],
  cashback: [
    {
      etiqueta: 'Jueves 7% tarjeta B6',
      tiendas: '*',
      diasSemana: [4],
      porcentaje: 0.07,
    },
  ],
  cuotasSinInteres: true,
  tasaMensual: 0.025,
  cuotas: 3,
  costoBodegaMensualPorUnidad: 0,
};
