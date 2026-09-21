// Consumo de los modelos: pnpm usage [--days=7] [--prefix=wa:]
const { usageSummary, formatUsage } = await import('../llm/usage.js');
const days = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? 7);
const prefix = process.argv.find((a) => a.startsWith('--prefix='))?.split('=')[1];
console.log(`consumo de los últimos ${days} días${prefix ? ` (conversaciones ${prefix}…)` : ''}\n`);
console.log(formatUsage(usageSummary(Date.now() - days * 86400_000, { userPrefix: prefix })));
