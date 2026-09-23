# Comparador de supermercados

Spike de viabilidad tecnica: recolectar precios de supermercados chilenos y
compararlos aplicando tus reglas reales de compra (membresia, cashback del
jueves, escalas por cantidad de Alvi y costo de tener bodega).

Estado: **funcionando contra Alvi y Jumbo.** El motor de precios esta completo
y testeado, el adapter de Alvi esta validado contra datos reales del sitio, y
el de Jumbo entrega nombre, marca, url y precio con la limitacion descrita mas
abajo. Santa Isabel, Unimarc y Lider siguen sin explorar.

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
| Mapeo del HTML de Alvi -> oferta | no (usa fixtures) | testeado con datos reales |
| Mapeo del JSON-LD de Jumbo -> oferta | no (usa fixtures) | testeado |
| Mapeo de la ficha de Jumbo -> oferta | no (usa fixtures) | testeado con datos reales |
| Llamada HTTP a las tiendas | si | funciona |

## Partida rapida

```bash
npm install
npm test          # 243 tests, todos offline
```

### Comparar

```bash
npm run comparar -- "arroz" --cantidad 3 --fecha 2026-09-24
npm run comparar -- "arroz" --offline     # usando los fixtures, sin red
```

Con los datos reales de Alvi, el arroz Tucapel G2 1 Kg sale asi:

```
>> alvi         $1.386/kg          total $4.157
     Arroz Tucapel gran seleccion G2 1 Kg
     unitario $1.490 (escala)  cashback -$313
     - escala desde 3 un: socio Alvi, 3+ un, 29% dcto
     - Jueves 7% tarjeta B6: -$313
```

$2.090 de lista, $1.490 llevando 3 o mas, menos el 7% del jueves: $1.386 por
kilo. Esa cadena de descuentos es justamente lo que no se ve en la vitrina.

Las escalas que **no** aplican a la cantidad consultada se muestran igual:

```
>> alvi         $2.090/kg          total $2.090
     Arroz Tucapel gran seleccion G2 1 Kg
     unitario $2.090 (lista)
     llevando 3+ un: $1.490 c/u ($1.490/kg)  -28.7%
     llevando 10+ un: $1.450 c/u ($1.450/kg)  -30.6%
```

Una escala mayorista que hoy no se aplica sigue siendo informacion: es lo que
permite decidir si conviene llevar mas. Ocultarla reduciria la herramienta a
una calculadora de precio unitario, justo en el caso de uso que mas importa.
Los tramos que exigen una membresia que no tienes tambien se listan, marcados:
saber que existe un precio al que no llegas tambien es una decision informada.

**El `detailUrl` de Alvi apunta a una ruta que su propio sitio abandono.** Lo
publica con la convencion de VTEX (`/<slug>/p`) mientras su storefront sirve
las fichas en `/product/<slug>`, asi que copiar el campo tal cual produce un
enlace que responde 404. Esa es la causa del 404 que aparecio al pedir la ficha
desde el codigo, que en su momento se atribuyo primero a una ruta inexistente y
despues a una supuesta exigencia de sesion: ninguna de las dos era.

Por eso la ruta de ficha es parte de la configuracion de cada tienda
(`rutaFicha`) y no un supuesto del adapter, y la url se arma desde el slug.

**Los tramos de Alvi exigen Club Alvi.** La ficha del producto los publica bajo
el encabezado "Socio", junto a un "Unete al Club Alvi", y el precio regular
($2.090) se paga igual compres 1 o compres 20. Por eso las escalas se marcan
`requiereMembresia` y el motor solo las aplica si tu perfil declara esa
membresia; si no, usa el precio regular y avisa cuanto te estas perdiendo.
Se configura en `src/precios/reglas.ts`.

### La pregunta que responde

No es "cuanto cuesta comprar N unidades" sino al reves: **cual es el precio mas
barato al que puedes llegar, y cuanta cantidad exige**. Quien compra por volumen
en un mayorista, con cuotas sin interes y espacio para guardar, decide cuanto
llevar en funcion del precio, no antes de mirarlo. Por eso la cantidad es parte
de la respuesta y no un dato de entrada.

```
>> alvi       $1.450/kg      llevando  10 un    total $14.500
     Arroz Tucapel gran seleccion G2 1 Kg
     -30.6% respecto de llevar 1 un ($2.090/kg)
```

El orden entre tiendas es por el mejor precio que cada una permite alcanzar, no
por lo que cuesta una unidad: un mayorista puede ser mas caro al detalle y el
mas barato llevando volumen, y ordenar por precio unitario lo dejaria segundo.

Cuando no quieras llevarte la bodega entera:

```bash
npm run comparar -- --producto <id> --maximo 12
npm run canasta -- --maximo 12
```

Y para el precio a una cantidad exacta, sin proponer otra:

```bash
npm run comparar -- --producto <id> --cantidad 3
```

`cantidadHabitual` pasa a ser la referencia contra la que se mide el ahorro, no
la cantidad que se compra.

### La canasta habitual

El caso de uso real no es "cual es el arroz mas barato" sino "mi leche Colun
semidescremada de siempre, donde conviene comprarla hoy". Los productos son
fijos, las marcas tambien, y lo que cambia son las ofertas.

```bash
npm run canasta
npm run canasta -- --fecha 2026-09-24
```

Recorre el catalogo completo, trae los precios de cada tienda y **pone primero
lo que cambio de tienda desde la ultima corrida**. Esa es la informacion que
justifica la herramienta: el producto que compras siempre en una cadena y que
esta semana, excepcionalmente, conviene en la otra.

Tambien calcula lo que cuesta repartir la compra frente a hacerla toda en una
sola tienda, contando solo las tiendas que cubren la canasta entera: un total
bajo con media cobertura no es comparable.

El historial queda en `historial.json`.

Cuando un producto aparece con una sola tienda, la salida lo dice y distingue
las dos causas, porque piden acciones distintas: la tienda **no esta mapeada**
en el catalogo (se arregla con `emparejar`) o **si lo esta pero hoy no devolvio
datos** (se reintenta). Una tabla de una fila no es una comparacion y no debe
presentarse como tal.

Para ver o limpiar lo registrado:

```bash
npm run catalogo
npm run catalogo -- --borrar <id>
```

### Producto canonico: comparar el mismo articulo

Buscar el mismo texto en cada tienda no compara nada: enfrenta lo mas barato de
una contra lo mas barato de otra, que suelen ser productos distintos. El
catalogo canonico arregla eso.

```bash
npm run emparejar -- "arroz tucapel"
```

Busca en todas las tiendas soportadas y:

- **Empareja solo lo que puede probar.** Si el EAN coincide, lo registra sin
  preguntar: eso no es un indicio, es identidad.
- **Pregunta el resto**, mostrando candidatas ordenadas por parecido y diciendo
  en que se basa cada puntaje ("misma marca", "formato distinto", "EAN
  distintos"). La decision es tuya; el programa no adivina.
- **Lo guarda en `catalogo.json`** y no lo vuelve a preguntar.

Despues:

```bash
npm run comparar -- --producto arroz-tucapel-g2-1-kg --cantidad 3
npm run catalogo                 # lo registrado hasta ahora
```

Cuando el producto esta en el catalogo, el comparador busca en cada tienda por
el nombre que esa tienda usa, elige la oferta por SKU, EAN, URL o nombre exacto
y compara el mismo articulo.

La URL no es redundante: una misma tienda puede entregar identificadores
distintos segun de donde venga el dato. La busqueda de Jumbo publica un
ItemList de schema.org sin sku, asi que se deriva del slug de la direccion,
mientras que la ficha entrega su `skuId` numerico.

El nombre es el ultimo recurso, y existe porque **el sku guardado deja de
calzar aunque el articulo siga en el catalogo de la tienda**. Se observo con
Jumbo apenas cinco minutos despues de emparejar, asi que no es cosa de que el
dato envejezca. Las causas conocidas:

- **Listados duplicados**: Jumbo publica el mismo producto bajo mas de una
  direccion, delatadas por sufijos como `-2` al final del slug. Emparejas con
  uno y la busqueda devuelve el otro.
- **Consultas distintas dan resultados distintos**: al emparejar se busca con
  las palabras de la persona y al comparar con el nombre guardado, que no
  devuelven el mismo conjunto.

Cuando algo calza por nombre, la salida muestra el sku guardado y el recibido,
que es lo que permite distinguir un caso del otro. Se exige igualdad exacta del
nombre normalizado, nunca parecido, porque un falso positivo aqui compara
productos distintos. Cuando algo calza asi, la salida lo dice, porque significa
que el catalogo quedo desactualizado:

```bash
npm run catalogo -- --reparar
```

Vuelve a consultar cada equivalencia y actualiza sku y url cuando el nombre
coincide exacto. Conserva quien confirmo el emparejamiento y cuando: refrescar
un identificador caduco no cambia la decision de que son el mismo producto. Ahi el ahorro que
reporta es real, y por eso deja de mostrar las advertencias de equivalencia.

### Dos cantidades que no son lo mismo

| Campo | Que es | Para que sirve |
|---|---|---|
| `cantidadHabitual` | unidades que llevas en **cada compra** | decide a que cantidad se compara, y por tanto que escalas mayoristas aplican |
| `consumoMensual` | unidades que gastas **al mes** | costo de bodega y meses de stock |

Son independientes: se pueden consumir 24 al mes y llevar 6 por visita.
Confundirlas cambia el resultado, porque declarar el consumo mensual no hace
que la comparacion se haga a esa cantidad.

`emparejar` pregunta ambas. Para ajustarlas despues sin volver a emparejar:

```bash
npm run catalogo -- --cantidad leche-colun 6
npm run catalogo -- --consumo  leche-colun 24
```

`npm run comparar --producto <id>` usa la cantidad habitual del producto salvo
que se pase `--cantidad`.

### Herramientas de diagnostico (esto lo corres tu)

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
produce 404 sin informacion.

El comando prueba tres formatos, en orden:

1. **`__NEXT_DATA__`** (Pages Router, Next.js 12 y anteriores).
2. **Chunks `self.__next_f.push([...])`** (App Router, Next.js 13+). Es el caso
   de Jumbo: devuelve HTTP 200 sin `__NEXT_DATA__` porque manda el payload de
   React Server Components en ese formato. Como el stream de RSC no es JSON
   sino lineas `id:valor`, se rescatan los fragmentos que parseen como objeto o
   arreglo en vez de implementar un formato interno que cambia sin aviso.
3. **`/_next/data/<buildId>/<ruta>.json`**, que a veces trae mas props que el
   HTML inicial.

En los tres casos recorre el JSON buscando arreglos que parezcan productos,
reporta donde estan y que claves de precio traen, y guarda el payload en
`fixtures/`. Siempre guarda tambien el HTML crudo, que sirve de evidencia
aunque la extraccion falle.

### Cuando la extraccion no encuentra nada

`npm run nextdata` guarda siempre el HTML crudo, asi que la pregunta se puede
responder sin volver a la red:

```bash
npm run inspeccionar -- fixtures/alvi-arroz.html --buscar tucapel
```

Distingue los dos casos que importan:

- **El nombre aparece pero ninguna lista pasa el filtro** -> el detector esta
  mal y hay que ajustarlo. Para eso el comando imprime el inventario de claves
  relevantes con un ejemplo y su ruta.
- **El nombre no aparece en ninguna parte** -> el catalogo no viaja en el HTML
  y hay que ir por la peticion XHR.

En el segundo caso la respuesta la da el sitio: DevTools -> Network -> filtro
Fetch/XHR -> buscar un producto. Esa peticion es la ruta a implementar.

## Donde estan los datos, confirmado

Verificado el 2026-09-19 sobre el HTML real de cada sitio.

### Alvi: `__NEXT_DATA__`, esquema completo

```
props.pageProps.dehydratedState.queries[0].state.data.availableProducts  -> 50 productos
```

Trae `productId`, `itemId`, `sku`, `ean`, `name`, `nameComplete`, `brand`,
`measurementUnit`, `unitMultiplier`, `sellers[].price / listPrice /
priceWithoutDiscount / inOffer` y, lo mas importante, **`priceSteps`**: las
escalas mayoristas vienen estructuradas, con `promotionalPrice`, en vez de
texto de promocion. El parser de "Llevando 3 o mas $X" queda como respaldo para
otras cadenas, no hace falta para Alvi.

El gramaje tambien viene estructurado (`measurementUnit`, `unitMultiplier`), asi
que deducirlo del nombre pasa a ser el plan B.

### Jumbo: JSON-LD de schema.org, parcial

El catalogo no viaja como datos de aplicacion, pero el payload RSC incluye un
`ItemList` de schema.org con 40 resultados: `name`, `brand.name`, `url` y
`offers.price`.

**Limitacion:** schema.org define un solo precio por oferta. El ItemList de la
busqueda no distingue precio normal de precio Prime, ni trae escalas ni EAN.
Sirve para comparar, no para modelar la membresia.

### La ficha de Jumbo si trae el precio Prime

Confirmado sobre el HTML real: la ficha manda un objeto `product` con
`items[].promotions[]`, y cada promocion declara a quien aplica.

```json
{
  "description": "JUMBO VINA, QUESO Y CERVEZA DEL MES PRIME SEPT",
  "type": "percentual", "value": 35,
  "unitPrice": 4544, "ppumPrice": 9088,
  "mQuantity": 1, "nQuantity": 0,
  "paymentMethods": "ALL",
  "userProperties": "PRIME_USER"
}
```

`userProperties` es lo que faltaba: distingue el precio Prime del abierto a
cualquiera. `interpretarPromociones()` las separa en precio de socio (cuando
aplican desde la primera unidad) y escalas por cantidad, marcando las que
exigen membresia.

Deliberadamente **no** se deduce el precio desde el porcentaje: 35% de $5.890
da $3.828,5 y cualquier redondeo propio se desviaria de la caja. Si la
promocion no declara `unitPrice`, no hay precio.

La ficha tambien trae el formato resuelto (`unitMultiplierUn: 0.5`,
`measurementUnitUn: "kg"` para un envase de 500 g) y el ppum de la tienda, que
sirve de contraste: el motor calcula $9.088/kg con Prime y $11.780/kg sin
Prime, los mismos valores que muestra la pagina.

**Jumbo no expone EAN.** El emparejamiento con Alvi no se puede automatizar por
codigo de barras y queda en confirmacion manual, producto por producto.

Esto implica traer la ficha de cada producto, no solo la pagina de busqueda,
asi que el flujo real queda partido en dos:

- **Busqueda** para descubrir productos y emparejarlos, una sola vez.
- **Ficha** para los precios exactos, cada vez que compares.

La ficha se pide **solo donde la busqueda se queda corta**, o sea en Jumbo. La
busqueda de Alvi ya trae precios, priceSteps, formato y EAN; ademas, la ruta de
ficha que declara su catalogo (`detailUrl`) responde 404, asi que pedirla solo
perdia el producto. Si una ficha falla, se cae a la busqueda en vez de quedarse
sin datos.

El catalogo canonico guarda la URL de cada equivalencia justamente para eso:
son ~150 fichas, una por producto registrado.

### Santa Isabel, Unimarc y Lider

Sin verificar. Quedan marcadas como no soportadas en el registro de tiendas
hasta comprobar su ruta de busqueda y su formato.

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
    inspeccionar.ts        analiza un archivo ya descargado, sin red
    emparejar.ts           registra un producto canonico, preguntando lo que no puede probar
    catalogo.ts            muestra el catalogo canonico
    canasta.ts             la compra completa: donde conviene cada producto hoy
  canasta/
    evaluar.ts             recorre la canasta y detecta cambios de tienda
  canonico/
    tipos.ts               producto canonico y equivalencias por tienda
    similitud.ts           puntaje de parecido; EAN es prueba, el resto indicio
    catalogo.ts            carga, busqueda y actualizacion de catalogo.json
  descubrir/
    nextdata.ts            __NEXT_DATA__, chunks de App Router y busqueda de productos
    comparar.ts            compara un producto entre tiendas
```

## Nada se descarta en silencio

Un filtro que bota datos sin dejar rastro es peor que una excepcion: no avisa y
el resultado se ve igual de legitimo. Paso una vez, con una oferta de Jumbo que
desaparecia por un identificador que no calzaba, y la salida mostraba una sola
tienda como si fuera una comparacion.

`src/diagnostico.ts` registra lo que cada etapa bota y por que. Los mapeadores
reciben el registro de forma opcional, asi que sin el se comportan igual que
antes. Las CLI avisan cuando hubo descartes y los detallan con `--diagnostico`:

```bash
npm run canasta -- --diagnostico
npm run comparar -- --producto <id> --diagnostico
```

```
DESCARTES (3)
   jumbo            2x  12 oferta(s) recibidas, ninguna calza con sku "leche-colun-1l", ean ni url
                        ej: Leche Colun semidescremada 1 L
   alvi             1x  sin precio utilizable en sellers
                        ej: Leche descremada Colun 1 L
```

Caso aparte es el catalogo: que `catalogo.json` no exista es normal la primera
vez y da un catalogo vacio, pero que exista y este corrupto **no** es lo mismo.
Confundirlos haria creer que se perdieron los productos cuando el archivo esta
ahi, asi que eso falla con un mensaje que dice que no se borro nada.

## Limites conocidos

- **No hay matching entre cadenas todavia.** Hoy se busca el mismo texto en
  cada tienda y se toma lo mas barato de cada una, asi que los ganadores pueden
  no ser el mismo producto. En la primera corrida real salio "Arroz Merkat 1 Kg"
  (marca propia de Alvi) contra "Arroz Tucapel Blue 1 kg" de Jumbo: la
  diferencia de precio era real, la comparacion no.

  Ya existe el catalogo canonico (`npm run emparejar`) que lo resuelve producto
  por producto. Mientras un producto no este registrado,
  `advertenciasEquivalencia()` detecta el problema por EAN, marca y unidad de
  medida, y el comparador se niega a presentar el ahorro como si fuera
  comparable.
- **El dedup por tienda elige por `$/kg`**, pero si la busqueda trae productos
  que no son equivalentes (arroz grado 1 vs grado 2) la comparacion es
  injusta. Eso lo resuelve el matching, no el dedup.
- **Uso personal.** Ritmo bajo, con cache y sin redistribuir los datos. No
  conviertas esto en un servicio publico sin asesoria legal.
