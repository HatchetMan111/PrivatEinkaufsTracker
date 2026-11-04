#!/usr/bin/env bash
#
# PrivatEinkaufsTracker – Update im bestehenden LXC
#
# Aufruf (als root im Container oder via pct exec):
#   offers-dashboard-update
#   pct exec <CTID> -- offers-dashboard-update
#
set -euo pipefail

APP_DIR="/opt/offers-dashboard"
CONFIG="/etc/offers-dashboard/config.env"
SERVICE="offers-dashboard"
TIMER="offers-dashboard-collect.timer"

msg_info()  { echo -e "\e[34m[INFO]\e[0m  $*"; }
msg_ok()    { echo -e "\e[32m[OK]\e[0m    $*"; }
msg_warn()  { echo -e "\e[33m[WARN]\e[0m  $*"; }
msg_error() { echo -e "\e[31m[ERROR]\e[0m $*" >&2; }

[[ "$(id -u)" == "0" ]] || { msg_error "Bitte als root ausführen."; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { msg_error "Kein Git-Checkout unter $APP_DIR."; exit 1; }

msg_info "Hole neuesten Stand ..."
runuser -u offers -- git -C "$APP_DIR" pull --ff-only
msg_ok "Repository aktualisiert."

[[ -f "$APP_DIR/web/dist/index.html" ]] \
  || { msg_error "Frontend-Build fehlt: $APP_DIR/web/dist/index.html"; exit 1; }

msg_info "Aktualisiere Python-Abhängigkeiten ..."
runuser -u offers -- "$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
runuser -u offers -- "$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
msg_ok "Abhängigkeiten aktuell."

msg_info "Übernehme systemd-Units ..."
for unit in "$SERVICE.service" "$SERVICE-collect.service" "$TIMER"; do
  install -m 0644 "$APP_DIR/systemd/$unit" "/etc/systemd/system/$unit"
done

SCHEDULE=""
if [[ -f "$CONFIG" ]]; then
  SCHEDULE="$(grep -E '^SCHEDULE_CALENDAR=' "$CONFIG" | tail -n1 | cut -d= -f2- || true)"
fi
SCHEDULE="${SCHEDULE:-Mon *-*-* 06:00:00 Europe/Berlin}"
mkdir -p "/etc/systemd/system/$TIMER.d"
printf '[Timer]\nOnCalendar=\nOnCalendar=%s\n' "$SCHEDULE" \
  > "/etc/systemd/system/$TIMER.d/schedule.conf"

systemctl daemon-reload
msg_ok "Units und Zeitplan übernommen ($SCHEDULE)."

DB_PATH="$(grep -E '^OFFERS_DB=' "$CONFIG" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
DB_PATH="${DB_PATH:-/var/lib/offers-dashboard/offers.db}"
PORT="$(grep -E '^OFFERS_PORT=' "$CONFIG" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
PORT="${PORT:-8000}"

msg_info "Führe Migrationen aus ..."
runuser -u offers -- env PYTHONPATH="$APP_DIR/app" OFFERS_DB="$DB_PATH" \
  "$APP_DIR/.venv/bin/python" -c "from offers_dashboard.db import init_db; init_db('$DB_PATH').close()"
msg_ok "Datenbank aktuell: $DB_PATH"

systemctl restart "$SERVICE"
systemctl enable --now "$TIMER" >/dev/null 2>&1 || msg_warn "Timer konnte nicht aktiviert werden."

msg_info "Health-Check ..."
for _ in $(seq 1 12); do
  if curl -fs -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    msg_ok "Dienst antwortet auf Port $PORT."
    systemctl --no-pager --lines=0 status "$SERVICE" || true
    echo ""
    msg_ok "Update abgeschlossen."
    exit 0
  fi
  sleep 3
done

msg_error "Health-Check fehlgeschlagen."
systemctl status "$SERVICE" --no-pager || true
journalctl -u "$SERVICE" --no-pager -n 80 || true
exit 1
