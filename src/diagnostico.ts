/**
 * Registro de lo que el pipeline descarta.
 *
 * Un filtro que descarta en silencio es peor que una excepcion: no deja rastro
 * y el resultado se ve igual de legitimo. Ya paso una vez, con una oferta de
 * Jumbo que desaparecia por un identificador que no calzaba, y la salida no
 * mostraba ni un aviso.
 *
 * Los mapeadores reciben un registro opcional y anotan ahi lo que botan. Si no
 * se les pasa ninguno, se comportan igual que antes.
 */

export interface Descarte {
  /** Etapa: "alvi", "jumbo:ficha", "catalogo". */
  donde: string;
  /** Que se descarto: un sku, un nombre, una tienda. */
  que: string;
  porque: string;
}

export class Descartes {
  private readonly items: Descarte[] = [];

  registrar(donde: string, que: string, porque: string): void {
    this.items.push({ donde, que, porque });
  }

  get total(): number {
    return this.items.length;
  }

  lista(): readonly Descarte[] {
    return this.items;
  }

  /** Agrupado por motivo, de mas a menos frecuente, con un ejemplo. */
  resumen(): Array<{ donde: string; porque: string; veces: number; ejemplo: string }> {
    const grupos = new Map<string, { donde: string; porque: string; veces: number; ejemplo: string }>();
    for (const d of this.items) {
      const clave = `${d.donde}|${d.porque}`;
      const previo = grupos.get(clave);
      if (previo) previo.veces++;
      else grupos.set(clave, { donde: d.donde, porque: d.porque, veces: 1, ejemplo: d.que });
    }
    return [...grupos.values()].sort((a, b) => b.veces - a.veces);
  }

  imprimir(salida: (linea: string) => void = console.error): void {
    if (this.total === 0) return;
    salida(`\nDESCARTES (${this.total})`);
    for (const g of this.resumen()) {
      salida(`   ${g.donde.padEnd(14)} ${String(g.veces).padStart(3)}x  ${g.porque}`);
      salida(`   ${' '.repeat(14)}      ej: ${g.ejemplo.slice(0, 70)}`);
    }
  }
}
