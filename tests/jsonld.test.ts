import { describe, expect, it } from 'vitest';
import { mapearJsonLd } from '../src/adapters/jsonld.js';
import { tienda } from '../src/adapters/index.js';

const JUMBO = tienda('jumbo')!;

// Copia de la forma real observada en el payload RSC de jumbo.cl.
const ITEM_LIST = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  numberOfItems: 2,
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      url: 'https://www.jumbo.cl/arroz-grado-1-tucapel-gran-seleccion-grano-largo-y-ancho-1-kg/p',
      name: 'Arroz Grado 1 Tucapel Gran Seleccion Grano Largo y Ancho 1 kg',
      item: {
        '@type': 'Product',
        name: 'Arroz Grado 1 Tucapel Gran Seleccion Grano Largo y Ancho 1 kg',
        url: 'https://www.jumbo.cl/arroz-grado-1-tucapel-gran-seleccion-grano-largo-y-ancho-1-kg/p',
        brand: { '@type': 'Brand', name: 'Tucapel' },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'CLP',
          price: 1790,
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
        },
      },
    },
    {
      '@type': 'ListItem',
      position: 2,
      url: 'https://www.jumbo.cl/arroz-grado-2-tucapel-1-kg/p',
      name: 'Arroz Grado 2 Tucapel Blue 1 kg',
      item: {
        '@type': 'Product',
        name: 'Arroz Grado 2 Tucapel Blue 1 kg',
        url: 'https://www.jumbo.cl/arroz-grado-2-tucapel-1-kg/p',
        brand: { name: 'Tucapel' },
        offers: { price: 1490, availability: 'https://schema.org/OutOfStock' },
      },
    },
  ],
};

describe('mapearJsonLd', () => {
  it('extrae nombre, marca, url y precio', () => {
    const [primera] = mapearJsonLd(JUMBO, [ITEM_LIST]);
    expect(primera).toMatchObject({
      tienda: 'jumbo',
      sku: 'arroz-grado-1-tucapel-gran-seleccion-grano-largo-y-ancho-1-kg',
      marca: 'Tucapel',
      precioLista: 1790,
      disponible: true,
    });
  });

  it('marca como no disponible lo que esta OutOfStock', () => {
    expect(mapearJsonLd(JUMBO, [ITEM_LIST])[1]!.disponible).toBe(false);
  });

  it('no inventa precio de socio ni escalas: schema.org no los tiene', () => {
    const [primera] = mapearJsonLd(JUMBO, [ITEM_LIST]);
    expect(primera!.precioSocio).toBeUndefined();
    expect(primera!.escalas).toEqual([]);
  });

  it('acepta brand como string plano', () => {
    const lista = { '@type': 'ItemList', itemListElement: [
      { item: { name: 'Arroz 1 kg', url: 'https://x.cl/arroz/p', brand: 'Tucapel', offers: { price: 990 } } },
    ] };
    expect(mapearJsonLd(JUMBO, [lista])[0]!.marca).toBe('Tucapel');
  });

  it('acepta offers como arreglo y toma la primera con precio', () => {
    const lista = { '@type': 'ItemList', itemListElement: [
      { item: { name: 'Arroz 1 kg', url: 'https://x.cl/arroz/p', offers: [{ price: 0 }, { price: 1290 }] } },
    ] };
    expect(mapearJsonLd(JUMBO, [lista])[0]!.precioLista).toBe(1290);
  });

  it('deduplica el mismo producto repetido en varios bloques', () => {
    expect(mapearJsonLd(JUMBO, [ITEM_LIST, ITEM_LIST])).toHaveLength(2);
  });

  it('ignora bloques que no son ItemList', () => {
    expect(mapearJsonLd(JUMBO, [{ '@type': 'WebSite', name: 'Jumbo.cl' }, null, 42])).toEqual([]);
  });

  it('descarta elementos sin precio utilizable', () => {
    const lista = { '@type': 'ItemList', itemListElement: [
      { item: { name: 'Sin precio', url: 'https://x.cl/a/p' } },
      { item: { name: 'Precio cero', url: 'https://x.cl/b/p', offers: { price: 0 } } },
    ] };
    expect(mapearJsonLd(JUMBO, [lista])).toEqual([]);
  });
});
