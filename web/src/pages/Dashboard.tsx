import {
  AlertTriangle,
  MapPin,
  PackageOpen,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  TrendingDown,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  api,
  type Location,
  type OfferSort,
  type OffersResponse,
  type Retailer,
  type Run,
  type Stats,
} from "../api";
import { OfferCard } from "../components/OfferCard";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { formatDate, formatRelative, formatWeek, retailerColor } from "../format";

type Week = "current" | "previous";

export function Dashboard() {
  const toast = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [retailerList, setRetailerList] = useState<Retailer[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");
  const [week, setWeek] = useState<Week>("current");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>([]);
  const [sort, setSort] = useState<OfferSort>("discount");
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.locations(), api.retailers(), api.runs()])
      .then(([locationList, retailerOptions, runList]) => {
        if (!active) return;
        setLocations(locationList);
        setRetailerList(retailerOptions);
        setRuns(runList);
        const stored = Number(localStorage.getItem("location"));
        const initial = locationList.find((item) => item.id === stored) ?? locationList[0];
        if (initial) setSelectedLocation(initial.id);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedLocation !== "") localStorage.setItem("location", String(selectedLocation));
  }, [selectedLocation]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  // „/“ fokussiert die Suche – außer man tippt gerade in einem Feld.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Interval beim Verlassen der Seite sauber beenden (früher Memory-Leak).
  useEffect(() => stopPolling, [stopPolling]);

  const load = useCallback(async () => {
    if (selectedLocation === "") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = {
        location_id: selectedLocation,
        week,
        q: appliedQuery || undefined,
        retailers: selectedRetailers.join(",") || undefined,
        sort,
      };
      const [offersResponse, statsResponse] = await Promise.all([
        api.offers(params),
        api.stats({ location_id: selectedLocation, week }),
      ]);
      setOffers(offersResponse);
      setStats(statsResponse);
      setRuns(await api.runs());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedLocation, week, appliedQuery, selectedRetailers, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.refresh();
      stopPolling();
      let attempts = 0;
      pollRef.current = window.setInterval(async () => {
        attempts += 1;
        const latest = await api.runs().catch(() => []);
        setRuns(latest);
        const running = latest.some((run) => run.status === "running");
        if (!running || attempts > 40) {
          stopPolling();
          setRefreshing(false);
          const lastRun = latest[0];
          if (lastRun?.status === "failed") {
            toast.error("Sammel-Lauf fehlgeschlagen. Details siehe Einstellungen.");
          } else if (lastRun?.status === "partial") {
            toast.success("Sammel-Lauf fertig – einige Quellen lieferten keine Daten.");
          } else {
            toast.success("Angebote aktualisiert.");
          }
          void load();
        }
      }, 3000);
    } catch (err) {
      setError((err as Error).message);
      setRefreshing(false);
    }
  };

  const toggleRetailer = (slug: string) => {
    setSelectedRetailers((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]
    );
  };

  const resetFilters = () => {
    setQuery("");
    setAppliedQuery("");
    setCategory("");
    setSelectedRetailers([]);
  };

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const offer of offers?.items ?? []) {
      if (offer.category) values.add(offer.category);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "de")).slice(0, 12);
  }, [offers]);

  const visibleOffers = useMemo(
    () => (offers?.items ?? []).filter((offer) => !category || offer.category === category),
    [offers, category]
  );

  const lastRun = runs[0];
  const stale =
    lastRun &&
    (lastRun.status === "failed" ||
      lastRun.status === "partial" ||
      Date.now() - new Date(lastRun.started_at).getTime() > 8 * 24 * 3600 * 1000);

  const hasActiveFilters = query !== "" || appliedQuery !== "" || category !== "" || selectedRetailers.length > 0;
  const itemCount = offers?.items.length ?? 0;
  const countText =
    visibleOffers.length !== itemCount
      ? `${visibleOffers.length} von ${itemCount} Angeboten`
      : `${itemCount} Angebote`;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow mb-2">{week === "current" ? "Aktuelle Woche" : "Vorwoche"}</p>
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
              Diese Woche im Angebot
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {offers ? formatWeek(offers.week_start) : "Angebote werden geladen …"}
              {stats?.offers ? ` · ${stats.offers} Angebote` : ""}
              {lastRun && !refreshing ? ` · gesammelt ${formatRelative(lastRun.started_at)}` : ""}
            </p>
          </div>

          <button type="button" className="btn btn-primary w-fit" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Sammelt …" : "Aktualisieren"}
          </button>
        </div>

        {/* Steuerleiste: Ort, Woche, Sortierung – ab lg klebt sie unter der Kopfzeile. */}
        <div className="-mx-4 mt-6 border-y border-line/70 bg-paper/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:sticky lg:top-[61px] lg:z-20">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <select
                value={selectedLocation}
                onChange={(event) => setSelectedLocation(Number(event.target.value))}
                className="field appearance-none py-2 pl-9 pr-8"
                aria-label="Ort wählen"
              >
                {locations.length === 0 && <option value="">Kein Ort</option>}
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.zip})
                  </option>
                ))}
              </select>
            </label>

            <div className="inline-flex rounded-full border border-line bg-surface p-1">
              <button
                type="button"
                onClick={() => setWeek("current")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  week === "current" ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                Aktuell
              </button>
              <button
                type="button"
                onClick={() => setWeek("previous")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  week === "previous" ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                Vorwoche
              </button>
            </div>

            <label className="ml-auto flex items-center gap-2 text-xs text-muted">
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] sm:inline">
                Sortierung
              </span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as OfferSort)}
                className="field w-auto appearance-none py-2 pr-8 text-xs"
                aria-label="Angebote sortieren"
              >
                <option value="discount">Beste Deals (% Rabatt)</option>
                <option value="saving">Höchste Ersparnis (€)</option>
                <option value="price_asc">Preis aufsteigend</option>
                <option value="price_desc">Preis absteigend</option>
                <option value="title">Name A–Z</option>
              </select>
            </label>
          </div>

          <div className="relative mt-2">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nach Produkt, Marke oder Beschreibung suchen …"
              className="field py-2 pl-11 pr-24"
              aria-label="Angebote durchsuchen"
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="Suche leeren"
                  className="rounded-md p-1.5 text-muted transition hover:text-ink"
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd className="hidden rounded-md border border-line bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:block">
                  /
                </kbd>
              )}
            </div>
          </div>
        </div>

        {stale && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              Letzter Lauf: {lastRun ? `${formatRelative(lastRun.started_at)} (${formatDate(lastRun.started_at)})` : "unbekannt"} ({lastRun?.status}).
              Die angezeigten Daten sind möglicherweise nicht aktuell.
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={<Tag size={16} />} label="Angebote" value={stats?.offers ?? 0} />
          <Kpi icon={<TrendingDown size={16} />} label="Günstiger als Vorwoche" value={stats?.price_drops ?? 0} />
          <Kpi icon={<PackageOpen size={16} />} label="Produkte" value={stats?.new_products ?? 0} />
          {stats?.best_discount ? (
            <Kpi
              icon={<Sparkles size={16} />}
              label="Bester Deal"
              value={`−${stats.best_discount.percent} %`}
              hint={`${stats.best_discount.title} · ${stats.best_discount.retailer_name}`}
              to={stats.best_discount.product_id ? `/products/${stats.best_discount.product_id}` : undefined}
            />
          ) : (
            <Kpi icon={<Sparkles size={16} />} label="Bester Deal" value="–" />
          )}
        </section>

        <div className="mt-6 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted" aria-live="polite">
              {!loading && itemCount > 0 ? countText : ""}
            </p>
            {hasActiveFilters && (
              <button type="button" className="chip" onClick={resetFilters}>
                <X size={12} /> Filter zurücksetzen
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Markt
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                className={`chip ${selectedRetailers.length === 0 ? "chip-active" : ""}`}
                onClick={() => setSelectedRetailers([])}
              >
                Alle
              </button>
              {retailerList.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  className={`chip ${selectedRetailers.includes(item.slug) ? "chip-active" : ""}`}
                  onClick={() => toggleRetailer(item.slug)}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: retailerColor(item.slug) }}
                  />
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          {categories.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Kategorie
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  className={`chip ${category === "" ? "chip-active" : ""}`}
                  onClick={() => setCategory("")}
                >
                  Alle
                </button>
                {categories.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip ${category === value ? "chip-active" : ""}`}
                    onClick={() => setCategory(value === category ? "" : value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="surface h-72 animate-pulse bg-ink/[.02] dark:bg-white/[.03]" />
            ))}
          </div>
        ) : visibleOffers.length === 0 ? (
          <div className="surface mt-8 flex flex-col items-center gap-3 px-6 py-16 text-center">
            <PackageOpen size={28} className="text-muted" />
            <h2 className="font-display text-xl">
              {locations.length === 0 ? "Noch kein Ort angelegt" : "Keine Angebote gefunden"}
            </h2>
            <p className="max-w-md text-sm text-muted">
              {locations.length === 0
                ? "Lege zuerst einen Ort mit Name und PLZ an. Danach kann der erste Sammel-Lauf starten."
                : hasActiveFilters
                  ? "Für diese Filter liegen keine Treffer vor. Setze die Filter zurück oder starte einen Sammel-Lauf."
                  : "Für diese Auswahl liegen noch keine Daten vor. Starte einen Lauf oder wähle einen anderen Ort bzw. eine andere Woche."}
            </p>
            {locations.length === 0 ? (
              <Link to="/settings" className="btn btn-primary mt-2">
                Ort anlegen
              </Link>
            ) : hasActiveFilters ? (
              <button type="button" className="btn btn-primary mt-2" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
            ) : (
              <button type="button" className="btn btn-primary mt-2" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
                Jetzt aktualisieren
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleOffers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} sortBy={sort} />
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-muted">
          Daten aus öffentlichen Prospekten und Angebotsquellen. Nur für den privaten Gebrauch.
        </p>
      </main>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div>}
    </>
  );
  if (to) {
    return (
      <Link
        to={to}
        className="surface block px-4 py-3.5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {content}
      </Link>
    );
  }
  return <div className="surface px-4 py-3.5">{content}</div>;
}
