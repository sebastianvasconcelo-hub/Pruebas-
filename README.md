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
npm test          # 47 tests, todos offline
```

### Paso 1: validar que las APIs responden (esto lo corres tu)

```bash
npm run probe -- arroz
```

Por cada tienda VTEX reporta si responde, si devuelve JSON o HTML, cuantas
ofertas salieron y que campos de precio traen. Guarda la respuesta cruda en
`fixtures/` para poder seguir trabajando despues sin red.

Criterio de exito: si al menos Jumbo y Alvi devuelven JSON con precios, el
proyecto es viable y lo que sigue es trabajo conocido. Si devuelven 403 o HTML,
hay proteccion anti-bot y toca ir por navegador headless.

### Paso 2: comparar

```bash
npm run comparar -- "arroz grado 1" --cantidad 3 --fecha 2026-09-24
npm run comparar -- "arroz" --offline     # usando los fixtures, sin red
```

## Que falta validar (en orden de importancia)

Estas son hipotesis del codigo, no hechos comprobados. `npm run probe` sirve
justamente para confirmarlas o tumbarlas.

1. **Que el endpoint publico de VTEX siga abierto.** `src/adapters/vtex.ts`
   asume `GET /api/catalog_system/pub/products/search?ft=...` sin
   autenticacion.
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
