import type { Adapter, TiendaConfig } from './tipos.js';
import { crearAdapterVtex } from './vtex.js';

export const TIENDAS: TiendaConfig[] = [
  {
    id: 'jumbo',
    nombre: 'Jumbo',
    host: 'www.jumbo.cl',
    motor: 'vtex',
    soportado: true,
  },
  {
    id: 'alvi',
    nombre: 'Alvi',
    host: 'www.alvi.cl',
    motor: 'vtex',
    soportado: true,
    notas: 'Mayorista: es la tienda donde mas importan las escalas por cantidad.',
  },
  {
    id: 'santaisabel',
    nombre: 'Santa Isabel',
    host: 'www.santaisabel.cl',
    motor: 'vtex',
    soportado: true,
  },
  {
    id: 'unimarc',
    nombre: 'Unimarc',
    host: 'www.unimarc.cl',
    motor: 'vtex',
    soportado: true,
  },
  {
    id: 'lider',
    nombre: 'Lider',
    host: 'www.lider.cl',
    motor: 'propio',
    soportado: false,
    notas:
      'No es VTEX: API propia con proteccion anti-bot. Requiere Playwright. Fuera del alcance del spike.',
  },
];

export function adapters(): Adapter[] {
  return TIENDAS.filter((t) => t.soportado && t.motor === 'vtex').map(crearAdapterVtex);
}

export function tienda(id: string): TiendaConfig | undefined {
  return TIENDAS.find((t) => t.id === id);
}

export * from './tipos.js';
export * from './vtex.js';
