import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "secondary" | "destructive" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-brand-500 text-white shadow-[0_16px_32px_-18px_rgba(14,165,233,0.9)] hover:bg-brand-400 active:bg-brand-600 disabled:bg-brand-500/60",
  secondary:
    "bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-700/90 disabled:bg-slate-800/70",
  destructive:
    "bg-red-600 text-white shadow-[0_16px_32px_-18px_rgba(220,38,38,0.9)] hover:bg-red-500 active:bg-red-700 disabled:bg-red-600/60",
  ghost:
    "bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white active:bg-slate-800/80 disabled:text-slate-500",
  outline:
    "border border-slate-700 bg-slate-950/60 text-slate-100 hover:border-slate-600 hover:bg-slate-900 active:bg-slate-900/80 disabled:text-slate-500",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      type = "button",
      disabled,
      loading = false,
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        "focus-ring",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
      ) : null}
      {children}
    </button>
  )
);

Button.displayName = "Button";
