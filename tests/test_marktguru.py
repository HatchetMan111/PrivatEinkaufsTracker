import json
from pathlib import Path

import httpx
from offers_dashboard.adapters import Location, MarktguruAdapter, Retailer

FIXTURES = Path(__file__).parent / "fixtures"


def _client() -> httpx.Client:
    search_payload = json.loads((FIXTURES / "marktguru_search.json").read_text())

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.marktguru.de":
            return httpx.Response(
                200,
                text='<script>{"apiKey":"test-api","clientKey":"test-client"}</script>',
            )
        return httpx.Response(200, json=search_payload)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_filters_retailer_and_converts_prices():
    adapter = MarktguruAdapter(client=_client())
    offers = adapter.fetch(
        Location(id=1, name="Teststadt", zip="91541"),
        Retailer(id=1, name="Kaufland", slug="kaufland", source="marktguru"),
    )
    assert len(offers) == 1
    offer = offers[0]
    assert offer.external_id == "111"
    assert offer.title == "Schinkenknacker"
    assert offer.price == 1.99
    assert offer.old_price == 2.99
    assert offer.week_start.isoformat() == "2026-11-02"
    assert offer.url == "https://www.marktguru.de/offers/111"


def test_fetch_returns_empty_for_unknown_retailer():
    adapter = MarktguruAdapter(client=_client())
    offers = adapter.fetch(
        Location(id=1, name="Teststadt", zip="91541"),
        Retailer(id=9, name="OBI", slug="obi", source="marktguru"),
    )
    assert offers == []


def test_missing_keys_raise():
    def handler(_request):
        return httpx.Response(200, text="<html>no keys</html>")

    adapter = MarktguruAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        adapter.fetch(
            Location(id=1, name="Teststadt", zip="91541"),
            Retailer(id=1, name="Kaufland", slug="kaufland", source="marktguru"),
        )
    except RuntimeError as exc:
        assert "API-Keys" in str(exc)
    else:
        raise AssertionError("RuntimeError erwartet")
