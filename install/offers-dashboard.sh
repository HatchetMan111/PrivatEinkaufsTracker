#!/usr/bin/env bash
#
# PrivatEinkaufsTracker – Proxmox LXC Installer
#
# App:   Privates Dashboard für Wochenangebote (Kaufland, Lidl, Baumärkte)
#        mit Preisverlauf, SQLite und systemd-Timer (montags 06:00).
# Stack: Python 3 / FastAPI / uvicorn / SQLite + statisches React-Frontend.
# Läuft: vollständig lokal im LXC, keine Cloud, kein Docker, kein Login.
# Host:  DAS SKRIPT LÄUFT AUF DEM PROXMOX-HOST (nicht im Container).
#
# Usage:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/PrivatEinkaufsTracker/main/install/offers-dashboard.sh)"
#   CT_ID=150 CORES=2 RAM=2048 DISK=8 bash -c "$(wget -qLO - ...)"
#   bash offers-dashboard.sh --ctid 150 --port 8000 --debug
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Variablen
# ---------------------------------------------------------------------------
APP="offers-dashboard"
APP_HOSTNAME="PrivateEinkaufsTracker"
APP_PORT="8000"
REPO_URL="https://github.com/HatchetMan111/PrivatEinkaufsTracker"
DEFAULT_CORES="1"
DEFAULT_RAM="1024"
DEFAULT_SWAP="512"
DEFAULT_DISK="4"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_TEMPLATE_STORE="local"
DEFAULT_OS="debian-12-standard"
UNPRIVILEGED="1"
FEATURES="nesting=1"

CT_ID_ARG="${CT_ID:-${CTID:-}}"
CORES_ARG="${CORES:-$DEFAULT_CORES}"
RAM_ARG="${RAM:-$DEFAULT_RAM}"
DISK_ARG="${DISK:-$DEFAULT_DISK}"
PORT_ARG="${PORT:-$APP_PORT}"

DEBUG="${DEBUG:-0}"
LOG_FILE="/tmp/${APP}-install-$(date +%F-%H%M%S).log"

# ---------------------------------------------------------------------------
# Logging / Farben
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' \
  C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi

msg_info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
msg_ok()    { echo -e "${C_GREEN}[OK]${C_RESET}    $*"; }
msg_warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
msg_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

exec > >(tee -i "$LOG_FILE") 2>&1
msg_info "Logdatei: $LOG_FILE"
[[ "$DEBUG" == "1" ]] && { echo "--- DEBUG: set -x aktiv ---"; set -x; }

# shellcheck disable=SC2154
trap 'ec=$?; msg_error "FEHLER: Befehl »${BASH_COMMAND}« scheiterte in Zeile ${LINENO} (Exit ${ec})."; msg_error "Vollständiges Log: ${LOG_FILE} – bei Bedarf erneut mit --debug laufen lassen."; exit ${ec}' ERR

usage() {
  cat <<EOF
${APP} Proxmox LXC Installer

Usage:
  bash offers-dashboard.sh [OPTIONEN]
  CT_ID=150 bash offers-dashboard.sh
  bash -c "\$(wget -qLO - ${REPO_URL}/raw/main/install/offers-dashboard.sh)"

Optionen:
  --ctid ID            Container-ID (Default: nächste freie ID via pvesh)
  --hostname NAME      Hostname (Default: ${APP_HOSTNAME})
  --cores N            vCPU (Default: ${DEFAULT_CORES})
  --memory MB          RAM in MB (Default: ${DEFAULT_RAM})
  --disk GB            Disk in GB (Default: ${DEFAULT_DISK})
  --storage NAME       RootFS-Storage (Default: auto, bevorzugt local-lvm)
  --template-store N   Template-Storage (Default: ${DEFAULT_TEMPLATE_STORE})
  --bridge NAME        Netzwerk-Bridge (Default: ${DEFAULT_BRIDGE})
  --port PORT          HTTP-Port im Container (Default: ${APP_PORT})
  --password PW        Root-Passwort (Default: zufällig generiert, wird angezeigt)
  --ssh-key PATH       SSH Public Key in den Container übernehmen (optional)
  --debug              bash -x + maximale Fehlermeldungskette
  -h, --help           diese Hilfe

Hinweis: Das Repository muss öffentlich erreichbar sein, damit der Container
es klonen kann. Für private Repos vorher manuell klonen und update.sh nutzen.
EOF
}

# ---------------------------------------------------------------------------
# Argumente
# ---------------------------------------------------------------------------
CT_ID="$CT_ID_ARG" HOSTNAME_ARG="$APP_HOSTNAME" CORES="$CORES_ARG" RAM="$RAM_ARG" DISK="$DISK_ARG"
STORAGE_ARG="" TEMPLATE_STORE="$DEFAULT_TEMPLATE_STORE" BRIDGE="$DEFAULT_BRIDGE"
PASSWORD_ARG="" SSH_KEY_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CT_ID="$2"; shift 2;;
    --hostname) HOSTNAME_ARG="$2"; shift 2;;
    --cores) CORES="$2"; shift 2;;
    --memory|--ram) RAM="$2"; shift 2;;
    --disk) DISK="$2"; shift 2;;
    --storage) STORAGE_ARG="$2"; shift 2;;
    --template-store) TEMPLATE_STORE="$2"; shift 2;;
    --bridge) BRIDGE="$2"; shift 2;;
    --port) PORT_ARG="$2"; shift 2;;
    --password) PASSWORD_ARG="$2"; shift 2;;
    --ssh-key) SSH_KEY_ARG="$2"; shift 2;;
    --debug) DEBUG="1"; set -x; shift;;
    -h|--help) usage; exit 0;;
    *) msg_error "Unbekannte Option: $1"; usage; exit 1;;
  esac
done

APP_PORT="$PORT_ARG"
if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
  msg_error "Ungültiger Port: $APP_PORT"; exit 1
fi

# ---------------------------------------------------------------------------
# 1. Host-Prüfung
# ---------------------------------------------------------------------------
[[ "$(id -u)" == "0" ]] || { msg_error "Bitte als root auf dem Proxmox-Host ausführen."; exit 1; }
command -v pct >/dev/null || { msg_error "pct nicht gefunden – kein Proxmox-Host?"; exit 1; }
command -v pvesh >/dev/null || { msg_error "pvesh nicht gefunden."; exit 1; }

if [[ -z "$CT_ID" ]]; then
  CT_ID="$(pvesh get /cluster/nextid)"
  msg_info "Nächste freie CT-ID: $CT_ID"
fi

if [[ -z "$STORAGE_ARG" ]]; then
  if pvesm status --storage local-lvm >/dev/null 2>&1; then STORAGE_ARG="local-lvm";
  else STORAGE_ARG="$(pvesm status -content rootdir | awk 'NR>1 {print $1; exit}')";
  fi
fi
[[ -n "$STORAGE_ARG" ]] || { msg_error "Kein RootFS-Storage gefunden."; exit 1; }
msg_info "Storage: $STORAGE_ARG | Template-Store: $TEMPLATE_STORE | Bridge: $BRIDGE | Port: $APP_PORT"

# ---------------------------------------------------------------------------
# 2. Template sicherstellen
# ---------------------------------------------------------------------------
msg_info "Prüfe LXC-Template ..."
pveam update >/dev/null 2>&1 || msg_warn "pveam update scheiterte – nutze vorhandene Templates."
AVAILABLE_TEMPLATES="$(pveam available --section system 2>/dev/null || true)"
TEMPLATE="$(printf '%s' "$AVAILABLE_TEMPLATES" | grep -oP "${DEFAULT_OS}[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" | sort -V | tail -n1 || true)"
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_warn "Kein ${DEFAULT_OS}-Template – suche neuestes Debian-Standard-Template als Fallback ..."
  TEMPLATE="$(printf '%s' "$AVAILABLE_TEMPLATES" | grep -oP "debian-[0-9]+-standard[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" | sort -V | tail -n1 || true)"
fi
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_error "Kein Debian-Standard-Template gefunden. Verfügbare System-Templates:"
  printf '%s\n' "$AVAILABLE_TEMPLATES" | head -n 20 >&2 || true
  msg_error "Bitte 'pveam update' manuell prüfen (Netz/DNS auf dem Host)."
  exit 1
fi
if ! pveam list "$TEMPLATE_STORE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg_info "Lade Template $TEMPLATE ..."
  pveam download "$TEMPLATE_STORE" "$TEMPLATE"
fi
msg_ok "Template bereit: $TEMPLATE_STORE:vztmpl/$TEMPLATE"

# ---------------------------------------------------------------------------
# 3. Container erstellen (idempotent)
# ---------------------------------------------------------------------------
if pct status "$CT_ID" >/dev/null 2>&1; then
  msg_warn "CT $CT_ID existiert – überspringe Erstellung (Update-Modus)."
else
  [[ -z "$PASSWORD_ARG" ]] && PASSWORD_ARG="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
  msg_info "Erstelle CT $CT_ID ($HOSTNAME_ARG): $CORES vCPU / $RAM MB / ${DISK}G ..."
  pct create "$CT_ID" "${TEMPLATE_STORE}:vztmpl/${TEMPLATE}" \
    --hostname "$HOSTNAME_ARG" \
    --cores "$CORES" --memory "$RAM" --swap "$DEFAULT_SWAP" \
    --rootfs "${STORAGE_ARG}:${DISK}" \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
    --unprivileged "$UNPRIVILEGED" --features "$FEATURES" \
    --onboot 1 --start 0 \
    --password "$PASSWORD_ARG"
  msg_ok "CT $CT_ID erstellt (unprivilegiert, nesting, onboot=1)."
fi

if [[ -n "$SSH_KEY_ARG" ]]; then
  [[ -f "$SSH_KEY_ARG" ]] || { msg_error "SSH-Key nicht gefunden: $SSH_KEY_ARG"; exit 1; }
  pct exec "$CT_ID" -- mkdir -p /root/.ssh
  pct push "$CT_ID" "$SSH_KEY_ARG" /root/.ssh/authorized_keys
fi

pct start "$CT_ID" 2>/dev/null || true
msg_info "Warte auf Container-Netz ..."
CT_IP=""
for _ in $(seq 1 24); do
  sleep 5
  CT_IP="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "${CT_IP:-}" ]] && break
done
[[ -n "${CT_IP:-}" ]] || { msg_error "Keine Container-IP (pct exec hostname -I). Netzwerk/Bridge prüfen."; exit 1; }
msg_ok "Container-IP: $CT_IP"

# ---------------------------------------------------------------------------
# 4. Installation im Container (idempotent)
# ---------------------------------------------------------------------------
msg_info "Installiere PrivatEinkaufsTracker im Container ..."
# Äußere Single-Quotes: der Block läuft 1:1 im Container. Deshalb im Block
# KEINE einfachen Anführungszeichen verwenden (würden den Block beenden).
# shellcheck disable=SC2016
pct exec "$CT_ID" -- env OFFERS_PORT="$APP_PORT" REPO_URL="$REPO_URL" bash -c '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y git curl ca-certificates python3 python3-venv python3-pip sqlite3

  ln -sf /usr/share/zoneinfo/Europe/Berlin /etc/localtime
  echo Europe/Berlin > /etc/timezone

  id offers >/dev/null 2>&1 || useradd -r -m -d /var/lib/offers-dashboard -s /usr/sbin/nologin offers

  mkdir -p /opt/offers-dashboard /var/lib/offers-dashboard /etc/offers-dashboard
  chown offers:offers /opt/offers-dashboard /var/lib/offers-dashboard
  chmod 0750 /var/lib/offers-dashboard

  if [ ! -d /opt/offers-dashboard/.git ]; then
    rm -rf /opt/offers-dashboard
    mkdir -p /opt/offers-dashboard
    chown offers:offers /opt/offers-dashboard
    su -s /bin/bash offers -c "git clone --depth 1 $REPO_URL /opt/offers-dashboard"
  else
    su -s /bin/bash offers -c "git -C /opt/offers-dashboard pull --ff-only"
  fi

  test -f /opt/offers-dashboard/web/dist/index.html
  test -f /opt/offers-dashboard/requirements.txt

  if [ ! -x /opt/offers-dashboard/.venv/bin/python ]; then
    python3 -m venv /opt/offers-dashboard/.venv
  fi
  /opt/offers-dashboard/.venv/bin/pip install --quiet --upgrade pip
  /opt/offers-dashboard/.venv/bin/pip install --quiet -r /opt/offers-dashboard/requirements.txt
  chown -R offers:offers /opt/offers-dashboard

  if [ ! -f /etc/offers-dashboard/config.env ]; then
    cat > /etc/offers-dashboard/config.env <<EOF
OFFERS_DB=/var/lib/offers-dashboard/offers.db
OFFERS_PORT=${OFFERS_PORT}
OFFERS_TZ=Europe/Berlin
SCHEDULE_CALENDAR=Mon *-*-* 06:00:00 Europe/Berlin
EOF
  else
    if grep -q "^OFFERS_PORT=" /etc/offers-dashboard/config.env; then
      sed -i "s|^OFFERS_PORT=.*|OFFERS_PORT=${OFFERS_PORT}|" /etc/offers-dashboard/config.env
    else
      echo "OFFERS_PORT=${OFFERS_PORT}" >> /etc/offers-dashboard/config.env
    fi
  fi
  chown root:offers /etc/offers-dashboard/config.env
  chmod 0640 /etc/offers-dashboard/config.env

  install -m 0644 /opt/offers-dashboard/systemd/offers-dashboard.service /etc/systemd/system/offers-dashboard.service
  install -m 0644 /opt/offers-dashboard/systemd/offers-dashboard-collect.service /etc/systemd/system/offers-dashboard-collect.service
  install -m 0644 /opt/offers-dashboard/systemd/offers-dashboard-collect.timer /etc/systemd/system/offers-dashboard-collect.timer
  install -m 0755 /opt/offers-dashboard/install/update.sh /usr/local/bin/offers-dashboard-update

  SCHEDULE="$(grep -E "^SCHEDULE_CALENDAR=" /etc/offers-dashboard/config.env | tail -n1 | cut -d= -f2- || true)"
  SCHEDULE="${SCHEDULE:-Mon *-*-* 06:00:00 Europe/Berlin}"
  mkdir -p /etc/systemd/system/offers-dashboard-collect.timer.d
  printf "[Timer]\nOnCalendar=\nOnCalendar=%s\n" "$SCHEDULE" > /etc/systemd/system/offers-dashboard-collect.timer.d/schedule.conf

  systemctl daemon-reload
  systemctl enable --now offers-dashboard.service
  systemctl enable --now offers-dashboard-collect.timer
'
# Bewusst kein Pipe-Kürzel: bei pipefail würde der trap sonst die Pipe melden.

msg_ok "Installation im Container abgeschlossen."

# ---------------------------------------------------------------------------
# 5. Verifikation
# ---------------------------------------------------------------------------
msg_info "Verifiziere Service ..."
pct exec "$CT_ID" -- systemctl is-active offers-dashboard >/dev/null \
  || { msg_error "Service offers-dashboard ist nicht active."; pct exec "$CT_ID" -- systemctl status offers-dashboard --no-pager || true; exit 1; }
msg_ok "Service läuft."

msg_info "Warte auf HTTP-Health (max. 2 Min) ..."
WEB_OK=0
for _ in $(seq 1 12); do
  if pct exec "$CT_ID" -- curl -fs -m 5 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    WEB_OK=1; break
  fi
  sleep 10
done
[[ "$WEB_OK" == "1" ]] \
  || { msg_error "Health-Endpoint antwortet nicht auf Port ${APP_PORT}."; pct exec "$CT_ID" -- journalctl -u offers-dashboard --no-pager -n 100 || true; exit 1; }
msg_ok "Health-Endpoint antwortet (HTTP 200)."

msg_info "Prüfe Timer ..."
pct exec "$CT_ID" -- systemctl is-active offers-dashboard-collect.timer >/dev/null \
  || { msg_error "Sammel-Timer ist nicht active."; pct exec "$CT_ID" -- systemctl status offers-dashboard-collect.timer --no-pager || true; exit 1; }
NEXT_RUN="$(pct exec "$CT_ID" -- systemctl list-timers offers-dashboard-collect.timer --no-pager 2>/dev/null | awk 'NR==2 {print $1, $2, $3}' || true)"
msg_ok "Timer aktiv${NEXT_RUN:+ – nächster Lauf: $NEXT_RUN}."

echo ""
echo "════════════════ INSTALLATION ERFOLGREICH ════════════════"
echo "  App          : PrivatEinkaufsTracker"
echo "  Repository   : $REPO_URL"
echo "  Container    : CT $CT_ID (Hostname: $HOSTNAME_ARG, unprivilegiert, onboot=1)"
echo "  Ressourcen   : $CORES vCPU / $RAM MB RAM / $DISK GB Disk"
echo "  Web UI       : http://${CT_IP}:${APP_PORT}"
echo "  Health       : http://${CT_IP}:${APP_PORT}/api/health"
echo "  Root-Passwort: ${PASSWORD_ARG:-<bestehender CT, unverändert>} (nur jetzt angezeigt!)"
echo "  Service      : systemctl status offers-dashboard (im Container)"
echo "  Timer        : systemctl list-timers offers-dashboard-collect.timer"
echo "  Update       : pct exec $CT_ID -- offers-dashboard-update"
echo "  Konfig       : /etc/offers-dashboard/config.env"
echo "  Datenbank    : /var/lib/offers-dashboard/offers.db"
echo "  Log          : $LOG_FILE"
echo ""
echo "  Nächster Schritt: Web UI öffnen, unter Einstellungen den ersten Ort"
echo "  anlegen und danach Aktualisieren klicken."
echo "══════════════════════════════════════════════════════════"
