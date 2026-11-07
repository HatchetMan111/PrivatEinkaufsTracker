import { ArrowLeft, GitMerge, Scissors, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api, type History, type Product } from "../api";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/Toast";
import { discountPercent, formatDate, formatPrice, formatWeek, retailerColor } from "../format";

type TooltipEntry = { value?: number | string; dataKey?: string | number; name?: string | number };

function PriceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="mb-1 font-semibold">Woche {label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
          <span className="text-muted">{entry.dataKey === "avg_price" ? "Ø Preis" : "Niedrigster"}</span>
          <span className="font-medium">{formatPrice(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const productId = Number(id);
  const toast = useToast();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await api.history(productId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!mergeOpen || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.products(search.trim()).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mergeOpen, search]);

  const merge = async (sourceId: number) => {
    setBusy(true);
    try {
      await api.merge(productId, [sourceId]);
      toast.success("Produkte zusammengeführt.");
      setMergeOpen(false);
      setSearch("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const split = async (offerId: number) => {
    if (!window.confirm("Dieses Angebot in ein eigenes Produkt abtrennen?")) return;
    setBusy(true);
    try {
      const result = await api.split(productId, [offerId]);
      toast.success(`Angebot abgetrennt (neues Produkt #${result.new_product_id}).`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const product = history?.product;
  const weeks = history?.weeks ?? [];
  const points = history?.points ?? [];
  const imageUrl = points.find((point) => point.image_url)?.image_url ?? null;

  const currentPrice = weeks.length > 0 ? weeks[weeks.length - 1].min_price : null;
  const lowest = weeks.length > 0 ? Math.min(...weeks.map((week) => week.min_price)) : null;
  const highest = weeks.length > 0 ? Math.max(...weeks.map((week) => week.min_price)) : null;
  const average =
    weeks.length > 0 ? weeks.reduce((sum, week) => sum + week.avg_price, 0) / weeks.length : null;

  const chartData = weeks.map((week) => ({ ...week, label: week.week_start.slice(5) }));

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ArrowLeft size={15} /> Zurück zur Übersicht
        </Link>

        {error && (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="surface mt-6 h-64 animate-pulse bg-ink/[.02] dark:bg-white/[.03]" />
        ) : !product ? (
          <div className="surface mt-6 p-8 text-sm text-muted">Produkt nicht gefunden.</div>
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={product.canonical_name}
                    className="h-20 w-20 shrink-0 rounded-2xl border border-line bg-surface2 object-contain p-1.5"
                  />
                ) : null}
                <div>
                  <p className="eyebrow">{product.retailer_name}</p>
                  <h1 className="mt-1 font-display text-3xl tracking-tight">{product.canonical_name}</h1>
                  <p className="mt-1 text-sm text-muted">
                    {product.brand ? `${product.brand} · ` : ""}
                    {weeks.length} {weeks.length === 1 ? "Woche" : "Wochen"} im Verlauf
                  </p>
                </div>
              </div>
              <button type="button" className="btn w-fit" onClick={() => setMergeOpen((value) => !value)}>
                {mergeOpen ? <X size={15} /> : <GitMerge size={15} />}
                {mergeOpen ? "Abbrechen" : "Zusammenführen"}
              </button>
            </div>

            {mergeOpen && (
              <div className="surface mt-4 p-4">
                <label className="label">Anderes Produkt suchen und zusammenführen</label>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className="field pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Produktname oder Marke …"
                  />
                </div>
                <div className="mt-3 space-y-1">
                  {results
                    .filter((item) => item.id !== productId)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={busy}
                        onClick={() => merge(item.id)}
                        className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-left text-sm transition hover:border-accent/40 hover:bg-accentsoft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
                      >
                        <span className="flex items-center gap-2">
                          <GitMerge size={14} className="shrink-0 text-muted" />
                          <span>
                            <span className="font-medium">{item.canonical_name}</span>
                            <span className="ml-2 text-xs text-muted">{item.retailer_name}</span>
                          </span>
                        </span>
                        <span className="text-xs text-muted">#{item.id}</span>
                      </button>
                    ))}
                  {search.trim().length >= 2 && results.filter((item) => item.id !== productId).length === 0 && (
                    <p className="text-xs text-muted">Keine Treffer.</p>
                  )}
                  {search.trim().length < 2 && (
                    <p className="text-xs text-muted">Mindestens 2 Zeichen eingeben …</p>
                  )}
                </div>
              </div>
            )}

            {weeks.length > 0 && (
              <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <PriceStat label="Aktuell" value={currentPrice} hint={formatWeek(weeks[weeks.length - 1].week_start)} />
                <PriceStat label="Niedrigster" value={lowest} hint="über alle Wochen" highlight={lowest === currentPrice} />
                <PriceStat label="Höchster" value={highest} hint="über alle Wochen" />
                <PriceStat label="Ø Preis" value={average} hint="Wochendurchschnitt" />
              </section>
            )}

            <section className="surface mt-6 p-4 sm:p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">
                Preisentwicklung
              </h2>
              {chartData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">Noch keine Preispunkte.</p>
              ) : (
                <>
                  <div className="price-chart h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                            {/* Farben kommen aus styles.css (#priceFill), damit der Verlauf theme-fähig ist */}
                            <stop offset="0%" />
                            <stop offset="100%" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={48}
                          domain={["auto", "auto"]}
                          tickFormatter={(value) => `${value} €`}
                        />
                        <Tooltip content={<PriceTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="min_price"
                          name="Niedrigster Preis"
                          strokeWidth={2.5}
                          fill="url(#priceFill)"
                          dot={{ r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="avg_price"
                          name="Ø Preis"
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2 w-4 rounded-full bg-accent" /> Niedrigster Preis der Woche
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-0 w-4 border-t-2 border-dashed border-muted"
                      />{" "}
                      Wochendurchschnitt
                    </span>
                  </div>
                </>
              )}
            </section>

            <section className="surface mt-6 overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">
                  Alle Angebote
                </h2>
              </div>
              <div className="divide-y divide-line">
                {points.map((point) => {
                  const discount = discountPercent(point);
                  return (
                    <div
                      key={point.offer_id}
                      className="flex flex-col gap-2 px-4 py-3 transition hover:bg-ink/[.02] sm:flex-row sm:items-center sm:justify-between dark:hover:bg-white/[.03]"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: retailerColor(point.retailer_name) }}
                          />
                          {formatWeek(point.week_start)}
                          {discount !== null && (
                            <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-white">
                              −{discount}%
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">
                          {point.retailer_name} · gültig bis {formatDate(point.valid_to)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-base font-bold">{formatPrice(point.price)}</div>
                          {point.old_price && (
                            <div className="text-xs text-muted line-through">{formatPrice(point.old_price)}</div>
                          )}
                        </div>
                        {point.url && (
                          <a
                            href={point.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-muted transition hover:text-accent"
                          >
                            Prospekt
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn px-3 py-1.5 text-xs"
                          disabled={busy}
                          onClick={() => split(point.offer_id)}
                          title="Dieses Angebot in ein neues Produkt abtrennen"
                        >
                          <Scissors size={13} /> Abtrennen
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function PriceStat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number | null;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`surface px-4 py-3.5 ${highlight ? "border-accent/40" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${highlight ? "text-accenttext" : ""}`}>
        {formatPrice(value)}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
