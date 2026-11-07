# PrivatEinkaufsTracker

Privates Dashboard für Wochenangebote auf Proxmox: sammelt montags Angebote von
Kaufland, Lidl und Baumärkten, zeigt die aktuelle Woche im Vergleich zur
Vorwoche und speichert Preisverläufe je Produkt.

- **Ein LXC, ein Dienst, eine SQLite-Datei** – kein Docker, kein Cloud-Konto,
  kein Login.
- **Quellen:** marktguru (Kaufland, Lidl) und kaufda (OBI, BAUHAUS, toom,
  HORNBACH) – öffentliche Prospekt- und Angebotsdaten.
- **Frontend** wird als fertiger Build mitgeliefert; im LXC ist kein Node nötig.
- **Sammel-Lauf** automatisch montags 06:00 Europe/Berlin per systemd-Timer,
  zusätzlich manuell über die Oberfläche.

> Nur für den privaten Eigenbedarf. Die Quellen können sich ändern; Preise und
> Verfügbarkeiten sind ohne Gewähr.

## Installation (Proxmox-Host)

Auf dem Proxmox-Host als root:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/PrivatEinkaufsTracker/main/install/offers-dashboard.sh)"
```

Das Skript ist idempotent: existiert die CT-ID bereits, wird die Installation
aktualisiert statt neu erstellt.

Optionen (auch als Umgebungsvariablen `CT_ID`, `CORES`, `RAM`, `DISK`,
`BRIDGE`, `PORT`):

```bash
bash offers-dashboard.sh \
  --ctid 150 --hostname einkaufstracker \
  --cores 1 --memory 1024 --disk 4 \
  --bridge vmbr0 --port 8000 \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --debug
```

| Flag | Default | Bedeutung |
|---|---|---|
| `--ctid` | nächste freie ID | Container-ID |
| `--hostname` | `PrivateEinkaufsTracker` | Hostname im LXC |
| `--cores` | `1` | vCPU |
| `--memory` | `1024` | RAM in MB |
| `--disk` | `4` | Disk in GB |
| `--storage` | auto (`local-lvm`) | RootFS-Storage |
| `--template-store` | `local` | Storage für LXC-Templates |
| `--bridge` | `vmbr0` | Netzwerk-Bridge |
| `--port` | `8000` | HTTP-Port der App |
| `--password` | zufällig | Root-Passwort des Containers |
| `--ssh-key` | – | Public Key für root im Container |

Der Container läuft unprivilegiert mit `nesting=1` und `onboot=1`.
Das Repository muss für den Container öffentlich erreichbar sein; bei einem
privaten Repo vorher manuell klonen und `install/update.sh` im Container nutzen.

### Nach der Installation

1. `http://<CT-IP>:8000` öffnen.
2. Unter **Einstellungen → Orte** den ersten Ort anlegen (Name + PLZ,
   optional kaufda-Slug, z. B. `Rothenburg-ob-der-Tauber`).
3. **Aktualisieren** klicken – der erste Lauf füllt die Datenbank.
4. Fertig. Ab dem nächsten Montag läuft die Sammlung automatisch.

## Bedienung

- **Übersicht:** Ort und Woche wählen, suchen, nach Markt und Kategorie filtern und nach besten Rabatten, Ersparnis oder Preis sortieren.
  Karten zeigen Preis, Streichpreis, Rabatt, Händler und Gültigkeit.
- **Produktdetail:** Preisentwicklung als Chart, alle Angebote der Wochen,
  Aktionen **Zusammenführen** und **Abtrennen**, um die automatische
  Produkterkennung zu korrigieren.
- **Einstellungen:** Orte anlegen/deaktivieren, Händler und letzte Läufe
  einsehen, manuellen Lauf starten.

## Betrieb

```bash
# Status
pct exec 150 -- systemctl status offers-dashboard
pct exec 150 -- systemctl list-timers offers-dashboard-collect.timer

# Manueller Lauf
pct exec 150 -- systemctl start offers-dashboard-collect.service
pct exec 150 -- journalctl -u offers-dashboard-collect -f

# Logs
pct exec 150 -- journalctl -u offers-dashboard -n 100

# Update (git pull, Abhängigkeiten, Migrationen, Neustart)
pct exec 150 -- offers-dashboard-update

# Backup (konsistent trotz WAL)
pct exec 150 -- sqlite3 /var/lib/offers-dashboard/offers.db \
  ".backup /root/offers-$(date +%F).db"
pct pull 150 /root/offers-$(date +%F).db ./offers-backup.db

# Deinstallation
pct stop 150 && pct destroy 150
```

### Konfiguration

`/etc/offers-dashboard/config.env`:

```ini
OFFERS_DB=/var/lib/offers-dashboard/offers.db
OFFERS_PORT=8000
OFFERS_TZ=Europe/Berlin
SCHEDULE_CALENDAR=Mon *-*-* 06:00:00 Europe/Berlin
# OFFERS_USER_AGENT=Mozilla/5.0 (optional, Standard ist ein Browser-UA)
```

Nach Änderung von `SCHEDULE_CALENDAR` oder `OFFERS_PORT`:

```bash
pct exec 150 -- offers-dashboard-update
```

Der Timer nutzt einen systemd-Drop-in
(`/etc/systemd/system/offers-dashboard-collect.timer.d/schedule.conf`), damit
`SCHEDULE_CALENDAR` wirkt.

### Sicherheit

- Es gibt **keine Authentifizierung**. Die App gehört ins LAN, nicht ins
  Internet. Kein Port-Forwarding, keine öffentliche Reverse-Proxy-Freigabe.
- Der Dienst läuft als Systemuser `offers` mit `ProtectSystem=strict`,
  `PrivateTmp` und `NoNewPrivileges`.
- Datenbank und Konfiguration liegen unter `/var/lib/offers-dashboard` bzw.
  `/etc/offers-dashboard`.

## Entwicklung

Voraussetzungen: Python 3.11+, Node 20+ (nur zum Bauen des Frontends).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# Tests + Lint
.venv/bin/pytest -q
.venv/bin/ruff check .

# Backend lokal starten (Port 8000)
OFFERS_DB=/tmp/offers.db PYTHONPATH=app \
  .venv/bin/python -m uvicorn offers_dashboard.api:app --reload

# Frontend im Dev-Modus (Proxy auf :8000)
cd web
npm install
npm run dev

# Produktions-Build erzeugen (muss eingecheckt werden)
npm run build
```

Nach Änderungen am Frontend immer `npm run build` ausführen und `web/dist`
mitcommitten – der LXC baut nichts.

### Projektstruktur

```
app/offers_dashboard/     Python-Paket (API, Collector, Matching, Adapter)
migrations/               SQL-Migrationen (werden beim Start angewandt)
tests/                    Pytest-Suite inkl. Fixtures der Quellen
web/                      React/Vite/TypeScript-Frontend
web/dist/                 gebautes Frontend (wird ausgeliefert)
systemd/                  Service- und Timer-Units
install/offers-dashboard.sh   Host-Installer (LXC + Installation)
install/update.sh         Update im Container
docs/superpowers/         Design-Spec und Umsetzungsplan
```

### Datenquellen

- **marktguru:** API-Keys stehen öffentlich im HTML der Startseite und werden
  bei jedem Lauf neu gelesen. Suche nach Händlername + PLZ.
- **kaufda:** liest `__NEXT_DATA__` der Händlerseite. Der Stadt-Slug wird aus
  dem Ortsnamen abgeleitet oder in den Einstellungen gesetzt.
- Baumarkt-Abdeckung ist standortabhängig. Fehlt ein Händler, liefert der Lauf
  für diesen Händler keine Angebote – der Rest läuft weiter.

## Lizenz / Nutzung

Privates Projekt ohne Lizenz. Die abgerufenen Inhalte gehören den jeweiligen
Anbietern; die Nutzung erfolgt ausschließlich privat und auf eigenes Risiko.
