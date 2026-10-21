// Cuánto vale lo que hay en el embudo.
//
// Un CRM sin esto dice «tienes 25 prospectos» y no dice si eso es un buen mes o uno malo. Veinticinco personas
// preguntando por un accesorio y veinticinco pidiendo un traje a la medida son dos negocios distintos.
//
// 🪤 El valor sale del CATÁLOGO, no de una estimación. Lo que vale un prospecto es el precio de lo que pidió, y
// ese precio ya está escrito en el catálogo del negocio: deducirlo de otra forma —un promedio, una regla por
// etapa— sería inventar una cifra que luego alguien lleva a una reunión. Si el catálogo no trae precios, el
// valor es cero y se dice que no se sabe, que es distinto de decir que no vale nada.
import { getDb, productsMentionedIn } from '../rag/store.js';
import { listContacts, rolDe, STAGE_DEFS, type Contact } from './contacts.js';

/** Lo que vale un prospecto, y por qué. */
export interface ValorDe {
  /** En la moneda del negocio. 0 = no se sabe. */
  valor: number;
  /** De dónde salió: 'catalogo', 'a mano', o '' cuando no se sabe. */
  origen: string;
  /** Qué productos se le reconocieron, para poder discutir la cifra en vez de creerla. */
  productos: string[];
}

let precios: Map<string, { precio: number; titulo: string }> | null = null;

/**
 * Los precios del catálogo, leídos del índice.
 *
 * Se guardan en memoria porque esto se llama una vez por contacto al pintar el embudo, y el catálogo cambia
 * cuando alguien lo reindexa, no entre dos clics.
 */
function catalogo(): Map<string, { precio: number; titulo: string }> {
  if (precios) return precios;
  precios = new Map();
  for (const f of getDb().prepare("SELECT id, title, meta FROM docs WHERE kind = 'product'").all() as { id: string; title: string; meta: string }[]) {
    try {
      const m = JSON.parse(f.meta ?? '{}') as { price?: number | string };
      const n = typeof m.price === 'string' ? Number(m.price.replace(/[^\d.]/g, '')) : Number(m.price);
      if (Number.isFinite(n) && n > 0) precios.set(f.id, { precio: n, titulo: f.title });
    } catch {
      /* un producto con meta rota no debe tumbar el cálculo del embudo entero */
    }
  }
  return precios;
}

/** Que vuelva a leer el catálogo: lo llama el reindexado. */
export function olvidarPrecios(): void {
  precios = null;
}

/**
 * Cuánto vale este prospecto.
 *
 * 🪤 Lo que alguien puso A MANO manda sobre lo deducido, siempre. Quien escribe una cifra en la ficha sabe algo
 * que el catálogo no: que son dos trajes, que va con descuento, que el evento es para toda la familia. Que un
 * reindexado le pise ese número sería quitarle el trabajo a quien mejor conoce el caso.
 */
export function valorDe(c: Contact): ValorDe {
  const aMano = Number((c.data as Record<string, unknown> | null)?.valor);
  if (Number.isFinite(aMano) && aMano > 0) return { valor: aMano, origen: 'a mano', productos: [] };

  const cat = catalogo();
  if (!cat.size) return { valor: 0, origen: '', productos: [] };

  // Lo que pidió, dicho en el resumen que escribió el análisis. Es el texto que mejor describe el caso: el
  // historial entero traería cada producto que se nombró de pasada.
  const texto = [c.summary, c.notes].filter(Boolean).join(" ");
  if (!texto) return { valor: 0, origen: '', productos: [] };

  const ids = productsMentionedIn(texto);
  let total = 0;
  const titulos: string[] = [];
  for (const id of ids) {
    const p = cat.get(id);
    if (!p) continue;
    total += p.precio;
    titulos.push(p.titulo);
  }
  return total > 0 ? { valor: total, origen: 'catalogo', productos: titulos } : { valor: 0, origen: '', productos: [] };
}

export interface ValorDelEmbudo {
  total: number;
  /** Cuántos prospectos tienen un valor conocido y cuántos no: sin esto el total engaña. */
  conValor: number;
  sinValor: number;
  /** Si el catálogo no tiene ni un precio, no es que no valgan nada: es que nadie los ha puesto. */
  catalogoSinPrecios: boolean;
  porEtapa: { etapa: string; titulo: string; rol: string; total: number; cuantos: number }[];
}

/**
 * Lo que hay en el embudo, en dinero.
 *
 * 🪤 Solo las etapas ABIERTAS. Sumar lo vendido y lo perdido daría un número más grande y más bonito que no
 * significa nada: el embudo es lo que todavía se puede ganar, no lo que pasó por él.
 */
export function valorDelEmbudo(): ValorDelEmbudo {
  const abiertas = STAGE_DEFS.filter((e) => e.rol !== 'ganado' && e.rol !== 'perdido');
  const porEtapa = new Map(abiertas.map((e) => [e.id, { etapa: e.id, titulo: e.label, rol: e.rol ?? '', total: 0, cuantos: 0 }]));

  let total = 0;
  let conValor = 0;
  let sinValor = 0;
  for (const c of listContacts({ limit: 2000 })) {
    if (c.archived) continue;
    const casilla = porEtapa.get(c.stage);
    if (!casilla) continue; // cerrada: no cuenta
    const v = valorDe(c);
    casilla.cuantos++;
    casilla.total += v.valor;
    total += v.valor;
    if (v.valor > 0) conValor++;
    else sinValor++;
  }
  return { total, conValor, sinValor, catalogoSinPrecios: catalogo().size === 0, porEtapa: [...porEtapa.values()] };
}

/** Poner o quitar el valor de un prospecto a mano. 0 lo borra y vuelve a lo del catálogo. */
export const ROL_ABIERTO = (stage: string): boolean => {
  const r = rolDe(stage);
  return r !== 'ganado' && r !== 'perdido';
};

/**
 * Cuántos productos tiene el catálogo y cuántos con precio. Lo usa la guía de inicio (crm/guia.ts) con la misma
 * regla de precio que el embudo, para que «tu catálogo no tiene precios» diga lo mismo en los dos sitios.
 */
export function estadoDelCatalogo(): { productos: number; conPrecio: number; informacion: number } {
  const n = getDb().prepare("SELECT COUNT(*) n FROM docs WHERE kind = 'product'").get() as { n: number };
  const i = getDb().prepare("SELECT COUNT(*) n FROM docs WHERE kind = 'knowledge'").get() as { n: number };
  return { productos: n.n, conPrecio: catalogo().size, informacion: i.n };
}
