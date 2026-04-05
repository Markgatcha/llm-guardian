import { useEffect, useState } from "react";
import {
  BarChart3,
  DollarSign,
  Layers,
  Menu,
  ScrollText,
  Server,
  Shield,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";

interface NavItem {
  label: string;
  to: string;
  icon: typeof Shield;
}

const navItems: NavItem[] = [
  { label: "Overview", to: "/", icon: BarChart3 },
  { label: "Compression", to: "/compression", icon: Layers },
  { label: "USD Savings", to: "/savings", icon: DollarSign },
  { label: "Providers", to: "/providers", icon: Server },
  { label: "Logs", to: "/logs", icon: ScrollText },
];

function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/25 via-brand-400/10 to-slate-950 text-brand-100">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-brand-300/80">Guardian</p>
            <p className="text-xl font-semibold text-gradient-brand">V1.0.0</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-5">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-500/15 text-brand-100 shadow-[inset_0_0_0_1px_rgba(43,140,255,0.25)]"
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
      <div className="border-t border-slate-800 p-4">
        <p className="text-xs text-slate-500">LLM-Guardian V1.0.0</p>
        <p className="text-xs text-slate-600">AI Trio Nervous System</p>
      </div>
    </div>
  );
}

export default function Shell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950/90 backdrop-blur lg:block">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 w-72 border-r border-slate-800 bg-slate-950/95 backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <span className="text-sm font-semibold text-slate-100">LLM Guardian</span>
              <button onClick={() => setMobileOpen(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 px-4 py-4 backdrop-blur lg:hidden">
          <button onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5 text-slate-400" />
          </button>
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
