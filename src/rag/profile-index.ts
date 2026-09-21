// El perfil del negocio en el índice de búsqueda (para los motores que buscan en vez de ver todo): un documento con lo
// confirmado. Con OpenAI y un negocio chico no hace falta, porque el perfil va entero en el prompt.
import { embed } from '../llm/ollama.js';
import { profileText } from '../profile.js';
import { business } from '../config.js';
import { replaceDocs, type Doc } from './store.js';

export const PROFILE_DOC_ID = 'kb:perfil';

export function profileDocs(): Doc[] {
  const content = profileText();
  if (!content) return [];
  return [{ id: PROFILE_DOC_ID, kind: 'knowledge', title: `Perfil de ${business.business.name}`, content, url: null, meta: { source: 'profile' } }];
}

/** Reindexa el perfil. false si el motor de embeddings no respondió (el prompt completo igual lo tiene). */
export async function indexProfile(): Promise<boolean> {
  const docs = profileDocs();
  try {
    const vecs = docs.length ? await embed(docs.map((d) => `${d.title}\n${d.content}`)) : [];
    replaceDocs('knowledge', docs.map((d, i) => ({ ...d, embedding: vecs[i]! })), 'profile');
    return true;
  } catch (err) {
    console.warn(`[perfil] no se pudo indexar (${(err as Error).message}); queda en el prompt y se indexa con pnpm ingest`);
    return false;
  }
}
