"""SQLite-Verbindung und Migrationen."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT / "migrations"

DEFAULT_RETAILERS = [
    ("Kaufland", "kaufland", "marktguru"),
    ("Lidl", "lidl", "marktguru"),
    ("OBI", "obi", "kaufda"),
    ("BAUHAUS", "bauhaus", "kaufda"),
    ("toom", "toom", "kaufda"),
    ("HORNBACH", "hornbach", "kaufda"),
]


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def connect(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    applied = {
        row["version"] for row in conn.execute("SELECT version FROM schema_version").fetchall()
    }
    for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = int(sql_file.stem.split("_", 1)[0])
        if version in applied:
            continue
        conn.executescript(sql_file.read_text(encoding="utf-8"))
        conn.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
            (version, utc_now()),
        )
        conn.commit()


def seed_retailers(conn: sqlite3.Connection) -> None:
    for name, slug, source in DEFAULT_RETAILERS:
        conn.execute(
            "INSERT INTO retailers (name, slug, source, active) VALUES (?, ?, ?, 1) "
            "ON CONFLICT(slug) DO NOTHING",
            (name, slug, source),
        )
    conn.commit()


def init_db(db_path: str | Path) -> sqlite3.Connection:
    conn = connect(db_path)
    migrate(conn)
    seed_retailers(conn)
    return conn
