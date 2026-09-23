/**
 * Arma la PWA en dist-web/.
 *
 *   node scripts/construir-web.mjs
 *
 * datos.json NO se genera aqui: lo escribe `npm run publicar` despues de este
 * paso. El build solo prepara la interfaz, que cambia poco.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const DESTINO = 'dist-web';

await rm(DESTINO, { recursive: true, force: true });
await mkdir(`${DESTINO}/iconos`, { recursive: true });

await build({
  entryPoints: ['web/app.ts'],
  bundle: true,
  format: 'esm',
  // Safari de iOS 15 en adelante: cubre cualquier iPhone con soporte vigente.
  target: ['safari15'],
  minify: true,
  outfile: `${DESTINO}/app.js`,
  logLevel: 'warning',
});

for (const archivo of ['index.html', 'estilos.css', 'manifest.webmanifest']) {
  await cp(`web/${archivo}`, `${DESTINO}/${archivo}`);
}
await cp('web/iconos', `${DESTINO}/iconos`, { recursive: true });

// Cada build invalida el cache del service worker, para que una interfaz nueva
// llegue al telefono sin reinstalar la app.
const version = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const sw = await readFile('web/sw.js', 'utf8');
await writeFile(`${DESTINO}/sw.js`, sw.replace('__VERSION__', version));

/*
 * Cabeceras para Cloudflare Pages. Sin esto su CDN podria cachear datos.json y
 * el telefono veria los precios de ayer aunque el PC ya publico los de hoy.
 * El service worker tampoco debe cachearse: es lo que trae las actualizaciones.
 */
await writeFile(
  `${DESTINO}/_headers`,
  [
    '/datos.json',
    '  Cache-Control: no-cache',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    '',
  ].join('\n'),
);

console.log(`PWA armada en ${DESTINO}/ (version ${version})`);
