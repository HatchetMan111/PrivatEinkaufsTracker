import {
  AlertTriangle,
  MapPin,
  PackageOpen,
  RefreshCw,
  Search,
  Tag,
  TrendingDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api, type Location, type OffersResponse, type Run, type Stats } from "../api";
import { OfferCard } from "../components/OfferCard";
import { TopBar } from "../components/TopBar";
import { formatDate, formatPrice, formatWeek } from "../format";

type Week = "current" | "previous";

export function Dashboard() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");
  const [week, setWeek] = useState<Week>("current");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [offers, setOffers] = useState<OffersResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.locations(), api.runs()])
      .then(([locationList, runList]) => {
        if (!active) return;
        setLocations(locationList);
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
  }, [selectedLocation, week, appliedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.refresh();
      let attempts = 0;
      const poll = window.setInterval(async () => {
        attempts += 1;
        const latest = await api.runs().catch(() => []);
        setRuns(latest);
        const running = latest.some((run) => run.status === "running");
        if (!running || attempts > 30) {
          window.clearInterval(poll);
          setRefreshing(false);
          void load();
        }
      }, 3000);
    } catch (err) {
      setError((err as Error).message);
      setRefreshing(false);
    }
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

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              {week === "current" ? "Aktuelle Woche" : "Vorwoche"}
            </p>
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
              Diese Woche im Angebot
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {offers ? formatWeek(offers.week_start) : "Angebote werden geladen …"}
              {stats?.offers ? ` · ${stats.offers} Angebote` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <MapPin size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <select
                value={selectedLocation}
                onChange={(event) => setSelectedLocation(Number(event.target.value))}
                className="field appearance-none pl-9 pr-8"
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

            <div className="inline-flex rounded-full border border-line bg-white p-1 dark:border-[#2a2926] dark:bg-[#1c1b19]">
              <button
                type="button"
                onClick={() => setWeek("current")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  week === "current"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-ink dark:hover:text-white"
                }`}
              >
                Aktuell
              </button>
              <button
                type="button"
                onClick={() => setWeek("previous")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  week === "previous"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-ink dark:hover:text-white"
                }`}
              >
                Vorwoche
              </button>
            </div>

            <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Sammelt …" : "Aktualisieren"}
            </button>
          </div>
        </div>

        <div className="relative mt-6">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nach Produkt, Marke oder Beschreibung suchen …"
            className="field pl-11"
            aria-label="Angebote durchsuchen"
          />
        </div>

        {stale && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              Letzter Lauf: {lastRun ? formatDate(lastRun.started_at) : "unbekannt"} ({lastRun?.status}).
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
          <Kpi
            icon={<TrendingDown size={16} />}
            label="Beste Ersparnis"
            value={stats?.best_discount ? formatPrice(stats.best_discount.saving) : "–"}
            hint={stats?.best_discount?.title}
          />
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
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

        {loading ? (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="surface h-72 animate-pulse bg-black/[.02] dark:bg-white/[.03]" />
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
                : "Für diese Auswahl liegen noch keine Daten vor. Starte einen Lauf oder wähle einen anderen Ort bzw. eine andere Woche."}
            </p>
            {locations.length === 0 ? (
              <Link to="/settings" className="btn btn-primary mt-2">
                Ort anlegen
              </Link>
            ) : (
              <button type="button" className="btn btn-primary mt-2" onClick={refresh} disabled={refreshing}>
                <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
                Jetzt aktualisieren
              </button>
            )}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleOffers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="surface px-4 py-3.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
