import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={cn("rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-900 to-slate-950/80", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardProps) {
  return <div className={cn("border-b border-slate-800/60 px-6 py-5", className)}>{children}</div>;
}

export function CardTitle({ children, className }: CardProps) {
  return <h3 className={cn("text-lg font-semibold text-slate-50", className)}>{children}</h3>;
}

export function CardDescription({ children, className }: CardProps) {
  return <p className={cn("mt-1 text-sm text-slate-400", className)}>{children}</p>;
}

export function CardContent({ children, className }: CardProps) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>;
}

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  accentClassName: string;
}

export function MetricCard({ title, value, description, icon, accentClassName }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-50">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{description}</p>
        </div>
        <div className={cn("rounded-2xl border border-white/5 p-3", accentClassName)}>{icon}</div>
      </CardContent>
    </Card>
  );
}

export function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-8 w-20" />
          <div className="skeleton h-4 w-40" />
        </div>
        <div className="skeleton h-12 w-12 rounded-2xl" />
      </CardContent>
    </Card>
  );
}

export function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-4 w-48" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex h-72 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="skeleton h-12 w-12 rounded-full" />
            <div className="skeleton h-4 w-40" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
