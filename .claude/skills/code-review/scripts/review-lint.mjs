#!/usr/bin/env node
// Valida o rascunho de uma revisão de PR e gera o payload final para a API do GitHub.
//
// Uso:
//   node review-lint.mjs --diff <pr.diff> --review <review.json> [--out <final.json>]
//                        [--own-pr] [--lang pt-BR|en-US]
//
// O que faz (tudo determinístico, sem rede):
//   1. Lê o diff unificado e descobre quais linhas aceitam comentário inline.
//   2. Confere cada comentário inline (path, line, side, start_line) contra o diff.
//   3. Confere o formato Conventional Comments e as decorações permitidas.
//   4. Calcula o veredito: algum `issue` ou `(blocking)` => REQUEST_CHANGES; senão APPROVE.
//   5. Troca {{VERDICT}} e {{COUNTS}} no corpo e grava o payload final (--out).
//
// Saída: relatório JSON no stdout. Exit 0 = ok, 1 = erros de validação, 2 = uso incorreto.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const LABELS = ["praise", "nitpick", "suggestion", "issue", "todo", "question", "thought", "chore", "note"];
// Labels que nunca bloqueiam, por definição.
const NEVER_BLOCKING = new Set(["praise", "nitpick", "thought", "note"]);
const BEHAVIOR_DECORATIONS = ["blocking", "non-blocking", "if-minor"];
// Uma decoração por dimensão da revisão (ver references/review-checklist.md).
const DIMENSION_DECORATIONS = [
  "standards", "performance", "bug", "readability", "a11y", "i18n", "tests", "o11y",
  "security", "architecture", "data", "api", "docs", "scope", "deps",
];
const DECORATIONS = new Set([...BEHAVIOR_DECORATIONS, ...DIMENSION_DECORATIONS]);
const COMMENT_KEYS = new Set(["path", "line", "side", "start_line", "start_side", "body"]);
const COMMENT_RE = new RegExp(`^(${LABELS.join("|")})(?: \\(([^)]*)\\))?:\\s+(\\S[\\s\\S]*)$`);
const MAX_BODY = 65536;
const SOFT_MAX_COMMENTS = 40;

const TEXT = {
  "pt-BR": {
    request: (n) => `🔴 **Solicitar mudanças** — ${n} comentário(s) bloqueante(s) (\`issue\` ou \`blocking\`).`,
    approve: "🟢 **Aprovado** — nenhum comentário bloqueante (\`issue\` ou \`blocking\`).",
    ownPr:
      "> O GitHub não permite aprovar nem solicitar mudanças no próprio PR. Esta revisão foi publicada como comentário, mas o veredito acima vale.",
    noComments: "nenhum comentário",
  },
  "en-US": {
    request: (n) => `🔴 **Changes requested** — ${n} blocking comment(s) (\`issue\` or \`blocking\`).`,
    approve: "🟢 **Approved** — no blocking comments (\`issue\` or \`blocking\`).",
    ownPr:
      "> GitHub does not allow approving or requesting changes on your own PR. This review was posted as a comment, but the verdict above stands.",
    noComments: "no comments",
  },
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readText(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`Não foi possível ler ${what} (${path}): ${error.message}`);
  }
}

// ---------------------------------------------------------------- diff

function unquote(path) {
  if (path.startsWith('"') && path.endsWith('"')) return path.slice(1, -1).replace(/\\"/g, '"');
  return path;
}

/** @returns {Map<string, {right: Map<number, number>, left: Map<number, number>}>} linha -> id do hunk */
function parseDiff(text) {
  const files = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;
  let hunk = 0;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let oldPath = null;

  for (const line of lines) {
    let inHunk = current !== null && (oldLeft > 0 || newLeft > 0);
    // Linha de corpo de hunk começa com espaço, + , - ou \ (ou é vazia: contexto sem espaço final).
    // Qualquer outra coisa encerra o hunk, mesmo que as contagens do cabeçalho estejam erradas.
    if (inHunk && line !== "" && !" +-\\".includes(line[0])) {
      oldLeft = 0;
      newLeft = 0;
      inHunk = false;
    }

    if (inHunk) {
      if (line.startsWith("\\")) continue; // "\ No newline at end of file"
      const marker = line[0];
      if (marker === "+") {
        current.right.set(newLine++, hunk);
        newLeft--;
      } else if (marker === "-") {
        current.left.set(oldLine++, hunk);
        oldLeft--;
      } else {
        current.left.set(oldLine++, hunk);
        current.right.set(newLine++, hunk);
        oldLeft--;
        newLeft--;
      }
      continue;
    }

    if (line.startsWith("diff --git ")) {
      current = null;
      oldPath = null;
    } else if (line.startsWith("--- ")) {
      const p = unquote(line.slice(4).trim());
      oldPath = p === "/dev/null" ? null : p.replace(/^a\//, "");
    } else if (line.startsWith("+++ ")) {
      const p = unquote(line.slice(4).trim());
      const path = p === "/dev/null" ? oldPath : p.replace(/^b\//, "");
      if (path) {
        current = files.get(path) ?? { right: new Map(), left: new Map() };
        files.set(path, current);
      }
    } else if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match || current === null) continue;
      hunk++;
      oldLine = Number(match[1]);
      oldLeft = match[2] === undefined ? 1 : Number(match[2]);
      newLine = Number(match[3]);
      newLeft = match[4] === undefined ? 1 : Number(match[4]);
    }
  }
  return files;
}

function ranges(map) {
  const sorted = [...map.keys()].sort((a, b) => a - b);
  const out = [];
  let start = null;
  let prev = null;
  for (const n of sorted) {
    if (start === null) start = n;
    else if (n !== prev + 1) {
      out.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = n;
    }
    prev = n;
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out.join(", ") || "(none)";
}

// ---------------------------------------------------------------- comentários

/** @returns {{label: string, decorations: string[], subject: string} | null} */
function parseComment(text) {
  const match = COMMENT_RE.exec(text.trimStart());
  if (!match) return null;
  const decorations = match[2] === undefined ? [] : match[2].split(",").map((d) => d.trim());
  return { label: match[1], decorations, subject: match[3].split("\n")[0].trim() };
}

function isBlocking(parsed) {
  return parsed.label === "issue" || parsed.decorations.includes("blocking");
}

function checkVocabulary(parsed, where, errors) {
  const { label, decorations } = parsed;
  for (const d of decorations) {
    if (!DECORATIONS.has(d)) errors.push(`${where}: decoração desconhecida "${d}". Permitidas: ${[...DECORATIONS].join(", ")}.`);
  }
  const blocking = decorations.includes("blocking");
  if (blocking && decorations.includes("non-blocking")) errors.push(`${where}: "blocking" e "non-blocking" juntos.`);
  if (label === "issue" && decorations.includes("non-blocking")) {
    errors.push(`${where}: "issue" é sempre bloqueante. Se não bloqueia, use suggestion, nitpick ou thought.`);
  }
  if (NEVER_BLOCKING.has(label) && blocking) {
    errors.push(`${where}: "${label}" nunca bloqueia. Use issue, ou suggestion/question/todo/chore com (blocking).`);
  }
}

function bodyComments(body) {
  const out = [];
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = raw.replace(/^\s*(?:[-*]\s+|>\s*)/, "");
    const parsed = parseComment(line);
    if (parsed) out.push({ ...parsed, text: line });
  }
  return out;
}

// ---------------------------------------------------------------- main

function main() {
  const { values } = parseArgs({
    options: {
      diff: { type: "string" },
      review: { type: "string" },
      out: { type: "string" },
      lang: { type: "string", default: "pt-BR" },
      "own-pr": { type: "boolean", default: false },
    },
  });
  if (!values.diff || !values.review) fail("Uso: review-lint.mjs --diff <pr.diff> --review <review.json> [--out <final.json>] [--own-pr] [--lang pt-BR|en-US]");
  const text = TEXT[values.lang];
  if (!text) fail(`--lang inválido: ${values.lang}`);

  const files = parseDiff(readText(values.diff, "o diff"));
  let review;
  try {
    review = JSON.parse(readText(values.review, "o review"));
  } catch (error) {
    return fail(`review.json não é JSON válido: ${error.message}`);
  }

  const errors = [];
  const warnings = [];
  const parsedAll = []; // { where, parsed }

  if (files.size === 0) errors.push("O diff não tem nenhum arquivo: arquivo errado ou vazio.");
  if (!/^[0-9a-f]{40}$/.test(review.commit_id ?? "")) errors.push("commit_id ausente ou fora do formato (SHA de 40 hex do head do PR).");
  if (typeof review.body !== "string" || review.body.trim() === "") errors.push("body ausente ou vazio.");
  const comments = Array.isArray(review.comments) ? review.comments : [];
  if (review.comments !== undefined && !Array.isArray(review.comments)) errors.push("comments precisa ser um array.");

  // Comentários inline
  const seen = new Set();
  comments.forEach((comment, index) => {
    const where = `comments[${index}]${comment?.path ? ` (${comment.path}:${comment.line})` : ""}`;
    for (const key of Object.keys(comment ?? {})) {
      if (!COMMENT_KEYS.has(key)) errors.push(`${where}: campo "${key}" não permitido. Use path, line, side, start_line, start_side, body.`);
    }
    const file = files.get(comment?.path);
    if (!file) {
      errors.push(`${where}: path não aparece no diff. Comentário fora do diff vai para o corpo geral.`);
      return;
    }
    const side = comment.side ?? "RIGHT";
    if (side !== "RIGHT" && side !== "LEFT") errors.push(`${where}: side deve ser RIGHT ou LEFT.`);
    const map = side === "LEFT" ? file.left : file.right;
    if (!Number.isInteger(comment.line) || !map.has(comment.line)) {
      errors.push(`${where}: linha ${comment.line} (${side}) não está no diff. Linhas válidas: ${ranges(map)}.`);
    } else if (comment.start_line !== undefined) {
      const startSide = comment.start_side ?? side;
      const startMap = startSide === "LEFT" ? file.left : file.right;
      if (!Number.isInteger(comment.start_line) || comment.start_line >= comment.line) {
        errors.push(`${where}: start_line precisa ser menor que line.`);
      } else if (!startMap.has(comment.start_line) || startMap.get(comment.start_line) !== map.get(comment.line)) {
        errors.push(`${where}: start_line ${comment.start_line} precisa estar no mesmo hunk de line (válidas: ${ranges(startMap)}).`);
      }
    }
    const key = `${comment.path}:${side}:${comment.line}`;
    if (seen.has(key)) warnings.push(`${where}: mais de um comentário na mesma linha; considere juntar.`);
    seen.add(key);

    if (typeof comment.body !== "string") {
      errors.push(`${where}: body ausente.`);
      return;
    }
    if (comment.body.length > MAX_BODY) errors.push(`${where}: body passa de ${MAX_BODY} caracteres.`);
    const parsed = parseComment(comment.body);
    if (!parsed) {
      errors.push(`${where}: não segue Conventional Comments. Esperado "<label> (<decorações>): <assunto>"; labels: ${LABELS.join(", ")}.`);
      return;
    }
    checkVocabulary(parsed, where, errors);
    parsedAll.push({ where, parsed, path: comment.path, line: comment.line });
  });

  // Comentários gerais (corpo)
  const body = typeof review.body === "string" ? review.body : "";
  const verdictSlots = body.split("{{VERDICT}}").length - 1;
  if (verdictSlots !== 1) errors.push(`O corpo precisa ter {{VERDICT}} exatamente uma vez (tem ${verdictSlots}). O veredito é calculado pelo script, não escrito à mão.`);
  if (/\b(approved|aprovado|request(ed)? changes|solicitar mudan)/i.test(body.replace(/\{\{VERDICT\}\}/g, ""))) {
    warnings.push("O corpo cita aprovação/mudanças fora de {{VERDICT}}; confira que não contradiz o veredito calculado.");
  }
  for (const generic of bodyComments(body)) {
    const where = `body ("${generic.text.slice(0, 40)}…")`;
    checkVocabulary(generic, where, errors);
    parsedAll.push({ where, parsed: generic, path: null, line: null });
  }

  if (comments.length > SOFT_MAX_COMMENTS) warnings.push(`${comments.length} comentários inline: acima de ${SOFT_MAX_COMMENTS}, o sinal se perde. Priorize.`);
  if (body.length > MAX_BODY - 2000) warnings.push("Corpo perto do limite de 65536 caracteres.");

  // Veredito
  const blocking = parsedAll.filter((c) => isBlocking(c.parsed));
  const verdict = blocking.length > 0 ? "REQUEST_CHANGES" : "APPROVE";
  const event = values["own-pr"] ? "COMMENT" : verdict;

  const counts = {};
  for (const { parsed } of parsedAll) counts[parsed.label] = (counts[parsed.label] ?? 0) + 1;
  const countsLine = Object.entries(counts).map(([label, n]) => `${label} ${n}`).join(" · ") || text.noComments;

  const report = {
    ok: errors.length === 0,
    verdict,
    event,
    inlineComments: comments.length,
    counts,
    blocking: blocking.map((c) => ({ where: c.path ? `${c.path}:${c.line}` : "body", label: c.parsed.label, subject: c.parsed.subject })),
    errors,
    warnings,
  };

  if (report.ok && values.out) {
    const headline = verdict === "REQUEST_CHANGES" ? text.request(blocking.length) : text.approve;
    const verdictBlock = values["own-pr"] ? `${headline}\n\n${text.ownPr}` : headline;
    // O marcador permite à skill detectar uma revisão já publicada para este commit (idempotência).
    const marker = `<!-- code-review sha:${review.commit_id} -->`;
    const finalBody = `${body.replace("{{VERDICT}}", verdictBlock).replaceAll("{{COUNTS}}", countsLine).trimEnd()}\n\n${marker}\n`;
    if (finalBody.length > MAX_BODY) {
      report.ok = false;
      report.errors.push(`Corpo final passa de ${MAX_BODY} caracteres.`);
    } else {
      const payload = {
        commit_id: review.commit_id,
        body: finalBody,
        event,
        comments: comments.map(({ path, line, side, start_line, start_side, body: commentBody }) => ({
          path,
          line,
          side: side ?? "RIGHT",
          ...(start_line === undefined ? {} : { start_line, start_side: start_side ?? side ?? "RIGHT" }),
          body: commentBody,
        })),
      };
      writeFileSync(values.out, `${JSON.stringify(payload, null, 2)}\n`);
      report.out = values.out;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
