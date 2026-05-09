export function money(value: number): string {
	if (!Number.isFinite(value)) return "$0.00";
	if (value === 0) return "$0.00";
	if (Math.abs(value) < 0.01) return `$${value.toFixed(5)}`;
	return `$${value.toFixed(2)}`;
}

export function numberShort(value: number): string {
	if (!Number.isFinite(value)) return "0";
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: value >= 1000 ? 0 : 2,
	}).format(value);
}

export function percent(value: number): string {
	if (!Number.isFinite(value)) return "0%";
	const normalized = value > 1 ? value / 100 : value;
	return `${(normalized * 100).toFixed(1)}%`;
}

export function ms(value: number): string {
	if (!Number.isFinite(value)) return "0ms";
	return `${Math.round(value)}ms`;
}

export function clip(value: string, max = 32): string {
	if (value.length <= max) return value;
	if (max <= 3) return value.slice(0, max);
	return `${value.slice(0, max - 3)}...`;
}

export function statusText(ok: boolean, detail?: string): string {
	if (ok) return detail ? `online - ${detail}` : "online";
	return detail ? `offline - ${detail}` : "offline";
}
