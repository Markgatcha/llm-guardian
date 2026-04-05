import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/Cards";
import { api, type LogItem, type LogsResponse } from "../lib/api";
import { formatCurrency, formatLatency, formatCompactNumber } from "../lib/utils";
import { Activity, ScrollText } from "lucide-react";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await api.logs(limit, offset);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="animate-fade-in space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-50">Request Logs</h1>
        <p className="mt-2 text-base text-slate-400">
          All requests processed through the Guardian pipeline
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

      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>
            {logs ? `${logs.total} total requests` : loading ? "Loading..." : "No data"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="skeleton h-5 w-24" />
                  <div className="skeleton h-5 w-12" />
                  <div className="skeleton h-5 w-12" />
                  <div className="skeleton h-5 w-14" />
                  <div className="skeleton h-5 w-14" />
                  <div className="skeleton h-5 w-12" />
                  <div className="skeleton h-5 w-16" />
                  <div className="skeleton h-5 w-20" />
                </div>
              ))}
            </div>
          ) : logs && logs.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-slate-400">
                      <th className="pb-3 pr-4">Model</th>
                      <th className="pb-3 pr-4">Prompt</th>
                      <th className="pb-3 pr-4">Completion</th>
                      <th className="pb-3 pr-4">Cost</th>
                      <th className="pb-3 pr-4">Saved</th>
                      <th className="pb-3 pr-4">Latency</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.items.map((item) => (
                      <LogRow key={item.requestId} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-500">
                  {offset + 1}&ndash;{Math.min(offset + limit, logs.total)} of {logs.total}
                </span>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= logs.total}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-900/50">
                <ScrollText className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm">No requests logged yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogRow({ item }: { item: LogItem }) {
  const modelShort = item.model.split("/").pop() || item.model;
  const time = item.timestamp
    ? new Date(item.timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "\u2014";

  return (
    <tr className="border-b border-slate-800/50 text-slate-300 transition-colors hover:bg-slate-900/40">
      <td className="py-3 pr-4">
        <span className="font-medium text-slate-100">{modelShort}</span>
      </td>
      <td className="py-3 pr-4">{formatCompactNumber(item.promptTokens)}</td>
      <td className="py-3 pr-4">{formatCompactNumber(item.completionTokens)}</td>
      <td className="py-3 pr-4">{formatCurrency(item.costUsd)}</td>
      <td className="py-3 pr-4">
        <span className={item.savedUsd > 0 ? "text-emerald-400" : "text-slate-500"}>
          {item.savedUsd > 0 ? `-${formatCurrency(item.savedUsd)}` : "\u2014"}
        </span>
      </td>
      <td className="py-3 pr-4">{formatLatency(item.latencyMs)}</td>
      <td className="py-3 pr-4">
        <span
          className={`rounded-lg px-2 py-0.5 text-xs ${
            item.status === "ok"
              ? "bg-emerald-500/15 text-emerald-300"
              : item.cacheHit
              ? "bg-brand-500/15 text-brand-300"
              : "bg-red-500/15 text-red-300"
          }`}
        >
          {item.cacheHit ? "cached" : item.status}
        </span>
      </td>
      <td className="py-3 text-xs text-slate-500">{time}</td>
    </tr>
  );
}
