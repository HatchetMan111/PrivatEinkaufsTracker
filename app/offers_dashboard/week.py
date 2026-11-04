"""Wochenlogik: Montag 00:00 bis Sonntag 23:59 Europe/Berlin."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

DEFAULT_TZ = "Europe/Berlin"


def as_local(dt: datetime, tz: str = DEFAULT_TZ) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo(tz))
    return dt.astimezone(ZoneInfo(tz))


def week_start(dt: datetime | date, tz: str = DEFAULT_TZ) -> date:
    """Montag der Woche, in der ``dt`` liegt."""
    if isinstance(dt, datetime):
        day = as_local(dt, tz).date()
    else:
        day = dt
    return day - timedelta(days=day.weekday())


def current_week(today: date | None = None, tz: str = DEFAULT_TZ) -> date:
    return week_start(today or datetime.now(ZoneInfo(tz)).date(), tz)


def previous_week(today: date | None = None, tz: str = DEFAULT_TZ) -> date:
    return current_week(today, tz) - timedelta(days=7)


def parse_iso_week(value: str) -> date:
    """``YYYY-Www`` -> Montag dieser ISO-Woche."""
    year_s, week_s = value.split("-W")
    monday = date.fromisocalendar(int(year_s), int(week_s), 1)
    return monday


def resolve_week(value: str | None, tz: str = DEFAULT_TZ) -> date:
    if not value or value == "current":
        return current_week(tz=tz)
    if value == "previous":
        return previous_week(tz=tz)
    return parse_iso_week(value)


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    # "+0000" -> "+00:00"
    if len(text) >= 5 and text[-5] in "+-" and text[-4:].isdigit():
        text = f"{text[:-5]}{text[-5:-2]}:{text[-2:]}"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d"):
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
    return None
