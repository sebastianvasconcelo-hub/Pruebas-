# Comparador de supermercados

Spike de viabilidad tecnica: recolectar precios de supermercados chilenos y
compararlos aplicando tus reglas reales de compra (membresia, cashback del
jueves, escalas por cantidad de Alvi y costo de tener bodega).

Estado: **prototipo sin validar contra las APIs reales.** El motor de precios
esta completo y testeado; los adapters estan escritos pero nadie los ha
ejecutado todavia contra Jumbo o Alvi.

## Por que esta dividido asi

El codigo se escribio en un contenedor cuya politica de red bloquea la salida
hacia `jumbo.cl`, `alvi.cl` y el resto de las cadenas. Eso obligo a una
separacion que igual conviene: **todo lo que no depende de la red esta
testeado, y todo lo que depende de la red esta aislado en dos comandos**.

| Pieza | Depende de la red | Estado |
|---|---|---|
| Parser de formatos (`$/kg`, `$/L`) | no | testeado |
| Parser de promociones y escalas | no | testeado |
| Motor de precio efectivo | no | testeado |
| Mapeo de la respuesta VTEX -> oferta | no (usa fixtures) | testeado con fixture sintetico |
| Llamada HTTP a las tiendas | si | **sin validar** |

## Partida rapida

```bash
npm install
npm test          # 56 tests, todos offline
```

### Paso 1: validar que las APIs responden (esto lo corres tu)

```bash
npm run probe -- arroz
```

Por cada tienda VTEX reporta si responde, si devuelve JSON o HTML, cuantas
ofertas salieron y que campos de precio traen. Guarda la respuesta cruda en
`fixtures/` para poder seguir trabajando despues sin red.

Si el probe falla, `npm run fingerprint` dice por que: que plataforma usa cada
sitio y que rutas candidatas responden.

Criterio de exito: si al menos Jumbo y Alvi devuelven JSON con precios, el
proyecto es viable y lo que sigue es trabajo conocido. Si devuelven 403 o HTML,
hay proteccion anti-bot y toca ir por navegador headless.

### Paso 2: comparar

```bash
npm run comparar -- "arroz grado 1" --cantidad 3 --fecha 2026-09-24
npm run comparar -- "arroz" --offline     # usando los fixtures, sin red
```

## Hallazgo: la ruta clasica de VTEX no responde

Ejecutado el 2026-09-19 desde una conexion residencial en Chile:

| Tienda | `/api/catalog_system/pub/products/search` |
|---|---|
| Jumbo | HTTP 404 (text/html) |
| Alvi | HTTP 404 (text/html) |
| Santa Isabel | HTTP 404 (text/html) |
| Unimarc | HTTP 500 |

**404, no 403**: no es un bloqueo anti-bot, la ruta simplemente no existe en el
dominio publico.

`npm run fingerprint` explico por que. Las cinco cadenas son storefronts
**Next.js**:

| Cadena | Rastros | Rutas VTEX probadas |
|---|---|---|
| Jumbo | vtexassets + Next.js, tras CloudFront | 404 en las 5 |
| Santa Isabel | vtexassets, `server: nginx, Cencosud` | 404 en las 5 |
| Alvi | Next.js | 404 en las 5 |
| Unimarc | Next.js | 500 en 4, 404 en 1 |
| Lider | Next.js | 404 en las 5 |

Jumbo y Santa Isabel siguen sirviendo imagenes desde `vtexassets.com`, asi que
el catalogo por detras sigue siendo VTEX: lo que cambio es que Cencosud puso un
storefront propio delante y el borde dejo de enrutar el API de plataforma al
dominio publico.

### Camino actual: leer el HTML, no el API

Una app Next.js tiene que entregarle los datos al navegador, y normalmente los
incrusta en `<script id="__NEXT_DATA__">`. Si los productos vienen ahi, no hace
falta API:

```bash
npm run nextdata -- "https://www.jumbo.cl/search?q=arroz"
```

Hay que pasarle la URL real de busqueda del sitio (la que queda en la barra de
direcciones al buscar), porque cada cadena usa la suya y adivinarla solo
produce 404 sin informacion. El comando extrae el `__NEXT_DATA__`, recorre el
JSON buscando arreglos que parezcan productos, reporta donde estan y que claves
de precio traen, y guarda el payload en `fixtures/`. Si el HTML no alcanza,
reintenta contra `/_next/data/<buildId>/<ruta>.json`.

Si tampoco aparece nada, los datos se cargan por XHR despues de pintar y la
respuesta definitiva la da el sitio: DevTools -> Network -> filtro Fetch/XHR ->
buscar un producto. Esa peticion es la ruta a implementar.

## Que falta validar (en orden de importancia)

Estas son hipotesis del codigo, no hechos comprobados.

1. **Donde esta realmente la API de cada cadena.** La hipotesis original
   (`/api/catalog_system/pub/products/search`) quedo descartada arriba. El
   mapeo de `src/adapters/vtex.ts` sigue siendo valido si la cadena expone la
   API clasica en otro host; si usa Intelligent Search, el esquema de respuesta
   es distinto y hay que escribir un segundo mapeo.
2. **Que `Price < ListPrice` signifique precio de socio.** Es la hipotesis mas
   fragil: puede que sea solo una promocion general, y que el precio Prime o
   socio Alvi requiera sesion iniciada. Compara lo que devuelve el probe contra
   lo que ves en el sitio con tu sesion abierta.
3. **Que las escalas mayoristas vengan en `Teasers`.** El parser cubre
   "Llevando 3 o mas $X", "3 x $X", "Nda unidad N%" y "Lleva N paga M". Si Alvi
   usa otra redaccion, `Oferta.promoTexto` guarda el texto crudo para poder
   agregar el patron.
4. **El canal de venta / tienda.** Los precios VTEX cambian por comuna. Fija
   `VTEX_SALES_CHANNEL` en `.env` o comparas peras con manzanas.
5. **Lider queda fuera.** No es VTEX, tiene API propia con proteccion. Esta
   declarado en el registro con `soportado: false`.

## Como funciona el motor de precios

`src/precios/efectivo.ts` calcula lo que *de verdad* cuesta una compra, en este
orden:

1. Precio base, eligiendo entre lista y socio segun tus membresias.
2. Escala por cantidad, si mejora el precio anterior.
3. Cashback del jueves con la B6, sobre el subtotal (es reembolso de la
   tarjeta, no descuento en caja).
4. Costo financiero: cero con cuotas sin interes.
5. Costo de bodega: cada unidad pasa guardada en promedio la mitad del tiempo
   que dura el stock, de ahi el `/2`.
6. Normalizacion a `$/kg` o `$/L`, que es lo unico comparable entre cadenas.

Tus reglas estan en `src/precios/reglas.ts` (`PERFIL_POR_DEFECTO`). Ahi se
ajusta el porcentaje de cashback, el dia, las membresias y cuanto te cuesta la
bodega.

`mejorCantidad()` responde la pregunta de fondo: comprar semanal o llenar la
bodega para tres meses. Si subes `costoBodegaMensualPorUnidad`, la respuesta
cambia sola.

## Estructura

```
src/
  tipos.ts                 Oferta, Escala, Contenido
  adapters/
    vtex.ts                Jumbo, Alvi, Santa Isabel, Unimarc (mapeo puro + fetch)
    index.ts               registro de tiendas
  normalizar/
    unidad.ts              "1,5 L" / "6x1,5 L" / "900 cc" -> litros
    promo.ts               "Llevando 3 o mas $1.290" -> escala
  precios/
    reglas.ts              tu perfil de compra
    efectivo.ts            motor de precio efectivo y comparacion
  cli/
    probe.ts               valida las APIs reales
    fingerprint.ts         descubre plataforma y rutas cuando el probe falla
    nextdata.ts            extrae productos del HTML de storefronts Next.js
  descubrir/
    nextdata.ts            parseo de __NEXT_DATA__ y busqueda de productos
    comparar.ts            compara un producto entre tiendas
```

## Limites conocidos

- **No hay matching entre cadenas todavia.** Hoy se busca el mismo texto en
  cada tienda. El paso siguiente es una tabla de producto canonico con el EAN
  cuando exista y confirmacion manual cuando no.
- **El dedup por tienda elige por `$/kg`**, pero si la busqueda trae productos
  que no son equivalentes (arroz grado 1 vs grado 2) la comparacion es
  injusta. Eso lo resuelve el matching, no el dedup.
- **Uso personal.** Ritmo bajo, con cache y sin redistribuir los datos. No
  conviertas esto en un servicio publico sin asesoria legal.
