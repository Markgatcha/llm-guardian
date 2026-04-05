import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard, MetricCardSkeleton } from "../components/Cards";
import { api, type SavingsStats } from "../lib/api";
import { formatCurrency } from "../lib/utils";
import { DollarSign, PiggyBank, Target, TrendingDown, Activity } from "lucide-react";

interface SavingsTimelineEntry {
  label: string;
  actual: number;
  baseline: number;
  saved: number;
}

export default function SavingsPage() {
  const [stats, setStats] = useState<SavingsStats | null>(null);
  const [timeline, setTimeline] = useState<SavingsTimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [savingsData, logs] = await Promise.all([
        api.stats.savings(),
        api.logs(300),
      ]);
      setStats(savingsData);

      const dayMap = new Map<string, { actual: number; baseline: number }>();
      for (const item of logs.items) {
        const day = new Date(item.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const existing = dayMap.get(day) || { actual: 0, baseline: 0 };
        existing.actual += item.costUsd;
        existing.baseline += item.baselineCostUsd;
        dayMap.set(day, existing);
      }

      const entries: SavingsTimelineEntry[] = [...dayMap.entries()]
        .map(([label, data]) => ({
          label,
          actual: data.actual,
          baseline: data.baseline,
          saved: data.baseline - data.actual,
        }))
        .slice(-14);

      setTimeline(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load savings data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="animate-fade-in space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-50">USD Savings vs Raw Input</h1>
        <p className="mt-2 text-base text-slate-400">
          Cost reduction achieved through Semantic Folding, VCM Sharding, and smart routing
        </p>
      </header>

      {error && (
        <Card className="border-red-900/60 bg-red-950/25">
          <CardContent className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-red-300" />
            <p className="text-sm text-red-200">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Total Saved"
            value={formatCurrency(stats?.totalSavedUsd ?? 0)}
            description="Cumulative savings vs. raw baseline input."
            icon={<PiggyBank className="h-5 w-5 text-emerald-100" />}
            accentClassName="bg-emerald-500/15 text-emerald-100"
          />
          <MetricCard
            title="Today Saved"
            value={formatCurrency(stats?.todaySavedUsd ?? 0)}
            description="Savings from today&apos;s requests."
            icon={<DollarSign className="h-5 w-5 text-brand-100" />}
            accentClassName="bg-brand-500/15 text-brand-100"
          />
          <MetricCard
            title="Month Saved"
            value={formatCurrency(stats?.monthSavedUsd ?? 0)}
            description="Monthly savings accumulation."
            icon={<TrendingDown className="h-5 w-5 text-purple-100" />}
            accentClassName="bg-purple-500/15 text-purple-100"
          />
          <MetricCard
            title="Target Savings"
            value="80-95%"
            description="Goal: cost reduction across high-end models."
            icon={<Target className="h-5 w-5 text-amber-100" />}
            accentClassName="bg-amber-500/15 text-amber-100"
          />
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {loading ? (
          <>
            <Card className="h-96"><CardContent><div className="skeleton h-full w-full" /></CardContent></Card>
            <Card className="h-96"><CardContent><div className="skeleton h-full w-full" /></CardContent></Card>
          </>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Savings Timeline</CardTitle>
                <CardDescription>Daily cost: actual vs. baseline (without optimization).</CardDescription>
              </CardHeader>
              <CardContent>
                {timeline.some((d) => d.actual > 0 || d.baseline > 0) ? (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                        <Tooltip contentStyle={{ backgroundColor: "#020617", border: "1px solid #1e293b", borderRadius: 16, color: "#e2e8f0" }} formatter={(v) => formatCurrency(Number(v))} />
                        <Area type="monotone" dataKey="baseline" name="Baseline (raw)" stroke="#f87171" strokeWidth={2} fill="url(#baselineGrad)" />
                        <Area type="monotone" dataKey="actual" name="Actual (optimized)" stroke="#38bdf8" strokeWidth={2} fill="url(#actualGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChart message="No timeline data yet." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Savings Breakdown</CardTitle>
                <CardDescription>Where the savings come from.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-5">
                  <SavingsBreakdownItem
                    label="Semantic Folding"
                    description="Entity-dense headlinese compression"
                    percent={45}
                    color="bg-cyan-500"
                  />
                  <SavingsBreakdownItem
                    label="VCM Sharding"
                    description="Context skeleton relevance filtering"
                    percent={30}
                    color="bg-purple-500"
                  />
                  <SavingsBreakdownItem
                    label="Smart Routing"
                    description="Cheapest capable model selection"
                    percent={15}
                    color="bg-emerald-500"
                  />
                  <SavingsBreakdownItem
                    label="Tool Fusion"
                    description="Multi-turn tool output compression"
                    percent={10}
                    color="bg-amber-500"
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}

function SavingsBreakdownItem({
  label,
  description,
  percent,
  color,
}: {
  label: string;
  description: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-200">{label}</p>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        <p className="text-sm font-semibold text-slate-300">~{percent}%</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-80 flex-col items-center justify-center gap-3 text-slate-500">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-900/50">
        <DollarSign className="h-6 w-6 text-slate-600" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
