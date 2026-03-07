import { Eye, EyeOff, Shield } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/Card";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ADMIN_KEY_STORAGE_KEY, api, AuthError, getErrorMessage } from "@/lib/api";

export default function LoginPage() {
  const { setAdminKey } = useAuth();
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedValue = keyValue.trim();

    if (!trimmedValue) {
      setError("Enter an admin key to continue.");
      return;
    }

    setLoading(true);
    setError(null);

    const previousKey = window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY);
    window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, trimmedValue);

    try {
      await api.stats.summary();
      setAdminKey(trimmedValue);
    } catch (errorValue) {
      if (previousKey) {
        window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, previousKey);
      } else {
        window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
      }

      setError(
        errorValue instanceof AuthError
          ? "The admin key was rejected. Check the key and try again."
          : getErrorMessage(errorValue)
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.22),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),_transparent_28%)]" />
      <Card className="relative w-full max-w-md border-slate-800/80 bg-slate-900/90 shadow-[0_40px_120px_-55px_rgba(14,165,233,0.65)] backdrop-blur">
        <CardHeader className="space-y-4 border-b border-slate-800/80 pb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-brand-500/30 bg-gradient-to-br from-brand-500/25 via-brand-400/10 to-slate-950 text-brand-100 shadow-[0_20px_50px_-32px_rgba(14,165,233,0.9)]">
            <Shield className="h-8 w-8" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-brand-300/80">Admin dashboard</p>
            <CardTitle className="mt-2 text-3xl text-gradient-brand">LLM Guardian</CardTitle>
            <CardDescription className="mt-2">
              Connect with an admin key to monitor usage, review logs, and manage proxy access.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="relative">
              <Input
                label="Admin API Key"
                type={showKey ? "text" : "password"}
                value={keyValue}
                onChange={(event) => setKeyValue(event.target.value)}
                placeholder="sk-guardian-..."
                autoComplete="current-password"
                autoFocus
                className="pr-12"
                error={error ?? undefined}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-[2.55rem] h-8 w-8 text-slate-400 hover:text-white"
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Connect
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
