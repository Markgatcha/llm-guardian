import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  Server,
  Shield,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/Card";
import { Badge, Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { useStats } from "@/hooks/useStats";
import {
  formatCompactNumber,
  formatCurrency,
  formatLatency,
  formatPercent,
} from "@/lib/format";
import type { ModelStat, ProviderStat } from "@/lib/types";

interface MetricCardProps {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  accentClassName: string;
}

function MetricCard({ title, value, description, icon, accentClassName }: MetricCardProps) {
  return (
    <Card className="border-slate-800/90 bg-gradient-to-br from-slate-900 to-slate-950/80">
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-50">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{description}</p>
        </div>
        <div className={`rounded-2xl border border-white/5 p-3 ${accentClassName}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function MetricCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-10 w-40" />
        <div className="skeleton h-4 w-52" />
      </CardContent>
    </Card>
  );
}

function PanelSkeleton({ height = "h-72" }: { height?: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-4 w-56" />
      </CardHeader>
      <CardContent>
        <div className={`skeleton w-full ${height}`} />
      </CardContent>
    </Card>
  );
}

function formatModelName(modelName: string): string {
  const segments = modelName.split("/");
  return segments[segments.length - 1] || modelName;
}

function sortModelsByCost(models: ModelStat[]): ModelStat[] {
  return [...models].sort((left, right) => right.total_cost_usd - left.total_cost_usd);
}

function sortProvidersByCost(providers: ProviderStat[]): ProviderStat[] {
  return [...providers].sort((left, right) => right.total_cost_usd - left.total_cost_usd);
}

export default function OverviewPage() {
  const { summary, models, providers, costs, loading, error, refetch } = useStats();

  const costSeries = useMemo(
    () =>
      costs
        ? [
            {
              label: "Today",
              actual_cost: costs.today.total_cost_usd,
              baseline_cost: costs.today.baseline_cost_usd,
            },
            {
              label: "7 days",
              actual_cost: costs.last_7_days.total_cost_usd,
              baseline_cost: costs.last_7_days.baseline_cost_usd,
            },
            {
              label: "30 days",
              actual_cost: costs.last_30_days.total_cost_usd,
              baseline_cost: costs.last_30_days.baseline_cost_usd,
            },
          ]
        : [],
    [costs]
  );

  const modelSeries = useMemo(
    () =>
      sortModelsByCost(models)
        .slice(0, 6)
        .map((model) => ({
          name: formatModelName(model.model_name),
          cost: model.total_cost_usd,
        })),
    [models]
  );

  const providerRows = useMemo(() => sortProvidersByCost(providers), [providers]);
  const maxProviderCost = providerRows[0]?.total_cost_usd || 1;
  const cacheHitRate = summary?.cache_hit_rate ?? 0;

  return (
    <div className="animate-fade-in space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-50">Overview</h1>
          <p className="mt-2 text-base text-slate-400">Monitor your LLM usage and costs</p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {error && !loading ? (
        <Card className="border-red-900/60 bg-red-950/25">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-300" />
              <div>
                <p className="font-medium text-red-100">Unable to load dashboard analytics</p>
                <p className="mt-1 text-sm text-red-200/80">{error}</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !summary ? (
          Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
        ) : summary ? (
          <>
            <MetricCard
              title="Total Requests"
              value={formatCompactNumber(summary.total_requests)}
              description="Lifetime requests processed through the proxy."
              icon={<Activity className="h-5 w-5 text-brand-100" />}
              accentClassName="bg-brand-500/15 text-brand-100"
            />
            <MetricCard
              title="Total Cost"
              value={formatCurrency(summary.total_cost_usd)}
              description="Actual provider spend across all requests."
              icon={<DollarSign className="h-5 w-5 text-emerald-100" />}
              accentClassName="bg-emerald-500/15 text-emerald-100"
            />
            <MetricCard
              title="Avg Latency"
              value={formatLatency(summary.avg_latency_ms)}
              description="Average end-to-end response time."
              icon={<Zap className="h-5 w-5 text-amber-100" />}
              accentClassName="bg-amber-500/15 text-amber-100"
            />
            <MetricCard
              title="Today's Savings"
              value={formatCurrency(summary.today.saved_usd)}
              description={`Against a ${formatCurrency(summary.today.baseline_cost_usd)} baseline today.`}
              icon={<TrendingDown className="h-5 w-5 text-purple-100" />}
              accentClassName="bg-purple-500/15 text-purple-100"
            />
          </>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        {loading && !costs ? (
          <PanelSkeleton />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Cost vs Baseline</CardTitle>
              <CardDescription>
                Compare actual spend against the baseline model over key time windows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {costSeries.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={costSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="actualCostFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="baselineCostFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        tickFormatter={(value: number | string) => `$${Number(value).toFixed(2)}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#020617",
                          border: "1px solid #1e293b",
                          borderRadius: 16,
                          color: "#e2e8f0",
                        }}
                        formatter={(value: number | string) => formatCurrency(Number(value))}
                      />
                      <Area
                        type="monotone"
                        dataKey="baseline_cost"
                        name="Baseline cost"
                        stroke="#94a3b8"
                        strokeWidth={2}
                        fill="url(#baselineCostFill)"
                      />
                      <Area
                        type="monotone"
                        dataKey="actual_cost"
                        name="Actual cost"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        fill="url(#actualCostFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<DollarSign className="h-6 w-6" />}
                  title="No spend data yet"
                  description="Run requests through the proxy to compare actual cost against your baseline model."
                />
              )}
            </CardContent>
          </Card>
        )}

        {loading && !summary ? (
          <PanelSkeleton height="h-64" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Cache hit rate</CardTitle>
              <CardDescription>
                Cache efficiency and savings at a glance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary ? (
                <div className="space-y-6">
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-4xl font-semibold text-slate-50">
                          {formatPercent(cacheHitRate)}
                        </p>
                        <p className="mt-2 text-sm text-slate-400">
                          Repeated prompts are returning from cache before reaching a provider.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3">
                        <Shield className="h-5 w-5 text-brand-100" />
                      </div>
                    </div>
                    <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-500 via-brand-400 to-cyan-200"
                        style={{ width: `${Math.min(cacheHitRate * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-sm text-slate-400">Today saved</p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-200">
                        {formatCurrency(summary.today.saved_usd)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                      <p className="text-sm text-slate-400">30 day saved</p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-200">
                        {formatCurrency(costs?.last_30_days.saved_usd ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Shield className="h-6 w-6" />}
                  title="No cache data yet"
                  description="Cache metrics appear once traffic starts flowing through the proxy."
                />
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        {loading && models.length === 0 ? (
          <PanelSkeleton />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Model breakdown</CardTitle>
              <CardDescription>Top models by total cost.</CardDescription>
            </CardHeader>
            <CardContent>
              {modelSeries.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        tickFormatter={(value: number | string) => `$${Number(value).toFixed(2)}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#020617",
                          border: "1px solid #1e293b",
                          borderRadius: 16,
                          color: "#e2e8f0",
                        }}
                        formatter={(value: number | string) => formatCurrency(Number(value))}
                      />
                      <Bar dataKey="cost" name="Total cost" radius={[8, 8, 0, 0]} fill="#38bdf8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<Activity className="h-6 w-6" />}
                  title="No model usage yet"
                  description="Model cost distribution will appear once requests are captured."
                />
              )}
            </CardContent>
          </Card>
        )}

        {loading && providers.length === 0 ? (
          <PanelSkeleton height="h-64" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Provider breakdown</CardTitle>
              <CardDescription>Spend, traffic, and latency by provider.</CardDescription>
            </CardHeader>
            <CardContent>
              {providerRows.length > 0 ? (
                <Table stripedRows>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Requests</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Latency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerRows.map((provider) => (
                      <TableRow key={provider.provider}>
                        <TableCell>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="muted">{provider.provider}</Badge>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-cyan-200"
                                style={{
                                  width: `${Math.max((provider.total_cost_usd / maxProviderCost) * 100, 6)}%`,
                                }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatCompactNumber(provider.request_count)}</TableCell>
                        <TableCell>{formatCurrency(provider.total_cost_usd)}</TableCell>
                        <TableCell>{formatLatency(provider.avg_latency_ms)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  icon={<Server className="h-6 w-6" />}
                  title="No provider data yet"
                  description="Provider comparisons appear once traffic reaches one or more backends."
                />
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
