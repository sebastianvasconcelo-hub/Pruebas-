import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapearFichaJumbo } from '../src/adapters/jumboFicha.js';
import { tienda } from '../src/adapters/index.js';
import { precioEfectivo } from '../src/precios/efectivo.js';
import { PERFIL_POR_DEFECTO, type PerfilCompra } from '../src/precios/reglas.js';

const JUMBO = tienda('jumbo')!;
// Recorte real de la ficha del queso mantecoso en jumbo.cl.
const REAL = JSON.parse(readFileSync('fixtures/jumbo-ficha.real.json', 'utf8')) as unknown[];
const MARTES = new Date('2026-09-22T12:00:00');
const SIN_PRIME: PerfilCompra = {
  ...PERFIL_POR_DEFECTO,
  membresias: PERFIL_POR_DEFECTO.membresias.filter((m) => m.tienda !== 'jumbo'),
};

describe('mapearFichaJumbo sobre datos reales', () => {
  const [oferta] = mapearFichaJumbo(JUMBO, REAL);

  it('lee precio de lista y precio Prime', () => {
    expect(oferta).toMatchObject({ tienda: 'jumbo', sku: '10995', precioLista: 6990, precioSocio: 4544 });
  });

  it('conserva el precio vigente como tramo abierto a cualquiera', () => {
    const abierta = oferta!.escalas.find((e) => e.precioUnitario === 5890);
    expect(abierta).toMatchObject({ minUnidades: 1 });
    expect(abierta!.requiereMembresia).toBeUndefined();
  });

  it('toma el formato declarado: 500 g son 0,5 kg', () => {
    expect(oferta!.contenido).toMatchObject({ cantidad: 0.5, base: 'kg' });
  });

  it('completa marca y url desde el schema.org de la misma ficha', () => {
    expect(oferta!.marca).toBe('Quilque');
    expect(oferta!.url).toContain('jumbo.cl');
  });

  it('no trae EAN: Jumbo no lo expone', () => {
    expect(oferta!.ean).toBeUndefined();
  });

  it('guarda las descripciones de promocion para poder auditar', () => {
    expect(oferta!.promoTexto.join(' ')).toContain('PRIME SEPT');
  });

  it('deduplica si el mismo item aparece en varios bloques', () => {
    expect(mapearFichaJumbo(JUMBO, [...REAL, ...REAL])).toHaveLength(1);
  });

  it('tolera bloques vacios o con forma inesperada', () => {
    expect(mapearFichaJumbo(JUMBO, [null, 42, 'texto', {}, []])).toEqual([]);
  });
});

describe('el precio efectivo reproduce lo que muestra la ficha', () => {
  const [oferta] = mapearFichaJumbo(JUMBO, REAL);

  it('siendo Prime paga $4.544, o sea $9.088 por kilo', () => {
    const d = precioEfectivo(oferta!, 1, PERFIL_POR_DEFECTO, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(4544);
    // La ficha publica "$9.088 x kg" para el precio Prime.
    expect(d.porUnidadMedida).toEqual({ valor: 9088, base: 'kg' });
  });

  it('sin Prime paga $5.890, o sea $11.780 por kilo', () => {
    const d = precioEfectivo(oferta!, 1, SIN_PRIME, { fecha: MARTES });
    expect(d.precioUnitarioBruto).toBe(5890);
    expect(d.porUnidadMedida).toEqual({ valor: 11780, base: 'kg' });
  });

  it('el ppum que guardamos coincide con el de la ficha', () => {
    expect(oferta!.ppumTienda).toBe('$11.780 x kg');
  });
});
