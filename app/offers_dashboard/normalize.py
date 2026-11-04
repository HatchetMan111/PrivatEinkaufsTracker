"""Normalisierung von Produktnamen fuer das Matching."""

from __future__ import annotations

import hashlib
import re
import unicodedata

_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})
_PUNCT = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACE = re.compile(r"\s+")

_QUANTITY_PATTERNS = [
    re.compile(
        r"\bje\s+\d+(?:[.,]\d+)?\s*[-–]?\s*"
        r"(?:g|kg|ml|l|stk|st|stueck|stück|blatt|packg|packung|pck)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d+\s*[x×]\s*\d*(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b", re.IGNORECASE),
    re.compile(r"\b\d+(?:[.,]\d+)?\s*[-–]\s*(?:g|kg|ml|l)\b", re.IGNORECASE),
    re.compile(
        r"\b\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*"
        r"(?:g|kg|ml|l|stk|st|stueck|stück|blatt)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b\d+(?:[.,]\d+)?\s*"
        r"(?:g|kg|ml|l|stk|st|stueck|stück|blatt|packg|packung|pck)\b",
        re.IGNORECASE,
    ),
    re.compile(r"[-–]\s*(?:stueck|stk|st|blatt)\b", re.IGNORECASE),
]


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", value).casefold().translate(_UMLAUTS)
    for pattern in _QUANTITY_PATTERNS:
        text = pattern.sub(" ", text)
    text = re.sub(r"\b(?:packg|packung|pck)\b", " ", text)
    text = _PUNCT.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


def unit_key(unit: str | None, quantity: float | None) -> str:
    parts: list[str] = []
    if quantity is not None:
        try:
            parts.append(f"{float(quantity):g}")
        except (TypeError, ValueError):
            pass
    if unit:
        parts.append(normalize_name(unit))
    return "".join(parts)


def match_key(retailer_id: int, brand: str | None, name: str | None, unit: str | None) -> str:
    payload = "|".join(
        [
            str(retailer_id),
            normalize_name(brand),
            normalize_name(name),
            unit or "",
        ]
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()
