import type { LabelHTMLAttributes } from "react";
import { cn } from "./lib/utils";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

/** Visible label of a form control; always associate it with `htmlFor`. */
export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn("block text-base font-bold text-foreground", className)}
      {...props}
    />
  );
}
