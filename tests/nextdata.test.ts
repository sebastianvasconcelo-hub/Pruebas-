import { describe, expect, it } from 'vitest';
import {
  buscarProductos,
  extraerBuildId,
  extraerFlight,
  extraerJsonIncrustado,
  extraerNextData,
} from '../src/descubrir/nextdata.js';

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

describe('extraerFlight (App Router)', () => {
  const HTML_APP = `<!doctype html><html><body>
<script>self.__next_f.push([1,"3:{\\"nada\\":1}\\n"])</script>
<script>self.__next_f.push([1,"4:{\\"productos\\":[{\\"nombre\\":\\"Arroz Tucapel 1 kg\\",\\"precio\\":1490},{\\"nombre\\":\\"Arroz Miraflores 5 kg\\",\\"precio\\":5990}]}\\n"])</script>
</body></html>`;

  it('concatena los chunks y los desescapa', () => {
    expect(extraerFlight(HTML_APP)).toContain('"nombre":"Arroz Tucapel 1 kg"');
  });

  it('devuelve vacio si la pagina no usa App Router', () => {
    expect(extraerFlight('<html><body>hola</body></html>')).toBe('');
  });

  it('ignora chunks rotos sin perder los buenos', () => {
    const roto = '<script>self.__next_f.push([1,"ok:1\\n"])</script>' + HTML_APP;
    expect(extraerFlight(roto)).toContain('Arroz Tucapel');
  });

  it('encuentra los productos dentro del stream', () => {
    const bloques = extraerJsonIncrustado(extraerFlight(HTML_APP), { minLargo: 40 });
    const candidatos = bloques.flatMap((b) => buscarProductos(b));
    expect(candidatos[0]).toMatchObject({ ruta: 'productos', cantidad: 2 });
  });
});

describe('extraerJsonIncrustado', () => {
  it('no se confunde con llaves dentro de strings', () => {
    const texto = 'x:{"nota":"esto { no cierra","valor":42,"otro":"[]"}';
    expect(extraerJsonIncrustado(texto, { minLargo: 10 })).toEqual([
      { nota: 'esto { no cierra', valor: 42, otro: '[]' },
    ]);
  });

  it('respeta las comillas escapadas', () => {
    const texto = 'a:{"txt":"comilla \\" adentro","n":1,"mas":"relleno relleno"}';
    expect(extraerJsonIncrustado(texto, { minLargo: 10 })).toHaveLength(1);
  });

  it('descarta bloques que no cierran', () => {
    expect(extraerJsonIncrustado('a:{"abierto":"sin cierre"', { minLargo: 5 })).toEqual([]);
  });

  it('ignora fragmentos demasiado cortos', () => {
    expect(extraerJsonIncrustado('a:{"n":1}', { minLargo: 120 })).toEqual([]);
  });
});
