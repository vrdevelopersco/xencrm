// Tapar credenciales antes de guardar nada. Vive aparte porque lo necesitan los dos caminos por los que un chat
// de WhatsApp entra a xencrm: traerlo como conversación (`importar.ts`) y leerlo para aprender cómo se atiende
// (`historial.ts`). Un grupo de soporte está lleno de «Usuario: … Clave: …» y eso no puede quedar guardado en
// ninguno de los dos lados.

// Lo que se tapa aunque venga suelto en mitad de una frase.
const SUELTOS: { re: RegExp; con: string }[] = [
  { re: /\bsk-[A-Za-z0-9_-]{10,}/g, con: '«clave omitida»' },
  { re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, con: '«token omitido»' },
  { re: /https?:\/\/\S*(?:token|key|secret|clave)=\S+/gi, con: '«enlace con clave omitido»' },
];

// «Usuario:», «Clave temporal (el sistema te pedirá cambiar):» … Una etiqueta de estas seguida de dos puntos
// anuncia un valor: lo que venga después es la credencial, hasta la siguiente etiqueta o el fin de la línea.
const ETIQUETAS = 'usuarios?|user(?:name)?|correos?|e-?mail|claves?|contrase[ñn]as?|passwords?|pass|pin|tokens?|api[_-]?key';
const CAMPO_RE = new RegExp(`\\b(?:${ETIQUETAS})\\b[^:\\n]{0,45}:`, 'gi');
// La etiqueta solo cuenta si abre el renglón (o va tras una viñeta o un emoji de candado). Así «el usuario dice:
// no me llega» se queda entera, que es de donde se aprende cómo atienden.
const ABRE_RE = /^[\s\p{P}\p{S}]*$/u;

/**
 * 🪤 Deja el texto sin credenciales. Se aplica SIEMPRE, antes de guardar: un grupo de soporte está lleno de
 * «Usuario: … Clave: …» y eso no puede quedar dentro de un CRM ni salir en una pantalla.
 *
 * Tapa de más antes que de menos: cuando la etiqueta queda sin valor («Clave temporal:» y el valor en el renglón
 * siguiente), se tapa el renglón siguiente completo.
 */
export function taparSecretos(texto: string): { texto: string; tapados: number } {
  let tapados = 0;
  let esperandoValor = false;
  const lineas = texto.split('\n').map((linea) => {
    if (esperandoValor && linea.trim()) {
      esperandoValor = false;
      tapados++;
      return '«omitido»';
    }
    const marcas = [...linea.matchAll(CAMPO_RE)];
    let out = linea;
    if (marcas.length) {
      out = '';
      let desde = 0;
      let previaValida = false;
      for (const [i, m] of marcas.entries()) {
        const inicio = m.index!;
        const fin = inicio + m[0].length;
        const vale = previaValida || ABRE_RE.test(linea.slice(0, inicio));
        if (!vale) continue;
        previaValida = true;
        const hasta = i + 1 < marcas.length ? marcas[i + 1]!.index! : linea.length;
        out += linea.slice(desde, fin);
        if (linea.slice(fin, hasta).trim()) {
          out += ' «omitido»';
          tapados++;
        } else if (i === marcas.length - 1) {
          esperandoValor = true; // el valor viene en el renglón de abajo
        }
        desde = hasta;
      }
      out += linea.slice(desde);
    }
    for (const { re, con } of SUELTOS) {
      out = out.replace(re, () => {
        tapados++;
        return con;
      });
    }
    return out;
  });
  return { texto: lineas.join('\n'), tapados };
}

// ---------- En vivo ----------
//
// 🪤 `taparSecretos` es para chats importados de grupos de soporte, y tapa también «Usuario:» y «Correo:». En una
// conversación en vivo eso borraría el correo que el cliente deja al agendar su cita. Aquí solo se tapa lo que es
// secreto de verdad: una clave, un PIN, un código de verificación, una llave, un número de tarjeta.
//
// Se aplica ANTES de todo: antes de guardar y antes de que lo lea el modelo. Una clave que llega a OpenAI ya salió,
// aunque después no se guarde.

// «mi clave es 4567», «Contraseña: perrito123», «el código de verificación es 482913».
const CLAVE_RE =
  /\b(clave|contrase[ñn]a|password|pass|pin|token|cvv|cvc|otp|c[oó]digo\s+de\s+(?:verificaci[oó]n|seguridad|acceso))\b((?:\s+(?:es|era|ser[ií]a|nueva|actual|temporal|el|la|de\s+(?:acceso|ingreso|la\s+app|internet))\b)*)(\s*[:=]\s*|\s+)([^\s,;.]+)/gi;
// Un número de tarjeta: 15 o 16 dígitos (con espacios o guiones), de una red conocida y que pase el dígito de control.
// 🪤 Las tres condiciones juntas, no una: cualquier número largo pasa el dígito de control una de cada diez veces, y
// un teléfono internacional puede tener quince dígitos.
const TARJETA_RE = /(?<![+\d])\b[2-6](?:[ -]?\d){14,15}\b/g;
const luhn = (d: string): boolean => {
  let suma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    suma += n;
  }
  return suma % 10 === 0;
};

/**
 * El mensaje sin claves ni tarjetas. El valor de una etiqueta se tapa si trae un número o un signo («perrito123»,
 * «4567»), o si va con dos puntos («Clave: girasol»): «la clave es que me llegue rápido» no es una clave.
 */
export function taparEnVivo(texto: string): { texto: string; tapados: number } {
  let tapados = 0;
  let out = texto.replace(CLAVE_RE, (todo, etiqueta: string, enMedio: string, sep: string, valor: string) => {
    const conDosPuntos = /[:=]/.test(sep);
    if (!conDosPuntos && !/[\d\W_]/.test(valor.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return todo;
    tapados++;
    return `${etiqueta}${enMedio}${sep}«omitido»`;
  });
  out = out.replace(TARJETA_RE, (n) => {
    if (!luhn(n.replace(/\D/g, ''))) return n;
    tapados++;
    return '«tarjeta omitida»';
  });
  for (const { re, con } of SUELTOS) {
    out = out.replace(re, () => {
      tapados++;
      return con;
    });
  }
  return { texto: out, tapados };
}
