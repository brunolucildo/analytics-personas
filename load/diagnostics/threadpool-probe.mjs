// Quais operacoes atrasam quando o pool de threads do libuv esta cheio de argon2?
// Mede, no mesmo processo e antes/durante uma saturacao de hashes, a latencia de operacoes que a API
// usa em toda requisicao autenticada. Uso (da raiz): node load/diagnostics/threadpool-probe.mjs
// Opcional: UV_THREADPOOL_SIZE=16 para ver que o tamanho do pool nao resolve; PROBE_FETCH_URL para
// medir um `fetch` local (padrao: o health do Grafana local).
import { createHmac, randomBytes, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const apiPackage = new URL("../../apps/api/package.json", import.meta.url);
const require = createRequire(apiPackage);
const argon2 = require("argon2");
const { SignJWT, jwtVerify } = await import(pathToFileURL(require.resolve("jose")).href);
const fetchUrl = process.env.PROBE_FETCH_URL ?? "http://127.0.0.1:3000/api/health";

const key = new TextEncoder().encode("probe-secret-0123456789-abcdefghijklmnop");
const token = await new SignJWT({ sid: "x" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject("u")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(key);
const subtleKey = await webcrypto.subtle.importKey(
  "raw",
  key,
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);
const data = new TextEncoder().encode("payload");
const signature = await webcrypto.subtle.sign("HMAC", subtleKey, data);

const probes = {
  "jose jwtVerify (HS256), usado no guard do session": () =>
    jwtVerify(token, key, { algorithms: ["HS256"] }),
  "crypto.subtle.verify (HMAC)": () => webcrypto.subtle.verify("HMAC", subtleKey, signature, data),
  "crypto.randomBytes assincrono": () =>
    new Promise((resolve, reject) => randomBytes(32, (e, b) => (e ? reject(e) : resolve(b)))),
  "crypto.createHmac (sincrono)": async () => createHmac("sha256", key).update(data).digest(),
  "fs.readFile (usa o pool)": () => readFile(new URL("../../package.json", import.meta.url)),
  "fetch http local (rede)": () => fetch(fetchUrl).then((r) => r.arrayBuffer()),
  "setImmediate (event loop)": () => new Promise((resolve) => setImmediate(resolve)),
};

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];

async function measure(rounds) {
  const out = Object.fromEntries(Object.keys(probes).map((name) => [name, []]));

  for (let i = 0; i < rounds; i++) {
    for (const [name, fn] of Object.entries(probes)) {
      const t0 = performance.now();

      await fn();
      out[name].push(performance.now() - t0);
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  return out;
}

console.log(`threadpool do libuv: ${process.env.UV_THREADPOOL_SIZE ?? "4 (padrao)"}\n`);

const idle = await measure(30);

// 48 hashes em voo o tempo todo, como centenas de logins invalidos simultaneos.
let stop = false;
const hashers = Array.from({ length: 48 }, async (_, i) => {
  while (!stop) await argon2.hash(`saturacao-${i}`, { type: argon2.argon2id });
});

await new Promise((r) => setTimeout(r, 1500));

const busy = await measure(12);

stop = true;
await Promise.all(hashers);

console.log("latencia por operacao, em ms (mediana / p95)\n");
console.log("operacao".padEnd(52), "pool livre".padEnd(18), "pool saturado de argon2");

for (const name of Object.keys(probes)) {
  const a = `${median(idle[name]).toFixed(2)} / ${p95(idle[name]).toFixed(2)}`;
  const b = `${median(busy[name]).toFixed(1)} / ${p95(busy[name]).toFixed(1)}`;

  console.log(name.padEnd(52), a.padEnd(18), b);
}
