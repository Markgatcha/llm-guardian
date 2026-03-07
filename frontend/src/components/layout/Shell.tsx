import { useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Server,
  Shield,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { lastFour } from "@/lib/format";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
}

const navigationItems: NavItem[] = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Providers", to: "/providers", icon: Server },
  { label: "Rules", to: "/rules", icon: SlidersHorizontal },
  { label: "Logs", to: "/logs", icon: ScrollText },
  { label: "Keys & Settings", to: "/keys", icon: KeyRound },
];

function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1 px-3">
      {navigationItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-500/15 text-brand-100 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.25)]"
                  : "text-slate-400 hover:bg-slate-900/80 hover:text-white"
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export default function Shell() {
  const { adminKey, setAdminKey } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const keySuffix = useMemo(() => lastFour(adminKey), [adminKey]);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/25 via-brand-400/10 to-slate-950 text-brand-100">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Admin dashboard</p>
            <p className="text-xl font-semibold text-gradient-brand">LLM Guardian</p>
          </div>
        </div>
      </div>

      <div className="flex-1 py-5">
        <SidebarNavigation onNavigate={() => setMobileOpen(false)} />
      </div>

      <div className="border-t border-slate-800 p-4">
        <button
          type="button"
          onClick={() => setAdminKey(null)}
          className="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
        >
          <div>
            <p className="text-sm font-medium text-slate-100">Admin key ending in {keySuffix}</p>
            <p className="text-xs text-slate-400">Sign out of this browser session.</p>
          </div>
          <LogOut className="h-4 w-4 text-slate-400" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950/90 backdrop-blur lg:block">
        {sidebarContent}
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur transition-transform duration-200 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-brand-200" />
            <span className="text-sm font-semibold text-slate-100">LLM Guardian</span>
          </div>
          <Button size="icon" variant="ghost" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {sidebarContent}
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 px-4 py-4 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-brand-300/80">LLM Guardian</p>
                <p className="text-sm font-medium text-slate-100">Dashboard</p>
              </div>
            </div>
            <p className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400">
              Key {keySuffix}
            </p>
          </div>
        </header>

        <main className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
