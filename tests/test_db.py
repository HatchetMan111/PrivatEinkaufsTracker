from offers_dashboard.db import init_db


def test_migrate_creates_tables(db_path):
    conn = init_db(db_path)
    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }
    for expected in ("locations", "retailers", "offers", "products", "price_points", "runs"):
        assert expected in tables
    conn.close()


def test_retailers_are_seeded(conn):
    rows = conn.execute("SELECT slug, source FROM retailers ORDER BY slug").fetchall()
    sources = {row["slug"]: row["source"] for row in rows}
    assert sources["kaufland"] == "marktguru"
    assert sources["lidl"] == "marktguru"
    assert sources["obi"] == "kaufda"
    assert sources["hornbach"] == "kaufda"


def test_migrate_is_idempotent(db_path):
    first = init_db(db_path)
    first.close()
    second = init_db(db_path)
    versions = second.execute("SELECT COUNT(*) AS n FROM schema_version").fetchone()["n"]
    assert versions == 1
    second.close()
