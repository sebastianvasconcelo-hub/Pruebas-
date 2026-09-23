/**
 * La PWA: muestra la canasta que el PC ya calculo.
 *
 * No hace ninguna cuenta. Todo sale de datos.json, que genera el mismo codigo
 * probado que usa la terminal.
 *
 * Los nombres de productos vienen de sitios de terceros, asi que nunca se
 * insertan como HTML: todo se arma con nodos y textContent, y solo se aceptan
 * enlaces https. Un nombre malicioso no puede ejecutar codigo en el telefono.
 */
import type { CambioPWA, DatosPWA, EscalaPWA, OpcionPWA, ProductoPWA } from '../src/publicar/vista.js';

const VERSION_ESPERADA = 1;
/** Despues de esto los datos se marcan como viejos: el PC no ha publicado. */
const HORAS_VIEJO = 30;

// ---------------------------------------------------------------------------
// Construccion segura del DOM

type Hijo = Node | string | number | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase?: string,
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  for (const h of hijos) {
    if (h === null || h === undefined || h === false) continue;
    nodo.append(typeof h === 'object' ? h : document.createTextNode(String(h)));
  }
  return nodo;
}

/** Solo https: una url de otro esquema no se convierte en enlace. */
function enlace(url: string | undefined, texto: string, clase: string): HTMLAnchorElement | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const a = el('a', clase, texto);
    a.href = u.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formato

const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const porcentaje = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const relativo = new Intl.RelativeTimeFormat('es-CL', { numeric: 'auto' });
const fechaHora = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function clp(n: number): string {
  return pesos.format(Math.round(n));
}

function unidad(base: string | undefined): string {
  return base && base !== 'un' ? `/${base}` : ' c/u';
}

function precioMedida(o: { porMedida?: number; base?: string; unitario: number }): string {
  return o.porMedida !== undefined ? `${clp(o.porMedida)}${unidad(o.base)}` : `${clp(o.unitario)} c/u`;
}

function haceCuanto(iso: string): { texto: string; horas: number } {
  const ms = Date.now() - new Date(iso).getTime();
  const horas = ms / 3_600_000;
  if (horas < 1) return { texto: relativo.format(-Math.max(1, Math.round(ms / 60_000)), 'minute'), horas };
  if (horas < 48) return { texto: relativo.format(-Math.round(horas), 'hour'), horas };
  return { texto: relativo.format(-Math.round(horas / 24), 'day'), horas };
}

function capitalizar(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normalizar(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function etiquetaTienda(id: string, nombre: string): HTMLSpanElement {
  return el('span', `tienda tienda-${id.replace(/[^a-z0-9]/g, '')}`, nombre);
}

// ---------------------------------------------------------------------------
// Piezas

const ICONO: Record<CambioPWA['tipo'], string> = { baja: '↓', alza: '↑', tramos: '＋', tienda: '⇄' };
/** Cual tipo pinta la tarjeta cuando un producto tiene varios cambios. */
const PRIORIDAD: CambioPWA['tipo'][] = ['tienda', 'baja', 'tramos', 'alza'];

/**
 * Una tarjeta por producto, con todos sus cambios dentro. Una por cambio
 * fragmentaba la leche en cuatro tarjetas seguidas.
 */
function tarjetaNovedad(cambios: CambioPWA[], nombresTienda: Map<string, string>): HTMLElement {
  const principal = PRIORIDAD.find((t) => cambios.some((c) => c.tipo === t)) ?? 'baja';
  const verificar = cambios.some((c) => c.verificar);
  return el(
    'li',
    `cambio cambio-${principal}${verificar ? ' cambio-verificar' : ''}`,
    el('span', 'cambio-icono', ICONO[principal]),
    el(
      'div',
      'cambio-cuerpo',
      el('p', 'cambio-producto', cambios[0]!.producto),
      el(
        'ul',
        'cambio-lineas',
        ...cambios.map((c) =>
          el(
            'li',
            'cambio-linea',
            etiquetaTienda(c.tienda, nombresTienda.get(c.tienda) ?? c.tienda),
            el('span', 'cambio-texto', c.texto),
            c.minimoHistorico ? el('span', 'cambio-marca', 'el más bajo registrado') : null,
            c.verificar ? el('span', 'cambio-marca cambio-marca-alerta', 'verificar: cambió el producto de referencia') : null,
          ),
        ),
      ),
    ),
  );
}

function seccionNovedades(d: DatosPWA): HTMLElement | null {
  if (d.cambios.length === 0) return null;
  const nombres = new Map<string, string>();
  for (const p of d.productos) {
    for (const o of [p.mejor, ...p.alternativas]) if (o) nombres.set(o.tienda, o.tiendaNombre);
  }
  const porProducto = new Map<string, CambioPWA[]>();
  for (const c of d.cambios) porProducto.set(c.productoId, [...(porProducto.get(c.productoId) ?? []), c]);

  return el(
    'section',
    'novedades',
    el('h2', '', 'Novedades'),
    el('ul', 'cambios', ...[...porProducto.values()].map((cs) => tarjetaNovedad(cs, nombres))),
  );
}

function lineaEscala(e: EscalaPWA): HTMLElement {
  return el(
    'li',
    e.usable ? 'escala' : 'escala escala-bloqueada',
    `Llevando ${e.min}+: `,
    el('strong', '', clp(e.precio)),
    ' c/u',
    e.porMedida !== undefined ? ` (${clp(e.porMedida)}${unidad(e.base)})` : '',
    ` · −${porcentaje.format(e.ahorroPorcentaje)}%`,
    e.usable ? null : el('span', 'escala-candado', ' · requiere membresía'),
  );
}

function lineaAlternativa(a: OpcionPWA): HTMLElement {
  return el(
    'li',
    'alternativa',
    etiquetaTienda(a.tienda, a.tiendaNombre),
    el('span', 'alternativa-precio', precioMedida(a)),
    el('span', 'alternativa-cantidad', `× ${a.cantidad}`),
  );
}

function tarjetaProducto(p: ProductoPWA): HTMLElement {
  if (p.sinDatos || !p.mejor) {
    return el(
      'article',
      'producto producto-sin-datos',
      el('h3', 'producto-nombre', p.nombre),
      el('p', 'sin-datos', 'Sin datos hoy en ninguna tienda'),
      p.faltan.length > 0 ? el('p', 'faltan', `Falta: ${p.faltan.join(', ')}`) : null,
    );
  }

  const m = p.mejor;
  const articulo = el(
    'article',
    'producto',
    el('div', 'producto-cabeza', el('h3', 'producto-nombre', p.nombre), etiquetaTienda(m.tienda, m.tiendaNombre)),
    el(
      'p',
      'precio',
      el('span', 'precio-valor', m.porMedida !== undefined ? clp(m.porMedida) : clp(m.unitario)),
      el('span', 'precio-unidad', m.porMedida !== undefined ? unidad(m.base) : ' c/u'),
    ),
    el(
      'p',
      'cantidad',
      'Llevando ',
      el('strong', '', m.cantidad),
      m.cantidad === 1 ? ' unidad' : ' unidades',
      el('span', 'separador', ' · '),
      `total ${clp(m.total)}`,
    ),
    // En el estante se ve la gondola, no el efectivo: sin esta linea la app
    // pareceria equivocarse justo en el pasillo.
    m.cashback > 0
      ? el('p', 'gondola', `En góndola ${clp(m.gondola)} c/u · cashback −${clp(m.cashback)}`)
      : null,
    m.ahorroVsReferencia
      ? el(
          'p',
          'ahorro',
          `${porcentaje.format(m.ahorroVsReferencia.porcentaje)}% menos que llevar ${m.ahorroVsReferencia.cantidad}`,
        )
      : null,
    p.antesConvenia ? el('p', 'antes', `Antes convenía ${p.antesConvenia}`) : null,
  );

  if (p.escalasPendientes.length > 0) {
    articulo.append(el('ul', 'escalas', ...p.escalasPendientes.map(lineaEscala)));
  }
  if (p.alternativas.length > 0) {
    articulo.append(el('ul', 'alternativas', ...p.alternativas.map(lineaAlternativa)));
  }
  if (p.faltan.length > 0) {
    articulo.append(el('p', 'faltan', `Sin comparar con: ${p.faltan.join(', ')}`));
  }

  const pie = el('div', 'producto-pie');
  const ver = enlace(m.url, `Ver en ${m.tiendaNombre}`, 'ver');
  if (ver) pie.append(ver);
  if (m.notas.length > 0) {
    pie.append(el('details', 'calculo', el('summary', '', 'Cómo se calculó'), el('ul', '', ...m.notas.map((n) => el('li', '', n)))));
  }
  articulo.append(pie);
  return articulo;
}

function seccionTotales(d: DatosPWA): HTMLElement {
  const t = d.totales;
  return el(
    'section',
    'totales',
    el('h2', '', 'Total de la canasta'),
    el('p', 'total-valor', clp(t.optimo)),
    el('p', 'total-nota', 'Comprando la cantidad óptima de cada producto donde conviene'),
    el(
      'ul',
      'total-tiendas',
      ...t.porTienda.map((pt) =>
        el(
          'li',
          '',
          el('span', '', `Todo en ${pt.tiendaNombre}`),
          el('span', 'total-tienda-valor', clp(pt.total)),
          pt.cubre < t.productosConDatos ? el('span', 'total-cobertura', `solo ${pt.cubre} de ${t.productosConDatos}`) : null,
        ),
      ),
    ),
    t.ahorroRepartiendo > 0
      ? el('p', 'total-ahorro', `Repartir la compra te ahorra ${clp(t.ahorroRepartiendo)}`)
      : null,
  );
}

function seccionProblemas(problemas: string[]): HTMLElement | null {
  if (problemas.length === 0) return null;
  return el(
    'details',
    'problemas',
    el('summary', '', `${problemas.length} ${problemas.length === 1 ? 'problema' : 'problemas'} en la última actualización`),
    el('ul', '', ...problemas.map((p) => el('li', '', p))),
  );
}

// ---------------------------------------------------------------------------
// Pantalla

const contenido = document.getElementById('contenido')!;
const cabeceraDia = document.getElementById('dia')!;
const cabeceraActualizado = document.getElementById('actualizado')!;
const avisos = document.getElementById('avisos')!;

function mensaje(titulo: string, detalle: string): void {
  contenido.replaceChildren(el('div', 'vacio', el('p', 'vacio-titulo', titulo), el('p', '', detalle)));
}

function pintar(d: DatosPWA, desdeCache: boolean): void {
  cabeceraDia.textContent = capitalizar(d.dia);

  const edad = haceCuanto(d.generadoEn);
  cabeceraActualizado.replaceChildren(
    `Actualizado ${edad.texto}`,
    el('span', 'separador', ' · '),
    fechaHora.format(new Date(d.generadoEn)),
  );

  avisos.replaceChildren();
  // Datos viejos: se dice en grande, porque una recomendacion de hace tres dias
  // puede ya no ser cierta.
  if (edad.horas > HORAS_VIEJO) {
    avisos.append(el('p', 'aviso aviso-viejo', `Estos precios son de ${edad.texto}: tu PC no ha publicado desde entonces.`));
  }
  if (desdeCache) {
    avisos.append(el('p', 'aviso', 'Sin conexión: mostrando la última canasta guardada.'));
  }
  for (const c of d.cashbackHoy) avisos.append(el('p', 'pastilla', c));

  const bloques: Hijo[] = [];

  bloques.push(seccionNovedades(d));

  const lista = el('div', 'productos', ...d.productos.map(tarjetaProducto));
  const filtro = el('input', 'filtro');
  filtro.type = 'search';
  filtro.placeholder = `Buscar entre ${d.productos.length} productos`;
  filtro.setAttribute('aria-label', 'Buscar producto');
  filtro.addEventListener('input', () => {
    const q = normalizar(filtro.value.trim());
    d.productos.forEach((p, i) => {
      (lista.children[i] as HTMLElement).hidden = q !== '' && !normalizar(p.nombre).includes(q);
    });
  });

  bloques.push(el('section', 'canasta', el('div', 'canasta-cabeza', el('h2', '', 'Tu canasta'), filtro), lista));
  bloques.push(seccionTotales(d));
  bloques.push(seccionProblemas(d.problemas));

  contenido.replaceChildren(...(bloques.filter(Boolean) as Node[]));
}

async function cargar(): Promise<void> {
  let respuesta: Response | undefined;
  let desdeCache = false;
  try {
    respuesta = await fetch('datos.json', { cache: 'no-store' });
  } catch {
    // Sin red: el service worker ya habria respondido desde cache; esto cubre
    // el caso en que todavia no esta instalado.
    respuesta = (await caches?.match?.('./datos.json')) ?? undefined;
    desdeCache = true;
  }
  desdeCache ||= !navigator.onLine;

  if (!respuesta || !respuesta.ok) {
    mensaje('Todavía no hay datos', 'La app se llena cuando tu PC publica la canasta por primera vez.');
    cabeceraActualizado.textContent = '';
    return;
  }

  let datos: DatosPWA;
  try {
    datos = (await respuesta.json()) as DatosPWA;
  } catch {
    mensaje('No se pudieron leer los datos', 'El archivo publicado está dañado. Se corrige en la próxima publicación.');
    return;
  }

  // Una app cacheada con una version vieja no debe interpretar mal un archivo nuevo.
  if (datos.version !== VERSION_ESPERADA) {
    mensaje('Hay una versión nueva', 'Cierra la app y vuelve a abrirla para actualizarla.');
    return;
  }
  pintar(datos, desdeCache);
}

document.getElementById('actualizado')!.addEventListener('click', () => void cargar());
document.addEventListener('visibilitychange', () => {
  // Al volver a la app despues de un rato, traer lo ultimo publicado.
  if (document.visibilityState === 'visible') void cargar();
});

void cargar();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Sin service worker la app funciona igual, solo que no sin conexion.
  });
}
