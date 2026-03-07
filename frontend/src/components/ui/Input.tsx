import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: boolean | string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorMessage = typeof error === "string" ? error : undefined;

    return (
      <div className="space-y-2">
        {label ? (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-200">
            {label}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={errorMessage ? `${inputId}-error` : undefined}
          className={cn(
            "flex h-11 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-sm text-slate-100 shadow-inner shadow-black/10 placeholder:text-slate-500",
            "transition-colors focus:border-brand-500",
            error ? "border-red-500/80 focus:border-red-500" : "",
            className
          )}
          {...props}
        />
        {errorMessage ? (
          <p id={`${inputId}-error`} className="text-sm text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
