import { clip, money, ms, numberShort, percent, statusText } from "./format.ts";
import type { GuardianSnapshot, SiblingStatus } from "./types.ts";

export type ScreenId =
	| "overview"
	| "requests"
	| "savings"
	| "providers"
	| "budgets"
	| "rules"
	| "siblings";

export const screens: Array<{ id: ScreenId; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "requests", label: "Live Requests" },
	{ id: "savings", label: "Savings" },
	{ id: "providers", label: "Providers" },
	{ id: "budgets", label: "Budgets" },
	{ id: "rules", label: "Rules" },
	{ id: "siblings", label: "Siblings" },
];

function line(label: string, value: string): string {
	return `${label.padEnd(22)} ${value}`;
}

function emptyState(title: string, detail: string): string {
	return `${title}\n\n${detail}`;
}

export function renderScreen(
	screen: ScreenId,
	snapshot: GuardianSnapshot,
	siblings: SiblingStatus[],
): string {
	switch (screen) {
		case "overview":
			return [
				"Guardian control plane",
				"",
				line("Backend", statusText(snapshot.connected, snapshot.message)),
				line("Requests", numberShort(snapshot.stats.totalRequests)),
				line("Total spend", money(snapshot.stats.totalCostUsd)),
				line("Baseline cost", money(snapshot.stats.baselineCostUsd)),
				line("Total saved", money(snapshot.stats.totalSavedUsd)),
				line("Cache hit rate", percent(snapshot.stats.cacheHitRate)),
				line("Average latency", ms(snapshot.stats.avgLatencyMs)),
				"",
				"Today",
				line("Requests", numberShort(snapshot.stats.todayRequests)),
				line("Spend", money(snapshot.stats.todayCostUsd)),
				line("Saved", money(snapshot.stats.todaySavedUsd)),
				"",
				"Use 1-7 or arrow keys to switch panels. Press r to refresh, q to quit.",
			].join("\n");
		case "requests":
			if (snapshot.logs.length === 0) {
				return emptyState(
					"Live Requests",
					"No request logs are available yet. Start sending traffic through Guardian to populate this panel.",
				);
			}
			return [
				"Live Requests",
				"",
				"MODEL                          PROVIDER      STATUS    LATENCY  COST       SAVED      CACHE",
				...snapshot.logs.slice(0, 18).map((item) =>
					[
						clip(item.model, 30).padEnd(30),
						clip(item.provider || "unknown", 12).padEnd(12),
						clip(item.status, 8).padEnd(8),
						ms(item.latencyMs).padStart(7),
						money(item.costUsd).padStart(10),
						money(item.savedUsd).padStart(10),
						item.cacheHit ? "hit" : "miss",
					].join("  "),
				),
			].join("\n");
		case "savings":
			return [
				"Semantic Folding and VCM Sharding",
				"",
				line("Total saved", money(snapshot.stats.totalSavedUsd)),
				line("Baseline avoided", money(snapshot.stats.baselineCostUsd)),
				line("Tokens optimized", numberShort(snapshot.stats.totalTokensOptimized)),
				line("Avg compression", percent(snapshot.stats.avgCompressionRatio)),
				line("30 day saved", money(snapshot.stats.monthSavedUsd)),
				line("30 day requests", numberShort(snapshot.stats.monthRequests)),
				"",
				"Guardian reports savings from routing, cache hits, Semantic Folding, and VCM Sharding where request telemetry exposes those metrics.",
			].join("\n");
		case "providers": {
			if (snapshot.providers.length === 0) {
				return emptyState(
					"Providers",
					"No provider catalog is available. This can happen when the backend is offline or the admin API is unavailable.",
				);
			}
			const catalogUpdatedAt = snapshot.providers.find(
				(item) => item.catalogUpdatedAt,
			)?.catalogUpdatedAt;
			const catalogSource =
				snapshot.providers.find((item) => item.source)?.source ?? "fingerprint";
			return [
				"Providers",
				`Catalog: ${catalogSource}${catalogUpdatedAt ? ` updated ${new Date(catalogUpdatedAt).toLocaleString()}` : ""}`,
				"",
				"MODEL                          PROVIDER      CTX        INPUT/1M    OUTPUT/1M   CAPS",
				...snapshot.providers.slice(0, 20).map((item) =>
					[
						clip(item.model, 30).padEnd(30),
						clip(item.provider || "unknown", 12).padEnd(12),
						Number.isFinite(item.contextWindow)
							? numberShort(item.contextWindow ?? 0).padStart(8)
							: "unknown ".padStart(8),
						money(item.inputPerMillion).padStart(10),
						money(item.outputPerMillion).padStart(10),
						[
							item.supportsTools ? "tools" : "",
							item.supportsVision ? "vision" : "",
						]
							.filter(Boolean)
							.join(",")
							.padEnd(8),
					].join("  "),
				),
			].join("\n");
		}
		case "budgets":
			return [
				"Budgets",
				"",
				line("Daily spend", money(snapshot.budget.dailySpentUsd)),
				line("Daily limit", money(snapshot.budget.dailyLimitUsd)),
				line(
					"Daily used",
					snapshot.budget.dailyLimitUsd > 0
						? percent(snapshot.budget.dailySpentUsd / snapshot.budget.dailyLimitUsd)
						: "unknown",
				),
				line("Monthly spend", money(snapshot.budget.monthlySpentUsd)),
				line("Monthly limit", money(snapshot.budget.monthlyLimitUsd)),
				line(
					"Monthly used",
					snapshot.budget.monthlyLimitUsd > 0
						? percent(snapshot.budget.monthlySpentUsd / snapshot.budget.monthlyLimitUsd)
						: "unknown",
				),
			].join("\n");
		case "rules":
			if (snapshot.rules.length === 0) {
				return emptyState(
					"Rules",
					"No routing rules are configured or the rules endpoint is unavailable.",
				);
			}
			return [
				"Rules",
				"",
				"PRIORITY  STATE    TYPE                    NAME",
				...snapshot.rules.map((rule) =>
					[
						String(rule.priority).padStart(8),
						(rule.isActive ? "active" : "paused").padEnd(8),
						clip(rule.ruleType, 22).padEnd(22),
						rule.name,
					].join("  "),
				),
			].join("\n");
		case "siblings":
			return [
				"AI Trio sibling discovery",
				"",
				...siblings.flatMap((item) => [
					item.label,
					line("Package", item.packageName),
					line("Version", item.version),
					line("Path", item.path),
					line("Repo", item.exists ? (item.hasGit ? "git repo" : "folder") : "missing"),
					line("Status", item.note),
					"",
				]),
			].join("\n");
	}
}
