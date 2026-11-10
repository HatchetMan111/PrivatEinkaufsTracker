"""Collector: Angebote holen, normalisieren, speichern."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from .adapters import KaufdaAdapter, Location, MarktguruAdapter, RawOffer, Retailer
from .db import init_db, utc_now
from .matching import assign_product, rebuild_price_points

ADAPTERS = {"marktguru": MarktguruAdapter, "kaufda": KaufdaAdapter}


def _fetch_with(
    source: str,
    overrides: dict[str, object] | None,
    location: Location,
    retailer: Retailer,
) -> list[RawOffer]:
    """Holt Angebote mit dem Adapter der Quelle und schliesst ihn wieder.

    Ein per ``adapter_overrides`` injizierter Adapter wird nicht geschlossen,
    weil er meist von mehreren Läufen geteilt wird.
    """
    overridden = (overrides or {}).get(source)
    adapter = overridden or ADAPTERS[source]()
    try:
        return adapter.fetch(location, retailer)
    finally:
        if overridden is None:
            close = getattr(adapter, "close", None)
            if close is not None:
                close()


def _upsert_offer(conn, run_id: int, location: Location, retailer: Retailer, offer: RawOffer) -> int:
    now = utc_now()
    week = offer.week_start.isoformat() if offer.week_start else None
    if not week:
        raise ValueError("Angebot ohne week_start")
    cur = conn.execute(
        """
        INSERT INTO offers (
            run_id, location_id, retailer_id, source, external_id, title, description,
            brand, category, price, old_price, base_price, unit, quantity,
            valid_from, valid_to, week_start, image_url, url, raw_json, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, external_id, location_id, week_start) DO UPDATE SET
            run_id = excluded.run_id,
            title = excluded.title,
            description = excluded.description,
            brand = excluded.brand,
            category = excluded.category,
            price = excluded.price,
            old_price = excluded.old_price,
            base_price = excluded.base_price,
            unit = excluded.unit,
            quantity = excluded.quantity,
            valid_from = excluded.valid_from,
            valid_to = excluded.valid_to,
            image_url = excluded.image_url,
            url = excluded.url,
            raw_json = excluded.raw_json,
            fetched_at = excluded.fetched_at
        RETURNING id
        """,
        (
            run_id,
            location.id,
            retailer.id,
            retailer.source,
            offer.external_id,
            offer.title,
            offer.description,
            offer.brand,
            offer.category,
            offer.price,
            offer.old_price,
            offer.base_price,
            offer.unit,
            offer.quantity,
            offer.valid_from,
            offer.valid_to,
            week,
            offer.image_url,
            offer.url,
            json.dumps(offer.raw, ensure_ascii=False),
            now,
        ),
    )
    offer_id = int(cur.fetchone()["id"])
    assign_product(
        conn,
        offer_id,
        retailer.id,
        offer.brand,
        offer.title,
        offer.unit,
        offer.quantity,
    )
    return offer_id


def run_collection(
    db_path: str | Path,
    location_ids: list[int] | None = None,
    trigger: str = "timer",
    adapter_overrides: dict[str, object] | None = None,
) -> int:
    conn = init_db(db_path)
    cur = conn.execute(
        "INSERT INTO runs (started_at, status, trigger) VALUES (?, 'running', ?)",
        (utc_now(), trigger),
    )
    run_id = int(cur.lastrowid)
    conn.commit()

    locations = conn.execute(
        "SELECT id, name, zip, kaufda_slug FROM locations WHERE active = 1 ORDER BY id"
    ).fetchall()
    if location_ids:
        locations = [row for row in locations if row["id"] in set(location_ids)]
    retailers = conn.execute(
        "SELECT id, name, slug, source FROM retailers WHERE active = 1 ORDER BY id"
    ).fetchall()

    errors: list[str] = []
    found = 0
    for loc_row in locations:
        location = Location(
            id=loc_row["id"],
            name=loc_row["name"],
            zip=loc_row["zip"],
            kaufda_slug=loc_row["kaufda_slug"],
        )
        for ret_row in retailers:
            retailer = Retailer(
                id=ret_row["id"],
                name=ret_row["name"],
                slug=ret_row["slug"],
                source=ret_row["source"],
            )
            source = retailer.source
            other = "kaufda" if source == "marktguru" else "marktguru"
            primary_error: Exception | None = None
            offers: list[RawOffer] = []
            # Primärquelle versuchen. Fehler werden gemerkt, damit trotzdem die
            # Zweitquelle greifen kann – wichtig, wenn marktguru z. B. mit 403/429
            # antwortet: dann sollen Kaufland/Lidl nicht komplett verschwinden.
            try:
                offers = _fetch_with(source, adapter_overrides, location, retailer)
            except Exception as exc:  # noqa: BLE001 - Quelle isoliert behandeln
                primary_error = exc
                if trigger == "manual":
                    traceback.print_exc(file=sys.stderr)
            if not offers:
                try:
                    offers = _fetch_with(other, adapter_overrides, location, retailer)
                except Exception as exc:  # noqa: BLE001 - auch die Zweitquelle isolieren
                    detail = f"{type(exc).__name__}: {exc}"
                    if primary_error is not None:
                        detail = f"{source}: {primary_error}; {other}: {detail}"
                    else:
                        detail = f"{other}: {detail}"
                    errors.append(f"{location.name}/{retailer.slug}: {detail}")
                    conn.rollback()
                    continue
            if primary_error is not None:
                if offers:
                    errors.append(
                        f"{location.name}/{retailer.slug}: {source} fehlgeschlagen "
                        f"({primary_error}); Fallback {other} lieferte Daten"
                    )
                else:
                    errors.append(
                        f"{location.name}/{retailer.slug}: {source} fehlgeschlagen "
                        f"({primary_error}); {other} ohne Ergebnisse"
                    )
            try:
                for offer in offers:
                    try:
                        _upsert_offer(conn, run_id, location, retailer, offer)
                        found += 1
                    except Exception as exc:  # noqa: BLE001 - ein Angebot darf den Lauf nicht killen
                        errors.append(f"{location.name}/{retailer.slug}: {exc}")
                conn.commit()
            except Exception as exc:  # noqa: BLE001 - Quelle isoliert behandeln
                errors.append(f"{location.name}/{retailer.slug} ({source}): {exc}")
                if trigger == "manual":
                    traceback.print_exc(file=sys.stderr)
                conn.rollback()

    rebuild_price_points(conn)
    if errors and found == 0:
        status = "failed"
    elif errors:
        status = "partial"
    else:
        status = "ok"
    message = "; ".join(errors)[:2000] or None
    conn.execute(
        "UPDATE runs SET finished_at = ?, status = ?, items_found = ?, error = ? WHERE id = ?",
        (utc_now(), status, found, message, run_id),
    )
    conn.commit()
    conn.close()
    return run_id


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wochenangebote einsammeln")
    parser.add_argument("--all", action="store_true", help="alle aktiven Orte")
    parser.add_argument("--location", type=int, action="append", default=None)
    parser.add_argument("--db", default=None)
    parser.add_argument("--trigger", default="timer")
    args = parser.parse_args(argv)

    from .config import get_settings

    db_path = args.db or get_settings().db_path
    run_id = run_collection(db_path, args.location, args.trigger)
    conn = init_db(db_path)
    try:
        row = conn.execute("SELECT status, items_found, error FROM runs WHERE id = ?", (run_id,)).fetchone()
    finally:
        conn.close()
    status = row["status"] if row else "unknown"
    print(f"Lauf {run_id} abgeschlossen: {status} ({row['items_found'] if row else 0} Angebote, {db_path})")
    if row and row["error"]:
        print(f"Fehler: {row['error']}", file=sys.stderr)
    return 0 if status in {"ok", "partial"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
