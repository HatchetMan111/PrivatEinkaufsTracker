"""marktguru.de Adapter.

Die API-Keys stehen oeffentlich im HTML der Startseite. Sie werden bei jedem
Lauf frisch gelesen, damit ein Key-Wechsel nicht die Installation bricht.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

from ..config import get_settings
from ..week import parse_datetime, week_start
from .base import Location, RawOffer, Retailer

HOME_URL = "https://www.marktguru.de/"
SEARCH_URL = "https://api.marktguru.de/api/v1/offers/search"

_API_KEY_RE = re.compile(r'"apiKey"\s*:\s*"([^"]+)"')
_CLIENT_KEY_RE = re.compile(r'"clientKey"\s*:\s*"([^"]+)"')
_MEDIA_HOST_RE = re.compile(r'"mediaHostAddress"\s*:\s*"([^"]+)"')


class MarktguruAdapter:
    name = "marktguru"

    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        api_key: str | None = None,
        client_key: str | None = None,
        page_size: int = 100,
        max_pages: int = 20,
        timeout: float = 20.0,
    ) -> None:
        self._client = client
        self._owns_client = client is None
        self._api_key = api_key
        self._client_key = client_key
        self._media_host: str | None = None
        self.page_size = page_size
        self.max_pages = max_pages
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

    def _load_keys(self) -> tuple[str, str]:
        if self._api_key and self._client_key:
            return self._api_key, self._client_key
        response = self.client.get(HOME_URL)
        response.raise_for_status()
        html = response.text
        api_match = _API_KEY_RE.search(html)
        client_match = _CLIENT_KEY_RE.search(html)
        if not api_match or not client_match:
            raise RuntimeError("marktguru API-Keys nicht im Seiten-HTML gefunden")
        self._api_key = api_match.group(1)
        self._client_key = client_match.group(1)
        media_match = _MEDIA_HOST_RE.search(html)
        if media_match:
            self._media_host = media_match.group(1)
        return self._api_key, self._client_key

    def fetch(self, location: Location, retailer: Retailer) -> list[RawOffer]:
        api_key, client_key = self._load_keys()
        headers = {
            "Accept": "application/json",
            "x-apikey": api_key,
            "x-clientkey": client_key,
        }
        offers: list[RawOffer] = []
        offset = 0
        for _ in range(self.max_pages):
            params = {
                "as": "web",
                "limit": self.page_size,
                "offset": offset,
                "q": retailer.name,
                "zipCode": location.zip,
            }
            response = self.client.get(SEARCH_URL, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
            items = payload.get("results") or []
            total = int(payload.get("totalResults") or 0)
            for item in items:
                if not self._is_retailer(item, retailer.slug):
                    continue
                offer = self._convert(item, retailer)
                if offer is not None:
                    offers.append(offer)
            offset += len(items)
            if not items or offset >= total:
                break
        return offers

    @staticmethod
    def _is_retailer(item: dict[str, Any], slug: str) -> bool:
        return any(
            (advertiser or {}).get("uniqueName") == slug
            for advertiser in item.get("advertisers") or []
        )

    def _convert(self, item: dict[str, Any], retailer: Retailer) -> RawOffer | None:
        title = (item.get("product") or {}).get("name") or item.get("description") or ""
        price = item.get("price")
        if not title or price is None:
            return None
        valid_dates = item.get("validityDates") or [{}]
        first_valid = valid_dates[0] or {}
        valid_from = first_valid.get("from")
        valid_to = first_valid.get("to")
        observed = parse_datetime(valid_from) or datetime.now()
        images = item.get("images") or {}
        urls = images.get("urls") or {}
        image_url = urls.get("medium") or urls.get("large") or ""
        if not image_url and int(images.get("count") or 0) > 0:
            media_host = self._media_host or "cdn.marktguru.de"
            image_url = (
                f"https://{media_host}/api/v1/offers/{item.get('id')}"
                "/images/default/0/medium.webp"
            )
        categories = item.get("categories") or [{}]
        brand = (item.get("brand") or {}).get("name") or ""
        unit = (item.get("unit") or {}).get("shortName") or ""
        quantity = item.get("quantity")
        if quantity is None:
            quantity = item.get("volume")
        try:
            price_value = float(price)
        except (TypeError, ValueError):
            return None
        old_price = item.get("oldPrice")
        try:
            old_value = float(old_price) if old_price not in (None, 0) else None
        except (TypeError, ValueError):
            old_value = None
        if old_value is not None and old_value <= price_value:
            old_value = None
        return RawOffer(
            external_id=str(item.get("id")),
            title=title,
            description=item.get("description") or "",
            brand=brand,
            category=(categories[0] or {}).get("name") or "",
            price=price_value,
            old_price=old_value,
            base_price=item.get("referencePrice") and f"{item['referencePrice']}" or "",
            unit=unit,
            quantity=float(quantity) if isinstance(quantity, (int, float)) else None,
            valid_from=valid_from,
            valid_to=valid_to,
            week_start=week_start(observed),
            image_url=image_url,
            url=item.get("externalUrl") or f"https://www.marktguru.de/offers/{item.get('id')}",
            raw=item,
        )
