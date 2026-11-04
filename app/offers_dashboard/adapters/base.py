"""Gemeinsame Typen der Quellen-Adapter."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass
class RawOffer:
    external_id: str
    title: str
    description: str = ""
    brand: str = ""
    category: str = ""
    price: float = 0.0
    old_price: float | None = None
    base_price: str = ""
    unit: str = ""
    quantity: float | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    week_start: date | None = None
    image_url: str = ""
    url: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Location:
    id: int
    name: str
    zip: str
    kaufda_slug: str | None = None


@dataclass(frozen=True)
class Retailer:
    id: int
    name: str
    slug: str
    source: str
