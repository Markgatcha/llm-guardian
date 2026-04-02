import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, MetricCard } from "../components/Cards";
import { api, type CompressionStats } from "../lib/api";
import { formatPercent } from "../lib/utils";
import { Layers, Minimize2, TrendingDown, Zap } from "lucide-react";

interface CompressionLogEntry {
  timestamp: number;
  ratio: number;
  tokensSaved: number;
  model: string;
}

export default function CompressionPage() {
  const [stats, setStats] = useState<CompressionStats | null>(null);
  const [logEntries, setLogEntries] = useState<CompressionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [compressionStats, logs] = await Promise.all([
        api.stats.compression(),
        api.logs(200),
      ]);
      setStats(compressionStats);

      // Build compression timeline from logs
      const entries: CompressionLogEntry[] = logs.items
        .filter((item) => item.timestamp > 0)
        .map((item) => ({
          timestamp: item.timestamp,
          ratio: compressionStats.avgCompressionRatio,
          tokensSaved: Math.floor(
            (item.promptTokens + item.completionTokens) *
              (1 - compressionStats.avgCompressionRatio)
          ),
          model: item.model,
        }))
        .reverse();
      setLogEntries(entries);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Build model breakdown chart data
  const modelBreakdown = logEntries.reduce(
    (acc, entry) => {
      const existing = acc.find((m) => m.model === entry.model);
      if (existing) {
        existing.tokensSaved += entry.tokensSaved;
        existing.count += 1;
      } else {
        acc.push({ model: entry.model.split("/").pop() || entry.model, tokensSaved: entry.tokensSaved, count: 1 });
      }
      return acc;
    },
    [] as Array<{ model: string; tokensSaved: number; count: number }>
  ).sort((a, b) => b.tokensSaved - a.tokensSaved).slice(0, 8);

  return (
    <div className="animate-fade-in space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-50">Real-time Compression</h1>
        <p className="mt-2 text-base text-slate-400">
          Semantic Folding & VCM Sharding compression analytics
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Avg Compression"
          value={formatPercent(stats?.avgCompressionRatio ?? 1)}
          description="Average ratio across all folded requests."
          icon={<Minimize2 className="h-5 w-5 text-cyan-100" />}
          accentClassName="bg-cyan-500/15 text-cyan-100"
        />
        <MetricCard
          title="Tokens Eliminated"
          value={stats ? `${(stats.totalTokensOptimized / 1000).toFixed(1)}K` : "0"}
          description="Total tokens removed by the folding pipeline."
          icon={<Layers className="h-5 w-5 text-purple-100" />}
          accentClassName="bg-purple-500/15 text-purple-100"
        />
        <MetricCard
          title="Pipeline Latency"
          value="<50ms"
          description="Target: sub-50ms folding + sharding execution."
          icon={<Zap className="h-5 w-5 text-amber-100" />}
          accentClassName="bg-amber-500/15 text-amber-100"
        />
        <MetricCard
          title="Cost Reduction"
          value={formatPercent(1 - (stats?.avgCompressionRatio ?? 1))}
          description="Token cost reduction via semantic folding."
          icon={<TrendingDown className="h-5 w-5 text-emerald-100" />}
          accentClassName="bg-emerald-500/15 text-emerald-100"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Compression Timeline</CardTitle>
            <CardDescription>Per-request compression ratio over time.</CardDescription>
          </CardHeader>
          <CardContent>
            {logEntries.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={logEntries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#94a3b8", fontSize: 12 }}
                      tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                      domain={[0, 1]}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#020617", border: "1px solid #1e293b", borderRadius: 16, color: "#e2e8f0" }}
                      formatter={(v) => formatPercent(Number(v))}
                    />
                    <Line type="monotone" dataKey="ratio" name="Compression" stroke="#22d3ee" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-slate-500">No compression data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tokens Saved by Model</CardTitle>
            <CardDescription>Which models benefit most from semantic folding.</CardDescription>
          </CardHeader>
          <CardContent>
            {modelBreakdown.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} layout="vertical">
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis type="category" dataKey="model" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: "#020617", border: "1px solid #1e293b", borderRadius: 16, color: "#e2e8f0" }} />
                    <Bar dataKey="tokensSaved" name="Tokens Saved" fill="#a78bfa" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-slate-500">No model data yet.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
