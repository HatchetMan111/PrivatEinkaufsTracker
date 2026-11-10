import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    // Erstbesuch: Systempräferenz respektieren.
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((value) => !value) };
}

export function TopBar() {
  const { dark, toggle } = useTheme();
  const location = useLocation();
  const onDashboard = location.pathname === "/" || location.pathname.startsWith("/products");
  const onSettings = location.pathname.startsWith("/settings");

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">
            ET
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg tracking-tight">EinkaufsTracker</span>
            <span className="hidden text-[11px] uppercase tracking-[0.16em] text-muted sm:block">
              Wochenangebote &amp; Preise
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            aria-current={onDashboard ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              onDashboard
                ? "bg-accentsoft font-medium text-accenttext"
                : "text-muted hover:text-ink"
            }`}
          >
            Übersicht
          </Link>
          <Link
            to="/settings"
            aria-current={onSettings ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              onSettings
                ? "bg-accentsoft font-medium text-accenttext"
                : "text-muted hover:text-ink"
            }`}
          >
            Einstellungen
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label="Design wechseln"
            className="ml-1 grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </nav>
      </div>
    </header>
  );
}
