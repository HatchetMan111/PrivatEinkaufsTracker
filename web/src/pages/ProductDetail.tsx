import { ArrowLeft, GitMerge, Scissors, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api, type History, type Product } from "../api";
import { TopBar } from "../components/TopBar";
import { formatDate, formatPrice, formatWeek } from "../format";

export function ProductDetail() {
  const { id } = useParams();
  const productId = Number(id);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    try {
      await api.merge(productId, [sourceId]);
      setNotice("Produkte zusammengeführt.");
      setMergeOpen(false);
      setSearch("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const split = async (offerId: number) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.split(productId, [offerId]);
      setNotice(`Angebot abgetrennt (neues Produkt #${result.new_product_id}).`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const product = history?.product;
  const weeks = history?.weeks ?? [];
  const chartData = weeks.map((week) => ({ ...week, label: week.week_start.slice(5) }));

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink dark:hover:text-white">
          <ArrowLeft size={15} /> Zurück zur Übersicht
        </Link>

        {error && (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="surface mt-6 h-64 animate-pulse" />
        ) : !product ? (
          <div className="surface mt-6 p-8 text-sm text-muted">Produkt nicht gefunden.</div>
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                  {product.retailer_name}
                </p>
                <h1 className="mt-1 font-display text-3xl tracking-tight">{product.canonical_name}</h1>
                <p className="mt-1 text-sm text-muted">
                  {product.brand ? `${product.brand} · ` : ""}
                  {weeks.length} {weeks.length === 1 ? "Woche" : "Wochen"} im Verlauf
                </p>
              </div>
              <button type="button" className="btn" onClick={() => setMergeOpen((value) => !value)}>
                <GitMerge size={15} /> Zusammenführen
              </button>
            </div>

            {notice && (
              <div className="mt-4 rounded-2xl border border-accent/30 bg-accentsoft px-4 py-3 text-sm text-accent dark:bg-accent/10 dark:text-[#bfe3d2]">
                {notice}
              </div>
            )}

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
                        className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 text-left text-sm transition hover:border-accent/40 hover:bg-accentsoft/50 dark:border-[#2a2926] dark:hover:bg-white/5"
                      >
                        <span>
                          <span className="font-medium">{item.canonical_name}</span>
                          <span className="ml-2 text-xs text-muted">{item.retailer_name}</span>
                        </span>
                        <span className="text-xs text-muted">#{item.id}</span>
                      </button>
                    ))}
                  {search.trim().length >= 2 && results.length === 0 && (
                    <p className="text-xs text-muted">Keine Treffer.</p>
                  )}
                </div>
              </div>
            )}

            <section className="surface mt-6 p-4 sm:p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted">
                Preisentwicklung
              </h2>
              {chartData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted">Noch keine Preispunkte.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,115,105,.18)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(value) => `${value} €`}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid #e7e2da",
                          fontSize: 12,
                        }}
                        formatter={(value) => formatPrice(Number(value))}
                        labelFormatter={(label) => `Woche ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="min_price"
                        stroke="#1f5f4a"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "#1f5f4a" }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="surface mt-6 overflow-hidden">
              <div className="border-b border-line px-4 py-3 dark:border-[#2a2926]">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">
                  Alle Angebote
                </h2>
              </div>
              <div className="divide-y divide-line dark:divide-[#2a2926]">
                {(history?.points ?? []).map((point) => (
                  <div key={point.offer_id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium">{formatWeek(point.week_start)}</div>
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
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
