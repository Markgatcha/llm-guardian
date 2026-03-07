/**
 * Utility: merge Tailwind class names safely.
 *
 * Combines `clsx` (conditional classes) with `tailwind-merge`
 * (deduplication of conflicting Tailwind utilities) — the standard
 * shadcn/ui pattern.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
