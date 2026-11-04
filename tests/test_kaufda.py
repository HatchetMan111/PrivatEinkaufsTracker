import json
from pathlib import Path

import httpx
from offers_dashboard.adapters import KaufdaAdapter, Location, Retailer

FIXTURES = Path(__file__).parent / "fixtures"


def _client(city_html: str) -> httpx.Client:
    page_information = json.loads((FIXTURES / "kaufda_next.json").read_text())
    next_data = json.dumps({"props": {"pageProps": {"pageInformation": page_information}}})

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/Teststadt"):
            return httpx.Response(200, text=city_html)
        return httpx.Response(
            200,
            text=f'<html><script id="__NEXT_DATA__" type="application/json">{next_data}</script></html>',
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def _retailer():
    return Retailer(id=3, name="Kaufland", slug="kaufland", source="kaufda")


def _location():
    return Location(id=1, name="Teststadt", zip="91541")


def test_fetch_parses_next_data():
    city_html = '<a href="https://www.kaufda.de/Teststadt/Kaufland/p-r1">Kaufland</a>'
    adapter = KaufdaAdapter(client=_client(city_html))
    offers = adapter.fetch(_location(), _retailer())
    assert len(offers) == 1
    offer = offers[0]
    assert offer.title == "Bohrmaschine"
    assert offer.brand == "Parkside"
    assert offer.price == 19.99
    assert offer.old_price == 29.99
    assert offer.week_start.isoformat() == "2026-11-02"
    assert offer.url == "https://www.kaufda.de/Teststadt/Kaufland/p-r1"


def test_fetch_without_retailer_link_returns_empty():
    adapter = KaufdaAdapter(client=_client("<html>kein Link</html>"))
    assert adapter.fetch(_location(), _retailer()) == []


def test_fetch_without_next_data_returns_empty():
    city_html = '<a href="https://www.kaufda.de/Teststadt/Kaufland/p-r1">Kaufland</a>'
    adapter = KaufdaAdapter(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, text=city_html if request.url.path.endswith("/Teststadt") else "<html>leer</html>")
            )
        )
    )
    assert adapter.fetch(_location(), _retailer()) == []
