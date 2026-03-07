import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "success" | "warning" | "error" | "muted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "border border-brand-500/30 bg-brand-500/15 text-brand-200",
  success: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
  warning: "border border-amber-500/30 bg-amber-500/15 text-amber-200",
  error: "border border-red-500/30 bg-red-500/15 text-red-200",
  muted: "border border-slate-700 bg-slate-800 text-slate-300",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
