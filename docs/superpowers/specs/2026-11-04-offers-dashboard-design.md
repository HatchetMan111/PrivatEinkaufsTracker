# Angebots-Dashboard auf Proxmox (LXC) – Design Spec

Datum: 2026-11-04
Status: Entwurf zur Review

## 1. Ziel

Ein selbst gehostetes Dashboard im Heimnetz, das wöchentlich (montags) die
aktuellen Wochenangebote von Kaufland, Lidl und Baumärkten (OBI, Bauhaus,
toom, Hornbach) für mehrere konfigurierbare Orte/PLZ einsammelt und
darstellt:

- aktuelle Woche und Vorwoche im Vergleich
- langfristige Preisentwicklung je Produkt als Chart
- moderne, helle, editoriale Oberfläche im Karten-Grid
- Installation auf einem Proxmox-Host per Einzeiler im Stil der
  Proxmox-VE-Community-Scripts
- kein Docker, kein Cloud-Dienst, keine Anmeldung (nur LAN)

## 2. Nicht-Ziele (YAGNI)

- Benutzerkonten, Rollen, Mehrbenutzerbetrieb
- Push-/Mail-Benachrichtigungen oder Preisalarme
- Öffentliches Hosting oder Weitergabe der Daten
- Händler außerhalb Deutschlands
- Native Mobile-App
- Vollständigkeit aller Händler/Artikel (Datenquelle bleibt Näherung)
- Automatische Kauf- oder Bestellfunktionen

## 3. Nutzer und Kernfälle

Eine Privatperson im Heimnetz (Betreiber = Nutzer).

1. Montagmorgens sind die neuen Angebote da; ein Blick aufs Dashboard zeigt
   sie und den Vergleich zur Vorwoche.
2. Produkt suchen, z. B. „Bohrmaschine“, und sehen, wo es diese Woche wie
   viel kostet.
3. Ein Produkt öffnen und den Preisverlauf der letzten Wochen/Monate sehen.
4. Zwei Produkteinträge, die dasselbe Produkt sind, zusammenführen, damit der
   Verlauf sauber bleibt.
5. Einen weiteren Ort (PLZ) hinzufügen und zwischen Orten wechseln.
6. Einen Lauf manuell anstoßen, wenn Daten fehlen.

## 4. Architektur

Ein LXC, ein Anwendungsdienst, eine Datenbank.

```
systemd timer (Mo 06:00)
        │
        ▼
collector (Python, oneshot)  ──►  SQLite (/var/lib/offers-dashboard/offers.db)
        │                                   │
        │  Quellen: marktguru, kaufda       │
        ▼                                   ▼
   runs-Protokoll                    FastAPI (uvicorn, :8000)
                                            │
                                            ▼
                              React-SPA (statisches Build, von FastAPI ausgeliefert)
```

- Frontend wird als fertiges Build mitgeliefert; auf dem LXC ist kein Node
  nötig.
- Collector und API teilen sich Code (Normalisierung, Matching) in einem
  Python-Paket.
- Standardressourcen: 1 vCPU, 1024 MB RAM, 512 MB Swap, 4 GB Disk,
  unprivilegiert, `nesting=1`, `onboot=1`, Debian 12.

## 5. Technologie-Stack

| Schicht | Wahl | Begründung |
|---|---|---|
| Sprache Backend | Python 3.11+ | beste Scraping-/Parsing-Bibliotheken |
| HTTP-Client | httpx | Timeouts, Retries, async-fähig |
| API | FastAPI + uvicorn | schlank, OpenAPI, einfache Tests |
| DB | SQLite (WAL) | kein zusätzlicher Dienst, ein Dateibackup |
| Scheduler | systemd timer | robust, kein Cron-Daemon |
| Frontend | React + Vite + TypeScript | Standard für moderne SPAs |
| UI | Tailwind CSS + shadcn/ui | editorialer, cleaner Look ohne Bastel-CSS |
| Charts | Recharts | Preisverlauf, responsiv |
| Tests | pytest, httpx TestClient, shellcheck | Backend + Installer |
| Lint | ruff, eslint | konsistente Qualität |

## 6. Datenmodell

SQLite, Migrationen über nummerierte SQL-Dateien (`migrations/001_init.sql` …)
und eine `schema_version`-Tabelle.

### 6.1 locations
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | z. B. „Rothenburg ob der Tauber“ |
| zip | TEXT | z. B. „91541“ |
| kaufda_slug | TEXT | z. B. „Rothenburg-ob-der-Tauber“, optional |
| active | INTEGER | 1/0 |
| created_at | TEXT | ISO-8601 |

### 6.2 retailers
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | Anzeigename |
| slug | TEXT UNIQUE | z. B. „kaufland“, „lidl“, „obi“, „bauhaus“, „toom“, „hornbach“ |
| source | TEXT | `marktguru` oder `kaufda` |
| active | INTEGER | 1/0 |

### 6.3 stores (optional, für Filialinfos)
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| retailer_id | INTEGER FK | |
| location_id | INTEGER FK | |
| name | TEXT | |
| address | TEXT | |
| external_id | TEXT | |

### 6.4 runs
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| started_at / finished_at | TEXT | ISO-8601 |
| status | TEXT | `running`, `ok`, `partial`, `failed` |
| trigger | TEXT | `timer`, `manual` |
| items_found | INTEGER | |
| error | TEXT | kurze Fehlermeldung, kein Stacktrace |

### 6.5 offers
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| run_id | INTEGER FK | |
| location_id | INTEGER FK | |
| retailer_id | INTEGER FK | |
| source | TEXT | |
| external_id | TEXT | ID der Quelle |
| title | TEXT | Produkt-/Angebotstitel |
| description | TEXT | |
| brand | TEXT | |
| category | TEXT | |
| price | REAL | |
| old_price | REAL | nullable |
| base_price | TEXT | z. B. „1 l = 2,19 €“ |
| unit | TEXT | z. B. „l“, „kg“, „Stk.“ |
| quantity | REAL | |
| valid_from / valid_to | TEXT | ISO-8601 |
| week_start | TEXT | Montag der Gültigkeitswoche, ISO-Datum |
| image_url | TEXT | |
| url | TEXT | Link zum Angebot/Prospekt |
| raw_json | TEXT | Originaldatensatz für Nachvollziehbarkeit |
| fetched_at | TEXT | |

Eindeutigkeit: `UNIQUE(source, external_id, location_id, week_start)`.
Ein erneuter Lauf in derselben Woche aktualisiert den Datensatz (Upsert)
statt zu duplizieren.

### 6.6 products
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| retailer_id | INTEGER FK | Produkte werden je Händler gruppiert |
| canonical_name | TEXT | Anzeigename |
| brand | TEXT | |
| category | TEXT | |
| unit_key | TEXT | normalisierte Einheit |
| match_key | TEXT UNIQUE | Hash aus Händler + Marke + Name + Einheit |
| created_at | TEXT | |

### 6.7 product_links
| Spalte | Typ | Anmerkung |
|---|---|---|
| offer_id | INTEGER PK/FK | 1:1 zu offers |
| product_id | INTEGER FK | |
| method | TEXT | `alias`, `exact`, `manual` |
| confidence | REAL | 0.0–1.0 |

### 6.8 product_aliases
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| product_id | INTEGER FK | |
| retailer_id | INTEGER FK | |
| normalized_name | TEXT | |
| created_at | TEXT | |

Aliase sorgen dafür, dass ein manuell bestätigter Merge in folgenden Wochen
automatisch wieder greift.

### 6.9 price_points (materialisiert)
| Spalte | Typ | Anmerkung |
|---|---|---|
| id | INTEGER PK | |
| product_id | INTEGER FK | |
| offer_id | INTEGER FK UNIQUE | |
| price | REAL | |
| week_start | TEXT | |
| observed_at | TEXT | |

Wird nach jedem Lauf und nach jedem Merge/Split vollständig neu aufgebaut
(`DELETE` + `INSERT … SELECT`). Das Chart nutzt je Woche den Minimalpreis.

### 6.10 settings
Key-Value-Tabelle für UI-Einstellungen (z. B. Standardort, Anzeigeoptionen).

## 7. Collector

### 7.1 Schnittstelle

```python
class SourceAdapter(Protocol):
    name: str
    def fetch(self, location: Location, retailer: Retailer) -> list[RawOffer]: ...
```

Jeder Adapter liefert normalisierte `RawOffer`-Objekte. Fehler eines
Adapters/einer Kombination werden protokolliert und beenden den Gesamtlauf
nicht (Status `partial`).

### 7.2 marktguru-Adapter

- Keys (`apiKey`, `clientKey`) zur Laufzeit aus `https://www.marktguru.de/`
  lesen, im Speicher cachen; nicht hart kodieren.
- Suche: `GET https://api.marktguru.de/api/v1/offers/search` mit
  `as=web`, `limit=100`, `offset`, `q=<Händlername>`, `zipCode=<PLZ>`.
- Ergebnisse clientseitig auf `advertisers[].uniqueName == retailer.slug`
  filtern.
- Paginieren, bis `offset >= totalResults` oder eine leere Seite kommt.
- Übernehmen: `product.name`, `description`, `price`, `oldPrice`,
  `referencePrice`/`unit`, `advertisers`, `categories`, `validityDates`,
  `images.urls.medium`, `externalUrl`.
- `week_start` aus `validityDates[0].from` (Montag der Woche, Europe/Berlin).

Bekannte Einschränkung: Ein reiner Händler-Filter ist über die beobachtete
API nicht verfügbar; die Suche nach dem Händlernamen ist der erprobte Weg.
Schlägt sie fehl, wird der Lauf als `partial` markiert und im UI angezeigt.

### 7.3 kaufda-Adapter (Fallback, v. a. Baumärkte)

- Stadtseite `https://www.kaufda.de/<kaufda_slug>` laden.
- Dort den lokalen Händler-Link `/…/<Händler>/p-r<ID>` bzw. die Filialseite
  `/Filialen/…/v-f<ID>` ermitteln.
- `<script id="__NEXT_DATA__" type="application/json">` parsen und
  `props.pageProps.pageInformation.offers.main.items[]` auslesen.
- Preis aus `prices.mainPrice` / `mainPriceFormatted`, Streichpreis aus
  `prices.secondaryPrice`, Gültigkeit aus den Angebotsfeldern.
- Fehlt `__NEXT_DATA__`, einmaliger Fallback auf JSON-LD; sonst Fehler
  protokollieren.

### 7.4 Laufverhalten

- Ein Lauf = alle aktiven Orte × aktive Händler.
- Rate Limit: max. 1 Request/Sekunde pro Quelle, Timeout 20 s,
  3 Versuche mit exponentiellem Backoff.
- Aussagekräftiger User-Agent mit Kontakt-Hinweis.
- Pro Quelle/Händler wird ein Teilstatus gespeichert; am Ende `ok`, wenn
  mindestens ein Ergebnis und keine Fehler, sonst `partial`/`failed`.

## 8. Produkt-Matching

### 8.1 Normalisierung

1. Unicode NFKC, Kleinschreibung, Trimmen.
2. Umlaute für den Vergleich vereinheitlichen (ä→ae, ö→oe, ü→ue, ß→ss).
3. Satzzeichen und Mehrfach-Leerzeichen entfernen.
4. Mengen-/Packungsangaben entfernen, u. a. Muster wie
   `je 250-g-packg.`, `12 x 330 ml`, `20 x 220 blatt`, `1-kg-stueck`.
5. Ergebnis: `normalized_name`; Einheit separat als `unit_key`.

### 8.2 Zuordnung

1. `product_aliases` prüfen (Händler + normalisierter Name) → Treffer.
2. Sonst `match_key = sha1(retailer_id | brand_norm | name_norm | unit_key)`.
3. Existiert ein Produkt mit diesem Key → verlinken (`method=exact`).
4. Sonst neues Produkt anlegen (`method=exact`, confidence 1.0 bei
   vollständigem Schlüssel, sonst 0.7).

### 8.3 Manuelles Merge/Split

- Merge: mehrere Quellprodukte auf ein Zielprodukt; alle `product_links`
  werden umgehängt, Aliase für die Quellnamen gespeichert, `price_points`
  neu berechnet.
- Split: einzelne Angebote aus einem Produkt lösen und einem neuen Produkt
  zuordnen.
- Beide Aktionen sind idempotent und werden in `runs` nicht als Lauf
  protokolliert, aber mit `created_at` in den Aliassen nachvollziehbar.

## 9. Scheduler

- `offers-dashboard-collect.timer`:
  `OnCalendar=Mon 06:00`, `Persistent=true`, `RandomizedDelaySec=15m`.
- Startet `offers-dashboard-collect.service` (Type=oneshot), das
  `python -m offers_dashboard.collect --all` ausführt.
- Zeitzone Europe/Berlin.
- Überschreibbar über `SCHEDULE_CALENDAR` in
  `/etc/offers-dashboard/config.env` (Installer schreibt Drop-in und lädt
  systemd neu). Das UI zeigt den Zeitplan zunächst nur lesend an.
- Manueller Lauf: `POST /api/refresh` startet denselben Code als
  Hintergrundtask und liefert eine `run_id`.

## 10. HTTP-API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Liveness + DB-Status |
| GET | `/api/locations` | Orte |
| POST | `/api/locations` | Ort anlegen |
| PUT | `/api/locations/{id}` | Ort ändern |
| DELETE | `/api/locations/{id}` | Ort deaktivieren |
| GET | `/api/retailers` | Händler |
| GET | `/api/offers` | Filter: `location_id`, `week=current\|previous\|YYYY-Www`, `retailer`, `category`, `q` |
| GET | `/api/offers/{id}` | Detail |
| GET | `/api/stats` | KPIs je Woche/Ort |
| GET | `/api/products` | Suche/Liste |
| GET | `/api/products/{id}/history` | Preisverlauf + Wochenaggregat |
| POST | `/api/products/{id}/merge` | Body: `{ "source_product_ids": [..] }` |
| POST | `/api/products/{id}/split` | Body: `{ "offer_ids": [..] }` |
| POST | `/api/refresh` | manueller Lauf |
| GET | `/api/runs` | letzte Läufe inkl. Status |

Alle Antworten JSON, Fehler als `{ "error": "...", "detail": "..." }` mit
passendem HTTP-Status. Keine Authentifizierung (LAN-only), aber CORS auf
Same-Origin beschränkt.

Wochendefinition: Montag 00:00 bis Sonntag 23:59 Europe/Berlin.
`week=current` ist die Woche, in der „heute“ liegt; `week=previous` die
Woche davor; `YYYY-Www` eine explizite ISO-Kalenderwoche. Maßgeblich ist
`offers.week_start`.

## 11. Oberfläche

Design: clean/editorial, hell, viel Weißraum, Karten-Grid, dezente Farben;
Dark Mode als Umschalter. Responsive ab 360 px.

### 11.1 Routen

- `/` – Dashboard
- `/products/:id` – Produktdetail mit Verlauf
- `/settings` – Orte, Händler, Zeitplan (lesend), Datenstand

### 11.2 Dashboard

- Sticky Header: Ort-Switcher, Wochen-Selector, Suche, Refresh-Button,
  Theme-Umschalter.
- KPI-Zeile: Anzahl Angebote, größte Rabatte, neue Produkte dieser Woche.
- Tabs „Diese Woche“ / „Vorwoche“.
- Kategorie-Chips als Filter.
- Karten-Grid: Produktbild, Titel, Preis, Streichpreis, Rabatt-Badge,
  Händler, gültig bis, Link zum Prospekt.
- Leerzustand: Hinweis, wenn für die Woche noch keine Daten vorliegen, mit
  Button „Jetzt aktualisieren“.
- Warnbanner, wenn der letzte erfolgreiche Lauf älter als 8 Tage ist oder
  `partial`/`failed`.

### 11.3 Produktdetail

- Kopf: Name, Marke, Händler, aktueller Preis.
- Chart: Preis je Woche (Minimalpreis), Tooltip mit Datum und Preis.
- Tabelle: alle Angebote mit Woche, Preis, Streichpreis, Gültigkeit, Link.
- Aktionen: „Mit anderem Produkt zusammenführen“, „Angebot abtrennen“.

### 11.4 Settings

- Orte anlegen/ändern/deaktivieren (Name, PLZ, kaufda-Slug optional).
- Händler aktivieren/deaktivieren.
- Zeitplan und letzte Läufe (lesend), Log-Verweis.
- Erststart-Assistent: ersten Ort anlegen und Lauf starten.

## 12. Installation (Proxmox-Helper-Script-Stil)

Ein Skript, das auf dem Proxmox-Host als root läuft, den LXC erstellt und
die App darin installiert. Aufbau wie in den bestehenden Projekten
(`apprise-proxmox`, `BIMCraft-Proxmox`): Farben, `[INFO]/[OK]/[WARN]`,
`set -euo pipefail`, `trap ERR`, Log unter `/tmp/`.

### 12.1 Dateien

```
offers-dashboard-proxmox/
  install/offers-dashboard.sh     # Host-Skript: LXC + Installation
  install/update.sh               # Update im bestehenden LXC
  systemd/offers-dashboard.service
  systemd/offers-dashboard-collect.service
  systemd/offers-dashboard-collect.timer
  app/                            # Python-Paket (collector + api)
  web/                            # React-Projekt
  web/dist/                       # gebautes Frontend (mitgeliefert)
  migrations/
  tests/
  README.md
```

### 12.2 Einzeiler

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/OffersDashboardProxmox/main/install/offers-dashboard.sh)"
```

### 12.3 Flags / Umgebungsvariablen

`CTID`, `CORES` (Default 1), `RAM` (Default 1024), `DISK` (Default 4),
`BRIDGE` (Default `vmbr0`), `STORAGE`, `TEMPLATE_STORE` (Default `local`),
`--hostname`, `--password`, `--ssh-key`, `--port` (Default 8000), `--debug`.

### 12.4 Ablauf

1. Host prüfen (`pct`, `pvesh`), nächste freie CT-ID bestimmen.
2. RootFS-Storage erkennen, `debian-12-standard`-Template sicherstellen.
3. LXC erstellen (unprivilegiert, `nesting=1`, `onboot=1`), starten,
   auf Netz warten, IP ermitteln.
4. Im Container: `python3`, `python3-venv`, `git`, `curl`, `sqlite3`
   installieren; Systemuser `offers`; Repo klonen; venv; Abhängigkeiten;
   Frontend aus `web/dist` nach `/opt/offers-dashboard/web` kopieren;
   DB-Verzeichnis `/var/lib/offers-dashboard` anlegen.
5. systemd-Units schreiben, `daemon-reload`, Service und Timer aktivieren.
6. Health-Check (`/api/health`), Timer-Status prüfen, URL ausgeben.

Idempotent: existiert die CT-ID, wird die Installation aktualisiert statt
neu erstellt.

### 12.5 Update

`install/update.sh` (im Container oder per `pct exec` vom Host) holt den
neuesten Stand, aktualisiert Abhängigkeiten und das Frontend, führt
Migrationen aus und startet den Dienst neu.

## 13. Konfiguration

`/etc/offers-dashboard/config.env`:

```
OFFERS_DB=/var/lib/offers-dashboard/offers.db
OFFERS_PORT=8000
OFFERS_TZ=Europe/Berlin
SCHEDULE_CALENDAR=Mon 06:00
KAUFDA_USER_AGENT=offers-dashboard/1.0 (privater Eigenbedarf)
```

Orte und Händler liegen in der DB und werden über die UI verwaltet.

## 14. Fehlerbehandlung und Betrieb

- Jeder Lauf schreibt einen `runs`-Eintrag; UI zeigt Status und Datenstand.
- Adapterfehler werden pro Quelle/Händler isoliert; der Rest läuft weiter.
- Kein Absturz bei fehlendem `__NEXT_DATA__` oder geänderten API-Feldern –
  klare Fehlermeldung, `partial`, letzter guter Stand bleibt sichtbar.
- Logs nach journald (`journalctl -u offers-dashboard*`).
- Backup: einfach `offers.db` (+ WAL) kopieren; dokumentiert im README.
- Datenaufbewahrung: unbegrenzt, solange die DB klein bleibt (Hochrechnung:
  wenige tausend Zeilen pro Woche).

## 15. Tests

- Unit: Normalisierung, `match_key`, Aliase, Merge/Split-Logik.
- Parser: gespeicherte Fixtures von marktguru-Antworten und
  kaufda-`__NEXT_DATA__`-Ausschnitten.
- API: FastAPI TestClient gegen temporäre SQLite.
- Installer: `shellcheck`, Trockenlauf-Prüfung der Argumente.
- Smoke-Test nach Installation: Health-Endpoint, leere DB, erster Ort per API.
- Kein Live-Scraping in CI.

## 16. Risiken und Gegenmaßnahmen

| Risiko | Auswirkung | Maßnahme |
|---|---|---|
| marktguru-Keys ändern sich | Collector scheitert | Laufzeit-Extraktion, klare Fehlermeldung, `partial` |
| API-Felder ändern sich | Parser bricht | Fixtures + defensive Feldzugriffe + Logging |
| kaufda-Slugs variieren | Ort nicht auflösbar | Slug im UI editierbar, automatische Suche als Fallback |
| Baumärkte fehlen bei marktguru | keine Baumarkt-Angebote | kaufda-Adapter als primäre Baumarkt-Quelle |
| Matching falsch | verfälschte Charts | Merge/Split-UI, Confidence-Anzeige |
| Rechtliche Nutzung | Datenquelle untersagt Nutzung | nur privates LAN, keine Weitergabe, keine öffentliche Preisliste |
| Speicher/CPU im LXC | träge UI | SQLite-Indizes, statisches Frontend, 1 vCPU reicht |

Hinweis: marktguru bittet in `llms.txt` darum, keine konkreten Preise
öffentlich zu zitieren. Das Dashboard ist ausschließlich privat; eine
Veröffentlichung der Daten ist nicht vorgesehen.

## 17. Phasen

### Phase 1 – MVP
- Installer + systemd-Units + Update-Script
- SQLite-Schema und Migrationen
- marktguru-Adapter
- API: Orte, Angebote, Stats, Refresh, Runs
- Dashboard mit aktueller Woche und Vorwoche, Ort-Switcher, Suche, KPIs
- Erststart-Assistent

### Phase 2 – Historie
- `price_points`, Produktdetail mit Chart
- Produktliste und Suche
- Merge/Split-UI inkl. Alias-Persistenz

### Phase 3 – Baumärkte und Feinschliff
- kaufda-Adapter (OBI, Bauhaus, toom, Hornbach)
- Settings-Seite, Dark Mode
- Warnbanner, Retry-Feinheiten, Dokumentation

## 18. Abnahmekriterien

1. Einzeiler installiert auf einem Proxmox-Host einen laufenden LXC; die
   Dashboard-URL ist erreichbar.
2. Ein manueller Lauf für Rothenburg (91541) liefert Kaufland- und
   Lidl-Angebote mit Preis, Gültigkeit und Link.
3. Das Dashboard zeigt „Diese Woche“ und „Vorwoche“ getrennt.
4. Nach mindestens zwei Läufen zeigt ein Produkt einen Preisverlauf.
5. Ein Merge im UI verändert den Chart und bleibt nach dem nächsten Lauf
   erhalten.
6. Der Timer ist aktiv und auf Montag 06:00 Europe/Berlin gesetzt.
7. Ein fehlgeschlagener Lauf führt zu einem sichtbaren Warnbanner, ohne
   die vorhandenen Daten zu verlieren.
8. `pytest`, `ruff`, `shellcheck` und der Frontend-Build laufen fehlerfrei.

## 19. Annahmen

- Proxmox VE 8.x, Debian-12-Template verfügbar oder herunterladbar.
- Der LXC hat Internetzugang (für Quellen und Installation).
- Der Host erreicht die Quellen ohne Proxy.
- Orte werden über PLZ und optionalen kaufda-Slug gepflegt.
- Preise sind EUR; Zeitzone Europe/Berlin.
- Das Frontend-Build wird im Repo mitgeliefert, damit der LXC kein Node
  benötigt.
