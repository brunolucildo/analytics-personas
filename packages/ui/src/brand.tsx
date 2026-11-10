import type { SVGProps } from "react";

/**
 * Rondo logos (DESIGN.md §11). The pixel data below is the source of the SVG files in
 * `assets/brand/`; keep both in sync. Colors come from the brand tokens in `styles.css`.
 */

export type RondoTone = "light" | "dark";

type Fill = "orange" | "yellow" | "lime" | "forest" | "gold" | "ink" | "paper";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: Fill;
}

const FILL_VARIABLE: Record<Fill, string> = {
  orange: "var(--color-blaze-orange)",
  yellow: "var(--color-golden-glow)",
  lime: "var(--color-lime-moss)",
  forest: "var(--color-forest-moss)",
  gold: "var(--color-sunflower-gold)",
  ink: "var(--color-ink)",
  paper: "var(--color-paper)",
};

/** K = outline, P = panel, N = center pentagon. 14 x 14 cells. */
const BALL = [
  "....KKKKKK....",
  "..KKPPPPPPKK..",
  ".KPPPPPPPPPPK.",
  ".KPPPNNNNPPPK.",
  "KPPPNNNNNNPPPK",
  "KPPPNNNNNNPPPK",
  "KPPPPNNNNPPPPK",
  "KPPPPPNNPPPPPK",
  "KPPPPPPPPPPPPK",
  "KPPPPPPPPPPPPK",
  ".KPPPPPPPPPPK.",
  ".KPPPPPPPPPPK.",
  "..KKPPPPPPKK..",
  "....KKKKKK....",
] as const;

/** 6 x 7 cells per letter. */
const GLYPHS = {
  R: ["XXXXX.", "X....X", "X....X", "XXXXX.", "X..X..", "X...X.", "X....X"],
  O: [".XXXX.", "X....X", "X....X", "X....X", "X....X", "X....X", ".XXXX."],
  N: ["X....X", "XX...X", "XX...X", "X.X..X", "X..X.X", "X...XX", "X....X"],
  D: ["XXXXX.", "X....X", "X....X", "X....X", "X....X", "X....X", "XXXXX."],
} as const;

const WORD = ["R", "O", "N", "D"] as const;
const LETTER_ADVANCE = 14; // 6 cells x 2 units + a 2-unit gap

/** Merges neighbouring cells of the same fill in a row into one rect. */
function rowRects(
  row: string,
  fillOf: (cell: string) => Fill | null,
  unit: number,
  originX: number,
  originY: number,
): Rect[] {
  const rects: Rect[] = [];
  let current: Rect | null = null;

  for (let column = 0; column <= row.length; column += 1) {
    const cell = row[column];
    const fill = cell === undefined ? null : fillOf(cell);

    if (current !== null && fill === current.fill) {
      current.width += unit;
      continue;
    }

    if (current !== null) {
      rects.push(current);
      current = null;
    }

    if (fill !== null) {
      current = { x: originX + column * unit, y: originY, width: unit, height: unit, fill };
    }
  }

  return rects;
}

function ballRects(tone: RondoTone, originX: number, originY: number): Rect[] {
  const outline: Fill = tone === "dark" ? "paper" : "ink";
  const fillOf = (cell: string): Fill | null => {
    if (cell === "K") return outline;
    if (cell === "P") return "paper";
    if (cell === "N") return "ink";
    return null;
  };

  return BALL.flatMap((row, index) => rowRects(row, fillOf, 1, originX, originY + index));
}

function square(x: number, y: number, size: number, fill: Fill): Rect {
  return { x, y, width: size, height: size, fill };
}

function markRects(tone: RondoTone): Rect[] {
  return [
    square(12, 0, 4, "orange"),
    square(24, 12, 4, "yellow"),
    square(12, 24, 4, "lime"),
    square(0, 12, 4, tone === "dark" ? "gold" : "forest"),
    square(5, 5, 2, "gold"),
    square(21, 5, 2, "gold"),
    square(5, 21, 2, "gold"),
    square(21, 21, 2, "gold"),
    ...ballRects(tone, 7, 7),
  ];
}

function wordmarkRects(tone: RondoTone): Rect[] {
  const letterFill: Fill = tone === "dark" ? "paper" : "ink";
  const letters = WORD.flatMap((letter, position) =>
    GLYPHS[letter].flatMap((row, index) =>
      rowRects(
        row,
        (cell) => (cell === "X" ? letterFill : null),
        2,
        position * LETTER_ADVANCE,
        index * 2,
      ).map((rect) => ({ ...rect, height: 2 })),
    ),
  );

  return [...letters, ...ballRects(tone, WORD.length * LETTER_ADVANCE, 0)];
}

const MARK = { light: markRects("light"), dark: markRects("dark") } as const;
const WORDMARK = { light: wordmarkRects("light"), dark: wordmarkRects("dark") } as const;

export interface RondoLogoProps extends Omit<
  SVGProps<SVGSVGElement>,
  "children" | "viewBox" | "title" | "role"
> {
  /** `light` for paper/white backgrounds, `dark` for ink backgrounds. */
  tone?: RondoTone;
  /**
   * Accessible name. Pass `"Rondo"` when the logo is the only visible name; omit it when
   * the logo sits next to the name in text (it is then hidden from assistive technology).
   */
  title?: string;
}

function Logo({
  rects,
  viewWidth,
  viewHeight,
  title,
  ...props
}: Omit<RondoLogoProps, "tone"> & {
  rects: readonly Rect[];
  viewWidth: number;
  viewHeight: number;
}) {
  const labelled = title !== undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      shapeRendering="crispEdges"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...props}
    >
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}-${rect.width}-${rect.fill}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          style={{ fill: FILL_VARIABLE[rect.fill] }}
        />
      ))}
    </svg>
  );
}

/** Compact logo (28 x 28): avatar, favicon and square spaces. Sharp at 28, 56, 84, 112 px. */
export function RondoMark({ tone = "light", ...props }: RondoLogoProps) {
  return <Logo rects={MARK[tone]} viewWidth={28} viewHeight={28} {...props} />;
}

/** Extended logo (70 x 14): headers and documents. Sharp at 70, 140, 210 px wide. */
export function RondoWordmark({ tone = "light", ...props }: RondoLogoProps) {
  return <Logo rects={WORDMARK[tone]} viewWidth={70} viewHeight={14} {...props} />;
}
