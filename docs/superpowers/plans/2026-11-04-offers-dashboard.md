# PrivatEinkaufsTracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wochenangebote (Kaufland, Lidl, Baumärkte) für mehrere PLZ sammeln, im Dashboard vergleichen und Preisverläufe je Produkt zeigen – installierbar als Proxmox-LXC per Einzeiler.

**Architecture:** Ein Python-Paket enthält Collector (marktguru/kaufda-Adapter, Normalisierung, Matching) und FastAPI-API. SQLite speichert Orte, Angebote, Produkte und materialisierte Preispunkte. Eine React-SPA wird als statisches Build ausgeliefert; systemd-Timer startet den Collector montags.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, httpx, SQLite (stdlib), pytest, ruff; React 18, Vite, TypeScript, Tailwind 3, Recharts; Bash-Installer, systemd.

**Spec:** `docs/superpowers/specs/2026-11-04-offers-dashboard-design.md`

## Global Constraints

- Laufzeit ausschließlich lokal im LXC; keine Cloud, kein Docker.
- Keine Authentifizierung, LAN-only.
- Python >= 3.11, Node nur zum Bauen des Frontends, nicht im LXC.
- Zeitzone Europe/Berlin; Woche Montag 00:00 bis Sonntag 23:59.
- Quellen: marktguru-API (Keys zur Laufzeit aus HTML), kaufda `__NEXT_DATA__`.
- Keine Secrets im Repo; GitHub-Token nur beim Push.
- Frontend-Build liegt in `web/dist/` und wird mitgeliefert.

## Review Focus

- marktguru-Antwort ohne `validityDates` oder `product` darf nicht crashen (leere/defensive Felder).
- kaufda-Seite ohne `__NEXT_DATA__` oder ohne Händler-Link muss leer zurückgeben, nicht werfen.
- Gleiches Angebot in zwei Läufen derselben Woche darf nicht dupliziert werden (Upsert).
- Produkt-Merge muss nach dem nächsten Lauf erhalten bleiben (Alias).
- Fehlgeschlagene Quelle darf vorhandene Daten nicht löschen.

---

### Task 1: Grundgerüst, Konfiguration, DB-Schema

**Files:**
- Create: `pyproject.toml`, `app/offers_dashboard/__init__.py`, `app/offers_dashboard/config.py`, `app/offers_dashboard/week.py`, `app/offers_dashboard/db.py`, `migrations/001_init.sql`
- Test: `tests/conftest.py`, `tests/test_db.py`

**Interfaces:**
- Produces: `Settings(db_path)`, `connect(path)`, `migrate(conn)`, `week_start(dt, tz)`, `iso_week_start(date)`.

- [ ] Test: Temp-DB anlegen, `migrate`, Tabellen `offers`, `products`, `price_points` vorhanden.
- [ ] Implementierung: sqlite3 mit `row_factory`, `PRAGMA foreign_keys=ON`, WAL; Migrationen aus `migrations/*.sql` in `schema_version`.
- [ ] `pytest tests/test_db.py -v` grün, commit.

### Task 2: Normalisierung und Matching

**Files:**
- Create: `app/offers_dashboard/normalize.py`, `app/offers_dashboard/matching.py`
- Test: `tests/test_normalize.py`, `tests/test_matching.py`

**Interfaces:**
- `normalize_name(str) -> str`, `unit_key(unit, quantity) -> str`, `match_key(retailer_id, brand, name, unit_key) -> str`
- `assign_product(conn, offer_id, retailer_id, brand, title, unit, quantity) -> int`
- `merge_products(conn, target_id, source_ids) -> None`, `split_offers(conn, product_id, offer_ids) -> int`, `rebuild_price_points(conn) -> None`

- [ ] Tests für Umlaute, Mengenentfernung, Alias-Wiederverwendung, Merge-Erhalt.
- [ ] Implementierung, `pytest tests/test_normalize.py tests/test_matching.py -v`, commit.

### Task 3: marktguru-Adapter

**Files:**
- Create: `app/offers_dashboard/adapters/__init__.py`, `base.py`, `marktguru.py`
- Test: `tests/test_marktguru.py`, `tests/fixtures/marktguru_search.json`

**Interfaces:**
- `RawOffer` Dataclass (external_id, title, description, brand, category, price, old_price, base_price, unit, quantity, valid_from, valid_to, image_url, url, raw).
- `MarktguruAdapter(client=None).fetch(location, retailer) -> list[RawOffer]`

- [ ] Fixture mit zwei Treffern (ein Kaufland, ein Lidl) und Paginierung.
- [ ] Key-Extraktion aus HTML; Suche `q=<Händlername>`, `zipCode`, Filter `advertisers[].uniqueName`.
- [ ] Test mit `httpx.MockTransport`; commit.

### Task 4: kaufda-Adapter

**Files:**
- Create: `app/offers_dashboard/adapters/kaufda.py`
- Test: `tests/test_kaufda.py`, `tests/fixtures/kaufda_next.json`

**Interfaces:**
- `KaufdaAdapter(client=None).fetch(location, retailer) -> list[RawOffer]`; `location.kaufda_slug` optional.

- [ ] Test: Stadtseite mit Händler-Link → `__NEXT_DATA__` → Preis/Gültigkeit korrekt; fehlender Link → `[]`.
- [ ] Implementierung, commit.

### Task 5: Collector-CLI

**Files:**
- Create: `app/offers_dashboard/collect.py`
- Test: `tests/test_collect.py`

**Interfaces:**
- `run_collection(db_path, location_ids=None, trigger="timer") -> int` (run_id); CLI `offers-collect --all`.
- Seed der Händler beim ersten Start (`kaufland`, `lidl` → marktguru; `obi`, `bauhaus`, `toom`, `hornbach` → kaufda).

- [ ] Test mit Fake-Adaptern: Upsert idempotent, Status `ok`/`partial`.
- [ ] Implementierung, commit.

### Task 6: FastAPI

**Files:**
- Create: `app/offers_dashboard/api.py`
- Test: `tests/test_api.py`

**Interfaces:** Endpunkte laut Spec §10; `create_app(db_path=None)`; statisches Frontend aus `web/dist` mit SPA-Fallback.

- [ ] Tests: Orte CRUD, Offers current/previous, Stats, Merge.
- [ ] Implementierung, commit.

### Task 7: Frontend-Grundgerüst und Dashboard

**Files:**
- Create: `web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `tailwind.config.js`, `postcss.config.js`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/styles.css`, `src/components/*`, `src/pages/Dashboard.tsx`

- [ ] Scaffold, Tailwind, Router, API-Client.
- [ ] Dashboard: Header (Ort/Woche/Suche/Refresh), KPIs, Tabs, Chips, Karten-Grid, Leer-/Warnzustand.
- [ ] `npm run build` fehlerfrei, commit.

### Task 8: Produktdetail und Settings

**Files:**
- Create: `web/src/pages/ProductDetail.tsx`, `web/src/pages/Settings.tsx`

- [ ] Chart (Recharts), Wochen-Tabelle, Merge/Split-Aktionen.
- [ ] Settings: Orte anlegen/ändern, Händler, Läufe, Refresh.
- [ ] Build, commit.

### Task 9: systemd und Installer

**Files:**
- Create: `systemd/offers-dashboard.service`, `offers-dashboard-collect.service`, `offers-dashboard-collect.timer`, `install/offers-dashboard.sh`, `install/in-container.sh`, `install/update.sh`

- [ ] Host-Skript im Helper-Script-Stil (Farben, Flags, Template, LXC, `pct exec`).
- [ ] In-Container-Installation: venv, pip, Frontend, systemd, Health-Check.
- [ ] `shellcheck install/*.sh`, commit.

### Task 10: README, Endprüfung, Push

**Files:**
- Create: `README.md`

- [ ] README mit Einzeiler, Flags, Backup, Update, Rechtshinweis.
- [ ] `pytest`, `ruff check`, `npm run build`, `shellcheck`.
- [ ] Remote setzen und nach `main` pushen (Token nur zur Laufzeit).
