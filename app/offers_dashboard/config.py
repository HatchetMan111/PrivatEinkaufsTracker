"""Konfiguration aus Umgebungsvariablen."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


@dataclass(frozen=True)
class Settings:
    db_path: str = field(default_factory=lambda: _env("OFFERS_DB", "/var/lib/offers-dashboard/offers.db"))
    port: int = field(default_factory=lambda: int(_env("OFFERS_PORT", "8000")))
    tz: str = field(default_factory=lambda: _env("OFFERS_TZ", "Europe/Berlin"))
    user_agent: str = field(
        default_factory=lambda: _env(
            "OFFERS_USER_AGENT",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
    )


def get_settings() -> Settings:
    return Settings()
