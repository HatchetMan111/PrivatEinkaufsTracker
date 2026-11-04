import { MapPin, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api, type Location, type Retailer, type Run } from "../api";
import { TopBar } from "../components/TopBar";
import { formatDate } from "../format";

export function Settings() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [slug, setSlug] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [locationList, retailerList, runList] = await Promise.all([
        api.locations(),
        api.retailers(),
        api.runs(),
      ]);
      setLocations(locationList);
      setRetailers(retailerList);
      setRuns(runList);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setName("");
    setZip("");
    setSlug("");
    setEditingId(null);
  };

  const startEdit = (location: Location) => {
    setName(location.name);
    setZip(location.zip);
    setSlug(location.kaufda_slug ?? "");
    setEditingId(location.id);
  };

  const saveLocation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || zip.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        zip: zip.trim(),
        kaufda_slug: slug.trim() || null,
      };
      if (editingId === null) {
        await api.createLocation(payload);
      } else {
        await api.updateLocation(editingId, payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: number) => {
    if (!window.confirm("Ort deaktivieren? Er wird beim nächsten Lauf nicht mehr abgefragt.")) return;
    setBusy(true);
    try {
      await api.deleteLocation(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRetailer = async (retailer: Retailer) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateRetailer(retailer.id, retailer.active !== 1);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.refresh();
      window.setTimeout(() => {
        void load();
        setRefreshing(false);
      }, 6000);
    } catch (err) {
      setError((err as Error).message);
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight">Einstellungen</h1>
        <p className="mt-1 text-sm text-muted">
          Orte, Händler und Sammel-Läufe verwalten. Änderungen gelten ab dem nächsten Lauf.
        </p>

        {error && (
          <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <section className="surface mt-6 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Orte</h2>
            <span className="text-xs text-muted">{locations.filter((item) => item.active).length} aktiv</span>
          </div>

          <div className="mt-4 divide-y divide-line dark:divide-[#2a2926]">
            {locations.map((location) => (
              <div key={location.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accentsoft text-accent dark:bg-accent/20">
                    <MapPin size={15} />
                  </span>
                  <div>
                    <div className={`text-sm font-medium ${location.active ? "" : "text-muted line-through"}`}>
                      {location.name} ({location.zip})
                    </div>
                    <div className="text-xs text-muted">
                      kaufda: {location.kaufda_slug ?? "automatisch aus PLZ"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn px-3 py-1.5 text-xs"
                    onClick={() => startEdit(location)}
                  >
                    <Pencil size={13} /> Bearbeiten
                  </button>
                  {location.active === 1 ? (
                    <button
                      type="button"
                      className="btn px-3 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => deactivate(location.id)}
                    >
                      <Trash2 size={13} /> Deaktivieren
                    </button>
                  ) : (
                    <span className="px-2 text-xs text-muted">inaktiv</span>
                  )}
                </div>
              </div>
            ))}
            {locations.length === 0 && <p className="py-3 text-sm text-muted">Noch kein Ort angelegt.</p>}
          </div>

          <form onSubmit={saveLocation} className="mt-6 grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto]">
            <div>
              <label className="label" htmlFor="location-name">Name</label>
              <input
                id="location-name"
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="z. B. Zuhause"
              />
            </div>
            <div>
              <label className="label" htmlFor="location-zip">PLZ</label>
              <input
                id="location-zip"
                className="field"
                value={zip}
                onChange={(event) => setZip(event.target.value)}
                placeholder="91541"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="label" htmlFor="location-slug">kaufda-Slug (optional)</label>
              <input
                id="location-slug"
                className="field"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="Rothenburg-ob-der-Tauber"
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {editingId === null ? <Plus size={15} /> : <Pencil size={15} />}
                {editingId === null ? "Hinzufügen" : "Speichern"}
              </button>
              {editingId !== null && (
                <button type="button" className="btn px-3" onClick={resetForm}>
                  <X size={15} />
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="surface mt-6 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Händler</h2>
            <span className="text-xs text-muted">{retailers.filter((item) => item.active).length} aktiv</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {retailers.map((retailer) => (
              <div
                key={retailer.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm dark:border-[#2a2926]"
              >
                <div>
                  <div className={`font-medium ${retailer.active ? "" : "text-muted line-through"}`}>
                    {retailer.name}
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {retailer.source}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn px-2.5 py-1 text-xs"
                  disabled={busy}
                  onClick={() => toggleRetailer(retailer)}
                >
                  {retailer.active ? "Deaktivieren" : "Aktivieren"}
                </button>
              </div>
            ))}
            {retailers.length === 0 && <p className="text-sm text-muted">Keine Händler konfiguriert.</p>}
          </div>
        </section>

        <section className="surface mt-6 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 dark:border-[#2a2926] sm:px-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Sammel-Läufe</h2>
            <button type="button" className="btn px-3 py-1.5 text-xs" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Läuft …" : "Jetzt starten"}
            </button>
          </div>
          <div className="divide-y divide-line dark:divide-[#2a2926]">
            {runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                <div>
                  <div className="text-sm font-medium">
                    #{run.id} · {formatDate(run.started_at)}
                  </div>
                  <div className="text-xs text-muted">
                    {run.trigger} · {run.items_found} Angebote
                    {run.error ? ` · ${run.error}` : ""}
                  </div>
                </div>
                <StatusBadge status={run.status} />
              </div>
            ))}
            {runs.length === 0 && <p className="px-4 py-3 text-sm text-muted sm:px-6">Noch keine Läufe.</p>}
          </div>
        </section>

        <section className="surface mt-6 p-4 text-sm text-muted sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">Zeitplan</h2>
          <p className="mt-2">
            Der Sammel-Lauf startet automatisch jeden Montag um 06:00 Uhr (Europe/Berlin) über einen
            systemd-Timer. Ein manueller Lauf ist jederzeit über „Aktualisieren“ möglich.
          </p>
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: Run["status"] }) {
  const styles: Record<Run["status"], string> = {
    running: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
    ok: "bg-accentsoft text-accent dark:bg-accent/20 dark:text-[#bfe3d2]",
    partial: "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    failed: "bg-danger/10 text-danger",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}
