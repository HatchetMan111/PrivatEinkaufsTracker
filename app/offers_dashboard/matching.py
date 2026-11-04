"""Produktzuordnung, Merge/Split und Preispunkte."""

from __future__ import annotations

import sqlite3

from .db import utc_now
from .normalize import match_key, normalize_name, unit_key


def assign_product(
    conn: sqlite3.Connection,
    offer_id: int,
    retailer_id: int,
    brand: str | None,
    title: str | None,
    unit: str | None = None,
    quantity: float | None = None,
) -> int:
    normalized = normalize_name(title)
    alias = conn.execute(
        "SELECT product_id FROM product_aliases WHERE retailer_id = ? AND normalized_name = ?",
        (retailer_id, normalized),
    ).fetchone()
    method = "exact"
    confidence = 1.0
    if alias:
        product_id = alias["product_id"]
        method = "alias"
    else:
        ukey = unit_key(unit, quantity)
        mkey = match_key(retailer_id, brand, title, ukey)
        existing = conn.execute(
            "SELECT id FROM products WHERE match_key = ? ORDER BY id LIMIT 1", (mkey,)
        ).fetchone()
        if existing:
            product_id = existing["id"]
        else:
            cur = conn.execute(
                "INSERT INTO products "
                "(retailer_id, canonical_name, brand, category, unit_key, match_key, created_at) "
                "VALUES (?, ?, ?, NULL, ?, ?, ?)",
                (retailer_id, title or normalized, brand, ukey, mkey, utc_now()),
            )
            product_id = int(cur.lastrowid)
            confidence = 1.0 if normalized else 0.7

    conn.execute(
        "INSERT INTO product_links (offer_id, product_id, method, confidence) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(offer_id) DO UPDATE SET "
        "product_id = excluded.product_id, method = excluded.method, "
        "confidence = excluded.confidence",
        (offer_id, product_id, method, confidence),
    )
    return product_id


def _alias_source_products(conn: sqlite3.Connection, target_id: int, source_ids: list[int]) -> None:
    now = utc_now()
    for source_id in source_ids:
        rows = conn.execute(
            "SELECT DISTINCT p.canonical_name, p.retailer_id, o.title "
            "FROM products p "
            "LEFT JOIN product_links pl ON pl.product_id = p.id "
            "LEFT JOIN offers o ON o.id = pl.offer_id "
            "WHERE p.id = ?",
            (source_id,),
        ).fetchall()
        for row in rows:
            retailer_id = row["retailer_id"]
            for name in (row["canonical_name"], row["title"]):
                normalized = normalize_name(name)
                if not normalized:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO product_aliases "
                    "(product_id, retailer_id, normalized_name, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (target_id, retailer_id, normalized, now),
                )


def merge_products(conn: sqlite3.Connection, target_id: int, source_ids: list[int]) -> None:
    sources = [int(s) for s in source_ids if int(s) != int(target_id)]
    if not sources:
        return
    placeholders = ",".join("?" for _ in sources)
    _alias_source_products(conn, target_id, sources)
    conn.execute(
        f"UPDATE product_links SET product_id = ?, method = 'manual' "
        f"WHERE product_id IN ({placeholders})",
        (target_id, *sources),
    )
    conn.execute(f"DELETE FROM products WHERE id IN ({placeholders})", tuple(sources))
    rebuild_price_points(conn)
    conn.commit()


def split_offers(conn: sqlite3.Connection, product_id: int, offer_ids: list[int]) -> int:
    ids = [int(o) for o in offer_ids]
    if not ids:
        return product_id
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT o.id, o.retailer_id, o.title, o.brand, o.unit, o.quantity "
        f"FROM offers o JOIN product_links pl ON pl.offer_id = o.id "
        f"WHERE pl.product_id = ? AND o.id IN ({placeholders}) ORDER BY o.id",
        (product_id, *ids),
    ).fetchall()
    if not rows:
        return product_id
    first = rows[0]
    normalized = normalize_name(first["title"])
    ukey = unit_key(first["unit"], first["quantity"])
    cur = conn.execute(
        "INSERT INTO products "
        "(retailer_id, canonical_name, brand, category, unit_key, match_key, created_at) "
        "VALUES (?, ?, ?, NULL, ?, ?, ?)",
        (
            first["retailer_id"],
            first["title"] or normalized,
            first["brand"],
            ukey,
            match_key(first["retailer_id"], first["brand"], first["title"], ukey),
            utc_now(),
        ),
    )
    new_id = int(cur.lastrowid)
    conn.execute(
        f"UPDATE product_links SET product_id = ?, method = 'manual' "
        f"WHERE product_id = ? AND offer_id IN ({placeholders})",
        (new_id, product_id, *ids),
    )
    rebuild_price_points(conn)
    conn.commit()
    return new_id


def rebuild_price_points(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM price_points")
    conn.execute(
        "INSERT INTO price_points (product_id, offer_id, price, week_start, observed_at) "
        "SELECT pl.product_id, o.id, o.price, o.week_start, o.fetched_at "
        "FROM offers o JOIN product_links pl ON pl.offer_id = o.id"
    )
    conn.commit()
