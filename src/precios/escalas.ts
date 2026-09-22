import type { Base, CLP, Oferta } from '../tipos.js';
import { parsearContenido } from '../normalizar/unidad.js';
import type { PerfilCompra } from './reglas.js';

/**
 * Las escalas por cantidad que todavia no estas usando.
 *
 * Una escala mayorista que no aplica a la cantidad consultada sigue siendo
 * informacion: es lo que permite decidir si conviene llevar mas. Ocultarla
 * porque hoy no se aplica reduce la herramienta a una calculadora de precio
 * unitario, y el caso de uso real es justamente la compra por volumen en Alvi.
 */

export interface EscalaInformada {
  minUnidades: number;
  precioUnitario: CLP;
  porUnidadMedida: { valor: CLP; base: Base } | null;
  /** Cuanto baja respecto del precio unitario que pagas hoy, en porcentaje. */
  ahorroPorcentaje: number;
  requiereMembresia: boolean;
  /** Puedes usarla: no exige membresia, o la tienes. */
  usable: boolean;
  /** Ya esta aplicada a la cantidad consultada. */
  aplicada: boolean;
  origen?: string;
}

/**
 * Describe las escalas de una oferta frente a la cantidad y el precio actuales.
 *
 * Devuelve todas, incluidas las que exigen una membresia que no tienes: saber
 * que existe un precio al que no llegas tambien es una decision informada.
 */
export function informarEscalas(
  oferta: Oferta,
  cantidad: number,
  precioUnitarioActual: CLP,
  perfil: PerfilCompra,
): EscalaInformada[] {
  const esSocio = perfil.membresias.some((m) => m.tienda === oferta.tienda && m.usarPrecioSocio);
  const contenido = oferta.contenido ?? parsearContenido(oferta.nombre);

  return oferta.escalas
    .map((e) => {
      const requiereMembresia = e.requiereMembresia === true;
      return {
        minUnidades: e.minUnidades,
        precioUnitario: e.precioUnitario,
        porUnidadMedida:
          contenido && contenido.cantidad > 0
            ? {
                valor: Math.round((e.precioUnitario / contenido.cantidad) * 100) / 100,
                base: contenido.base,
              }
            : null,
        ahorroPorcentaje:
          precioUnitarioActual > 0
            ? Math.round(((precioUnitarioActual - e.precioUnitario) / precioUnitarioActual) * 1000) / 10
            : 0,
        requiereMembresia,
        usable: !requiereMembresia || esSocio,
        aplicada: cantidad >= e.minUnidades && e.precioUnitario >= precioUnitarioActual,
        origen: e.origen,
      };
    })
    .sort((a, b) => a.minUnidades - b.minUnidades);
}

/** Las que todavia no estas aprovechando y si podrias. */
export function escalasPendientes(informadas: EscalaInformada[]): EscalaInformada[] {
  return informadas.filter((e) => !e.aplicada && e.ahorroPorcentaje > 0);
}
