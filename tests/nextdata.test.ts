import { describe, expect, it } from 'vitest';
import {
  buscarProductos,
  extraerBuildId,
  extraerFlight,
  extraerJsonIncrustado,
  extraerNextData,
  inventarioClaves,
  buscarTexto,
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

describe('buscarProductos con formas reales', () => {
  it('encuentra productos con el precio anidado al estilo VTEX', () => {
    // El nombre esta arriba y el precio cuatro niveles mas abajo.
    const vtex = {
      props: {
        pageProps: {
          products: [
            {
              productName: 'Arroz Tucapel 1 kg',
              items: [{ sellers: [{ commertialOffer: { Price: 1490, ListPrice: 1690 } }] }],
            },
            {
              productName: 'Arroz Miraflores 5 kg',
              items: [{ sellers: [{ commertialOffer: { Price: 5990, ListPrice: 5990 } }] }],
            },
          ],
        },
      },
    };
    expect(buscarProductos(vtex)[0]).toMatchObject({
      ruta: 'props.pageProps.products',
      cantidad: 2,
    });
  });

  it('acepta precios serializados como texto', () => {
    const json = {
      items: [
        { nombre: 'Arroz 1 kg', precio: '1.490' },
        { nombre: 'Arroz 5 kg', precio: '$5.990' },
      ],
    };
    expect(buscarProductos(json)[0]).toMatchObject({ ruta: 'items', cantidad: 2 });
  });

  it('sigue sin confundir banners que no tienen precio en ninguna parte', () => {
    const json = { banners: [{ title: 'Oferta', href: '/a' }, { title: 'Otra', href: '/b' }] };
    expect(buscarProductos(json)).toEqual([]);
  });

  it('no toma por precio un cero o un texto no numerico', () => {
    const json = {
      items: [
        { nombre: 'Sin stock', precio: 0 },
        { nombre: 'Consultar', precio: 'a convenir' },
      ],
    };
    expect(buscarProductos(json)).toEqual([]);
  });
});

describe('inventarioClaves', () => {
  const json = {
    props: {
      productos: [
        { productName: 'Arroz Tucapel 1 kg', items: [{ sellers: [{ commertialOffer: { Price: 1490 } }] }] },
        { productName: 'Arroz Miraflores 5 kg', items: [{ sellers: [{ commertialOffer: { Price: 5990 } }] }] },
      ],
    },
  };

  it('reporta las claves que coinciden con el patron, con un ejemplo', () => {
    const inv = inventarioClaves(json, /price|productname/i);
    expect(inv.map((c) => c.clave).sort()).toEqual(['Price', 'productName']);
    expect(inv.find((c) => c.clave === 'Price')).toMatchObject({
      ruta: 'props.productos[0].items[0].sellers[0].commertialOffer.Price',
      ejemplo: 1490,
    });
  });

  it('resume los valores compuestos en vez de volcarlos', () => {
    const inv = inventarioClaves(json, /^items$/);
    expect(inv[0]!.ejemplo).toBe('[1 elementos]');
  });

  it('devuelve vacio cuando nada coincide', () => {
    expect(inventarioClaves(json, /inexistente/)).toEqual([]);
  });
});

describe('buscarTexto', () => {
  const json = { a: { b: 'Arroz Grado 1 Tucapel 1 kg' }, c: ['otro', 'TUCAPEL mayuscula'] };

  it('encuentra las rutas que contienen el texto, sin importar mayusculas', () => {
    const rutas = buscarTexto(json, 'tucapel');
    expect(rutas).toHaveLength(2);
    expect(rutas[0]).toContain('a.b =');
    expect(rutas[1]).toContain('c[1] =');
  });

  it('devuelve vacio si el texto no esta', () => {
    expect(buscarTexto(json, 'inexistente')).toEqual([]);
  });

  it('respeta el tope de resultados', () => {
    const muchos = { lista: Array.from({ length: 50 }, () => 'arroz') };
    expect(buscarTexto(muchos, 'arroz', 5)).toHaveLength(5);
  });
});
