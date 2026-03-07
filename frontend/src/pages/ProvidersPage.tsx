import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Search, Server } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/Card";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatLatency } from "@/lib/format";
import type { ProviderCatalogEntry, ProviderStat, ProvidersResponse } from "@/lib/types";

interface ProvidersPageData {
  catalog: ProvidersResponse;
  stats: ProviderStat[];
}

interface ProviderPricingRow {
  provider: string;
  model: string;
  input_per_million: number;
  output_per_million: number;
  p95_latency_ms: number;
}

type SortKey = "model" | "provider" | "input" | "output" | "latency";
type SortDirection = "asc" | "desc";

function providerMatchesSearch(entry: ProviderCatalogEntry, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  if (entry.provider.toLowerCase().includes(normalizedQuery)) {
    return true;
  }

  return entry.models.some((model) => model.model.toLowerCase().includes(normalizedQuery));
}

export default function ProvidersPage() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("provider");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const fetcher = useCallback(async (): Promise<ProvidersPageData> => {
    const [catalog, statsResponse] = await Promise.all([api.providers.list(), api.stats.providers()]);
    return {
      catalog,
      stats: statsResponse.providers,
    };
  }, []);

  const { data, loading, error, refetch } = useApiQuery(fetcher, []);

  const providerStatsByName = useMemo(() => {
    const entries = data?.stats ?? [];
    return new Map(entries.map((entry) => [entry.provider, entry]));
  }, [data]);

  const providerCards = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.catalog.providers.filter((entry) => providerMatchesSearch(entry, search));
  }, [data, search]);

  const pricingRows = useMemo(() => {
    if (!data) {
      return [];
    }

    const rows: ProviderPricingRow[] = [];
    for (const provider of data.catalog.providers) {
      for (const model of provider.models) {
        rows.push({
          provider: provider.provider,
          model: model.model,
          input_per_million: model.pricing.input_per_million,
          output_per_million: model.pricing.output_per_million,
          p95_latency_ms: model.p95_latency_ms,
        });
      }
    }

    const normalizedSearch = search.trim().toLowerCase();
    const filteredRows = rows.filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      return (
        row.provider.toLowerCase().includes(normalizedSearch) ||
        row.model.toLowerCase().includes(normalizedSearch)
      );
    });

    const sortedRows = [...filteredRows].sort((left, right) => {
      const compareStrings = (firstValue: string, secondValue: string) =>
        sortDirection === "asc"
          ? firstValue.localeCompare(secondValue)
          : secondValue.localeCompare(firstValue);

      const compareNumbers = (firstValue: number, secondValue: number) =>
        sortDirection === "asc" ? firstValue - secondValue : secondValue - firstValue;

      switch (sortKey) {
        case "model":
          return compareStrings(left.model, right.model);
        case "provider":
          return compareStrings(left.provider, right.provider);
        case "input":
          return compareNumbers(left.input_per_million, right.input_per_million);
        case "output":
          return compareNumbers(left.output_per_million, right.output_per_million);
        case "latency":
          return compareNumbers(left.p95_latency_ms, right.p95_latency_ms);
        default:
          return 0;
      }
    });

    return sortedRows;
  }, [data, search, sortDirection, sortKey]);

  function toggleSort(nextSortKey: SortKey) {
    setSortDirection((currentDirection) => {
      if (sortKey === nextSortKey) {
        return currentDirection === "asc" ? "desc" : "asc";
      }

      return "asc";
    });
    setSortKey(nextSortKey);
  }

  function sortLabel(nextSortKey: SortKey): string {
    if (sortKey !== nextSortKey) {
      return "";
    }

    return sortDirection === "asc" ? "Asc" : "Desc";
  }

  return (
    <div className="animate-fade-in space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-50">Providers & Models</h1>
          <p className="mt-2 text-base text-slate-400">
            Review provider coverage, pricing, and observed latency.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      {data ? (
        <Card className="border-brand-500/20 bg-brand-500/10">
          <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-brand-100">Baseline model</p>
              <p className="text-lg font-semibold text-white">{data.catalog.baseline_model || "Not configured"}</p>
            </div>
            <Badge variant="default">Pricing catalog synced</Badge>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Provider coverage</CardTitle>
              <CardDescription>
                Each provider card combines catalog metadata with traffic analytics.
              </CardDescription>
            </div>
            <div className="w-full max-w-sm">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search providers or models"
                label="Search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="Unable to load providers"
              description={error}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : providerCards.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {providerCards.map((provider) => {
                const providerStats = providerStatsByName.get(provider.provider);
                const includesBaseline = provider.models.some(
                  (model) => model.model === data?.catalog.baseline_model
                );

                return (
                  <Card
                    key={provider.provider}
                    className="border-slate-800/90 bg-gradient-to-br from-slate-900 to-slate-950/80"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle>{provider.provider}</CardTitle>
                          <CardDescription>
                            {provider.models.length} models in the pricing catalog.
                          </CardDescription>
                        </div>
                        <div className="rounded-2xl border border-brand-500/25 bg-brand-500/10 p-3 text-brand-100">
                          <Server className="h-5 w-5" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                          <p className="text-slate-400">Requests</p>
                          <p className="mt-2 text-xl font-semibold text-slate-50">
                            {formatCompactNumber(providerStats?.request_count ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                          <p className="text-slate-400">Total cost</p>
                          <p className="mt-2 text-xl font-semibold text-slate-50">
                            {formatCurrency(providerStats?.total_cost_usd ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                          <p className="text-slate-400">Avg latency</p>
                          <p className="mt-2 text-xl font-semibold text-slate-50">
                            {formatLatency(providerStats?.avg_latency_ms ?? 0)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                          <p className="text-slate-400">Model count</p>
                          <p className="mt-2 text-xl font-semibold text-slate-50">
                            {provider.models.length}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {includesBaseline ? <Badge variant="default">Contains baseline model</Badge> : null}
                        {provider.models.slice(0, 3).map((model) => (
                          <Badge key={model.model} variant="muted">
                            {model.model}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No providers match your search"
              description="Try broadening your search to see the full pricing catalog."
              action={
                <Button variant="outline" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Model pricing</CardTitle>
          <CardDescription>
            Sort the pricing table to compare input, output, and latency across every catalog entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : pricingRows.length > 0 ? (
            <Table stripedRows>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-2" onClick={() => toggleSort("model")}>
                      Model
                      <span className="text-[10px] uppercase text-brand-300">{sortLabel("model")}</span>
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-2" onClick={() => toggleSort("provider")}>
                      Provider
                      <span className="text-[10px] uppercase text-brand-300">{sortLabel("provider")}</span>
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-2" onClick={() => toggleSort("input")}>
                      Input ($/1M)
                      <span className="text-[10px] uppercase text-brand-300">{sortLabel("input")}</span>
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-2" onClick={() => toggleSort("output")}>
                      Output ($/1M)
                      <span className="text-[10px] uppercase text-brand-300">{sortLabel("output")}</span>
                    </button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-2" onClick={() => toggleSort("latency")}>
                      P95 latency
                      <span className="text-[10px] uppercase text-brand-300">{sortLabel("latency")}</span>
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pricingRows.map((row) => (
                  <TableRow key={`${row.provider}-${row.model}`}>
                    <TableCell className="font-mono text-xs text-slate-300">{row.model}</TableCell>
                    <TableCell>
                      <Badge variant="muted">{row.provider}</Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(row.input_per_million)}</TableCell>
                    <TableCell>{formatCurrency(row.output_per_million)}</TableCell>
                    <TableCell>{formatLatency(row.p95_latency_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<Server className="h-6 w-6" />}
              title="No pricing rows available"
              description="Connect providers in the backend catalog to populate this table."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
