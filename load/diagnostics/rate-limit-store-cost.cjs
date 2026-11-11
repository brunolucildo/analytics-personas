// Custo de InMemoryRateLimitStore.hit() para chaves NOVAS, abaixo e no teto de entradas.
// Requer a API compilada (`bun run build` em apps/api). Uso (da raiz):
//   node load/diagnostics/rate-limit-store-cost.cjs
const path = require("node:path");
const { InMemoryRateLimitStore, DEFAULT_MAX_ENTRIES } = require(
  path.join(__dirname, "../../apps/api/dist/modules/rate-limit/in-memory-rate-limit-store.js"),
);

const WINDOW_MS = 10 * 60 * 1000;

function microsecondsPerNewKey(maxEntries, preFill, hits) {
  const store = new InMemoryRateLimitStore(Date.now, maxEntries);

  for (let i = 0; i < preFill; i++) store.hit(`pre-${i}`, WINDOW_MS);

  const t0 = process.hrtime.bigint();

  for (let i = 0; i < hits; i++) store.hit(`novo-${i}`, WINDOW_MS);

  return Number(process.hrtime.bigint() - t0) / 1000 / hits;
}

console.log(
  `teto padrao do store: ${DEFAULT_MAX_ENTRIES} entradas; janela de 10 min (nenhuma expira durante o teste)\n`,
);

const below = microsecondsPerNewKey(1_000_000, 5_000, 20_000);
const atCap = microsecondsPerNewKey(DEFAULT_MAX_ENTRIES, DEFAULT_MAX_ENTRIES, 20_000);

console.log(`chave nova, mapa com ~5 mil entradas e sem teto: ${below.toFixed(2)} us por hit`);
console.log(
  `chave nova, mapa NO teto (10 mil entradas):      ${atCap.toFixed(2)} us por hit  (${(atCap / below).toFixed(0)}x mais caro)`,
);

const perSecond = 1_000_000 / atCap;

console.log(
  `\nno teto, a thread principal aguenta no maximo ~${perSecond.toFixed(0)} chaves novas por segundo so com o limitador,`,
);
console.log(
  "antes de qualquer outro trabalho da requisicao (validacao, banco, telemetria, resposta).",
);
