import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { business } from '../config.js';
import { retrieve, formatPrice } from '../rag/retriever.js';
import { handleMessage } from '../agent/agent.js';

/**
 * Servidor MCP: expone el catálogo, la info de la tienda y al propio agente como
 * herramientas para otros clientes de IA (Claude Desktop, Cursor, otro agente...).
 * Se sirve por stdio (pnpm mcp) o por HTTP en /mcp (accesible por el túnel).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: `xencrm-${slug(business.business.name)}`, version: '0.1.0' });

  server.registerTool(
    'search_products',
    {
      title: 'Buscar productos',
      description: `Busca productos en el catálogo de ${business.business.name} (búsqueda semántica + palabras clave). Devuelve nombre, precio, disponibilidad y enlace de compra.`,
      inputSchema: {
        query: z.string().describe('Qué busca el cliente, en lenguaje natural'),
        limit: z.number().int().min(1).max(10).default(5),
      },
    },
    async ({ query, limit }) => {
      const hits = await retrieve(query, { kinds: ['product'], k: limit });
      const items = hits.map((h) => {
        const m = h.meta as Record<string, unknown>;
        return {
          name: h.title,
          price: m.price,
          // Sin precio es «sin precio», no «NaN COP»: el mismo criterio que el buscador (retriever.ts).
          price_formatted: m.price != null ? formatPrice(Number(m.price), String(m.currency ?? business.business.currency)) : 'sin precio',
          in_stock: m.inStock !== false,
          category: m.category,
          description: m.description,
          url: h.url,
          relevance: Number(h.vectorSim.toFixed(3)),
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ query, results: items }, null, 2) }] };
    },
  );

  server.registerTool(
    'search_store_info',
    {
      title: 'Buscar información de la tienda',
      description: `Busca en la información de ${business.business.name}: envíos, pagos, devoluciones, horarios, cómo comprar, contenido del sitio.`,
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(8).default(4) },
    },
    async ({ query, limit }) => {
      const hits = await retrieve(query, { kinds: ['knowledge'], k: limit });
      const text = hits.length
        ? hits.map((h) => `## ${h.title}\n${h.content}${h.url ? `\nFuente: ${h.url}` : ''}`).join('\n\n')
        : 'No se encontró información relacionada.';
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'ask_xencrm',
    {
      title: `Preguntarle a ${business.agent.name}`,
      description: `Envía un mensaje al asistente de atención de ${business.business.name} y devuelve su respuesta, como si fuera un cliente escribiendo por chat. Usa session_id para mantener la conversación.`,
      inputSchema: {
        // El mismo tope que el chat del sitio: sin él, un mensaje enorme entra entero al modelo y lo paga el cliente.
        message: z.string().max(2000),
        session_id: z.string().regex(/^[\w-]{4,64}$/).optional().describe('Identificador de conversación para mantener contexto'),
      },
    },
    async ({ message, session_id }) => {
      // 🪤 Antes era `anon-<reloj>`: adivinable dentro del mismo segundo, y quien lo adivinara retomaba la
      // conversación de otro con su historial en el contexto del modelo.
      const sid = session_id ?? `anon-${randomUUID()}`;
      const r = await handleMessage({ userId: `mcp:${sid}`, channel: 'mcp', text: message });
      return {
        content: [{ type: 'text', text: r.text }],
        structuredContent: { session_id: sid, intent: r.intent, sources: r.sources },
      };
    },
  );

  return server;
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
