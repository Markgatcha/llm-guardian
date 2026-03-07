import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 px-6 py-16 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-brand-200">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
