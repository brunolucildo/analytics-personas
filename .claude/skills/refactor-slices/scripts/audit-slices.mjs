#!/usr/bin/env node
/**
 * audit-slices.mjs — deterministic architecture audit for vertical slices.
 *
 * Usage (from the repository root):
 *   node .claude/skills/refactor-slices/scripts/audit-slices.mjs
 *   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --scope apps/api/src/modules
 *   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --json
 *   node .claude/skills/refactor-slices/scripts/audit-slices.mjs --strict
 *
 * The script is a floor, not a ceiling: it finds structural violations that can
 * be detected mechanically. The auditor subagent must still read the code and
 * judge semantics (business rules leaking into controllers, fake use cases,
 * ports implemented in the wrong layer, and so on).
 *
 * Exit codes:
 *   0 — report produced (default)
 *   1 — --strict and at least one violation was found
 *   2 — invalid scope or unexpected failure
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const LAYERS = ["domain", "application", "infrastructure", "interface"];

const FRAMEWORK_PACKAGES = [
  "@nestjs/",
  "@supabase/",
  "@opentelemetry/",
  "argon2",
  "class-transformer",
  "class-validator",
  "express",
  "jose",
  "pino",
  "supertest",
  "vitest",
];

const ROOT_FILE_PATTERNS = [
  /^index\.(ts|js)$/,
  /\.module\.ts$/,
  /\.tokens\.ts$/,
  /\.spec\.ts$/,
];

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(/g;
const INJECT_DECORATOR = /@Inject\s*\(/g;
const EXECUTE_METHOD = /\bexecute\s*\(/g;

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const strict = args.includes("--strict");

function readOption(name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) {
    return equals.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }

  return undefined;
}

const scopeArg = readOption("--scope");
const root = process.cwd();
const scope = scopeArg
  ? resolve(root, scopeArg)
  : resolve(root, "apps/api/src/modules");

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function walk(dir) {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(full));
    } else if (entry.isFile()) {
      entries.push(full);
    }
  }
  return entries;
}

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

function readImports(content) {
  const imports = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        imports.push({ specifier: match[1], index: match.index ?? 0 });
      }
    }
  }

  return imports;
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ];

  return candidates.find(isFile) ?? base;
}

function moduleForPath(path) {
  const rel = relative(scope, path);
  if (rel.startsWith("..") || rel === "") {
    return null;
  }

  const first = rel.split(sep)[0];
  return first ? join(scope, first) : null;
}

function layerForPath(moduleDir, path) {
  const rel = relative(moduleDir, path);
  if (rel.startsWith("..")) {
    return null;
  }

  const first = rel.split(sep)[0];
  return LAYERS.includes(first) ? first : "root";
}

function isBarrelImport(fromFile, specifier, resolvedPath) {
  if (!specifier.startsWith(".") || !resolvedPath) {
    return false;
  }

  const currentModule = moduleForPath(fromFile);
  const targetModule = moduleForPath(resolvedPath);
  if (!currentModule || !targetModule || currentModule === targetModule) {
    return true;
  }

  const targetRel = relative(targetModule, resolvedPath).split(sep).join("/");
  return targetRel === "" || targetRel === "index.ts" || targetRel === "index.js";
}

function externalSeverity(layer, specifier) {
  if (specifier.startsWith(".")) {
    return null;
  }

  if (layer === "domain") {
    return "high";
  }

  if (layer === "application") {
    return FRAMEWORK_PACKAGES.some(
      (pkg) => specifier === pkg || specifier.startsWith(pkg),
    )
      ? "high"
      : "medium";
  }

  return null;
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function addViolation(slice, violation) {
  slice.violations.push(violation);
}

function auditSlice(moduleDir) {
  const name = relative(scope, moduleDir).split(sep)[0];
  const slice = {
    name,
    path: relative(root, moduleDir).split(sep).join("/"),
    missingLayers: LAYERS.filter((layer) => !isDirectory(join(moduleDir, layer))),
    files: 0,
    endpoints: 0,
    violations: [],
  };

  for (const layer of slice.missingLayers) {
    addViolation(slice, {
      rule: "missing-layer",
      severity: "high",
      file: slice.path,
      line: 1,
      message: `missing layer \`${layer}\`; target is domain + application + infrastructure + interface`,
    });
  }

  const files = walk(moduleDir);
  slice.files = files.length;

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file) || /\.spec\.(ts|tsx|js|mjs)$/.test(file)) {
      continue;
    }

    const content = readFileSync(file, "utf8");
    const layer = layerForPath(moduleDir, file);
    const relFile = relative(root, file).split(sep).join("/");

    if (layer === "root") {
      const allowed = ROOT_FILE_PATTERNS.some((pattern) => pattern.test(basename(file)));
      if (!allowed) {
        addViolation(slice, {
          rule: "file-at-module-root",
          severity: "low",
          file: relFile,
          line: 1,
          message: "file at module root; move it to a layer or to the module public barrel",
        });
      }
    }

    for (const { specifier, index } of readImports(content)) {
      const resolvedPath = resolveSpecifier(file, specifier);
      const targetLayer = resolvedPath ? layerForPath(moduleDir, resolvedPath) : null;

      if (layer && layer !== "root" && targetLayer && targetLayer !== "root") {
        const forbidden = {
          domain: ["application", "infrastructure", "interface"],
          application: ["infrastructure", "interface"],
          infrastructure: ["interface"],
          interface: ["infrastructure"],
        }[layer];

        if (forbidden?.includes(targetLayer)) {
          addViolation(slice, {
            rule: "layer-direction",
            severity: "high",
            file: relFile,
            line: lineOf(content, index),
            message: `\`${layer}\` must not import \`${targetLayer}\` (${specifier}); dependencies point inward`,
          });
        }
      }

      const severity = externalSeverity(layer ?? "root", specifier);
      if (severity) {
        addViolation(slice, {
          rule: "external-in-inner-layer",
          severity,
          file: relFile,
          line: lineOf(content, index),
          message: `\`${layer}\` imports external package \`${specifier}\`; keep the inner layer framework-free`,
        });
      }

      if (
        resolvedPath &&
        specifier.startsWith(".") &&
        !isBarrelImport(file, specifier, resolvedPath)
      ) {
        const currentModule = moduleForPath(file);
        const targetModule = moduleForPath(resolvedPath);
        if (currentModule && targetModule && currentModule !== targetModule) {
          addViolation(slice, {
            rule: "cross-module-direct-import",
            severity: "high",
            file: relFile,
            line: lineOf(content, index),
            message: `direct import from another slice (${specifier}); import only the slice barrel or expose a use case/port`,
          });
        }
      }
    }

    if (layer === "interface" && /\.(controller|request-handler)\.(ts|js)$/.test(file)) {
      const routes = countMatches(content, ROUTE_DECORATOR);
      slice.endpoints += routes;

      if (routes === 0) {
        addViolation(slice, {
          rule: "handler-without-route",
          severity: "low",
          file: relFile,
          line: 1,
          message: "controller/request handler without a route decorator; verify it is not dead code",
        });
      }

      if (routes > 1) {
        addViolation(slice, {
          rule: "controller-multiple-endpoints",
          severity: "high",
          file: relFile,
          line: lineOf(content, content.search(ROUTE_DECORATOR)),
          message: `${routes} endpoints in one class; target is one request handler class per endpoint`,
        });
      }

      const injections = countMatches(content, INJECT_DECORATOR);
      if (injections > 1) {
        addViolation(slice, {
          rule: "handler-multiple-injections",
          severity: "high",
          file: relFile,
          line: lineOf(content, content.search(INJECT_DECORATOR)),
          message: `${injections} injected dependencies; target is exactly one use case per request handler`,
        });
      }

      if (injections === 0) {
        addViolation(slice, {
          rule: "handler-without-injection",
          severity: "low",
          file: relFile,
          line: 1,
          message: "no @Inject found; verify the handler depends on exactly one use case",
        });
      }
    }

    if (layer === "application" && !/\.spec\.(ts|tsx|js|mjs)$/.test(file)) {
      const executes = countMatches(content, EXECUTE_METHOD);

      if (/\.service\.(ts|js)$/.test(file)) {
        addViolation(slice, {
          rule: "application-service-class",
          severity: "medium",
          file: relFile,
          line: 1,
          message:
            "application service class; keep it only if it is a reusable capability, otherwise split it into one use case per flow",
        });
      }

      if (executes > 1) {
        addViolation(slice, {
          rule: "use-case-multiple-execute",
          severity: "high",
          file: relFile,
          line: lineOf(content, content.search(EXECUTE_METHOD)),
          message: `${executes} \`execute\` methods; one use case class must represent one flow`,
        });
      }

      if (executes === 0 && !/\.service\.(ts|js)$/.test(file)) {
        addViolation(slice, {
          rule: "application-without-execute",
          severity: "low",
          file: relFile,
          line: 1,
          message: "application class without `execute`; verify it is a collaborator, not a flow",
        });
      }
    }
  }

  return slice;
}

function main() {
  if (!isDirectory(scope)) {
    console.error(`Scope not found: ${scope}`);
    process.exitCode = 2;
    return;
  }

  const moduleDirs = readdirSync(scope, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(scope, entry.name))
    .filter((dir) => entryIsSlice(dir));

  const slices = moduleDirs.map(auditSlice).sort((a, b) => a.name.localeCompare(b.name));
  const violations = slices.flatMap((slice) =>
    slice.violations.map((violation) => ({ ...violation, slice: slice.name })),
  );
  const nonConforming = slices.filter(
    (slice) => slice.missingLayers.length > 0 || slice.violations.length > 0,
  );
  const result = {
    scope: relative(root, scope).split(sep).join("/") || ".",
    generatedAt: new Date().toISOString(),
    summary: {
      slices: slices.length,
      nonConforming: nonConforming.length,
      violations: violations.length,
      endpoints: slices.reduce((total, slice) => total + slice.endpoints, 0),
    },
    slices,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printMarkdown(result);
  }

  if (strict && (nonConforming.length > 0 || violations.length > 0)) {
    process.exitCode = 1;
  }
}

function entryIsSlice(dir) {
  if (!isDirectory(dir)) {
    return false;
  }

  const name = dir.split(sep).pop();
  if (name === "shared") {
    return false;
  }

  return LAYERS.some((layer) => isDirectory(join(dir, layer))) || hasCodeFiles(dir);
}

function hasCodeFiles(dir) {
  return walk(dir).some((file) => /\.(ts|tsx|js|mjs)$/.test(file));
}

function printMarkdown(result) {
  console.log("# Slice architecture audit");
  console.log("");
  console.log(`- Scope: \`${result.scope}\``);
  console.log(`- Generated at: ${result.generatedAt}`);
  console.log(
    `- Slices: ${result.summary.slices} · non-conforming: ${result.summary.nonConforming} · violations: ${result.summary.violations} · endpoints found: ${result.summary.endpoints}`,
  );
  console.log("");
  console.log("| Slice | Layers | Files | Endpoints | Violations | Status |");
  console.log("| --- | --- | --- | --- | --- | --- |");

  for (const slice of result.slices) {
    const layers = LAYERS.map((layer) =>
      slice.missingLayers.includes(layer) ? `~~${layer}~~` : layer,
    ).join(", ");
    const status =
      slice.missingLayers.length > 0 || slice.violations.length > 0
        ? "non-conforming"
        : "conforming";
    console.log(
      `| ${slice.name} | ${layers} | ${slice.files} | ${slice.endpoints} | ${slice.violations.length} | ${status} |`,
    );
  }

  const withViolations = result.slices.filter((slice) => slice.violations.length > 0);
  if (withViolations.length > 0) {
    console.log("");
    console.log("## Violations");
    for (const slice of withViolations) {
      console.log("");
      console.log(`### ${slice.name}`);
      for (const violation of slice.violations) {
        console.log(
          `- \`${violation.file}:${violation.line}\` **[${violation.severity}] ${violation.rule}** — ${violation.message}`,
        );
      }
    }
  }

  console.log("");
  console.log(
    "> This report is mechanical. Read the code and confirm semantics before planning.",
  );
}

main();
