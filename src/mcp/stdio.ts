// Servidor MCP por stdio, para Claude Desktop / Cursor / claude mcp add.
// Todo log va a stderr: stdout es exclusivo del protocolo.
console.log = (...args: unknown[]) => console.error(...args);
console.info = console.log;
console.warn = (...args: unknown[]) => console.error(...args);

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createMcpServer } = await import('./server.js');
const { getDb } = await import('../rag/store.js');

getDb();
await createMcpServer().connect(new StdioServerTransport());
