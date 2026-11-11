// Helpers compartilhados dos cenarios k6: configuracao, chamadas com tag por endpoint, IP sintetico
// por cliente e leitura do token no e-mail capturado.
import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";

export const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:3013").replace(/\/$/, "");
export const API = `${BASE_URL}/api/v1`;
export const RUN_ID = __ENV.RUN_ID || Date.now().toString(36);
export const APP_ORIGIN = __ENV.APP_ORIGIN || "http://localhost:5173";

// Contas criadas pelo teste: o runner apaga tudo que comeca com este prefixo no fim da execucao.
export const EMAIL_PREFIX = "k6-";
export const PASSWORD = "K6-load-Pass-93f1c7!";
export const NEW_PASSWORD = "K6-load-New-71ab02!";

let sequence = 0;

/** E-mail unico por execucao, VU e iteracao (sempre @example.test, nunca um dominio real). */
export function uniqueEmail(tag) {
  sequence += 1;

  return `${EMAIL_PREFIX}${RUN_ID}-${tag}-${exec.vu.idInTest}-${exec.vu.iterationInInstance}-${sequence}@example.test`;
}

/**
 * IPv4 sintetico (10.x.y.z) por VU e iteracao. A API de teste roda com TRUST_PROXY=true, entao o
 * `X-Forwarded-For` vira o `request.ip` do limitador: cada "cliente" tem a propria cota, como em
 * producao atras de um proxy. Sem isso, 5 sign-ups por hora por IP travariam o teste inteiro.
 */
export function clientIp(salt = 0) {
  const n = (exec.vu.idInTest * 7919 + exec.vu.iterationInInstance * 104729 + salt) % 16777216;

  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/**
 * Uma chamada a API. `expected` lista os status que contam como sucesso no `http_req_failed`
 * (um 401 de credencial errada e esperado; um 500 nao). `endpoint` e a tag usada nos graficos e nos
 * limites, com cardinalidade fixa.
 */
export function call(method, path, { endpoint, expected, body, token, ip, headers: extra } = {}) {
  const headers = Object.assign(
    {
      "content-type": "application/json",
      "x-forwarded-for": ip || clientIp(),
      "x-request-id": `k6-${RUN_ID}-${exec.vu.idInTest}-${exec.vu.iterationInInstance}`,
    },
    extra || {},
  );

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return http.request(method, `${API}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers,
    tags: { endpoint },
    responseCallback: http.expectedStatuses(...(expected || [200])),
  });
}

/** Marca o resultado de uma chamada como check do k6 e devolve se passou. */
export function expectStatus(res, status, label) {
  return check(res, { [label]: (r) => r.status === status });
}

/**
 * Le o link mais recente de um tipo (`confirm-account` ou `reset-password`) no e-mail capturado do
 * destinatario. O e-mail e enviado em segundo plano, entao tenta algumas vezes. Devolve `null` se
 * nao chegou (o buffer do provider de captura guarda so os ultimos 500 e-mails).
 */
export function tokenFromMail(email, kind) {
  const link = `/auth/${kind}?token=`;

  for (let attempt = 0; attempt < 10; attempt++) {
    const res = call("GET", `/test-support/emails?to=${encodeURIComponent(email)}`, {
      endpoint: "test-support-list",
      expected: [200],
    });

    if (res.status === 200) {
      const emails = res.json("emails") || [];

      for (let i = emails.length - 1; i >= 0; i--) {
        const text = emails[i].text || "";

        if (text.includes(link)) {
          const match = /[?&]token=([^\s&"<>]+)/.exec(text.slice(text.indexOf(link)));

          if (match) {
            return decodeURIComponent(match[1]);
          }
        }
      }
    }

    sleep(0.2);
  }

  return null;
}
