/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  DB SCHEMA â€” SQLite Schema Definition
 *
 *  SSOT para la estructura de la base de datos.
 *  ArtÃ­culo I: SINGLE SOURCE OF TRUTH â€” Los datos se definen
 *  UNA VEZ aquÃ­ y se usan en toda la app.
 *
 *  Migraciones: cada cambio de schema es un nuevo archivo
 *  en server/db/migrations/ con nÃºmero de versiÃ³n.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

// v4 (Fase 1 â€” caja cuadre al centavo): payments.tip REAL NOT NULL DEFAULT 0
// (propina registrada en el MISMO payment que la recibe; total cobrado = amount + tip).
// v5 (S1): rol 'caja' REAL en staff (CHECK acepta 'caja') + cash_closings sin
// columnas fantasma (total_sales/total_iva/total_orders/sales_by_method nunca escritas).
// v6 (Fase 3 â€” simplificaciÃ³n): propina ELIMINADA de la app (se da directo al mesero).
//   - payments.method CHECK IN ('cash','qr') â€” solo Efectivo o QR (adiÃ³s yape/simple/card/transfer).
//   - payments.tip eliminada; payments.received/change REAL DEFAULT 0 â€” efectivo al centavo:
//     received = lo que el cliente ENTREGA, change = vuelto (received - amount).
//     MigraciÃ³n: mÃ©todos legacy â†’ 'qr'; amount' = amount + tip (no falsear histÃ³ricos).
// v7 (Fase 4 â€” flujo cerrado): order_items.round INTEGER NOT NULL DEFAULT 1 â€” "segunda
//   comanda": al agregar items a un pedido con platos ya procesados, entran en una RONDA
//   nueva (max+1) â†’ el KDS los muestra como tarjeta separada prioritaria ("Mesa 4 Â· Ronda 2").
// v8 (Fase 5 â€” cobro): payments.proof_photo TEXT NOT NULL DEFAULT '' â€” ruta del comprobante
//   foto del pago QR (se sube en base64, se guarda en data/payment-proofs/). SOLO aplica a
//   method='qr' (el efectivo no necesita foto). ADD COLUMN no destructivo.
// v9 (S1 â€” menÃº oficial de barra + promos): soporte de precios variable/promocionales.
//   - menu_items.price_variable INTEGER NOT NULL DEFAULT 0 â€” item con precio MANUAL
//     ("Consultar precio", ej. Negra Ahumada / Flor de CaÃ±a): price IS NULL + flag 1 â†’
//     el server exige manual_price > 0 en el payload (nunca factura Bs 0).
//   - menu_items.promo_price REAL NULL â€” precio promocional del item (MiÃ©rcoles de Barra
//     = 12, Primera Visita = 25); NULL = sin promo. El mesero lo aplica con toggle manual
//     (apply_promo) y el server lo valida contra la DB.
//   - order_items.promo_label TEXT NULL â€” 'Promo' cuando la lÃ­nea se facturÃ³ con
//     promo_price (el ticket imprime "(Promo)" discreto para la caja).
//   Las 3 son ADD COLUMN no destructivas (los registros existentes quedan con defaults).
const SCHEMA_VERSION = 12;

const CREATE_TABLES = [
  // â”€â”€ Staff / Users (v5: 4 roles â€” admin, mesero, kds, caja) â”€â”€â”€â”€â”€
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

  // â”€â”€ Tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Menu Categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  `CREATE TABLE IF NOT EXISTS menu_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT 'ðŸ½',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // â”€â”€ Menu Items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  `CREATE TABLE IF NOT EXISTS menu_items (
    id              TEXT PRIMARY KEY,
    category_id     TEXT NOT NULL,
    name            TEXT NOT NULL,
    subtitle        TEXT,
    description     TEXT NOT NULL DEFAULT '',
    price           INTEGER,
    price_variable  INTEGER NOT NULL DEFAULT 0,  -- v9: precio MANUAL ("Consultar precio")
    promo_price     INTEGER,                    -- v9/v11: centavos (NULL = sin promo)
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

  // â”€â”€ Modifier Groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Modifier Options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  `CREATE TABLE IF NOT EXISTS modifier_options (
    id              TEXT PRIMARY KEY,
    group_id        TEXT NOT NULL,
    name            TEXT NOT NULL,
    price_adjustment INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    is_default      INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
  )`,

  // â”€â”€ Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  `CREATE TABLE IF NOT EXISTS orders (
    id              TEXT PRIMARY KEY,
    table_id        TEXT NOT NULL,
    table_number    INTEGER NOT NULL,
    waiter_id       TEXT NOT NULL,
    waiter_name     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','called','confirmed','preparing','ready','served','paid','cancelled')),
    subtotal        INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    iva_amount      INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    discount        INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    discount_reason TEXT NOT NULL DEFAULT '',
    total           INTEGER NOT NULL DEFAULT 0, -- v11: centavos
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

  // â”€â”€ Order Line Items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // v7: columna `round` â€” "segunda comanda". Items agregados a un pedido con
  // platos ya procesados entran en una ronda nueva (max+1) para que el KDS
  // los muestre como tarjeta separada (orden de prioridades).
  `CREATE TABLE IF NOT EXISTS order_items (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    menu_item_id    TEXT NOT NULL,
    menu_item_name  TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      INTEGER NOT NULL, -- v11: centavos
    modifiers_json  TEXT,  -- JSON array of {groupName, optionName, priceAdjustment}
    promo_label     TEXT,  -- v9: 'Promo' cuando la lÃ­nea se facturÃ³ con promo_price
    subtotal        INTEGER NOT NULL, -- v11: centavos
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','preparing','ready','delivered','cancelled')),
    round           INTEGER NOT NULL DEFAULT 1,
    preparation_notes TEXT NOT NULL DEFAULT '',
    promo_type      TEXT,  -- v10: '2x1'|'barra'|'combo'|'primera-visita' (Sprint Promos)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,

  // â”€â”€ Payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // v6 (Fase 3): SOLO cash|qr, sin propina. received/change = efectivo al centavo.
  // v8 (Fase 5): proof_photo â€” comprobante foto del pago QR (base64 â†’ data/payment-proofs/).
  `CREATE TABLE IF NOT EXISTS payments (
    id            TEXT PRIMARY KEY,
    order_id      TEXT NOT NULL,
    method        TEXT NOT NULL CHECK(method IN ('cash','qr')),
    amount        INTEGER NOT NULL, -- v11: centavos
    iva_amount    INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    received      INTEGER NOT NULL DEFAULT 0,  -- efectivo: centavos
    change        INTEGER NOT NULL DEFAULT 0,  -- efectivo: centavos
    reference     TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','refunded')),
    processed_by  TEXT NOT NULL,
    processed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    notes         TEXT NOT NULL DEFAULT '',
     proof_photo   TEXT NOT NULL DEFAULT '',  -- v8: ruta del comprobante QR (ej. /payment-proofs/xxx.jpg)
     payment_operation_id TEXT,
    synced_at     TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (processed_by) REFERENCES staff(id)
  )`,

  // â”€â”€ Cash Closing (Corte de Caja) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // v5: SIN columnas fantasma (total_sales/total_iva/total_orders/sales_by_method
  // nunca fueron escritas â€” los reportes reales viven en /api/reports/sales/daily).
  `CREATE TABLE IF NOT EXISTS cash_closings (
    id              TEXT PRIMARY KEY,
    closing_date    TEXT NOT NULL,
    opened_at       TEXT NOT NULL,
    closed_at       TEXT,
    opened_by       TEXT NOT NULL,
    closed_by       TEXT,
    expected_cash   INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    actual_cash     INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    cash_difference INTEGER NOT NULL DEFAULT 0, -- v11: centavos
    is_reconciled   INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (opened_by) REFERENCES staff(id),
    FOREIGN KEY (closed_by) REFERENCES staff(id)
  )`,

  // â”€â”€ Waiter Calls (mesero llamar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Client Sessions (QR mesas â€” server-side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // v3: Sesiones QR que ANTES vivÃ­an en memoria del navegador Admin.
  // Ahora viven en el servidor â†’ el cliente puede validarlas.
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

  // â”€â”€ Sync Log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Schema Version â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  `CREATE TABLE IF NOT EXISTS schema_version (
    version   INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS payment_operations (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL,
    total_amount    INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('pending','completed','failed','cancelled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (created_by) REFERENCES staff(id)
  )`,

  `CREATE TABLE IF NOT EXISTS payment_proofs (
    id          TEXT PRIMARY KEY,
    payment_id  TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    hash        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    reviewer    TEXT,
    supersedes  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (payment_id) REFERENCES payments(id),
    FOREIGN KEY (reviewer) REFERENCES staff(id),
    FOREIGN KEY (supersedes) REFERENCES payment_proofs(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_payment_operations_order ON payment_operations(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_proofs_payment ON payment_proofs(payment_id)`,
];

/**
 * Apply all schema tables if they don't exist
 */
function applySchema(db) {
  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check current schema version (fresh DB: tabla aÃºn no existe)
  let currentVersion = null;
  try {
    currentVersion = db.prepare(
      `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`
    ).get();
  } catch {
    // Primera ejecuciÃ³n â€” schema_version aÃºn no existe
  }

  if (currentVersion && currentVersion.version >= SCHEMA_VERSION) {
    console.log(`[DB] Schema at version ${currentVersion.version}, no migration needed`);
    return;
  }

  // â”€â”€ v5: la recreaciÃ³n de tablas (staff/cash_closings) requiere FK OFF â”€â”€â”€â”€â”€
  // SQLite NO permite cambiar un CHECK con ALTER TABLE. La tÃ©cnica es:
  //  1. foreign_keys=OFF ANTES de la transacciÃ³n (dentro de una transacciÃ³n
  //     el pragma es no-op).
  //  2. Recrear la tabla con el DDL nuevo, copiar datos, DROP, RENAME.
  //  3. foreign_keys=ON tras el COMMIT â€” las FKs de payments/orders apuntan
  //     a `staff` POR NOMBRE â†’ re-apuntan automÃ¡ticamente a la tabla nueva.
  // La tabla es pequeÃ±a (3-4 filas) y no hay FKs entrantes con ON DELETE
  // CASCADE â€” el PRAGMA foreign_key_check al final lo verifica.
  db.pragma('foreign_keys = OFF');
  try {
    const transaction = db.transaction(() => {
      for (const sql of CREATE_TABLES) {
        db.exec(sql);
      }
      // â”€â”€ Migraciones idempotentes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // v6 (Fase 3): payments sin propina, SOLO cash|qr, +received/change.
      // Disparador: payments PRE-v6 (sin columna received â€” solo existe en v6).
      // Cubre v3 (sin tip, 5 mÃ©todos), v4/v5 (con tip). La columna tip se
      // detecta DENTRO de migratePaymentsV6 para absorberla en amount.
      if (!hasColumn(db, 'payments', 'received')) {
        migratePaymentsV6(db);
        console.log('[DB] Migration v6: payments sin propina, mÃ©todos cash|qr, +received/change');
      }
      // v7 (Fase 4): order_items.round â€” "segunda comanda". ADD COLUMN es no
      // destructivo (los items existentes quedan round=1). Disparador: falta
      // la columna (pre-v7).
      if (!hasColumn(db, 'order_items', 'round')) {
        db.exec(`ALTER TABLE order_items ADD COLUMN round INTEGER NOT NULL DEFAULT 1`);
        console.log('[DB] Migration v7: order_items.round (segunda comanda)');
      }
      // v8 (Fase 5): payments.proof_photo â€” comprobante foto QR. ADD COLUMN
      // no destructivo (pagos existentes quedan ''). Disparador: falta columna.
      if (!hasColumn(db, 'payments', 'proof_photo')) {
        db.exec(`ALTER TABLE payments ADD COLUMN proof_photo TEXT NOT NULL DEFAULT ''`);
        console.log('[DB] Migration v8: payments.proof_photo (comprobante QR)');
      }
      // v9 (S1 â€” menÃº oficial de barra + promos): price_variable/promo_price en
      // menu_items + promo_label en order_items. Cada ADD COLUMN se dispara por
      // separado (defensivo ante DBs parcialmente migradas). No destructivo:
      // items existentes â†’ price_variable=0, promo_price=NULL, promo_label=NULL.
      if (!hasColumn(db, 'menu_items', 'price_variable')) {
        db.exec(`ALTER TABLE menu_items ADD COLUMN price_variable INTEGER NOT NULL DEFAULT 0`);
        console.log('[DB] Migration v9: menu_items.price_variable (precio manual)');
      }
      if (!hasColumn(db, 'menu_items', 'promo_price')) {
        db.exec(`ALTER TABLE menu_items ADD COLUMN promo_price INTEGER`);
        console.log('[DB] Migration v9: menu_items.promo_price (precio promocional)');
      }
      if (!hasColumn(db, 'order_items', 'promo_label')) {
        db.exec(`ALTER TABLE order_items ADD COLUMN promo_label TEXT`);
        console.log('[DB] Migration v9: order_items.promo_label (Promo en ticket)');
      }
      // v10 (Sprint Promos 2026-08-19): order_items.promo_type â€” tipo de promo
      // aplicada ('2x1'|'barra'|'combo'|'primera-visita'). No destructivo:
      // items existentes â†’ NULL. El server valida el tipo contra la config
      // SSOT (src/core/config/promotions.js) y lo usa para revalidar contexto.
      if (!hasColumn(db, 'order_items', 'promo_type')) {
        db.exec(`ALTER TABLE order_items ADD COLUMN promo_type TEXT`);
        console.log('[DB] Migration v10: order_items.promo_type (promos por dÃ­a laboral)');
      }
      // v5a: staff con rol 'caja' â€” recrear SOLO si el CHECK viejo no lo acepta
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
      // v11 (2026-08-19): MIGRACIÓN A CENTAVOS — todo dinero pasa a ENTEROS
      // en la unidad mínima (Bs 10.50 → 1050 centavos). Regla MANDATORIA del
      // ecosistema FORCH.iA (money-minor-units). Disparador: DB pre-v11
      // (currentVersion < 11). Las DBs fresh ya nacen con INTEGER (CREATE_TABLES
      // actualizado) y tienen 0 filas → el UPDATE ×100 es no-op. ROUND() evita
      // residuos float (10.5*100 = 1050 exacto). NULL se conserva (price manual).
      if (currentVersion && currentVersion.version < 11) {
        migrateMoneyToCentsV11(db);
        console.log('[DB] Migration v11: dinero a centavos (INTEGER ×100)');
      }
       if (!hasColumn(db, 'payments', 'payment_operation_id')) {
         db.exec('ALTER TABLE payments ADD COLUMN payment_operation_id TEXT');
       }
       // v12: financial operation and private proof metadata tables are created
       // with IF NOT EXISTS so partially upgraded databases remain repairable.
       db.exec(CREATE_TABLES.filter(sql => sql.includes('payment_operations') || sql.includes('payment_proofs') || sql.includes('idx_payment_')).join(';'));
       // Record schema version
      db.prepare(`INSERT OR REPLACE INTO schema_version (version) VALUES (?)`).run(SCHEMA_VERSION);
    });

    transaction();

    // Post-migraciÃ³n: verificar integridad referencial (fail loud)
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length > 0) {
      console.error('[DB] âš ï¸ foreign_key_check detectÃ³ violaciones tras la migraciÃ³n:', fkViolations);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  console.log(`[DB] Schema v${SCHEMA_VERSION} applied successfully`);
}

/** Â¿El CHECK de staff ya acepta el rol 'caja'? (vÃ­a sqlite_master.sql) */
function staffAcceptsCajaRole(db) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'staff'`).get();
  return !!row && !!row.sql && row.sql.includes("'caja'");
}

/**
 * Recrea una tabla con DDL nuevo preservando los datos (tÃ©cnica v5).
 * PRECAUCIÃ“N: llamar SOLO con foreign_keys=OFF (ver applySchema).
 * Dentro de la MISMA transacciÃ³n del applySchema.
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

/** Â¿Existe la columna en la tabla? (PRAGMA table_info) */
function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

/**
 * v11: convierte TODAS las columnas monetarias de Bs a centavos (x100).
 * Idempotente por diseno: solo corre con currentVersion < 11; en DBs fresh
 * (0 filas) es no-op. ROUND() elimina residuos float de la multiplicacion.
 * Corre DENTRO de la transaccion de applySchema (foreign_keys=OFF).
 */
function migrateMoneyToCentsV11(db) {
  const MONEY_COLUMNS = [
    ['menu_items', ['price', 'promo_price']],
    ['modifier_options', ['price_adjustment']],
    ['orders', ['subtotal', 'iva_amount', 'discount', 'total']],
    ['order_items', ['unit_price', 'subtotal']],
    ['payments', ['amount', 'iva_amount', 'received', 'change']],
    ['cash_closings', ['expected_cash', 'actual_cash', 'cash_difference']],
  ];
  for (const [table, cols] of MONEY_COLUMNS) {
    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).get(table);
    if (!exists) continue;
    for (const col of cols) {
      if (hasColumn(db, table, col)) {
        db.exec(`UPDATE ${table} SET ${col} = ROUND(${col} * 100)`);
      }
    }
  }
}

/**
 * v6 (Fase 3): recrea `payments` con el DDL nuevo (sin tip, CHECK cash|qr,
 * +received/change) PRESERVANDO datos:
 *  - mÃ©todos legacy (qr_yape, qr_simple, card, transfer) â†’ 'qr' (todo no-efectivo es QR).
 *  - si la columna tip existe (v4/v5): amount' = amount + tip â†’ los totales
 *    histÃ³ricos del dÃ­a no cambian (SUM(amount) nuevo == SUM(amount + tip) viejo).
 *    En v3 (sin tip): amount' = amount.
 *  - received/change = 0 en pagos legacy (no habÃ­a registro de vuelto).
 * DEBE correr con foreign_keys=OFF (misma transacciÃ³n de applySchema).
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
