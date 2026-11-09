import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const EMAIL_MODULE = join(SRC, "modules", "email");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("e-mail module boundaries", () => {
  it("keeps code outside the module away from providers and infrastructure (R1, R9)", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.startsWith(EMAIL_MODULE))
      .flatMap((file) =>
        importsOf(file)
          .filter((target) =>
            /modules\/email\/(infrastructure|interface|application|domain)/.test(target),
          )
          .map((target) => `${relative(SRC, file)} -> ${target}`),
      );

    expect(offenders).toEqual([]);
  });

  it("keeps domain and application free of provider, framework and infrastructure imports (R9)", () => {
    const offenders = ["domain", "application"].flatMap((layer) =>
      sourceFiles(join(EMAIL_MODULE, layer)).flatMap((file) =>
        importsOf(file)
          .filter((target) => /^@nestjs|infrastructure|interface|mailtrap|resend/.test(target))
          .map((target) => `${relative(EMAIL_MODULE, file).split(sep).join("/")} -> ${target}`),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("limits provider code to the infrastructure layer", () => {
    const offenders = sourceFiles(EMAIL_MODULE)
      .filter((file) => !file.includes(`${sep}infrastructure${sep}`))
      .filter((file) =>
        /sandbox\.api\.mailtrap\.io|api\.resend\.com/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(EMAIL_MODULE, file));

    expect(offenders).toEqual([]);
  });
});
