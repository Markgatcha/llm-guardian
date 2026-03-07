export function formatCurrency(value: number, maxFractionDigits = 4): string {
  const digits = Math.abs(value) >= 1 ? 2 : maxFractionDigits;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompactNumber(value: number): string {
  if (Math.abs(value) < 1000) {
    return value.toLocaleString("en-US");
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatLatency(value: number): string {
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ms`;
}

export function formatPercent(value: number): string {
  const digits = value > 0 && value < 0.1 ? 1 : 0;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTokens(promptTokens: number, completionTokens: number): string {
  return (promptTokens + completionTokens).toLocaleString("en-US");
}

export function lastFour(value: string | null): string {
  if (!value) {
    return "----";
  }

  return value.slice(-4);
}
