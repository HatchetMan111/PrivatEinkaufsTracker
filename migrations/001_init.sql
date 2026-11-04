CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zip TEXT NOT NULL,
    kaufda_slug TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retailers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('marktguru', 'kaufda')),
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    external_id TEXT,
    UNIQUE (retailer_id, location_id, external_id)
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
    trigger TEXT NOT NULL DEFAULT 'timer',
    items_found INTEGER NOT NULL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    brand TEXT,
    category TEXT,
    price REAL NOT NULL DEFAULT 0,
    old_price REAL,
    base_price TEXT,
    unit TEXT,
    quantity REAL,
    valid_from TEXT,
    valid_to TEXT,
    week_start TEXT NOT NULL,
    image_url TEXT,
    url TEXT,
    raw_json TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE (source, external_id, location_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_offers_week ON offers (week_start);
CREATE INDEX IF NOT EXISTS idx_offers_location_week ON offers (location_id, week_start);
CREATE INDEX IF NOT EXISTS idx_offers_retailer ON offers (retailer_id);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    canonical_name TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    unit_key TEXT,
    match_key TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_retailer ON products (retailer_id);
CREATE INDEX IF NOT EXISTS idx_products_match_key ON products (match_key);

CREATE TABLE IF NOT EXISTS product_links (
    offer_id INTEGER PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'exact',
    confidence REAL NOT NULL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_product_links_product ON product_links (product_id);

CREATE TABLE IF NOT EXISTS product_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    normalized_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (retailer_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_lookup ON product_aliases (retailer_id, normalized_name);

CREATE TABLE IF NOT EXISTS price_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    offer_id INTEGER NOT NULL UNIQUE REFERENCES offers(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    week_start TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_points_product ON price_points (product_id, week_start);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
