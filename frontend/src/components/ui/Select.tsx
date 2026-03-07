import { ChevronDown } from "lucide-react";
import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: boolean | string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const errorMessage = typeof error === "string" ? error : undefined;

    return (
      <div className="space-y-2">
        {label ? (
          <label htmlFor={selectId} className="text-sm font-medium text-slate-200">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={Boolean(error)}
            aria-describedby={errorMessage ? `${selectId}-error` : undefined}
            className={cn(
              "h-11 w-full appearance-none rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 pr-10 text-sm text-slate-100",
              "transition-colors focus:border-brand-500",
              error ? "border-red-500/80 focus:border-red-500" : "",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </div>
        {errorMessage ? (
          <p id={`${selectId}-error`} className="text-sm text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }
);

Select.displayName = "Select";
