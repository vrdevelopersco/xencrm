// La portada (public/inicio.html) con las palabras del negocio: el titular, la línea de abajo y la vista de ejemplo
// del tablero salen de xencrm.config.json › interfaz.portada. Lo usa `pnpm paquete` al armar el ZIP, y las pruebas.
//
// 🪤 La portada es una página estática (la sirve el lanzador con su CSP y la huella de lo que trae en línea), así que
// no se pinta en el navegador: se escribe ya hecha. En el repositorio, inicio.html trae el contenido del ejemplo
// (XENTRIS) entre sus marcas; con otra configuración, lo de entre las marcas se cambia y lo demás no se toca.
import type { BusinessConfig } from './config.js';

type Portada = BusinessConfig['interfaz']['portada'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** «Tus clientes, atendidos *siempre*.» → con el resaltado en <em>. */
const conResalte = (s: string) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');

const ROL_A_CLASE: Record<string, string> = { inicio: 'inicio', activo: 'activo', interes: 'interes', cita: 'cita', ganado: 'ganado', perdido: 'perdido' };

function fila(f: Portada['vista'][number]): string {
  const ini = f.asignado ? esc(f.asignado.trim().charAt(0).toUpperCase()) : '';
  return (
    `          <div class="vf"><span><b>${esc(f.contacto)}</b>${f.caliente ? ' 🔥' : ''}</span>` +
    `<span><em class="et ${ROL_A_CLASE[f.rol] ?? 'activo'}">${esc(f.etapa)}</em></span>` +
    `<span class="n">${esc(f.valor)}</span>` +
    `<span class="ps${f.tono === 'urge' ? ' urge' : f.tono === 'agenda' ? ' cita' : ''}">${esc(f.paso)}</span>` +
    `<span class="ll">${f.asignado ? `<i class="h">${ini}</i>${esc(f.asignado)}` : '—'}</span></div>\n`
  );
}

/** Cambia lo que va entre las marcas de la portada por lo de la configuración. Lo que no está configurado se queda. */
export function pintarPortada(html: string, p: Portada): string {
  const entre = (h: string, marca: string, nuevo: string) => {
    const a = `<!-- portada:${marca} -->`, b = `<!-- /portada:${marca} -->`;
    const i = h.indexOf(a), j = h.indexOf(b);
    if (i < 0 || j < i) throw new Error(`a public/inicio.html le falta la marca ${a}`);
    return h.slice(0, i + a.length) + nuevo + h.slice(j);
  };
  let h = html;
  h = entre(h, 'titulo', `<h1>${conResalte(p.titulo)}</h1>`);
  h = entre(h, 'subtitulo', `<p class="bajada">${esc(p.subtitulo)}</p>`);
  h = entre(h, 'marca', `<b>${esc(p.marca)}</b>`);
  if (p.vista.length) h = entre(h, 'filas', '\n' + p.vista.map(fila).join('') + '          ');
  return h;
}
