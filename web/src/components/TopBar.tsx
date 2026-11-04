import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((value) => !value) };
}

export function TopBar() {
  const { dark, toggle } = useTheme();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur dark:border-[#2a2926] dark:bg-[#141413]/85">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">
            ET
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg tracking-tight">EinkaufsTracker</span>
            <span className="block text-[11px] uppercase tracking-[0.16em] text-muted">
              Wochenangebote &amp; Preise
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            className={`rounded-full px-3 py-1.5 transition ${
              location.pathname === "/"
                ? "bg-accentsoft text-accent dark:bg-accent/20 dark:text-[#bfe3d2]"
                : "text-muted hover:text-ink dark:hover:text-white"
            }`}
          >
            Übersicht
          </Link>
          <Link
            to="/settings"
            className={`rounded-full px-3 py-1.5 transition ${
              location.pathname === "/settings"
                ? "bg-accentsoft text-accent dark:bg-accent/20 dark:text-[#bfe3d2]"
                : "text-muted hover:text-ink dark:hover:text-white"
            }`}
          >
            Einstellungen
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label="Design wechseln"
            className="ml-1 grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition hover:text-ink dark:border-[#2a2926] dark:hover:text-white"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </nav>
      </div>
    </header>
  );
}
