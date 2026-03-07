import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
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
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useRules } from "@/hooks/useRules";
import { getErrorMessage } from "@/lib/api";
import type { JsonObject, RuleType, UserRule } from "@/lib/types";

const RULE_TYPE_OPTIONS: { label: string; value: RuleType }[] = [
  { label: "Preferred model", value: "preferred_model" },
  { label: "Preferred provider", value: "preferred_provider" },
  { label: "Pinned provider", value: "provider_pin" },
  { label: "Budget cap", value: "budget_cap" },
  { label: "Max request spend", value: "max_request_spend" },
  { label: "Minimum max tokens", value: "max_tokens" },
];

const RULE_TYPE_LABELS: Record<string, string> = {
  preferred_model: "Preferred model",
  preferred_provider: "Preferred provider",
  provider_pin: "Pinned provider",
  budget_cap: "Budget cap",
  max_request_spend: "Max request spend",
  max_tokens: "Minimum max tokens",
};

interface RuleEditorState {
  name: string;
  rule_type: RuleType;
  valueText: string;
  priority: string;
  is_active: boolean;
}

function ruleTemplate(ruleType: RuleType): string {
  switch (ruleType) {
    case "preferred_provider":
      return '{\n  "provider": "groq"\n}';
    case "provider_pin":
      return '{\n  "provider": "openai"\n}';
    case "budget_cap":
      return '{\n  "amount": 0.01\n}';
    case "max_request_spend":
      return '{\n  "amount": 0.01\n}';
    case "max_tokens":
      return '{\n  "max_tokens": 4096\n}';
    case "preferred_model":
    default:
      return '{\n  "model": "gpt-4o-mini"\n}';
  }
}

function createDefaultState(): RuleEditorState {
  return {
    name: "",
    rule_type: "preferred_model",
    valueText: ruleTemplate("preferred_model"),
    priority: "100",
    is_active: true,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeRuleValue(value: JsonObject): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "No value configured";
  }

  return entries
    .slice(0, 2)
    .map(([key, entryValue]) => `${key}: ${typeof entryValue === "string" ? entryValue : JSON.stringify(entryValue)}`)
    .join(" | ");
}

export default function RulesPage() {
  const { rules, loading, error, createRule, updateRule, deleteRule, refetch } = useRules();
  const [editorState, setEditorState] = useState<RuleEditorState>(createDefaultState());
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<UserRule | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<UserRule | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => right.priority - left.priority),
    [rules]
  );

  function openCreateDialog() {
    setEditingRule(null);
    setEditorState(createDefaultState());
    setFormError(null);
    setIsEditorOpen(true);
  }

  function openEditDialog(rule: UserRule) {
    setEditingRule(rule);
    setEditorState({
      name: rule.name,
      rule_type: rule.rule_type,
      valueText: JSON.stringify(rule.value, null, 2),
      priority: String(rule.priority),
      is_active: rule.is_active,
    });
    setFormError(null);
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditingRule(null);
    setFormError(null);
  }

  function handleRuleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextType = event.target.value;
    setEditorState((current) => {
      const shouldReplaceValue =
        current.valueText.trim() === "" || current.valueText.trim() === ruleTemplate(current.rule_type).trim();

      return {
        ...current,
        rule_type: nextType,
        valueText: shouldReplaceValue ? ruleTemplate(nextType) : current.valueText,
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setActionError(null);

    if (!editorState.name.trim()) {
      setFormError("Rule name is required.");
      return;
    }

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(editorState.valueText);
    } catch {
      setFormError("Rule value must be valid JSON.");
      return;
    }

    if (!isJsonObject(parsedValue)) {
      setFormError("Rule value must be a JSON object.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: editorState.name.trim(),
        rule_type: editorState.rule_type,
        value: parsedValue,
        priority: Number.parseInt(editorState.priority, 10) || 100,
        is_active: editorState.is_active,
      };

      if (editingRule) {
        await updateRule(editingRule.id, payload);
      } else {
        await createRule(payload);
      }

      closeEditor();
    } catch (errorValue) {
      setFormError(errorValue instanceof Error ? errorValue.message : "Failed to save the rule.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive(rule: UserRule) {
    setActionError(null);
    try {
      await updateRule(rule.id, { is_active: !rule.is_active });
    } catch (errorValue) {
      setActionError(getErrorMessage(errorValue));
    }
  }

  async function confirmDelete() {
    if (!ruleToDelete) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteRule(ruleToDelete.id);
      setRuleToDelete(null);
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
          <h1 className="text-3xl font-semibold text-slate-50">Routing Rules</h1>
          <p className="mt-2 text-base text-slate-400">
            Define how requests are routed, blocked, or capped before they reach a provider.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void refetch()} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Add Rule
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
        <CardTitle>Active routing policy</CardTitle>
        <CardDescription>
          Rules are applied in priority order so you can shape model usage with confidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {actionError ? (
          <div className="mb-6 rounded-2xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {actionError}
          </div>
        ) : null}
        {loading && rules.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<SlidersHorizontal className="h-6 w-6" />}
              title="Unable to load rules"
              description={error}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : sortedRules.length > 0 ? (
            <Table stripedRows>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-slate-50">{rule.name}</p>
                        <p className="mt-1 text-xs text-slate-400">{summarizeRuleValue(rule.value)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="default">{RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}</Badge>
                    </TableCell>
                    <TableCell>{rule.priority}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={rule.is_active ? "success" : "muted"}>
                          {rule.is_active ? "Active" : "Inactive"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleToggleActive(rule)}
                        >
                          {rule.is_active ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(rule)}
                          aria-label={`Edit ${rule.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRuleToDelete(rule)}
                          aria-label={`Delete ${rule.name}`}
                          className="text-red-200 hover:text-red-100"
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
              icon={<SlidersHorizontal className="h-6 w-6" />}
              title="No routing rules yet"
              description="Create your first routing rule to block expensive models, prefer safer defaults, or cap spend."
              action={<Button onClick={openCreateDialog}>Add Rule</Button>}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditorOpen} onOpenChange={(open) => (open ? setIsEditorOpen(true) : closeEditor())}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={(event) => void handleSubmit(event)}>
            <DialogHeader>
              <DialogTitle>{editingRule ? "Edit rule" : "Add rule"}</DialogTitle>
              <DialogDescription>
                Use JSON values so the backend can evaluate model preferences, blocks, and budget limits.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 p-6">
              <Input
                label="Name"
                value={editorState.name}
                onChange={(event) =>
                  setEditorState((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Prefer the lowest cost chat model"
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Rule type" value={editorState.rule_type} onChange={handleRuleTypeChange}>
                  {RULE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>

                <Input
                  label="Priority"
                  type="number"
                  value={editorState.priority}
                  onChange={(event) =>
                    setEditorState((current) => ({ ...current, priority: event.target.value }))
                  }
                />
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <label className="flex items-center gap-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={editorState.is_active}
                    onChange={(event) =>
                      setEditorState((current) => ({ ...current, is_active: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-brand-500"
                  />
                  Enable this rule immediately
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-200" htmlFor="rule-value">
                  Value
                </label>
                <textarea
                  id="rule-value"
                  value={editorState.valueText}
                  onChange={(event) =>
                    setEditorState((current) => ({ ...current, valueText: event.target.value }))
                  }
                  rows={8}
                  className="min-h-[200px] w-full rounded-2xl border border-slate-700 bg-slate-800/90 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <p className="text-xs text-slate-400">
                  Provide a JSON object. Templates update automatically for the selected rule type.
                </p>
              </div>

              {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
            </div>

            <DialogFooter>
              <DialogClose>Cancel</DialogClose>
              <Button type="submit" loading={isSaving}>
                {editingRule ? "Save changes" : "Create rule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(ruleToDelete)} onOpenChange={(open) => (open ? undefined : setRuleToDelete(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete rule</DialogTitle>
            <DialogDescription>
              Delete "{ruleToDelete?.name}"? This change takes effect immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <Button variant="destructive" loading={isDeleting} onClick={() => void confirmDelete()}>
              Delete rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
