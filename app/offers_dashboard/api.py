"""FastAPI-Anwendung fuer das Angebots-Dashboard."""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .collect import run_collection
from .config import get_settings
from .db import connect, init_db, utc_now
from .matching import merge_products, split_offers
from .week import resolve_week

ROOT = Path(__file__).resolve().parents[2]
WEB_DIST = ROOT / "web" / "dist"


class LocationIn(BaseModel):
    name: str = Field(min_length=1)
    zip: str = Field(min_length=3, max_length=10)
    kaufda_slug: str | None = None


class RetailerIn(BaseModel):
    active: bool


class MergeIn(BaseModel):
    source_product_ids: list[int]


class SplitIn(BaseModel):
    offer_ids: list[int]


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def create_app(db_path: str | Path | None = None) -> FastAPI:
    settings = get_settings()
    database = str(db_path or settings.db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db(database).close()
        yield

    app = FastAPI(title="PrivatEinkaufsTracker", version="0.1.0", lifespan=lifespan)
    app.state.db_path = database

    def db() -> sqlite3.Connection:
        return connect(database)

    # ------------------------------------------------------------------ health
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        conn = db()
        try:
            count = conn.execute("SELECT COUNT(*) AS n FROM offers").fetchone()["n"]
            return {"status": "ok", "offers": count, "database": database}
        finally:
            conn.close()

    # --------------------------------------------------------------- locations
    @app.get("/api/locations")
    def list_locations() -> list[dict[str, Any]]:
        conn = db()
        try:
            rows = conn.execute(
                "SELECT id, name, zip, kaufda_slug, active FROM locations ORDER BY name"
            ).fetchall()
            return [_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    @app.post("/api/locations", status_code=201)
    def create_location(payload: LocationIn) -> dict[str, Any]:
        conn = db()
        try:
            cur = conn.execute(
                "INSERT INTO locations (name, zip, kaufda_slug, active, created_at) "
                "VALUES (?, ?, ?, 1, ?)",
                (payload.name, payload.zip, payload.kaufda_slug, utc_now()),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, name, zip, kaufda_slug, active FROM locations WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()

    @app.put("/api/locations/{location_id}")
    def update_location(location_id: int, payload: LocationIn) -> dict[str, Any]:
        conn = db()
        try:
            conn.execute(
                "UPDATE locations SET name = ?, zip = ?, kaufda_slug = ? WHERE id = ?",
                (payload.name, payload.zip, payload.kaufda_slug, location_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, name, zip, kaufda_slug, active FROM locations WHERE id = ?",
                (location_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Ort nicht gefunden")
            return _row_to_dict(row)
        finally:
            conn.close()

    @app.delete("/api/locations/{location_id}")
    def delete_location(location_id: int) -> dict[str, str]:
        conn = db()
        try:
            conn.execute("UPDATE locations SET active = 0 WHERE id = ?", (location_id,))
            conn.commit()
            return {"status": "deactivated"}
        finally:
            conn.close()

    # --------------------------------------------------------------- retailers
    @app.get("/api/retailers")
    def list_retailers() -> list[dict[str, Any]]:
        conn = db()
        try:
            rows = conn.execute(
                "SELECT id, name, slug, source, active FROM retailers ORDER BY name"
            ).fetchall()
            return [_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    @app.put("/api/retailers/{retailer_id}")
    def update_retailer(retailer_id: int, payload: RetailerIn) -> dict[str, Any]:
        conn = db()
        try:
            conn.execute(
                "UPDATE retailers SET active = ? WHERE id = ?",
                (1 if payload.active else 0, retailer_id),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, name, slug, source, active FROM retailers WHERE id = ?",
                (retailer_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Händler nicht gefunden")
            return _row_to_dict(row)
        finally:
            conn.close()

    # ------------------------------------------------------------------ offers
    @app.get("/api/offers")
    def list_offers(
        location_id: int | None = None,
        week: str = Query("current"),
        retailer: str | None = None,
        retailers: str | None = None,
        category: str | None = None,
        q: str | None = None,
        sort: str = Query("discount", pattern="^(discount|saving|price_asc|price_desc|title|newest)$"),
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        week_date = resolve_week(week, settings.tz)
        clauses = ["o.week_start = ?"]
        params: list[Any] = [week_date.isoformat()]
        if location_id is not None:
            clauses.append("o.location_id = ?")
            params.append(location_id)
        if retailers:
            slugs = [slug.strip() for slug in retailers.split(",") if slug.strip()]
            if slugs:
                clauses.append(f"r.slug IN ({', '.join('?' for _ in slugs)})")
                params.extend(slugs)
        elif retailer:
            clauses.append("r.slug = ?")
            params.append(retailer)
        if category:
            clauses.append("o.category = ?")
            params.append(category)
        if q:
            clauses.append("(o.title LIKE ? OR o.description LIKE ? OR o.brand LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])
        where = " AND ".join(clauses)
        order_by = {
            # Prozent-Rabatt zuerst, absolute Ersparnis als Tiebreaker
            "discount": (
                "(CASE WHEN o.old_price IS NOT NULL AND o.old_price > o.price "
                "THEN (o.old_price - o.price) * 1.0 / o.old_price ELSE 0 END) DESC, "
                "(COALESCE(o.old_price, o.price) - o.price) DESC, o.price ASC, o.title"
            ),
            # Absolute Ersparnis zuerst, Prozent-Rabatt als Tiebreaker
            "saving": (
                "(COALESCE(o.old_price, o.price) - o.price) DESC, "
                "(CASE WHEN o.old_price IS NOT NULL AND o.old_price > o.price "
                "THEN (o.old_price - o.price) * 1.0 / o.old_price ELSE 0 END) DESC, "
                "o.price ASC, o.title"
            ),
            "price_asc": "o.price ASC, o.title",
            "price_desc": "o.price DESC, o.title",
            "title": "o.title COLLATE NOCASE ASC",
            "newest": "o.id DESC",
        }[sort]
        conn = db()
        try:
            total = conn.execute(
                f"SELECT COUNT(*) AS n FROM offers o JOIN retailers r ON r.id = o.retailer_id "
                f"WHERE {where}",
                params,
            ).fetchone()["n"]
            rows = conn.execute(
                f"""
                SELECT o.id, o.title, o.description, o.brand, o.category, o.price, o.old_price,
                       o.base_price, o.unit, o.quantity, o.valid_from, o.valid_to, o.week_start,
                       o.image_url, o.url, o.source, r.name AS retailer_name, r.slug AS retailer_slug,
                       pl.product_id
                FROM offers o
                JOIN retailers r ON r.id = o.retailer_id
                LEFT JOIN product_links pl ON pl.offer_id = o.id
                WHERE {where}
                ORDER BY {order_by}
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            return {
                "week_start": week_date.isoformat(),
                "total": total,
                "items": [_row_to_dict(row) for row in rows],
            }
        finally:
            conn.close()

    @app.get("/api/offers/{offer_id}")
    def get_offer(offer_id: int) -> dict[str, Any]:
        conn = db()
        try:
            row = conn.execute(
                """
                SELECT o.*, r.name AS retailer_name, r.slug AS retailer_slug, pl.product_id
                FROM offers o
                JOIN retailers r ON r.id = o.retailer_id
                LEFT JOIN product_links pl ON pl.offer_id = o.id
                WHERE o.id = ?
                """,
                (offer_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Angebot nicht gefunden")
            data = _row_to_dict(row)
            data.pop("raw_json", None)
            return data
        finally:
            conn.close()

    # ------------------------------------------------------------------- stats
    @app.get("/api/stats")
    def stats(location_id: int | None = None, week: str = Query("current")) -> dict[str, Any]:
        week_date = resolve_week(week, settings.tz)
        clause = "o.week_start = ?"
        params: list[Any] = [week_date.isoformat()]
        if location_id is not None:
            clause += " AND o.location_id = ?"
            params.append(location_id)
        conn = db()
        try:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS offers,
                       COUNT(DISTINCT o.retailer_id) AS retailers,
                       SUM(CASE WHEN o.old_price IS NOT NULL THEN 1 ELSE 0 END) AS discounted
                FROM offers o WHERE {clause}
                """,
                params,
            ).fetchone()
            best = conn.execute(
                f"""
                SELECT o.title, o.price, o.old_price,
                       (o.old_price - o.price) AS saving,
                       ROUND((o.old_price - o.price) * 100.0 / o.old_price) AS percent,
                       r.name AS retailer_name, o.id, pl.product_id AS product_id
                FROM offers o
                JOIN retailers r ON r.id = o.retailer_id
                LEFT JOIN product_links pl ON pl.offer_id = o.id
                WHERE {clause} AND o.old_price IS NOT NULL AND o.old_price > o.price
                ORDER BY (o.old_price - o.price) * 1.0 / o.old_price DESC, saving DESC LIMIT 1
                """,
                params,
            ).fetchone()
            new_products = conn.execute(
                f"""
                SELECT COUNT(DISTINCT pl.product_id) AS n
                FROM offers o JOIN product_links pl ON pl.offer_id = o.id
                WHERE {clause}
                """,
                params,
            ).fetchone()["n"]
            previous = week_date - timedelta(days=7)
            previous_params = [previous.isoformat()]
            previous_clause = "o.week_start = ?"
            if location_id is not None:
                previous_clause += " AND o.location_id = ?"
                previous_params.append(location_id)
            price_drops = conn.execute(
                f"""
                SELECT COUNT(*) AS n FROM (
                    SELECT pl.product_id AS product_id, MIN(o.price) AS price
                    FROM offers o JOIN product_links pl ON pl.offer_id = o.id
                    WHERE {clause}
                    GROUP BY pl.product_id
                ) current
                JOIN (
                    SELECT pl.product_id AS product_id, MIN(o.price) AS price
                    FROM offers o JOIN product_links pl ON pl.offer_id = o.id
                    WHERE {previous_clause}
                    GROUP BY pl.product_id
                ) previous ON previous.product_id = current.product_id
                WHERE current.price < previous.price
                """,
                [*params, *previous_params],
            ).fetchone()["n"]
            return {
                "week_start": week_date.isoformat(),
                "offers": row["offers"],
                "retailers": row["retailers"],
                "discounted": row["discounted"],
                "new_products": new_products,
                "price_drops": price_drops,
                "best_discount": _row_to_dict(best) if best else None,
            }
        finally:
            conn.close()

    # ---------------------------------------------------------------- products
    @app.get("/api/products")
    def list_products(
        q: str | None = None, limit: int = Query(50, ge=1, le=500)
    ) -> list[dict[str, Any]]:
        conn = db()
        try:
            if q:
                rows = conn.execute(
                    "SELECT p.id, p.canonical_name, p.brand, p.unit_key, r.name AS retailer_name, "
                    "(SELECT MIN(price) FROM price_points pp WHERE pp.product_id = p.id) AS min_price, "
                    "(SELECT MAX(week_start) FROM price_points pp WHERE pp.product_id = p.id) AS last_week "
                    "FROM products p JOIN retailers r ON r.id = p.retailer_id "
                    "WHERE p.canonical_name LIKE ? OR p.brand LIKE ? "
                    "ORDER BY p.canonical_name LIMIT ?",
                    (f"%{q}%", f"%{q}%", limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT p.id, p.canonical_name, p.brand, p.unit_key, r.name AS retailer_name, "
                    "(SELECT MIN(price) FROM price_points pp WHERE pp.product_id = p.id) AS min_price, "
                    "(SELECT MAX(week_start) FROM price_points pp WHERE pp.product_id = p.id) AS last_week "
                    "FROM products p JOIN retailers r ON r.id = p.retailer_id "
                    "ORDER BY p.canonical_name LIMIT ?",
                    (limit,),
                ).fetchall()
            return [_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    @app.get("/api/products/{product_id}")
    def get_product(product_id: int) -> dict[str, Any]:
        conn = db()
        try:
            row = conn.execute(
                "SELECT p.*, r.name AS retailer_name FROM products p "
                "JOIN retailers r ON r.id = p.retailer_id WHERE p.id = ?",
                (product_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Produkt nicht gefunden")
            return _row_to_dict(row)
        finally:
            conn.close()

    @app.get("/api/products/{product_id}/history")
    def product_history(product_id: int) -> dict[str, Any]:
        conn = db()
        try:
            product = conn.execute(
                "SELECT p.*, r.name AS retailer_name FROM products p "
                "JOIN retailers r ON r.id = p.retailer_id WHERE p.id = ?",
                (product_id,),
            ).fetchone()
            if product is None:
                raise HTTPException(status_code=404, detail="Produkt nicht gefunden")
            points = conn.execute(
                """
                SELECT pp.week_start, pp.price, pp.observed_at, o.id AS offer_id, o.title,
                       o.old_price, o.valid_from, o.valid_to, o.url, o.image_url, r.name AS retailer_name
                FROM price_points pp
                JOIN offers o ON o.id = pp.offer_id
                JOIN retailers r ON r.id = o.retailer_id
                WHERE pp.product_id = ?
                ORDER BY pp.week_start, pp.price
                """,
                (product_id,),
            ).fetchall()
            point_list = [_row_to_dict(row) for row in points]
            weeks: dict[str, list[float]] = {}
            for point in point_list:
                weeks.setdefault(point["week_start"], []).append(point["price"])
            aggregates = [
                {
                    "week_start": week,
                    "min_price": min(prices),
                    "avg_price": round(sum(prices) / len(prices), 2),
                    "count": len(prices),
                }
                for week, prices in sorted(weeks.items())
            ]
            return {
                "product": _row_to_dict(product),
                "points": point_list,
                "weeks": aggregates,
            }
        finally:
            conn.close()

    @app.post("/api/products/{product_id}/merge")
    def merge(product_id: int, payload: MergeIn) -> dict[str, str]:
        conn = db()
        try:
            target = conn.execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
            if target is None:
                raise HTTPException(status_code=404, detail="Produkt nicht gefunden")
            merge_products(conn, product_id, payload.source_product_ids)
            return {"status": "merged"}
        finally:
            conn.close()

    @app.post("/api/products/{product_id}/split")
    def split(product_id: int, payload: SplitIn) -> dict[str, Any]:
        conn = db()
        try:
            new_id = split_offers(conn, product_id, payload.offer_ids)
            return {"status": "split", "new_product_id": new_id}
        finally:
            conn.close()

    # -------------------------------------------------------------------- runs
    @app.get("/api/runs")
    def runs(limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
        conn = db()
        try:
            rows = conn.execute(
                "SELECT id, started_at, finished_at, status, trigger, items_found, error "
                "FROM runs ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [_row_to_dict(row) for row in rows]
        finally:
            conn.close()

    @app.post("/api/refresh", status_code=202)
    def refresh(background: BackgroundTasks) -> dict[str, str]:
        background.add_task(run_collection, database, None, "manual")
        return {"status": "started"}

    # ------------------------------------------------------------------ static
    if WEB_DIST.is_dir():
        assets = WEB_DIST / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"error": "not found"}, status_code=404)
            candidate = (WEB_DIST / path).resolve()
            if path and candidate.is_file() and WEB_DIST in candidate.parents:
                return FileResponse(candidate)
            index = WEB_DIST / "index.html"
            if index.is_file():
                return FileResponse(index)
            return JSONResponse({"error": "frontend build missing"}, status_code=404)

    return app


app = create_app()
