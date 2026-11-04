import pytest
from fastapi.testclient import TestClient
from offers_dashboard.api import create_app
from offers_dashboard.db import connect, utc_now
from offers_dashboard.week import current_week


def _client(db_path):
    return TestClient(create_app(db_path))


def test_health_and_locations(db_path):
    with _client(db_path) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        response = client.post("/api/locations", json={"name": "Rothenburg", "zip": "91541"})
        assert response.status_code == 201
        locations = client.get("/api/locations").json()
        assert locations[0]["name"] == "Rothenburg"


def test_offers_current_week_and_stats(db_path):
    with _client(db_path) as client:
        location = client.post(
            "/api/locations", json={"name": "Rothenburg", "zip": "91541"}
        ).json()
        conn = connect(db_path)
        retailer = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
        conn.execute(
            "INSERT INTO offers (location_id, retailer_id, source, external_id, title, price, "
            "old_price, week_start, fetched_at, category) "
            "VALUES (?, ?, 'marktguru', 'x1', 'Testprodukt', 1.49, 2.99, ?, ?, 'Test')",
            (location["id"], retailer, current_week().isoformat(), utc_now()),
        )
        conn.commit()
        conn.close()

        offers = client.get("/api/offers", params={"week": "current"}).json()
        assert offers["total"] == 1
        assert offers["items"][0]["title"] == "Testprodukt"
        assert offers["items"][0]["retailer_slug"] == "kaufland"

        stats = client.get("/api/stats", params={"week": "current"}).json()
        assert stats["offers"] == 1
        assert stats["best_discount"]["saving"] == pytest.approx(1.5)

        previous = client.get("/api/offers", params={"week": "previous"}).json()
        assert previous["total"] == 0


def test_merge_endpoint_combines_products(db_path):
    with _client(db_path) as client:
        location = client.post(
            "/api/locations", json={"name": "Rothenburg", "zip": "91541"}
        ).json()
        conn = connect(db_path)
        retailer = conn.execute("SELECT id FROM retailers WHERE slug = 'kaufland'").fetchone()["id"]
        for index, title in enumerate(("Kaffee Gold", "Kaffee Gold Bio")):
            conn.execute(
                "INSERT INTO offers (location_id, retailer_id, source, external_id, title, price, "
                "week_start, fetched_at) VALUES (?, ?, 'marktguru', ?, ?, 4.99, ?, ?)",
                (location["id"], retailer, f"m{index}", title, current_week().isoformat(), utc_now()),
            )
        conn.commit()
        conn.close()


        # Produkte werden beim Sammeln angelegt; hier direkt aus den Angeboten erzeugen.
        conn = connect(db_path)
        from offers_dashboard.matching import assign_product, rebuild_price_points

        products = []
        for row in conn.execute("SELECT id, retailer_id, title, brand, unit, quantity FROM offers").fetchall():
            products.append(
                assign_product(conn, row["id"], row["retailer_id"], row["brand"], row["title"], row["unit"], row["quantity"])
            )
        rebuild_price_points(conn)
        conn.commit()
        conn.close()
        assert len(set(products)) == 2

        target, source = set(products)
        response = client.post(
            f"/api/products/{target}/merge", json={"source_product_ids": [source]}
        )
        assert response.status_code == 200
        history = client.get(f"/api/products/{target}/history").json()
        assert len(history["points"]) == 2
        assert len(history["weeks"]) == 1


def test_update_location_and_retailer_toggle(db_path):
    with _client(db_path) as client:
        location = client.post(
            "/api/locations", json={"name": "Rothenburg", "zip": "91541"}
        ).json()
        updated = client.put(
            f"/api/locations/{location['id']}",
            json={"name": "Zuhause", "zip": "91541", "kaufda_slug": "Rothenburg-ob-der-Tauber"},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Zuhause"
        assert updated.json()["kaufda_slug"] == "Rothenburg-ob-der-Tauber"

        retailers = client.get("/api/retailers").json()
        assert retailers and all(item["active"] == 1 for item in retailers)
        target = retailers[0]
        off = client.put(f"/api/retailers/{target['id']}", json={"active": False})
        assert off.status_code == 200 and off.json()["active"] == 0
        on = client.put(f"/api/retailers/{target['id']}", json={"active": True})
        assert on.status_code == 200 and on.json()["active"] == 1
