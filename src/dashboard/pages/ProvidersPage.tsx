import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/Cards";
import { api, type ProviderInfo } from "../lib/api";
import { formatCurrency } from "../lib/utils";
import { Activity, Server } from "lucide-react";

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await api.providers();
      setProviders(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sorted = [...providers].sort(
    (a, b) => a.inputCostPerMillion - b.inputCostPerMillion
  );

  return (
    <div className="animate-fade-in space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-slate-50">Providers</h1>
        <p className="mt-2 text-base text-slate-400">
          All available models with pricing and capabilities
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
          <CardTitle>Model Catalog</CardTitle>
          <CardDescription>Sorted by input cost (cheapest first).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="skeleton h-6 w-32" />
                  <div className="skeleton h-6 w-20" />
                  <div className="skeleton h-6 w-16" />
                  <div className="skeleton h-6 w-16" />
                  <div className="skeleton h-6 w-12" />
                </div>
              ))}
            </div>
          ) : sorted.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th className="pb-3 pr-4">Model</th>
                    <th className="pb-3 pr-4">Provider</th>
                    <th className="pb-3 pr-4">Input $/1M</th>
                    <th className="pb-3 pr-4">Output $/1M</th>
                    <th className="pb-3 pr-4">Context</th>
                    <th className="pb-3 pr-4">Stream</th>
                    <th className="pb-3 pr-4">Vision</th>
                    <th className="pb-3">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((model) => (
                    <tr key={model.model} className="border-b border-slate-800/50 text-slate-300 transition-colors hover:bg-slate-900/40">
                      <td className="py-3 pr-4 font-medium text-slate-100">
                        {model.model.split("/").pop()}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="rounded-lg bg-slate-800 px-2 py-1 text-xs">{model.provider}</span>
                      </td>
                      <td className="py-3 pr-4">{formatCurrency(model.inputCostPerMillion)}</td>
                      <td className="py-3 pr-4">{formatCurrency(model.outputCostPerMillion)}</td>
                      <td className="py-3 pr-4">{(model.contextWindow / 1000).toFixed(0)}K</td>
                      <td className="py-3 pr-4">{model.supportsStreaming ? "Yes" : "No"}</td>
                      <td className="py-3 pr-4">{model.supportsVision ? "Yes" : "No"}</td>
                      <td className="py-3">{model.supportsToolUse ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-900/50">
                <Server className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm">No providers configured yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
