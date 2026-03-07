import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useAuth } from "@/contexts/AuthContext";
import { useKeys } from "@/hooks/useKeys";
import { getErrorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ApiKey, CreatedApiKey } from "@/lib/types";

async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCopied(false), 1800);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copied]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const wasCopied = await copyText(value);
        setCopied(wasCopied);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export default function KeysPage() {
  const { adminKey } = useAuth();
  const { keys, loading, error, createKey, updateKey, deleteKey, refetch } = useKeys();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const proxyOrigin = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    if (window.location.port === "5173") {
      return `${window.location.protocol}//${window.location.hostname}:8000`;
    }

    return window.location.origin;
  }, []);

  const proxyEndpoint = `${proxyOrigin || ""}/v1/chat/completions`;
  const curlExample = `curl ${proxyEndpoint} \\
  -H "Content-Type: application/json" \\
  -H "X-Guardian-Key: ${adminKey ?? "YOUR_ADMIN_KEY"}" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Summarize today's LLM spend."}]}'`;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setActionError(null);

    if (!keyName.trim()) {
      setCreateError("Key name is required.");
      return;
    }

    setIsCreating(true);
    try {
      const nextKey = await createKey(keyName.trim());
      setCreatedKey(nextKey);
      setKeyName("");
      setIsCreateOpen(false);
    } catch (errorValue) {
      setCreateError(errorValue instanceof Error ? errorValue.message : "Failed to create key.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleToggleKey(key: ApiKey) {
    setActionError(null);
    try {
      await updateKey(key.id, { is_active: !key.is_active });
    } catch (errorValue) {
      setActionError(getErrorMessage(errorValue));
    }
  }

  async function handleDeleteKey() {
    if (!keyToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteKey(keyToDelete.id);
      setKeyToDelete(null);
    } catch (errorValue) {
      setActionError(getErrorMessage(errorValue));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-50">API Keys & Settings</h1>
          <p className="mt-2 text-base text-slate-400">
            Create proxy credentials, rotate access, and share the integration details with your team.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void refetch()} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Key
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
        <CardTitle>Issued keys</CardTitle>
        <CardDescription>
          Use separate keys per environment so usage and revocation stay easy to manage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {actionError ? (
          <div className="mb-6 rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {actionError}
          </div>
        ) : null}
        {loading && keys.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<KeyRound className="h-6 w-6" />}
              title="Unable to load keys"
              description={error}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : keys.length > 0 ? (
            <Table stripedRows>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-slate-50">{key.name}</p>
                        <p className="mt-1 text-xs text-slate-500">ID {key.id.slice(0, 8)}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatDateTime(key.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={key.is_active ? "success" : "muted"}>
                        {key.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleToggleKey(key)}
                        >
                          {key.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-200 hover:text-red-100"
                          onClick={() => setKeyToDelete(key)}
                          aria-label={`Delete ${key.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<KeyRound className="h-6 w-6" />}
              title="No API keys yet"
              description="Create your first proxy key to onboard an application or a teammate."
              action={<Button onClick={() => setIsCreateOpen(true)}>Create Key</Button>}
            />
          )}
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Guardrails at a glance</CardTitle>
            <CardDescription>
              The dashboard keeps operators aligned on how the gateway should be used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4 text-sm text-slate-300">
              <li className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                Issue dedicated keys for each environment so you can rotate or revoke access without broad impact.
              </li>
              <li className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                Apply routing rules to block risky models, prefer safer defaults, and cap spend before traffic leaves the gateway.
              </li>
              <li className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                Use logs and analytics to track latency, cache hits, and savings against your configured baseline model.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Proxy usage</CardTitle>
                <CardDescription>
                  Point OpenAI-compatible clients at the gateway and pass your key with every request.
                </CardDescription>
              </div>
              <div className="rounded-2xl border border-brand-500/25 bg-brand-500/10 p-3 text-brand-100">
                <Shield className="h-5 w-5" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-200">Proxy endpoint URL</p>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-sm text-brand-200">{proxyEndpoint}</code>
                <CopyButton value={proxyEndpoint} />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-200">curl example</p>
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all text-sm text-slate-300">
                  {curlExample}
                </pre>
                <CopyButton value={curlExample} label="Copy curl" />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <form onSubmit={(event) => void handleCreate(event)}>
            <DialogHeader>
              <DialogTitle>Create key</DialogTitle>
              <DialogDescription>
                Give this key a clear name so it is easy to rotate or revoke later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 p-6">
              <Input
                label="Key name"
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder="production-api"
                error={createError ?? undefined}
              />
            </div>
            <DialogFooter>
              <DialogClose>Cancel</DialogClose>
              <Button type="submit" loading={isCreating}>
                Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(createdKey)} onOpenChange={(open) => (open ? undefined : setCreatedKey(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Key created</DialogTitle>
            <DialogDescription>
              Copy this secret now. It is only shown once for security reasons.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <code className="break-all text-sm text-emerald-100">{createdKey?.key}</code>
            </div>
            {createdKey?.key ? <CopyButton value={createdKey.key} /> : null}
          </div>
          <DialogFooter>
            <DialogClose>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(keyToDelete)} onOpenChange={(open) => (open ? undefined : setKeyToDelete(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke key</DialogTitle>
            <DialogDescription>
              Revoke "{keyToDelete?.name}"? Any callers using this key will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <Button variant="destructive" loading={isDeleting} onClick={() => void handleDeleteKey()}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
