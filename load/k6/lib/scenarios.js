// Uma funcao por tipo de trafego. Juntas exercitam todos os endpoints atuais da API.
import exec from "k6/execution";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  NEW_PASSWORD,
  PASSWORD,
  call,
  clientIp,
  expectStatus,
  tokenFromMail,
  uniqueEmail,
} from "./client.js";

export const flowSuccess = new Rate("flow_success");
export const flowDuration = new Trend("flow_duration", true);
export const mailMissing = new Counter("mail_missing");
export const rateLimitedSeen = new Counter("rate_limited_seen");

const SIGN_UP = "sign-up";
const SIGN_IN = "sign-in";
const SIGN_OUT = "sign-out";
const CONFIRM = "confirm-account";
const FORGOT = "forgot-password";
const RESET = "reset-password";
const RESEND = "resend-confirmation";
const SESSION = "session";
const HEALTH = "health";

const signUpBody = (email) => ({
  firstName: "Carga",
  lastName: "K6",
  email,
  password: PASSWORD,
  confirmPassword: PASSWORD,
});

/** Cria e confirma uma conta; devolve `{ email, token }` ou `null` se algum passo falhar. */
function createConfirmedAccount(tag, ip) {
  const email = uniqueEmail(tag);
  const created = call("POST", "/auth/sign-up", {
    endpoint: SIGN_UP,
    expected: [201],
    body: signUpBody(email),
    ip,
  });

  if (!expectStatus(created, 201, "sign-up 201")) {
    return null;
  }

  const link = tokenFromMail(email, "confirm-account");

  if (link === null) {
    mailMissing.add(1);

    return null;
  }

  const confirmed = call("POST", "/auth/confirm-account", {
    endpoint: CONFIRM,
    expected: [200],
    body: { token: link },
    ip,
  });

  if (!expectStatus(confirmed, 200, "confirm-account 200")) {
    return null;
  }

  return { email, token: confirmed.json("accessToken"), ip };
}

/** Jornada completa de uma pessoa: cadastro, confirmacao, sessao, sair, entrar, esqueci a senha, reset. */
export function lifecycle() {
  const started = Date.now();
  const ip = clientIp();
  let ok = false;

  try {
    const account = createConfirmedAccount("life", ip);

    if (account === null) {
      return;
    }

    const session = call("GET", "/auth/session", {
      endpoint: SESSION,
      expected: [200],
      token: account.token,
      ip,
    });

    if (!expectStatus(session, 200, "session 200")) {
      return;
    }

    // Conta ja confirmada: responde 202 igual (anti-enumeracao) e nao envia nada.
    expectStatus(
      call("POST", "/auth/resend-confirmation", {
        endpoint: RESEND,
        expected: [202],
        body: { email: account.email },
        ip,
      }),
      202,
      "resend-confirmation 202",
    );

    expectStatus(
      call("POST", "/auth/sign-out", {
        endpoint: SIGN_OUT,
        expected: [204],
        token: account.token,
        ip,
      }),
      204,
      "sign-out 204",
    );
    expectStatus(
      call("GET", "/auth/session", {
        endpoint: SESSION,
        expected: [401],
        token: account.token,
        ip,
      }),
      401,
      "session apos sign-out 401",
    );

    const signedIn = call("POST", "/auth/sign-in", {
      endpoint: SIGN_IN,
      expected: [200],
      body: { email: account.email, password: PASSWORD },
      ip,
    });

    if (!expectStatus(signedIn, 200, "sign-in 200")) {
      return;
    }

    expectStatus(
      call("POST", "/auth/forgot-password", {
        endpoint: FORGOT,
        expected: [202],
        body: { email: account.email },
        ip,
      }),
      202,
      "forgot-password 202",
    );

    const resetToken = tokenFromMail(account.email, "reset-password");

    if (resetToken === null) {
      mailMissing.add(1);

      return;
    }

    expectStatus(
      call("POST", "/auth/reset-password", {
        endpoint: RESET,
        expected: [204],
        body: { token: resetToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
        ip,
      }),
      204,
      "reset-password 204",
    );

    expectStatus(
      call("POST", "/auth/sign-in", {
        endpoint: SIGN_IN,
        expected: [401],
        body: { email: account.email, password: PASSWORD },
        ip,
      }),
      401,
      "sign-in com a senha antiga 401",
    );

    ok = expectStatus(
      call("POST", "/auth/sign-in", {
        endpoint: SIGN_IN,
        expected: [200],
        body: { email: account.email, password: NEW_PASSWORD },
        ip,
      }),
      200,
      "sign-in com a senha nova 200",
    );
  } finally {
    flowSuccess.add(ok);
    flowDuration.add(Date.now() - started);
  }
}

// Cada VU cria a propria conta uma vez e depois so le: o trafego de leitura que domina uma API real.
let browseAccount = null;

export function browse() {
  if (browseAccount === null) {
    browseAccount = createConfirmedAccount("browse", clientIp());

    if (browseAccount === null) {
      sleep(1);

      return;
    }
  }

  expectStatus(
    call("GET", "/health", { endpoint: HEALTH, expected: [200], ip: browseAccount.ip }),
    200,
    "health 200",
  );
  expectStatus(
    call("GET", "/auth/session", {
      endpoint: SESSION,
      expected: [200],
      token: browseAccount.token,
      ip: browseAccount.ip,
    }),
    200,
    "session 200",
  );
  sleep(0.1 + Math.random() * 0.4);
}

/** Senha errada para e-mails que nao existem: o caminho de falha mais comum num ataque ao login. */
export function invalidCredentials() {
  expectStatus(
    call("POST", "/auth/sign-in", {
      endpoint: SIGN_IN,
      expected: [401],
      body: { email: uniqueEmail("nobody"), password: "wrong-password-123" },
    }),
    401,
    "sign-in invalido 401",
  );
}

const VALIDATION_CASES = [
  ["POST", "/auth/sign-up", SIGN_UP, { email: "not-an-email" }],
  ["POST", "/auth/sign-in", SIGN_IN, {}],
  ["POST", "/auth/confirm-account", CONFIRM, {}],
  ["POST", "/auth/reset-password", RESET, { token: "x" }],
  ["POST", "/auth/forgot-password", FORGOT, { email: 123 }],
  ["POST", "/auth/resend-confirmation", RESEND, {}],
];

/** Corpos invalidos em todos os POSTs: 400 de validacao antes de qualquer regra de negocio. */
export function validation() {
  const [method, path, endpoint, body] =
    VALIDATION_CASES[exec.scenario.iterationInTest % VALIDATION_CASES.length];

  expectStatus(
    call(method, path, { endpoint, expected: [400], body }),
    400,
    `validacao ${path} 400`,
  );
}

/** forgot-password e resend-confirmation com e-mails desconhecidos: sempre 202 (anti-enumeracao). */
export function antiEnumeration() {
  const forgot = exec.scenario.iterationInTest % 2 === 0;

  expectStatus(
    call("POST", forgot ? "/auth/forgot-password" : "/auth/resend-confirmation", {
      endpoint: forgot ? FORGOT : RESEND,
      expected: [202],
      body: { email: uniqueEmail("ghost") },
    }),
    202,
    "anti-enumeracao 202",
  );
}

/** Tokens inventados em confirm-account e reset-password: uma resposta unica, 400. */
export function badTokens() {
  const confirm = exec.scenario.iterationInTest % 2 === 0;
  const token = `k6-invalid-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;

  expectStatus(
    confirm
      ? call("POST", "/auth/confirm-account", {
          endpoint: CONFIRM,
          expected: [400],
          body: { token },
        })
      : call("POST", "/auth/reset-password", {
          endpoint: RESET,
          expected: [400],
          body: { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
        }),
    400,
    "token invalido 400",
  );
}

/** Rotas inexistentes, preflight CORS e rotas fechadas sem sessao. */
export function edges() {
  const choice = exec.scenario.iterationInTest % 5;

  if (choice === 0) {
    expectStatus(
      call("GET", "/does-not-exist", { endpoint: "unmatched", expected: [404] }),
      404,
      "rota inexistente 404",
    );
  } else if (choice === 1) {
    const res = call("OPTIONS", "/auth/sign-in", {
      endpoint: "preflight",
      expected: [200, 204],
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });

    expectStatus(res, 204, "preflight 204");
  } else if (choice === 2) {
    expectStatus(
      call("GET", "/auth/session", { endpoint: SESSION, expected: [401] }),
      401,
      "session sem token 401",
    );
  } else if (choice === 3) {
    expectStatus(
      call("POST", "/auth/sign-out", { endpoint: SIGN_OUT, expected: [401] }),
      401,
      "sign-out sem token 401",
    );
  } else {
    expectStatus(call("GET", "/health", { endpoint: HEALTH, expected: [200] }), 200, "health 200");
  }
}

/** Le a caixa de e-mails capturados (so existe com EMAIL_PROVIDER=capture). */
export function testSupport() {
  expectStatus(
    call("GET", "/test-support/emails", { endpoint: "test-support-list", expected: [200] }),
    200,
    "test-support list 200",
  );
}

/**
 * Um unico "cliente" (mesmo IP) estoura o limite: sign-in 10 por 10 min por IP e e-mail, sign-up 5
 * por hora por IP. Espera sucesso ate o limite e 429 depois, com o envelope RATE_LIMITED.
 */
export function rateLimit() {
  const ip = clientIp(555);
  const email = uniqueEmail("limit");
  let blocked = 0;

  for (let i = 0; i < 14; i++) {
    const res = call("POST", "/auth/sign-in", {
      endpoint: SIGN_IN,
      expected: [401, 429],
      body: { email, password: "wrong-password-123" },
      ip,
    });

    if (res.status === 429) {
      blocked += 1;
      rateLimitedSeen.add(1);
      expectStatus(res, 429, "sign-in limitado 429");
    }
  }

  expectStatus({ status: blocked >= 1 ? 429 : 0 }, 429, "o limite do sign-in foi alcancado");

  for (let i = 0; i < 7; i++) {
    const res = call("POST", "/auth/sign-up", {
      endpoint: SIGN_UP,
      expected: [201, 429],
      body: signUpBody(uniqueEmail("limitup")),
      ip,
    });

    if (res.status === 429) {
      rateLimitedSeen.add(1);
    }
  }
}
