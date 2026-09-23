/**
 * Publica dist-web/ en Cloudflare Pages.
 *
 *   node scripts/desplegar.mjs
 *
 * Los datos van directo del PC a Cloudflare, sin pasar por git: el repo es
 * publico, y un datos.json commiteado dejaria la lista de compras y su
 * historial a la vista de cualquiera.
 *
 * Necesita dos variables de entorno, que se configuran una vez (ver README):
 *   CLOUDFLARE_API_TOKEN   token con permiso "Cloudflare Pages: Edit"
 *   CLOUDFLARE_ACCOUNT_ID  id de la cuenta
 * y opcionalmente CANASTA_PROYECTO, el nombre del proyecto en Pages.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const WRANGLER = 'wrangler@4.136.3';
const proyecto = process.env.CANASTA_PROYECTO || 'mi-canasta';

const faltan = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((v) => !process.env[v]);
if (faltan.length > 0) {
  console.error(`\nFaltan variables de entorno: ${faltan.join(', ')}`);
  console.error('Ver la seccion "Publicar la PWA" del README para configurarlas.\n');
  process.exit(1);
}

// Sin datos.json no se despliega: la app quedaria vacia en el telefono.
if (!existsSync('dist-web/datos.json')) {
  console.error('\nNo existe dist-web/datos.json: corre primero `npm run publicar`.\n');
  process.exit(1);
}

const r = spawnSync(
  'npx',
  ['--yes', WRANGLER, 'pages', 'deploy', 'dist-web', '--project-name', proyecto, '--branch', 'main', '--commit-dirty=true'],
  // En Windows npx es un .cmd y necesita la shell para ejecutarse.
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(r.status ?? 1);
