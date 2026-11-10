import { RondoMark, RondoWordmark } from "@repo/ui/brand";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionError, SessionLoading } from "./features/auth/session-states";
import { ACCESS_TOKEN_KEY } from "./lib/access-token";
import { jsonResponse, renderApp, SESSION_USER, stubSessionFetch } from "./test/render-app";

const ROOT = `${resolve(process.cwd(), "../..")}/`;
const readRepoFile = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const ASSET = (name: string) => `packages/ui/assets/brand/${name}`;

const TOKEN_HEX: Record<string, string> = {
  "var(--color-blaze-orange)": "#FB6107",
  "var(--color-golden-glow)": "#F3DE2C",
  "var(--color-lime-moss)": "#7CB518",
  "var(--color-forest-moss)": "#5C8001",
  "var(--color-sunflower-gold)": "#FBB02D",
  "var(--color-ink)": "#0A0A0A",
  "var(--color-paper)": "#FFFDF5",
};

type Pixels = Map<string, string>;

/** Paints each rect onto a unit grid, so different rect splits of one drawing compare equal. */
function paint(rects: { x: number; y: number; w: number; h: number; fill: string }[]): Pixels {
  const pixels: Pixels = new Map();

  for (const { x, y, w, h, fill } of rects) {
    for (let row = y; row < y + h; row += 1) {
      for (let column = x; column < x + w; column += 1) {
        pixels.set(`${column},${row}`, fill.toUpperCase());
      }
    }
  }

  return pixels;
}

function pixelsOfFile(svg: string): Pixels {
  const rects = [
    ...svg.matchAll(
      /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9A-Fa-f]{6})"\/>/g,
    ),
  ];

  return paint(
    rects.map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      w: Number(match[3]),
      h: Number(match[4]),
      fill: match[5] as string,
    })),
  );
}

function pixelsOfComponent(svg: Element): Pixels {
  return paint(
    [...svg.querySelectorAll("rect")].map((rect) => {
      const variable = /fill:\s*(var\([^)]+\))/.exec(rect.getAttribute("style") ?? "")?.[1] ?? "";

      return {
        x: Number(rect.getAttribute("x")),
        y: Number(rect.getAttribute("y")),
        w: Number(rect.getAttribute("width")),
        h: Number(rect.getAttribute("height")),
        fill: TOKEN_HEX[variable] ?? `unknown:${variable}`,
      };
    }),
  );
}

describe("Rondo logo components", () => {
  it("is named when it has a title and hidden from assistive technology when it has none", () => {
    render(
      <>
        <RondoWordmark title="Rondo" />
        <RondoMark data-testid="decorative" />
      </>,
    );

    expect(screen.getByRole("img", { name: "Rondo" })).toBeInTheDocument();
    expect(screen.getByTestId("decorative")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryAllByRole("img")).toHaveLength(1);
  });

  it.each([
    ["light", "rondo-mark.svg", RondoMark],
    ["dark", "rondo-mark-dark.svg", RondoMark],
    ["light", "rondo-wordmark.svg", RondoWordmark],
    ["dark", "rondo-wordmark-dark.svg", RondoWordmark],
  ] as const)("draws the same pixels as %s %s", (tone, file, Component) => {
    const { container } = render(<Component tone={tone} />);
    const svg = container.querySelector("svg") as SVGSVGElement;

    expect(pixelsOfComponent(svg)).toEqual(pixelsOfFile(readRepoFile(ASSET(file))));
    expect(svg).toHaveAttribute(
      "viewBox",
      readRepoFile(ASSET(file)).match(/viewBox="([^"]+)"/)?.[1],
    );
  });

  it("keeps the favicon and the docs copies identical to the source assets", () => {
    expect(readRepoFile("apps/app/public/favicon.svg")).toBe(readRepoFile(ASSET("rondo-mark.svg")));
    expect(readRepoFile("apps/docs/app/icon.svg")).toBe(readRepoFile(ASSET("rondo-mark.svg")));
    expect(readRepoFile("apps/docs/public/brand/rondo-wordmark.svg")).toBe(
      readRepoFile(ASSET("rondo-wordmark.svg")),
    );
  });
});

describe("Rondo logo on the screens", () => {
  it("shows the extended logo, named Rondo, above the /auth pages", async () => {
    renderApp("/auth/sign-in");

    expect(await screen.findByRole("img", { name: "Rondo" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the compact logo, hidden from assistive technology, on the not-found page", async () => {
    renderApp("/auth/does-not-exist");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Rondo" })).not.toBeInTheDocument();
    expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("shows the compact logo on the home page, the loading state and the retry screen", async () => {
    const decorativeMarks = () =>
      document.querySelectorAll("svg[aria-hidden='true'][viewBox='0 0 28 28']");

    window.localStorage.setItem(ACCESS_TOKEN_KEY, "header.payload.signature");
    stubSessionFetch(() => jsonResponse(200, { user: SESSION_USER }));
    renderApp("/app");

    expect(await screen.findByRole("heading", { level: 1, name: /Welcome/ })).toBeInTheDocument();
    expect(decorativeMarks()).toHaveLength(1);

    cleanup();
    render(<SessionLoading />);

    expect(screen.getByRole("status")).toContainElement(decorativeMarks()[0] as SVGElement);

    cleanup();
    render(<SessionError onRetry={() => undefined} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(decorativeMarks()).toHaveLength(1);
  });
});
