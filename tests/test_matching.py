from datetime import date

from offers_dashboard.db import utc_now
from offers_dashboard.matching import (
    assign_product,
    merge_products,
    rebuild_price_points,
    split_offers,
)


def _insert_offer(conn, retailer_id, title, price, week="2026-11-02", external_id="x1"):
    location_id = conn.execute(
        "INSERT INTO locations (name, zip, active, created_at) VALUES ('Test', '91541', 1, ?)",
        (utc_now(),),
    ).lastrowid
    cur = conn.execute(
        "INSERT INTO offers (location_id, retailer_id, source, external_id, title, price, "
        "week_start, fetched_at) VALUES (?, ?, 'marktguru', ?, ?, ?, ?, ?)",
        (location_id, retailer_id, external_id, title, price, week, utc_now()),
    )
    conn.commit()
    return int(cur.lastrowid)


def test_assign_product_reuses_match_key(conn):
    retailer_id = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
    first = _insert_offer(conn, retailer_id, "Bio Milch 1 l", 1.29, external_id="a")
    second = _insert_offer(conn, retailer_id, "Bio Milch 1 l", 1.19, external_id="b")
    p1 = assign_product(conn, first, retailer_id, "", "Bio Milch 1 l", "l", 1)
    p2 = assign_product(conn, second, retailer_id, "", "Bio Milch 1 l", "l", 1)
    assert p1 == p2


def test_merge_keeps_alias_for_next_week(conn):
    retailer_id = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
    a = _insert_offer(conn, retailer_id, "Kaffee Gold", 5.0, external_id="a")
    b = _insert_offer(conn, retailer_id, "Kaffee Gold Bio 500g", 4.5, external_id="b")
    target = assign_product(conn, a, retailer_id, "", "Kaffee Gold", None, None)
    source = assign_product(conn, b, retailer_id, "", "Kaffee Gold Bio 500g", None, None)
    assert target != source
    merge_products(conn, target, [source])
    rebuild_price_points(conn)
    points = conn.execute("SELECT COUNT(*) AS n FROM price_points WHERE product_id = ?", (target,)).fetchone()["n"]
    assert points == 2

    c = _insert_offer(conn, retailer_id, "Kaffee Gold 500g", 4.2, external_id="c")
    reused = assign_product(conn, c, retailer_id, "", "Kaffee Gold 500g", None, None)
    assert reused == target


def test_split_moves_offers_to_new_product(conn):
    retailer_id = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
    a = _insert_offer(conn, retailer_id, "Werkzeug Set", 9.99, external_id="a")
    b = _insert_offer(conn, retailer_id, "Werkzeug Set", 8.99, external_id="b")
    product = assign_product(conn, a, retailer_id, "", "Werkzeug Set", None, None)
    assert assign_product(conn, b, retailer_id, "", "Werkzeug Set", None, None) == product
    new_id = split_offers(conn, product, [b])
    assert new_id != product
    moved = conn.execute("SELECT product_id FROM product_links WHERE offer_id = ?", (b,)).fetchone()["product_id"]
    assert moved == new_id


def test_rebuild_price_points_uses_offer_week(conn):
    retailer_id = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
    offer = _insert_offer(conn, retailer_id, "Test", 2.0, week="2026-10-26", external_id="z")
    product = assign_product(conn, offer, retailer_id, "", "Test", None, None)
    rebuild_price_points(conn)
    row = conn.execute("SELECT week_start FROM price_points WHERE product_id = ?", (product,)).fetchone()
    assert row["week_start"] == "2026-10-26"
    assert date.fromisoformat(row["week_start"]).weekday() == 0
