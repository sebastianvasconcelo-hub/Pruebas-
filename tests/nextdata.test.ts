import { describe, expect, it } from 'vitest';
import { buscarProductos, extraerBuildId, extraerNextData } from '../src/descubrir/nextdata.js';

const HTML = `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">
{"buildId":"aBc123","props":{"pageProps":{"searchResult":{"products":[
  {"name":"Arroz Tucapel 1 kg","price":1490,"sku":"1"},
  {"name":"Arroz Miraflores 5 kg","price":5990,"sku":"2"}
]}}}}
</script></body></html>`;

describe('extraerNextData', () => {
  it('extrae el JSON embebido del HTML', () => {
    expect(extraerBuildId(extraerNextData(HTML))).toBe('aBc123');
  });

  it('devuelve null si la pagina no es Next.js', () => {
    expect(extraerNextData('<html><body>hola</body></html>')).toBeNull();
  });

  it('devuelve null si el bloque existe pero tiene JSON roto', () => {
    expect(extraerNextData('<script id="__NEXT_DATA__">{roto</script>')).toBeNull();
  });
});

describe('buscarProductos', () => {
  it('encuentra la lista de productos y reporta su ruta', () => {
    const [c] = buscarProductos(extraerNextData(HTML));
    expect(c).toMatchObject({ ruta: 'props.pageProps.searchResult.products', cantidad: 2 });
    expect(c!.claves).toEqual(['name', 'price', 'sku']);
  });

  it('reconoce precios anidados como price.value', () => {
    const json = { data: [{ nombre: 'Aceite 900 cc', precio: { value: 2990 } }, { nombre: 'Aceite 1 L', precio: { value: 3490 } }] };
    expect(buscarProductos(json)[0]).toMatchObject({ ruta: 'data', cantidad: 2 });
  });

  it('ignora arreglos que no son productos', () => {
    const json = { banners: [{ title: 'Oferta', href: '/a' }, { title: 'Otra', href: '/b' }] };
    expect(buscarProductos(json)).toEqual([]);
  });

  it('no confunde un arreglo mayoritariamente de banners', () => {
    const json = {
      mixto: [
        { title: 'Banner', href: '/a' },
        { title: 'Banner', href: '/b' },
        { title: 'Banner', href: '/c' },
        { name: 'Arroz', price: 1490 },
        { name: 'Fideos', price: 990 },
      ],
    };
    expect(buscarProductos(json)).toEqual([]);
  });

  it('ordena de mayor a menor cantidad', () => {
    const json = {
      pocos: [{ name: 'a', price: 1 }, { name: 'b', price: 2 }],
      muchos: [{ name: 'a', price: 1 }, { name: 'b', price: 2 }, { name: 'c', price: 3 }],
    };
    expect(buscarProductos(json).map((c) => c.ruta)).toEqual(['muchos', 'pocos']);
  });

  it('tolera ciclos sin colgarse', () => {
    const json: Record<string, unknown> = { a: 1 };
    json.self = json;
    expect(() => buscarProductos(json)).not.toThrow();
  });
});
