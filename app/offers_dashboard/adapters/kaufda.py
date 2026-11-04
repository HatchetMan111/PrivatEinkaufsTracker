"""kaufda.de Adapter (Bonial) – Fallback, vor allem fuer Baumarkt-Prospekte."""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from typing import Any

import httpx

from ..config import get_settings
from ..week import parse_datetime, week_start
from .base import Location, RawOffer, Retailer

BASE_URL = "https://www.kaufda.de"
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.DOTALL
)
_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def city_slug(name: str) -> str:
    text = unicodedata.normalize("NFKC", name).translate(_UMLAUTS)
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")
    return text


class KaufdaAdapter:
    name = "kaufda"

    def __init__(self, client: httpx.Client | None = None, timeout: float = 20.0) -> None:
        self._client = client
        self._owns_client = client is None
        self.timeout = timeout

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": get_settings().user_agent},
            )
        return self._client

    def close(self) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    def fetch(self, location: Location, retailer: Retailer) -> list[RawOffer]:
        slug = location.kaufda_slug or city_slug(location.name)
        city_url = f"{BASE_URL}/{slug}"
        response = self.client.get(city_url)
        response.raise_for_status()
        retailer_url = self._find_retailer_url(response.text, slug, retailer.name)
        if not retailer_url:
            return []
        offer_response = self.client.get(retailer_url)
        offer_response.raise_for_status()
        items, page_url = self._parse_next_data(offer_response.text)
        offers: list[RawOffer] = []
        for item in items:
            offer = self._convert(item, page_url or retailer_url)
            if offer is not None:
                offers.append(offer)
        return offers

    @staticmethod
    def _find_retailer_url(html: str, slug: str, retailer_name: str) -> str | None:
        pattern = re.compile(
            r'href="([^"]+/' + re.escape(slug) + r"/" + re.escape(retailer_name) + r'/p-r\d+)"',
            re.IGNORECASE,
        )
        match = pattern.search(html)
        if not match:
            return None
        url = match.group(1)
        if url.startswith("/"):
            return f"{BASE_URL}{url}"
        return url

    @staticmethod
    def _parse_next_data(html: str) -> tuple[list[dict[str, Any]], str | None]:
        match = _NEXT_DATA_RE.search(html)
        if not match:
            return [], None
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            return [], None
        page = data.get("props", {}).get("pageProps", {}).get("pageInformation", {})
        items = page.get("offers", {}).get("main", {}).get("items", []) or []
        return items, page.get("url")

    def _convert(self, item: dict[str, Any], page_url: str) -> RawOffer | None:
        if item.get("type") != "OFFER":
            return None
        title = item.get("title") or ""
        prices = item.get("prices") or {}
        price = prices.get("mainPrice")
        if not title or not price:
            return None
        valid_from = item.get("validFrom")
        observed = parse_datetime(valid_from) or datetime.now()
        secondary = prices.get("secondaryPrice")
        try:
            price_value = float(price)
            old_value = float(secondary) if secondary and float(secondary) > price_value else None
        except (TypeError, ValueError):
            return None
        images = (item.get("offerImages") or {}).get("url") or {}
        categories = item.get("categories") or []
        return RawOffer(
            external_id=str(item.get("id")),
            title=title,
            description=item.get("description") or "",
            brand=item.get("brand") or "",
            category=categories[0] if categories else "",
            price=price_value,
            old_price=old_value,
            base_price=prices.get("priceByBaseUnit") or "",
            valid_from=valid_from,
            valid_to=item.get("validUntil"),
            week_start=week_start(observed),
            image_url=images.get("large") or images.get("normal") or "",
            url=page_url,
            raw=item,
        )
