/**
 * Fechas en hora local, no UTC.
 *
 * `new Date('2026-09-25')` se interpreta como medianoche UTC, que en Chile
 * (UTC-3/-4) cae el dia anterior por la tarde. Como el cashback depende del
 * dia de la semana, ese corrimiento aplica descuentos en dias equivocados:
 * un error de precio silencioso.
 */

/** true si el texto es una fecha simple YYYY-MM-DD, sin hora ni zona. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Interpreta YYYY-MM-DD como ese dia en hora local, al mediodia.
 *
 * El mediodia evita que un cambio de horario de verano corra el dia. Cualquier
 * otro formato se delega a `Date`, que si respeta la zona cuando viene escrita.
 */
export function parsearFechaLocal(texto: string): Date {
  const m = SOLO_FECHA.exec(texto.trim());
  if (!m) return new Date(texto);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

export const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
] as const;

export function nombreDia(fecha: Date): string {
  return DIAS[fecha.getDay()]!;
}
