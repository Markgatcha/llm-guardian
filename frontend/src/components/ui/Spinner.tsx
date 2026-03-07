import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

export function Spinner({ className, size = "md", label = "Loading", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block animate-spin rounded-full border-slate-700 border-t-brand-300",
          sizeClasses[size]
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
