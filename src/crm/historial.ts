// Lo que un cliente ya tiene conversado cuando llega: meses de WhatsApp con sus clientes. De ahí sale **qué le
// preguntan** y **cómo atiende**, nunca los precios ni las políticas, que cambian y quedarían vencidos (ver
// docs/aprender-del-historial.md). Por eso el historial vive en su propia tabla y **no entra al índice de
// conocimiento**: nada de aquí se convierte en respuesta automática, solo en propuestas que una persona confirma.
import { getDb } from '../rag/store.js';

export interface MensajeImportado {
  chat: string;
  autor: string;
  /** 'user' lo que escribió el cliente; 'assistant' lo que contestó el negocio. */
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** Guarda lo importado. Devuelve cuántos entraron (los repetidos no se duplican). */
export function guardarImportados(mensajes: MensajeImportado[], origen = 'whatsapp'): number {
  const db = getDb();
  const existe = db.prepare('SELECT 1 FROM import_messages WHERE chat = ? AND ts = ? AND content = ?');
  const insertar = db.prepare('INSERT INTO import_messages (chat, autor, role, content, ts, origen) VALUES (?, ?, ?, ?, ?, ?)');
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const m of mensajes) {
      const texto = m.content.trim();
      if (!texto) continue;
      if (existe.get(m.chat, m.ts, texto)) continue;
      insertar.run(m.chat, m.autor, m.role, texto, m.ts, origen);
      n++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return n;
}

export function borrarImportado(): number {
  const db = getDb();
  const n = Number(db.prepare('DELETE FROM import_messages').run().changes);
  db.prepare('DELETE FROM import_temas').run();
  return n;
}

/** Cuánto historial hay: mensajes, conversaciones y desde cuándo. */
export function resumenImportado(): { mensajes: number; chats: number; desde: number | null; hasta: number | null; delNegocio: number } {
  const db = getDb();
  const r = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT chat) c, MIN(ts) desde, MAX(ts) hasta FROM import_messages').get() as {
    n: number;
    c: number;
    desde: number | null;
    hasta: number | null;
  };
  const negocio = db.prepare("SELECT COUNT(*) n FROM import_messages WHERE role = 'assistant'").get() as { n: number };
  return { mensajes: r.n, chats: r.c, desde: r.desde, hasta: r.hasta, delNegocio: negocio.n };
}

// ---------- Qué le preguntan ----------
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// Palabras que no distinguen un tema de otro.
const VACIAS = new Set(
  ('a al algo alguien alguna alguno como con cual cuales cuando de del donde el ella ellos en es esa ese eso esta este esto hay la las le les lo los me mi mucha mucho muy no nos o para pero por porque que se si sin su sus te tu un una uno usted ustedes y ya ' +
    'buenas buenos dias tardes noches hola gracias favor porfa porfavor senor senora don dona ahi aca alla bien ok okay listo mas menos tambien solo ser estar tener hacer poder querer saber decir ver dar ir venir llegar quedar pasar ' +
    'me da das den dame regale regalame digame dime sabe saben podria puede pueden necesito quiero quisiera tengo tienen hay')
    .split(' ')
    .filter(Boolean),
);

// Lo que suena a pregunta aunque no lleve signo.
const PREGUNTA_RE =
  /\?|^\s*(?:que|cual|cuales|como|cuando|donde|cuanto|cuanta|cuantos|cuantas|quien|por que|porque|hay|tienen|manejan|venden|aceptan|puedo|podria|se puede|necesito saber|me pueden|informacion)\b/;

/** Un tema: la pregunta tal como la hicieron, cuántas veces apareció y ejemplos. */
export interface Tema {
  clave: string;
  titulo: string;
  veces: number;
  ejemplos: string[];
  estado: 'nuevo' | 'aceptado' | 'descartado';
}

// El título del tema es la pregunta, pero sin el saludo con que la abrieron: lo que importa es lo que preguntan.
const SALUDO_RE = /^(?:hola|buenas?|buenos?)\b[^,¿?]{0,20}[,.\s]+/i;
const limpiarTitulo = (s: string) => {
  const limpio = s
    .replace(/\s+/g, ' ')
    .replace(/\b\d[\d.,]{2,}\b/g, '…') // cifras fuera: el tema es la pregunta, no el dato
    .replace(SALUDO_RE, '')
    .trim()
    .slice(0, 80);
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

/**
 * Las preguntas que más le hacen al negocio, agrupadas por las palabras que las distinguen. Es la lista de lo que
 * el negocio tiene que tener respondido; la respuesta la pone el equipo en el Perfil, nunca sale del historial.
 */
export function temasFrecuentes(opts: { minimo?: number; limite?: number } = {}): Tema[] {
  const minimo = opts.minimo ?? 2;
  const filas = getDb().prepare("SELECT content FROM import_messages WHERE role = 'user' ORDER BY ts").all() as { content: string }[];
  // Primero, qué palabras se repiten en todas las preguntas: son las que dicen de qué habla el negocio.
  const preguntas: { texto: string; palabras: string[] }[] = [];
  const frecuencia = new Map<string, number>();
  for (const { content } of filas) {
    const texto = content.trim();
    if (texto.length < 8 || texto.length > 300) continue;
    const plano = fold(texto);
    if (!PREGUNTA_RE.test(plano)) continue;
    const palabras = [
      ...new Set(
        plano
          .replace(/[^a-zñ0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3 && !VACIAS.has(w) && !/^\d+$/.test(w)),
      ),
    ];
    if (!palabras.length) continue;
    preguntas.push({ texto, palabras });
    for (const w of palabras) frecuencia.set(w, (frecuencia.get(w) ?? 0) + 1);
  }
  // Y la firma de cada pregunta son sus palabras compartidas, las que aparecen en más de una: así "¿hay
  // parqueadero en la tienda?" y "¿tienen parqueadero por ahí?" caen en el mismo tema, porque lo único que de
  // verdad se repite es "parqueadero"; y "¿documentos para abrir una cuenta de ahorros?" no se separa por el
  // "ahorros" que dijo una sola persona.
  const grupos = new Map<string, { textos: string[] }>();
  const porFrecuencia = (a: string, b: string) => (frecuencia.get(b) ?? 0) - (frecuencia.get(a) ?? 0) || a.localeCompare(b);
  for (const p of preguntas) {
    const compartidas = p.palabras.filter((w) => (frecuencia.get(w) ?? 0) > 1).sort(porFrecuencia);
    const clave = (compartidas.length ? compartidas.slice(0, 2) : [...p.palabras].sort(porFrecuencia).slice(0, 1)).sort().join(' ');
    const g = grupos.get(clave) ?? { textos: [] };
    g.textos.push(p.texto);
    grupos.set(clave, g);
  }
  const decididos = new Map(
    (getDb().prepare('SELECT clave, estado FROM import_temas').all() as { clave: string; estado: string }[]).map((r) => [r.clave, r.estado]),
  );
  return [...grupos.entries()]
    .filter(([, g]) => g.textos.length >= minimo)
    .map(([clave, g]) => ({
      clave,
      // Como título, la pregunta más corta del grupo: la que dice lo mismo con menos vueltas.
      titulo: limpiarTitulo([...g.textos].sort((a, b) => a.length - b.length)[0]!),
      veces: g.textos.length,
      ejemplos: [...new Set(g.textos)].slice(0, 3),
      estado: (decididos.get(clave) as Tema['estado']) ?? 'nuevo',
    }))
    .sort((a, b) => b.veces - a.veces)
    .slice(0, opts.limite ?? 30);
}

/** Deja anotado qué se decidió sobre un tema, para no volver a proponerlo. */
export function decidirTema(clave: string, estado: 'aceptado' | 'descartado', titulo: string) {
  getDb()
    .prepare('INSERT INTO import_temas (clave, estado, titulo, ts) VALUES (?, ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET estado = excluded.estado, titulo = excluded.titulo, ts = excluded.ts')
    .run(clave, estado, titulo, Date.now());
}

// ---------- Cómo atiende ----------
const CIFRA_RE = /\$\s?\d|\b\d[\d.,]{2,}\b|\b\d+\s?(?:mil|millones|millon|k)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.\s?m|p\.\s?m)\b/i;

/**
 * Una muestra de cómo responde el negocio, **sin una sola cifra**: de aquí se describe el tono (cómo saludan, cómo
 * piden datos, cómo cierran), no se copian datos. Lo que traiga precios, horas o plazos se descarta entero.
 */
export function muestraDeEstilo(limite = 20): string[] {
  const filas = getDb()
    .prepare("SELECT content FROM import_messages WHERE role = 'assistant' ORDER BY ts DESC LIMIT 400")
    .all() as { content: string }[];
  const vistos = new Set<string>();
  const muestra: string[] = [];
  for (const { content } of filas) {
    const texto = content.trim().replace(/\s+/g, ' ');
    if (texto.length < 20 || texto.length > 220) continue;
    if (CIFRA_RE.test(texto)) continue; // trae un dato que puede estar vencido: no sirve para el estilo
    const huella = fold(texto).slice(0, 40);
    if (vistos.has(huella)) continue;
    vistos.add(huella);
    muestra.push(texto);
    if (muestra.length >= limite) break;
  }
  return muestra;
}

// ---------- Leer un chat exportado de WhatsApp ----------
// "Exportar chat" de WhatsApp da un .txt como:
//   [12/03/24, 9:41:02 a. m.] Marta: buenos días, ¿tienen traje azul?
//   3/12/24, 9:41 a. m. - Marta: buenos días
const LINEA_RE =
  /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?\s?m\.?\]?\s*(?:-\s*)?([^:]{1,60}):\s?([\s\S]*)$/i;
const SISTEMA_RE = /cifrados de extremo a extremo|se uni[oó] usando|cambi[oó] el asunto|creaste el grupo|<multimedia omitido>|imagen omitida|audio omitido|video omitido|sticker omitido|documento omitido|elimin[oó] este mensaje/i;

/**
 * Convierte un chat exportado en mensajes. `delNegocio` son los nombres con los que aparece el negocio en el
 * archivo (lo que escriba cualquier otro se toma como del cliente).
 */
export function leerChatExportado(texto: string, opts: { delNegocio: string[]; chat?: string }): MensajeImportado[] {
  const negocio = new Set(opts.delNegocio.map((n) => fold(n.trim())));
  const out: MensajeImportado[] = [];
  let actual: MensajeImportado | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const m = LINEA_RE.exec(linea.trim());
    if (!m) {
      if (actual && linea.trim()) actual.content += `\n${linea.trim()}`; // mensaje de varias líneas
      continue;
    }
    const [, d, mes, anio, hh, mm, ampm, autor, contenido] = m as unknown as string[];
    if (SISTEMA_RE.test(contenido ?? '')) {
      actual = null;
      continue;
    }
    const y = Number(anio) < 100 ? 2000 + Number(anio) : Number(anio);
    let hora = Number(hh) % 12;
    if (ampm!.toLowerCase() === 'p') hora += 12;
    const ts = new Date(y, Number(mes) - 1, Number(d), hora, Number(mm)).getTime();
    actual = {
      chat: opts.chat ?? autor!.trim(),
      autor: autor!.trim(),
      role: negocio.has(fold(autor!.trim())) ? 'assistant' : 'user',
      content: (contenido ?? '').trim(),
      ts,
    };
    out.push(actual);
  }
  return out.filter((m) => m.content.trim() && !SISTEMA_RE.test(m.content));
}
