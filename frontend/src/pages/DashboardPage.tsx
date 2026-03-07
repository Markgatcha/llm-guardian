/**
 * DashboardPage — main analytics view.
 *
 * TODO: fetch real data from GET /api/v1/stats/summary
 * TODO: add model breakdown chart (Recharts BarChart)
 * TODO: add live request feed (SSE or polling)
 */
import { useStats } from "../hooks/useStats";

export default function DashboardPage() {
  const { data, loading, error } = useStats();

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-6 text-brand-500">LLM Guardian</h1>

      {loading && <p className="text-slate-400">Loading stats…</p>}
      {error && <p className="text-red-400">Error: {error}</p>}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Total Requests" value={String(data.total_requests)} />
          <StatCard label="Total Cost (USD)" value={`$${data.total_cost_usd.toFixed(4)}`} />
          <StatCard label="Avg Latency" value={`${data.avg_latency_ms.toFixed(1)} ms`} />
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <p className="text-sm text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
