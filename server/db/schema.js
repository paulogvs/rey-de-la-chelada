/**
 * ═══════════════════════════════════════════════════════════
 *  DB SCHEMA — SQLite Schema Definition
 *
 *  SSOT para la estructura de la base de datos.
 *  Artículo I: SINGLE SOURCE OF TRUTH — Los datos se definen
 *  UNA VEZ aquí y se usan en toda la app.
 *
 *  Migraciones: cada cambio de schema es un nuevo archivo
 *  en server/db/migrations/ con número de versión.
 * ═══════════════════════════════════════════════════════════
 */

const SCHEMA_VERSION = 2;

const CREATE_TABLES = [
  // ── Staff / Users (v2: 3 roles only, no username) ─────
  `CREATE TABLE IF NOT EXISTS staff (
    id          TEXT PRIMARY KEY,
    pin_hash    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('admin','mesero','kds')),
    display_name TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    current_shift TEXT,
    last_login_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Tables ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tables (
    id              TEXT PRIMARY KEY,
    number          INTEGER NOT NULL UNIQUE,
    capacity        INTEGER NOT NULL DEFAULT 4,
    status          TEXT NOT NULL DEFAULT 'free' CHECK(status IN ('free','occupied','ordered','serving','payment','closed')),
    current_order_id TEXT,
    assigned_waiter_id TEXT,
    section         TEXT NOT NULL DEFAULT 'interior',
    position        INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Menu Categories ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS menu_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT '🍽',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Menu Items ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS menu_items (
    id              TEXT PRIMARY KEY,
    category_id     TEXT NOT NULL,
    name            TEXT NOT NULL,
    subtitle        TEXT,
    description     TEXT NOT NULL DEFAULT '',
    price           REAL,
    currency        TEXT NOT NULL DEFAULT 'BOB',
    iva_percentage  REAL NOT NULL DEFAULT 13,
    image_url       TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    is_available    INTEGER NOT NULL DEFAULT 1,
    preparation_time INTEGER NOT NULL DEFAULT 15,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    area            TEXT NOT NULL CHECK(area IN ('bar','cocina')),
    has_ice         INTEGER NOT NULL DEFAULT 0,
    ingredient_list TEXT,  -- JSON array
    garnish_list    TEXT,  -- JSON array
    recipe_json     TEXT,  -- JSON object
    size_variants   TEXT,  -- JSON object: {"mediana": 40, "familiar": 60}
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES menu_categories(id)
  )`,

  // ── Modifier Groups ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS modifier_groups (
    id          TEXT PRIMARY KEY,
    menu_item_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('select','multi','toggle')),
    required    INTEGER NOT NULL DEFAULT 0,
    min_select  INTEGER NOT NULL DEFAULT 0,
    max_select  INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  )`,

  // ── Modifier Options ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS modifier_options (
    id              TEXT PRIMARY KEY,
    group_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    price_adjustment REAL NOT NULL DEFAULT 0,
    is_default      INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
  )`,

  // ── Orders ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    table_id        TEXT NOT NULL,
    table_number    INTEGER NOT NULL,
    waiter_id       TEXT NOT NULL,
    waiter_name     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','called','confirmed','preparing','ready','served','paid','cancelled')),
    subtotal        REAL NOT NULL DEFAULT 0,
    iva_amount      REAL NOT NULL DEFAULT 0,
    discount        REAL NOT NULL DEFAULT 0,
    discount_reason TEXT NOT NULL DEFAULT '',
    total           REAL NOT NULL DEFAULT 0,
    payment_method  TEXT,
    payment_reference TEXT,
    is_paid         INTEGER NOT NULL DEFAULT 0,
    paid_at         TEXT,
    notes           TEXT NOT NULL DEFAULT '',
    guest_count     INTEGER NOT NULL DEFAULT 1,
    local_id        TEXT,
    synced_at       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (table_id) REFERENCES tables(id),
    FOREIGN KEY (waiter_id) REFERENCES staff(id)
  )`,

  // ── Order Line Items ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS order_items (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    menu_item_id    TEXT NOT NULL,
    menu_item_name  TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      REAL NOT NULL,
    modifiers_json  TEXT,  -- JSON array of {groupName, optionName, priceAdjustment}
    subtotal        REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled')),
    preparation_notes TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,

  // ── Payments ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL,
    method        TEXT NOT NULL CHECK(method IN ('cash','qr_yape','qr_simple','card','transfer')),
    amount        REAL NOT NULL,
    iva_amount    REAL NOT NULL DEFAULT 0,
    reference     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
    processed_by  TEXT NOT NULL,
    processed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    notes         TEXT NOT NULL DEFAULT '',
    synced_at     TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (processed_by) REFERENCES staff(id)
  )`,

  // ── Cash Closing (Corte de Caja) ──────────────────────
  `CREATE TABLE IF NOT EXISTS cash_closings (
    id              TEXT PRIMARY KEY,
    closing_date    TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_at       TEXT,
    opened_by       TEXT NOT NULL,
    closed_by       TEXT,
    total_sales     REAL NOT NULL DEFAULT 0,
    total_iva       REAL NOT NULL DEFAULT 0,
    total_orders    INTEGER NOT NULL DEFAULT 0,
    sales_by_method TEXT,  -- JSON object
    expected_cash   REAL NOT NULL DEFAULT 0,
    actual_cash     REAL NOT NULL DEFAULT 0,
    cash_difference REAL NOT NULL DEFAULT 0,
    is_reconciled   INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (opened_by) REFERENCES staff(id),
    FOREIGN KEY (closed_by) REFERENCES staff(id)
  )`,

  // ── Waiter Calls (mesero llamar) ──────────────────────
  `CREATE TABLE IF NOT EXISTS waiter_calls (
    id            TEXT PRIMARY KEY,
    table_id      TEXT NOT NULL,
    table_number  INTEGER NOT NULL,
    session_id    TEXT NOT NULL,
    call_type     TEXT NOT NULL CHECK(call_type IN ('call_waiter','request_bill')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','done','cancelled')),
    accepted_by   TEXT,
    accepted_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (table_id) REFERENCES tables(id)
  )`,

  // ── Sync Log ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sync_log (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL CHECK(action IN ('created','updated','deleted')),
    payload_json TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at   TEXT
  )`,

  // ── Schema Version ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS schema_version (
    version   INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

/**
 * Apply all schema tables if they don't exist
 */
function applySchema(db) {
  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check current schema version (fresh DB: tabla aún no existe)
  let currentVersion = null;
  try {
    currentVersion = db.prepare(
      `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`
    ).get();
  } catch {
    // Primera ejecución — schema_version aún no existe
  }

  if (currentVersion && currentVersion.version >= SCHEMA_VERSION) {
    console.log(`[DB] Schema at version ${currentVersion.version}, no migration needed`);
    return;
  }

  // Create all tables
  const transaction = db.transaction(() => {
    for (const sql of CREATE_TABLES) {
      db.exec(sql);
    }
    // Record schema version
    db.prepare(`INSERT OR REPLACE INTO schema_version (version) VALUES (?)`).run(SCHEMA_VERSION);
  });

  transaction();
  console.log(`[DB] Schema v${SCHEMA_VERSION} applied successfully`);
}

export { applySchema, SCHEMA_VERSION, CREATE_TABLES };
