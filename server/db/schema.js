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

// v4 (Fase 1 — caja cuadre al centavo): payments.tip REAL NOT NULL DEFAULT 0
// (propina registrada en el MISMO payment que la recibe; total cobrado = amount + tip).
// v5 (S1): rol 'caja' REAL en staff (CHECK acepta 'caja') + cash_closings sin
// columnas fantasma (total_sales/total_iva/total_orders/sales_by_method nunca escritas).
// v6 (Fase 3 — simplificación): propina ELIMINADA de la app (se da directo al mesero).
//   - payments.method CHECK IN ('cash','qr') — solo Efectivo o QR (adiós yape/simple/card/transfer).
//   - payments.tip eliminada; payments.received/change REAL DEFAULT 0 — efectivo al centavo:
//     received = lo que el cliente ENTREGA, change = vuelto (received - amount).
//     Migración: métodos legacy → 'qr'; amount' = amount + tip (no falsear históricos).
// v7 (Fase 4 — flujo cerrado): order_items.round INTEGER NOT NULL DEFAULT 1 — "segunda
//   comanda": al agregar items a un pedido con platos ya procesados, entran en una RONDA
//   nueva (max+1) → el KDS los muestra como tarjeta separada prioritaria ("Mesa 4 · Ronda 2").
// v8 (Fase 5 — cobro): payments.proof_photo TEXT NOT NULL DEFAULT '' — ruta del comprobante
//   foto del pago QR (se sube en base64, se guarda en data/payment-proofs/). SOLO aplica a
//   method='qr' (el efectivo no necesita foto). ADD COLUMN no destructivo.
// v9 (S1 — menú oficial de barra + promos): soporte de precios variable/promocionales.
//   - menu_items.price_variable INTEGER NOT NULL DEFAULT 0 — item con precio MANUAL
//     ("Consultar precio", ej. Negra Ahumada / Flor de Caña): price IS NULL + flag 1 →
//     el server exige manual_price > 0 en el payload (nunca factura Bs 0).
//   - menu_items.promo_price REAL NULL — precio promocional del item (Miércoles de Barra
//     = 12, Primera Visita = 25); NULL = sin promo. El mesero lo aplica con toggle manual
//     (apply_promo) y el server lo valida contra la DB.
//   - order_items.promo_label TEXT NULL — 'Promo' cuando la línea se facturó con
//     promo_price (el ticket imprime "(Promo)" discreto para la caja).
//   Las 3 son ADD COLUMN no destructivas (los registros existentes quedan con defaults).
const SCHEMA_VERSION = 9;

const CREATE_TABLES = [
  // ── Staff / Users (v5: 4 roles — admin, mesero, kds, caja) ─────
  `CREATE TABLE IF NOT EXISTS staff (
    id          TEXT PRIMARY KEY,
    pin_hash    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('admin','mesero','kds','caja')),
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
    price_variable  INTEGER NOT NULL DEFAULT 0,  -- v9: precio MANUAL ("Consultar precio")
    promo_price     REAL,                        -- v9: precio promocional (NULL = sin promo)
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
  // v7: columna `round` — "segunda comanda". Items agregados a un pedido con
  // platos ya procesados entran en una ronda nueva (max+1) para que el KDS
  // los muestre como tarjeta separada (orden de prioridades).
  `CREATE TABLE IF NOT EXISTS order_items (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    menu_item_id    TEXT NOT NULL,
    menu_item_name  TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      REAL NOT NULL,
    modifiers_json  TEXT,  -- JSON array of {groupName, optionName, priceAdjustment}
    promo_label     TEXT,  -- v9: 'Promo' cuando la línea se facturó con promo_price
    subtotal        REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled')),
    round           INTEGER NOT NULL DEFAULT 1,
    preparation_notes TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,

  // ── Payments ──────────────────────────────────────────
  // v6 (Fase 3): SOLO cash|qr, sin propina. received/change = efectivo al centavo.
  // v8 (Fase 5): proof_photo — comprobante foto del pago QR (base64 → data/payment-proofs/).
  `CREATE TABLE IF NOT EXISTS payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL,
    method        TEXT NOT NULL CHECK(method IN ('cash','qr')),
    amount        REAL NOT NULL,
    iva_amount    REAL NOT NULL DEFAULT 0,
    received      REAL NOT NULL DEFAULT 0,  -- efectivo: lo que el cliente entrega
    change        REAL NOT NULL DEFAULT 0,  -- efectivo: vuelto = received - amount
    reference     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
    processed_by  TEXT NOT NULL,
    processed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    notes         TEXT NOT NULL DEFAULT '',
    proof_photo   TEXT NOT NULL DEFAULT '',  -- v8: ruta del comprobante QR (ej. /payment-proofs/xxx.jpg)
    synced_at     TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (processed_by) REFERENCES staff(id)
  )`,

  // ── Cash Closing (Corte de Caja) ──────────────────────
  // v5: SIN columnas fantasma (total_sales/total_iva/total_orders/sales_by_method
  // nunca fueron escritas — los reportes reales viven en /api/reports/sales/daily).
  `CREATE TABLE IF NOT EXISTS cash_closings (
    id              TEXT PRIMARY KEY,
    closing_date    TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_at       TEXT,
    opened_by       TEXT NOT NULL,
    closed_by       TEXT,
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

  // ── Client Sessions (QR mesas — server-side) ──────────
  // v3: Sesiones QR que ANTES vivían en memoria del navegador Admin.
  // Ahora viven en el servidor → el cliente puede validarlas.
  `CREATE TABLE IF NOT EXISTS client_sessions (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL UNIQUE,
    table_number INTEGER NOT NULL,
    expires_at  TEXT NOT NULL,
    order_id    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT,
    interactions INTEGER NOT NULL DEFAULT 0
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

  // ── v5: la recreación de tablas (staff/cash_closings) requiere FK OFF ─────
  // SQLite NO permite cambiar un CHECK con ALTER TABLE. La técnica es:
  //  1. foreign_keys=OFF ANTES de la transacción (dentro de una transacción
  //     el pragma es no-op).
  //  2. Recrear la tabla con el DDL nuevo, copiar datos, DROP, RENAME.
  //  3. foreign_keys=ON tras el COMMIT — las FKs de payments/orders apuntan
  //     a `staff` POR NOMBRE → re-apuntan automáticamente a la tabla nueva.
  // La tabla es pequeña (3-4 filas) y no hay FKs entrantes con ON DELETE
  // CASCADE — el PRAGMA foreign_key_check al final lo verifica.
  db.pragma('foreign_keys = OFF');
  try {
    const transaction = db.transaction(() => {
      for (const sql of CREATE_TABLES) {
        db.exec(sql);
      }
      // ── Migraciones idempotentes ──────────────────────────
      // v6 (Fase 3): payments sin propina, SOLO cash|qr, +received/change.
      // Disparador: payments PRE-v6 (sin columna received — solo existe en v6).
      // Cubre v3 (sin tip, 5 métodos), v4/v5 (con tip). La columna tip se
      // detecta DENTRO de migratePaymentsV6 para absorberla en amount.
      if (!hasColumn(db, 'payments', 'received')) {
        migratePaymentsV6(db);
        console.log('[DB] Migration v6: payments sin propina, métodos cash|qr, +received/change');
      }
      // v7 (Fase 4): order_items.round — "segunda comanda". ADD COLUMN es no
      // destructivo (los items existentes quedan round=1). Disparador: falta
      // la columna (pre-v7).
      if (!hasColumn(db, 'order_items', 'round')) {
        db.exec(`ALTER TABLE order_items ADD COLUMN round INTEGER NOT NULL DEFAULT 1`);
        console.log('[DB] Migration v7: order_items.round (segunda comanda)');
      }
      // v8 (Fase 5): payments.proof_photo — comprobante foto QR. ADD COLUMN
      // no destructivo (pagos existentes quedan ''). Disparador: falta columna.
      if (!hasColumn(db, 'payments', 'proof_photo')) {
        db.exec(`ALTER TABLE payments ADD COLUMN proof_photo TEXT NOT NULL DEFAULT ''`);
        console.log('[DB] Migration v8: payments.proof_photo (comprobante QR)');
      }
      // v9 (S1 — menú oficial de barra + promos): price_variable/promo_price en
      // menu_items + promo_label en order_items. Cada ADD COLUMN se dispara por
      // separado (defensivo ante DBs parcialmente migradas). No destructivo:
      // items existentes → price_variable=0, promo_price=NULL, promo_label=NULL.
      if (!hasColumn(db, 'menu_items', 'price_variable')) {
        db.exec(`ALTER TABLE menu_items ADD COLUMN price_variable INTEGER NOT NULL DEFAULT 0`);
        console.log('[DB] Migration v9: menu_items.price_variable (precio manual)');
      }
      if (!hasColumn(db, 'menu_items', 'promo_price')) {
        db.exec(`ALTER TABLE menu_items ADD COLUMN promo_price REAL`);
        console.log('[DB] Migration v9: menu_items.promo_price (precio promocional)');
      }
      if (!hasColumn(db, 'order_items', 'promo_label')) {
        db.exec(`ALTER TABLE order_items ADD COLUMN promo_label TEXT`);
        console.log('[DB] Migration v9: order_items.promo_label (Promo en ticket)');
      }
      // v5a: staff con rol 'caja' — recrear SOLO si el CHECK viejo no lo acepta
      if (!staffAcceptsCajaRole(db)) {
        recreateTable(db, {
          table: 'staff',
          newSql: CREATE_TABLES[0], // DDL nuevo (CHECK con 'caja')
          copyColumns: ['id', 'pin_hash', 'role', 'display_name', 'is_active', 'current_shift', 'last_login_at', 'created_at', 'updated_at'],
        });
        console.log('[DB] Migration v5a: staff CHECK actualizado para rol caja');
      }
      // v5b: cash_closings sin columnas fantasma (nunca escritas)
      if (hasColumn(db, 'cash_closings', 'total_sales')) {
        recreateTable(db, {
          table: 'cash_closings',
          newSql: CREATE_TABLES.find(t => t.includes('cash_closings')),
          copyColumns: ['id', 'closing_date', 'opened_at', 'closed_at', 'opened_by', 'closed_by',
                        'expected_cash', 'actual_cash', 'cash_difference', 'is_reconciled', 'notes', 'created_at'],
        });
        console.log('[DB] Migration v5b: cash_closings sin columnas fantasma');
      }
      // Record schema version
      db.prepare(`INSERT OR REPLACE INTO schema_version (version) VALUES (?)`).run(SCHEMA_VERSION);
    });

    transaction();

    // Post-migración: verificar integridad referencial (fail loud)
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length > 0) {
      console.error('[DB] ⚠️ foreign_key_check detectó violaciones tras la migración:', fkViolations);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  console.log(`[DB] Schema v${SCHEMA_VERSION} applied successfully`);
}

/** ¿El CHECK de staff ya acepta el rol 'caja'? (vía sqlite_master.sql) */
function staffAcceptsCajaRole(db) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'staff'`).get();
  return !!row && !!row.sql && row.sql.includes("'caja'");
}

/**
 * Recrea una tabla con DDL nuevo preservando los datos (técnica v5).
 * PRECAUCIÓN: llamar SOLO con foreign_keys=OFF (ver applySchema).
 * Dentro de la MISMA transacción del applySchema.
 */
function recreateTable(db, { table, newSql, copyColumns }) {
  const tempTable = `${table}_v${SCHEMA_VERSION}`;
  const ddl = newSql
    .replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')
    .replace(table, tempTable);
  const cols = copyColumns.join(', ');
  db.exec(`
    ${ddl};
    INSERT INTO ${tempTable} (${cols}) SELECT ${cols} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${tempTable} RENAME TO ${table};
  `);
}

/** ¿Existe la columna en la tabla? (PRAGMA table_info) */
function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

/**
 * v6 (Fase 3): recrea `payments` con el DDL nuevo (sin tip, CHECK cash|qr,
 * +received/change) PRESERVANDO datos:
 *  - métodos legacy (qr_yape, qr_simple, card, transfer) → 'qr' (todo no-efectivo es QR).
 *  - si la columna tip existe (v4/v5): amount' = amount + tip → los totales
 *    históricos del día no cambian (SUM(amount) nuevo == SUM(amount + tip) viejo).
 *    En v3 (sin tip): amount' = amount.
 *  - received/change = 0 en pagos legacy (no había registro de vuelto).
 * DEBE correr con foreign_keys=OFF (misma transacción de applySchema).
 */
function migratePaymentsV6(db) {
  const ddl = CREATE_TABLES
    .find(t => t.includes('CREATE TABLE IF NOT EXISTS payments'))
    .replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')
    .replace('payments', 'payments_v6');
  const hasTip = hasColumn(db, 'payments', 'tip');
  const amountExpr = hasTip ? 'amount + tip' : 'amount';
  db.exec(`
    ${ddl};
    INSERT INTO payments_v6
      (id, order_id, method, amount, iva_amount, received, change, reference,
       status, processed_by, processed_at, notes, synced_at)
    SELECT id, order_id,
           CASE WHEN method = 'cash' THEN 'cash' ELSE 'qr' END,
           ${amountExpr},
           iva_amount, 0, 0, reference,
           status, processed_by, processed_at, notes, synced_at
    FROM payments;
    DROP TABLE payments;
    ALTER TABLE payments_v6 RENAME TO payments;
  `);
}

export { applySchema, SCHEMA_VERSION, CREATE_TABLES };
