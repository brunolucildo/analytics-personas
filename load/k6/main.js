// Teste de carga da API Rondo com k6. Exercita todos os endpoints atuais:
//   GET  /api/v1/health
//   POST /api/v1/auth/{sign-up, confirm-account, sign-in, sign-out, forgot-password, reset-password,
//                      resend-confirmation}
//   GET  /api/v1/auth/session
//   GET|DELETE /api/v1/test-support/emails   (so com EMAIL_PROVIDER=capture)
// mais rotas inexistentes (404), preflight CORS (OPTIONS) e rotas fechadas sem sessao (401).
//
// Nao rode este arquivo contra a API de dev: use `bun run load <perfil>`, que sobe uma API isolada
// com Supabase local, e-mail capturado e TRUST_PROXY=true. Perfis: smoke, load, stress.
import http from "k6/http";
import { check } from "k6";
import { API } from "./lib/client.js";
import {
  antiEnumeration,
  badTokens,
  browse,
  edges,
  invalidCredentials,
  lifecycle,
  rateLimit,
  testSupport,
  validation,
} from "./lib/scenarios.js";

export {
  antiEnumeration,
  badTokens,
  browse,
  edges,
  invalidCredentials,
  lifecycle,
  rateLimit,
  testSupport,
  validation,
};

const PROFILE = __ENV.PROFILE || "smoke";

const once = (exec, iterations = 1, vus = 1) => ({
  executor: "shared-iterations",
  exec,
  vus,
  iterations,
  maxDuration: "2m",
});

const ramp = (exec, stages) => ({
  executor: "ramping-vus",
  exec,
  startVUs: 0,
  stages,
  gracefulRampDown: "30s",
  gracefulStop: "30s",
});

const rate = (exec, stages, preAllocatedVUs, maxVUs) => ({
  executor: "ramping-arrival-rate",
  exec,
  startRate: 1,
  timeUnit: "1s",
  stages,
  preAllocatedVUs,
  maxVUs,
  gracefulStop: "30s",
});

const stage = (duration, target) => ({ duration, target });

const PROFILES = {
  // Um passo por cenario: confirma que todo endpoint responde como esperado (cerca de 20 s).
  smoke: {
    lifecycle: once("lifecycle"),
    browse: once("browse", 3),
    invalidCredentials: once("invalidCredentials", 3),
    validation: once("validation", 6),
    antiEnumeration: once("antiEnumeration", 4),
    badTokens: once("badTokens", 4),
    edges: once("edges", 10),
    testSupport: once("testSupport", 2),
    rateLimit: once("rateLimit"),
  },

  // Carga realista e sustentada, para medir a latencia no ritmo esperado (cerca de 4 min).
  load: {
    lifecycle: ramp("lifecycle", [stage("30s", 5), stage("2m30s", 10), stage("30s", 0)]),
    browse: ramp("browse", [stage("30s", 10), stage("2m30s", 30), stage("30s", 0)]),
    invalidCredentials: rate(
      "invalidCredentials",
      [stage("30s", 5), stage("2m30s", 20), stage("30s", 0)],
      10,
      60,
    ),
    validation: rate("validation", [stage("30s", 10), stage("2m30s", 40), stage("30s", 0)], 10, 60),
    antiEnumeration: rate(
      "antiEnumeration",
      [stage("30s", 3), stage("2m30s", 10), stage("30s", 0)],
      10,
      40,
    ),
    badTokens: rate("badTokens", [stage("30s", 3), stage("2m30s", 10), stage("30s", 0)], 10, 40),
    edges: rate("edges", [stage("30s", 10), stage("2m30s", 40), stage("30s", 0)], 10, 60),
    testSupport: rate("testSupport", [stage("30s", 1), stage("2m30s", 2), stage("30s", 0)], 5, 10),
    rateLimit: { ...once("rateLimit", 4, 2), startTime: "30s" },
  },

  // Rampa alem da capacidade esperada para achar o ponto de degradacao (cerca de 9 min). Os limites
  // sao informativos: estourar um deles e o resultado, nao uma falha do teste. Os tetos de VUs sao
  // deliberados: sem eles o k6 abre milhares de conexoes na mesma maquina da API e o que se mede e
  // o limite do gerador e do sistema operacional (connection refused), nao o da API.
  stress: {
    lifecycle: ramp("lifecycle", [
      stage("1m", 5),
      stage("2m", 15),
      stage("2m", 30),
      stage("2m", 50),
      stage("1m", 0),
    ]),
    browse: ramp("browse", [
      stage("1m", 20),
      stage("2m", 60),
      stage("2m", 120),
      stage("2m", 200),
      stage("1m", 0),
    ]),
    invalidCredentials: rate(
      "invalidCredentials",
      [stage("1m", 10), stage("2m", 30), stage("2m", 60), stage("2m", 100), stage("1m", 0)],
      30,
      200,
    ),
    validation: rate(
      "validation",
      [stage("1m", 20), stage("2m", 60), stage("2m", 120), stage("2m", 160), stage("1m", 0)],
      30,
      250,
    ),
    antiEnumeration: rate(
      "antiEnumeration",
      [stage("1m", 5), stage("2m", 20), stage("2m", 40), stage("2m", 60), stage("1m", 0)],
      20,
      150,
    ),
    badTokens: rate(
      "badTokens",
      [stage("1m", 5), stage("2m", 20), stage("2m", 40), stage("2m", 60), stage("1m", 0)],
      20,
      150,
    ),
    edges: rate(
      "edges",
      [stage("1m", 20), stage("2m", 60), stage("2m", 120), stage("2m", 160), stage("1m", 0)],
      30,
      250,
    ),
    testSupport: rate(
      "testSupport",
      [stage("1m", 1), stage("2m", 2), stage("2m", 3), stage("2m", 3), stage("1m", 0)],
      5,
      20,
    ),
    rateLimit: { ...once("rateLimit", 30, 5), startTime: "1m" },
  },

  // Capacidade de um caminho por vez (use --only=edges, --only=invalidCredentials ou --only=browse):
  // rampa curta (2,5 min) ate saturar, para comparar configuracoes da API em condicoes iguais.
  capacity: {
    edges: rate(
      "edges",
      [
        stage("30s", 200),
        stage("30s", 600),
        stage("30s", 1000),
        stage("30s", 1500),
        stage("30s", 2000),
      ],
      100,
      500,
    ),
    invalidCredentials: rate(
      "invalidCredentials",
      [stage("30s", 10), stage("30s", 30), stage("30s", 60), stage("30s", 90), stage("30s", 120)],
      50,
      400,
    ),
    browse: ramp("browse", [
      stage("30s", 20),
      stage("30s", 50),
      stage("30s", 100),
      stage("30s", 150),
      stage("30s", 200),
    ]),
    // Corpos invalidos, um cliente novo (IP e chave do limitador) a cada requisicao: sem argon2 e sem
    // banco, mede o custo do limitador de requisicoes com muitas chaves distintas.
    validation: rate(
      "validation",
      [
        stage("30s", 100),
        stage("30s", 300),
        stage("30s", 600),
        stage("30s", 900),
        stage("30s", 1200),
      ],
      100,
      400,
    ),
  },
};

if (!PROFILES[PROFILE]) {
  throw new Error(`perfil desconhecido: ${PROFILE} (use smoke, load ou stress)`);
}

const tolerant = PROFILE === "stress";

// ONLY=a,b limita a execucao a alguns cenarios do perfil (uso: --only=a,b no runner).
const selected = {};

for (const name of (__ENV.ONLY || "").split(",").filter(Boolean)) {
  if (!PROFILES[PROFILE][name]) {
    throw new Error(
      `cenario "${name}" nao existe no perfil ${PROFILE}: ${Object.keys(PROFILES[PROFILE]).join(", ")}`,
    );
  }

  selected[name] = PROFILES[PROFILE][name];
}

const scenarios = Object.keys(selected).length > 0 ? selected : PROFILES[PROFILE];

export const options = {
  scenarios,
  // `http_req_failed` so conta o que nao estava na lista de status esperados de cada chamada.
  // O perfil capacity compara configuracoes: sem limites de verdade, so medidas.
  thresholds:
    PROFILE === "capacity"
      ? {
          // Sempre verdadeiros: existem so para o resumo trazer a latencia por endpoint.
          "http_req_duration{endpoint:health}": ["max>=0"],
          "http_req_duration{endpoint:session}": ["max>=0"],
          "http_req_duration{endpoint:sign-in}": ["max>=0"],
        }
      : {
          http_req_failed: [{ threshold: "rate<0.01", abortOnFail: false }],
          checks: [{ threshold: "rate>0.98", abortOnFail: false }],
          flow_success: [{ threshold: "rate>0.95", abortOnFail: false }],
          "http_req_duration{endpoint:health}": [
            { threshold: tolerant ? "p(95)<1000" : "p(95)<300", abortOnFail: false },
          ],
          "http_req_duration{endpoint:session}": [
            { threshold: tolerant ? "p(95)<2000" : "p(95)<1000", abortOnFail: false },
          ],
          "http_req_duration{endpoint:sign-in}": [
            { threshold: tolerant ? "p(95)<5000" : "p(95)<2500", abortOnFail: false },
          ],
          "http_req_duration{endpoint:sign-up}": [
            { threshold: tolerant ? "p(95)<5000" : "p(95)<2500", abortOnFail: false },
          ],
        },
  // Sem `url` e `name`: o k6 os grava com a URL completa, e `GET /test-support/emails?to=<e-mail>`
  // muda a cada chamada. Cada URL nova vira dezenas de series no Mimir (uma por metrica http_req_*),
  // o que estourou o limite de series do tenant. O `endpoint` (tag nossa, valores fixos) basta.
  systemTags: ["status", "method", "scenario", "expected_response", "error_code"],
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

export function setup() {
  const health = http.get(`${API}/health`, { tags: { endpoint: "health" } });

  check(health, { "a API responde antes de comecar": (r) => r.status === 200 });

  // Esvazia a caixa de e-mails capturados: os cenarios leem os links dela.
  const cleared = http.del(`${API}/test-support/emails`, null, {
    tags: { endpoint: "test-support-clear" },
    responseCallback: http.expectedStatuses(204),
  });

  check(cleared, { "test-support clear 204": (r) => r.status === 204 });
}
