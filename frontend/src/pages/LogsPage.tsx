import { RefreshCw, ScrollText } from "lucide-react";
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
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useLogs } from "@/hooks/useLogs";
import { formatCurrency, formatDateTime, formatLatency, formatTokens } from "@/lib/format";
import type { LogItem } from "@/lib/types";

function statusVariant(status: LogItem["status"]): "success" | "error" | "warning" {
  if (status === "ok") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  return "warning";
}

export default function LogsPage() {
  const { logs, total, loading, error, page, setPage, filters, setFilters, refetch } = useLogs();
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const startItem = total === 0 ? 0 : (page - 1) * filters.limit + 1;
  const endItem = Math.min(total, page * filters.limit);
  const hasActiveFilters = filters.model.trim().length > 0 || filters.status !== "all";

  return (
    <div className="animate-fade-in space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-50">Request Logs</h1>
          <p className="mt-2 text-base text-slate-400">
            Inspect request volume, savings, latency, and cache behavior over time.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void refetch()} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Narrow the log stream by model, status, or page size.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-[1fr_200px_180px]">
            <Input
              label="Search by model"
              value={filters.model}
              onChange={(event) =>
                setFilters((current) => ({ ...current, model: event.target.value }))
              }
              placeholder="gpt-4o-mini"
            />
            <Select
              label="Status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="all">All</option>
              <option value="ok">OK</option>
              <option value="error">Error</option>
            </Select>
            <Select
              label="Items per page"
              value={String(filters.limit)}
              onChange={(event) =>
                setFilters((current) => ({ ...current, limit: Number(event.target.value) }))
              }
            >
              {[10, 25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Log stream</CardTitle>
              <CardDescription>
                Showing {startItem}-{endItem} of {total.toLocaleString()} requests.
              </CardDescription>
            </div>
            {hasActiveFilters ? (
              <Button
                variant="outline"
                onClick={() =>
                  setFilters((current) => ({ ...current, model: "", status: "all" }))
                }
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="Unable to load request logs"
              description={error}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : logs.length > 0 ? (
            <>
              <Table stripedRows>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Saved</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Cache</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-sm text-slate-300">
                        {formatDateTime(log.created_at)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-mono text-xs text-slate-100">{log.model}</p>
                          <p className="mt-1 text-xs text-slate-500">ID {log.id.slice(0, 8)}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted">{log.provider}</Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-slate-100">
                            {formatTokens(log.prompt_tokens, log.completion_tokens)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {log.prompt_tokens.toLocaleString()} prompt / {log.completion_tokens.toLocaleString()} completion
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{formatCurrency(log.cost_usd)}</TableCell>
                      <TableCell>
                        {log.saved_usd > 0 ? (
                          <span className="font-medium text-emerald-200">{formatCurrency(log.saved_usd)}</span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </TableCell>
                      <TableCell>{formatLatency(log.latency_ms)}</TableCell>
                      <TableCell>
                        <Badge variant={log.cache_hit ? "success" : "muted"}>
                          {log.cache_hit ? "Hit" : "Miss"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={statusVariant(log.status)}>{log.status}</Badge>
                          {log.error_code ? (
                            <p className="text-xs text-red-300">{log.error_code}</p>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 flex flex-col gap-4 border-t border-slate-800 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="No logs match your filters"
              description={
                hasActiveFilters
                  ? "Try widening your filters to find matching requests."
                  : "Requests will appear here once traffic starts flowing through the proxy."
              }
              action={
                hasActiveFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => setFilters((current) => ({ ...current, model: "", status: "all" }))}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
