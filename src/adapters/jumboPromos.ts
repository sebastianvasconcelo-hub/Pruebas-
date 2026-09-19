import type { CLP, Escala } from '../tipos.js';

/**
 * Interpretacion de las promociones de la ficha de Jumbo.
 *
 * La ficha manda un objeto `product` con `items[].promotions[]`, donde cada
 * promocion declara a quien aplica y con que condiciones. Ejemplo real:
 *
 *   { description: "JUMBO VINA, QUESO Y CERVEZA DEL MES PRIME SEPT",
 *     type: "percentual", value: 35, unitPrice: 4544, ppumPrice: 9088,
 *     mQuantity: 1, nQuantity: 0, paymentMethods: "ALL",
 *     userProperties: "PRIME_USER" }
 *
 * `userProperties` es la pieza que faltaba: distingue el precio Prime del
 * precio abierto a cualquiera, que es justo lo que el JSON-LD de la busqueda
 * no permite saber.
 */

export interface PromocionJumbo {
  description?: string;
  type?: string;
  value?: number;
  /** Precio unitario resultante de aplicar la promocion. */
  unitPrice?: number;
  /** Precio por unidad de medida resultante. */
  ppumPrice?: number;
  /** Unidades minimas para que aplique. 1 o 0 significan "siempre". */
  mQuantity?: number;
  nQuantity?: number;
  paymentMethods?: string;
  /** A quien aplica: "PRIME_USER" para Jumbo Prime. */
  userProperties?: string;
}

export interface PromosInterpretadas {
  /** Precio con membresia cuando aplica desde la primera unidad. */
  precioSocio?: CLP;
  /** Tramos por cantidad, marcados si exigen membresia. */
  escalas: Escala[];
  /** Descripciones originales, para poder auditar la interpretacion. */
  textos: string[];
}

function exigeMembresia(p: PromocionJumbo): boolean {
  return /PRIME/i.test(p.userProperties ?? '');
}

/** Una promocion sin minimo util aplica desde la primera unidad. */
function minimo(p: PromocionJumbo): number {
  const m = p.mQuantity ?? 0;
  return Number.isFinite(m) && m > 1 ? m : 1;
}

/**
 * Separa las promociones en precio de membresia y escalas por cantidad.
 *
 * Las que aplican desde la primera unidad son precio de socio; las que exigen
 * llevar varias son escalas. Solo se consideran las que declaran el precio
 * resultante: deducirlo del porcentaje invitaria a errores de redondeo que no
 * coincidirian con la caja.
 */
export function interpretarPromociones(
  promociones: PromocionJumbo[] | undefined,
  precioBase: CLP,
): PromosInterpretadas {
  const escalas: Escala[] = [];
  const textos: string[] = [];
  let precioSocio: CLP | undefined;

  for (const p of promociones ?? []) {
    if (p.description) textos.push(p.description);

    const precio = p.unitPrice;
    if (typeof precio !== 'number' || precio <= 0 || precio >= precioBase) continue;

    const min = minimo(p);
    const socio = exigeMembresia(p);

    if (min === 1) {
      // Varias promociones pueden aplicar desde la primera unidad: gana la mejor.
      if (socio && (precioSocio === undefined || precio < precioSocio)) precioSocio = precio;
      else if (!socio && precio < precioBase) {
        // Promocion abierta: se modela como escala desde 1 para que el motor
        // la use aunque no seas socio.
        escalas.push({
          minUnidades: 1,
          precioUnitario: precio,
          origen: p.description ?? 'promocion Jumbo',
        });
      }
      continue;
    }

    escalas.push({
      minUnidades: min,
      precioUnitario: precio,
      ...(socio ? { requiereMembresia: true } : {}),
      origen: `${socio ? 'Prime, ' : ''}${min}+ un${p.description ? `: ${p.description}` : ''}`,
    });
  }

  return {
    ...(precioSocio !== undefined ? { precioSocio } : {}),
    escalas: escalas.sort((a, b) => a.minUnidades - b.minUnidades),
    textos,
  };
}
