import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/Cards";
import { api, type ProviderInfo } from "../lib/api";
import { formatCurrency } from "../lib/utils";

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.providers();
      setProviders(data.models);
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

      <Card>
        <CardHeader>
          <CardTitle>Model Catalog</CardTitle>
          <CardDescription>Sorted by input cost (cheapest first).</CardDescription>
        </CardHeader>
        <CardContent>
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
                  <tr key={model.model} className="border-b border-slate-800/50 text-slate-300">
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
        </CardContent>
      </Card>
    </div>
  );
}
