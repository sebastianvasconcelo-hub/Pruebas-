import { describe, expect, it } from 'vitest';
import { parsearContenido } from '../src/normalizar/unidad.js';

describe('parsearContenido', () => {
  it('lee el gramaje al final del nombre', () => {
    expect(parsearContenido('Arroz Grado 1 Tucapel 1 kg')).toMatchObject({
      cantidad: 1,
      base: 'kg',
      envases: 1,
    });
  });

  it('convierte gramos a kilos', () => {
    expect(parsearContenido('Atun Lomitos San Jose 160 g')).toMatchObject({
      cantidad: 0.16,
      base: 'kg',
    });
  });

  it('acepta coma decimal', () => {
    expect(parsearContenido('Bebida Coca Cola 1,5 L')).toMatchObject({
      cantidad: 1.5,
      base: 'L',
    });
  });

  it('trata cc como mililitros', () => {
    expect(parsearContenido('Aceite Vegetal Chef 900 cc')).toMatchObject({
      cantidad: 0.9,
      base: 'L',
    });
  });

  it('multiplica los packs escritos como 6x1,5 L', () => {
    expect(parsearContenido('Bebida Sprite Pack 6x1,5 L')).toMatchObject({
      cantidad: 9,
      base: 'L',
      envases: 6,
    });
  });

  it('multiplica los packs escritos al reves: 1 kg x 4', () => {
    expect(parsearContenido('Azucar Iansa 1 kg x 4')).toMatchObject({
      cantidad: 4,
      base: 'kg',
      envases: 4,
    });
  });

  it('prefiere masa o volumen por sobre el conteo de unidades', () => {
    expect(parsearContenido('Pack 6 un Leche Entera Colun 1 L')).toMatchObject({
      cantidad: 1,
      base: 'L',
    });
  });

  it('no confunde el "1" de "Grado 1" con un formato', () => {
    expect(parsearContenido('Arroz Grado 1 Tucapel 1 kg')?.origen).toBe('1 kg');
  });

  it('devuelve null cuando no hay formato, en vez de inventarlo', () => {
    expect(parsearContenido('Palta Hass a granel')).toBeNull();
  });

  it('cuenta unidades cuando es lo unico que hay', () => {
    expect(parsearContenido('Papel Higienico Elite 12 un')).toMatchObject({
      cantidad: 12,
      base: 'un',
    });
  });
});
