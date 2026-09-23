/*
 * Service worker de la PWA.
 *
 * - La interfaz (html, css, js, iconos) se sirve desde cache: abre al instante
 *   y funciona sin conexion.
 * - datos.json va primero a la red y cae al cache si no hay senal: en el
 *   supermercado sin cobertura igual se ve la ultima canasta, con su fecha.
 *
 * VERSION la reemplaza el build: cambiarla invalida el cache viejo, asi una
 * interfaz nueva llega al telefono sin tener que reinstalar la app.
 */
const VERSION = '__VERSION__';
const CACHE = `canasta-${VERSION}`;
const INTERFAZ = [
  './',
  './index.html',
  './app.js',
  './estilos.css',
  './manifest.webmanifest',
  './iconos/icono-180.png',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((c) => c.addAll(INTERFAZ)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (evento.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/datos.json')) {
    // Red primero: los datos cambian a diario. Si falla, lo ultimo guardado.
    evento.respondWith(
      fetch(evento.request)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put('./datos.json', copia));
          }
          return res;
        })
        .catch(() => caches.match('./datos.json').then((r) => r || Response.error())),
    );
    return;
  }

  // Interfaz: cache primero, red de respaldo.
  evento.respondWith(caches.match(evento.request).then((r) => r || fetch(evento.request)));
});
