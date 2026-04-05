import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  DollarSign,
  Layers,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard, MetricCardSkeleton, CardSkeleton } from "../components/Cards";
import { useStats } from "../hooks/useStats";
import { cn } from "../lib/utils";
import { formatCompactNumber, formatCurrency, formatLatency, formatPercent } from "../lib/utils";

export default function OverviewPage() {
  const { summary, loading, error, refetch } = useStats();

  const costSeries = useMemo(
    () =>
      summary
        ? [
            { label: "Today", cost: summary.today.costUsd, baseline: summary.totalBaselineCostUsd * (summary.today.requests / Math.max(summary.totalRequests, 1)) },
            { label: "Month", cost: summary.month.costUsd, baseline: summary.totalBaselineCostUsd * (summary.month.requests / Math.max(summary.totalRequests, 1)) },
            { label: "Total", cost: summary.totalCostUsd, baseline: summary.totalBaselineCostUsd },
          ]
        : [],
    [summary]
  );

  return (
    <div className="animate-fade-in space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-50">Overview</h1>
          <p className="mt-2 text-base text-slate-400">
            LLM-Guardian Nervous System &mdash; real-time token optimization
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </header>

      {error && (
        <Card className="border-red-900/60 bg-red-950/25">
          <CardContent className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-300" />
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
            title="Total Requests"
            value={formatCompactNumber(summary?.totalRequests ?? 0)}
            description="Requests through the Guardian pipeline."
            icon={<Activity className="h-5 w-5 text-brand-100" />}
            accentClassName="bg-brand-500/15 text-brand-100"
          />
          <MetricCard
            title="Total Cost"
            value={formatCurrency(summary?.totalCostUsd ?? 0)}
            description="Actual provider spend across all requests."
            icon={<DollarSign className="h-5 w-5 text-emerald-100" />}
            accentClassName="bg-emerald-500/15 text-emerald-100"
          />
          <MetricCard
            title="Avg Latency"
            value={formatLatency(summary?.avgLatencyMs ?? 0)}
            description="End-to-end response time incl. optimization."
            icon={<Zap className="h-5 w-5 text-amber-100" />}
            accentClassName="bg-amber-500/15 text-amber-100"
          />
          <MetricCard
            title="Tokens Saved"
            value={formatCompactNumber(summary?.totalTokensOptimized ?? 0)}
            description={`Compression: ${formatPercent(summary?.avgCompressionRatio ?? 1)} avg ratio.`}
            icon={<Layers className="h-5 w-5 text-purple-100" />}
            accentClassName="bg-purple-500/15 text-purple-100"
          />
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-2">
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Cost vs Baseline</CardTitle>
                <CardDescription>Actual spend compared to raw-input baseline.</CardDescription>
              </CardHeader>
              <CardContent>
                {costSeries.some((d) => d.cost > 0 || d.baseline > 0) ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={costSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="baseFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                        <Tooltip contentStyle={{ backgroundColor: "#020617", border: "1px solid #1e293b", borderRadius: 16, color: "#e2e8f0" }} formatter={(v) => formatCurrency(Number(v))} />
                        <Area type="monotone" dataKey="baseline" name="Baseline" stroke="#94a3b8" strokeWidth={2} fill="url(#baseFill)" />
                        <Area type="monotone" dataKey="cost" name="Actual" stroke="#38bdf8" strokeWidth={2} fill="url(#costFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyChart message="No cost data yet. Requests will appear here." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Savings Summary</CardTitle>
                <CardDescription>Total USD saved through optimization.</CardDescription>
              </CardHeader>
              <CardContent>
                {summary && (summary.totalSavedUsd > 0 || summary.today.savedUsd > 0 || summary.month.savedUsd > 0) ? (
                  <div className="space-y-6">
                    <div>
                      <p className="text-4xl font-semibold text-emerald-200">
                        {formatCurrency(summary.totalSavedUsd)}
                      </p>
                      <p className="mt-2 text-sm text-slate-400">Total saved vs. baseline</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-sm text-slate-400">Today saved</p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-200">
                          {formatCurrency(summary.today.savedUsd)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                        <p className="text-sm text-slate-400">Month saved</p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-200">
                          {formatCurrency(summary.month.savedUsd)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyChart message="No savings data yet. Start routing requests to see savings." />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-slate-500">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-900/50">
        <Activity className="h-6 w-6 text-slate-600" />
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
