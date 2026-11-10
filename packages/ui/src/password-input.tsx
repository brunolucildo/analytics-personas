import { useId, useState } from "react";
import { Button } from "./button";
import { Input, type InputProps } from "./input";
import { cn } from "./lib/utils";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /**
   * What the toggle reveals, used in its accessible name: "Show password" / "Hide password".
   * Name each field apart when a form has more than one (for example "new password").
   */
  visibilityLabel?: string;
}

/** Pixel eye (12 x 8 cells). X = filled cell. */
const EYE = [
  "..XXXXXXXX..",
  ".X........X.",
  "X....XX....X",
  "X...XXXX...X",
  "X...XXXX...X",
  "X....XX....X",
  ".X........X.",
  "..XXXXXXXX..",
] as const;

/** The same eye crossed by a diagonal, for the "hide" state. */
const EYE_STRUCK = EYE.map((row, y) =>
  row
    .split("")
    .map((cell, x) => (x === y + 2 || x === y + 3 ? "X" : cell))
    .join(""),
);

function PixelEye({ struck }: { struck: boolean }) {
  const rows = struck ? EYE_STRUCK : EYE;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      className="h-4 w-6"
    >
      {rows.flatMap((row, y) =>
        row
          .split("")
          .map((cell, x) =>
            cell === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null,
          ),
      )}
    </svg>
  );
}

/**
 * Password field with a button that shows or hides what was typed. The text starts hidden.
 * The button is a real toggle (`aria-pressed`, `aria-controls`), reachable by keyboard
 * right after the field, and at least 44 x 44 px. Pair it with a `Label` like `Input`.
 */
export function PasswordInput({
  id,
  className,
  visibilityLabel = "password",
  ...props
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        className={cn("pr-12 [&::-ms-reveal]:hidden", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${visible ? "Hide" : "Show"} ${visibilityLabel}`}
        aria-pressed={visible}
        aria-controls={inputId}
        onClick={() => setVisible((current) => !current)}
        className="absolute top-0 right-0 rounded-l-none"
      >
        <PixelEye struck={visible} />
      </Button>
    </div>
  );
}
