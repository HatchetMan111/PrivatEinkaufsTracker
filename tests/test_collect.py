from datetime import date

import pytest

from offers_dashboard.adapters import RawOffer
from offers_dashboard.collect import run_collection
from offers_dashboard.db import connect, init_db, utc_now


class FakeMarktguru:
    def __init__(self, price=1.99):
        self.price = price

    def fetch(self, location, retailer):
        if retailer.slug != "kaufland":
            return []
        return [
            RawOffer(
                external_id="offer-1",
                title="Testprodukt 1 kg",
                brand="Testmarke",
                price=self.price,
                old_price=2.99,
                unit="kg",
                quantity=1.0,
                valid_from="2026-11-01T23:00:00Z",
                valid_to="2026-11-07T18:00:00Z",
                week_start=date(2026, 11, 2),
                url="https://example.test/1",
            )
        ]


class FakeKaufda:
    def fetch(self, location, retailer):
        return []


class BrokenMarktguru:
    def fetch(self, location, retailer):
        raise RuntimeError("marktguru nicht erreichbar")


class FakeKaufdaWithOffers:
    def fetch(self, location, retailer):
        if retailer.slug != "kaufland":
            return []
        return [
            RawOffer(
                external_id="fallback-1",
                title="Fallback-Produkt",
                price=1.49,
                old_price=2.49,
                valid_from="2026-11-01T23:00:00Z",
                valid_to="2026-11-07T18:00:00Z",
                week_start=date(2026, 11, 2),
            )
        ]


def test_collection_is_idempotent(db_path):
    conn = init_db(db_path)
    conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    )
    conn.commit()
    conn.close()

    overrides = {"marktguru": FakeMarktguru(), "kaufda": FakeKaufda()}
    first = run_collection(db_path, trigger="manual", adapter_overrides=overrides)
    second = run_collection(db_path, trigger="manual", adapter_overrides=overrides)

    conn = connect(db_path)
    assert conn.execute("SELECT COUNT(*) AS n FROM offers").fetchone()["n"] == 1
    assert conn.execute("SELECT COUNT(*) AS n FROM price_points").fetchone()["n"] == 1
    assert conn.execute("SELECT status FROM runs WHERE id = ?", (first,)).fetchone()["status"] == "ok"
    assert conn.execute("SELECT status FROM runs WHERE id = ?", (second,)).fetchone()["status"] == "ok"
    conn.close()


def test_collection_updates_price_for_same_offer(db_path):
    conn = init_db(db_path)
    conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    )
    conn.commit()
    conn.close()

    run_collection(
        db_path, trigger="manual", adapter_overrides={"marktguru": FakeMarktguru(1.99), "kaufda": FakeKaufda()}
    )
    run_collection(
        db_path, trigger="manual", adapter_overrides={"marktguru": FakeMarktguru(1.49), "kaufda": FakeKaufda()}
    )
    conn = connect(db_path)
    price = conn.execute("SELECT price FROM offers").fetchone()["price"]
    assert price == 1.49
    conn.close()


def test_collection_falls_back_when_primary_source_errors(db_path):
    """Ist marktguru blockiert (403/429), muss kaufda einspringen statt auszufallen."""
    conn = init_db(db_path)
    conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    )
    conn.commit()
    conn.close()

    run_id = run_collection(
        db_path,
        trigger="manual",
        adapter_overrides={"marktguru": BrokenMarktguru(), "kaufda": FakeKaufdaWithOffers()},
    )

    conn = connect(db_path)
    offers = conn.execute(
        "SELECT o.title, r.slug FROM offers o JOIN retailers r ON r.id = o.retailer_id"
    ).fetchall()
    titles = {row["title"] for row in offers}
    assert "Fallback-Produkt" in titles
    run = conn.execute("SELECT status, error FROM runs WHERE id = ?", (run_id,)).fetchone()
    assert run["status"] == "partial"
    assert "marktguru" in (run["error"] or "")
    conn.close()


def test_collection_does_not_fallback_for_disabled_retailers(db_path):
    """Nur aktive Händler werden abgefragt; der Fallback darf sie nicht reaktivieren."""
    conn = init_db(db_path)
    conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    )
    conn.execute("UPDATE retailers SET active = 0 WHERE slug = 'lidl'")
    conn.commit()
    conn.close()

    run_collection(
        db_path,
        trigger="manual",
        adapter_overrides={"marktguru": BrokenMarktguru(), "kaufda": FakeKaufdaWithOffers()},
    )

    conn = connect(db_path)
    retailers = {
        row["slug"]
        for row in conn.execute(
            "SELECT r.slug FROM offers o JOIN retailers r ON r.id = o.retailer_id"
        )
    }
    assert "lidl" not in retailers
    conn.close()


def test_run_collection_marks_failed_on_crash(db_path, monkeypatch):
    """Bricht der Lauf mittendrin ab, darf kein status='running' hängen bleiben."""
    def boom(conn):
        raise RuntimeError("rebuild kaputt")

    monkeypatch.setattr("offers_dashboard.collect.rebuild_price_points", boom)

    conn = init_db(db_path)
    conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    )
    conn.commit()
    conn.close()

    with pytest.raises(RuntimeError):
        run_collection(db_path)

    row = connect(db_path).execute("SELECT status, error FROM runs").fetchone()
    assert row["status"] == "failed"
    assert "rebuild kaputt" in row["error"]
