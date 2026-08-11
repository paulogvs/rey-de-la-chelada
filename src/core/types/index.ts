/**
 * REY DE LA CHELADA — Core Types
 * 
 * SSOT for all data types in the system.
 * These types define the complete data model shared across ALL modules.
 * UI layer ONLY consumes. Business logic lives in src/core/engine/
 * 
 * Artículo I: SINGLE SOURCE OF TRUTH
 * Artículo II: ZERO HARDCODED VALUES
 */

// ============================================================
// ENUMS & UNIONS
// ============================================================

/** Table status for salon management */
export type TableStatus = 'free' | 'occupied' | 'ordered' | 'serving' | 'payment' | 'closed';

/** Kitchen order status (KDS) */
export type KDSStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

/** Order status lifecycle */
export type OrderStatus = 'draft' | 'called' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';

/** System roles (v5: 4 roles — admin, mesero, kds, caja) */
export type UserRole = 'admin' | 'mesero' | 'kds' | 'caja';

/** Payment methods (FASE 3: SOLO Efectivo o QR — el corte separa cajón vs depósito) */
export type PaymentMethod = 'cash' | 'qr';

/** Menu item modifier type */
export type ModifierType = 'select' | 'multi' | 'toggle';

/** Shift types */
export type Shift = 'morning' | 'afternoon' | 'night';

// ============================================================
// CORE ENTITIES
// ============================================================

/** A restaurant table (not a visual position — a logical entity) */
export interface Table {
  id: string;
  number: number;           // Visible table number (1-10)
  capacity: number;         // Max persons
  status: TableStatus;
  currentOrderId: string | null;
  assignedWaiterId: string | null;
  section: string;          // 'barra' | 'interior' | 'terraza' | etc.
  position: number;         // Sort order for display grid (NOT absolute coordinates)
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Table configuration (admin-editable, not hardcoded) */
export interface TableConfig {
  totalTables: number;
  numberingStyle: 'sequential' | 'sectioned';
  sections: string[];       // e.g. ['barra', 'interior', 'terraza']
  defaultCapacity: number;
  gridColumns: number;      // How many columns in the table grid display
}

/** Menu category */
export interface MenuCategory {
  id: string;
  name: string;
  description: string;
  emoji: string;            // For quick visual reference
  sortOrder: number;
  isActive: boolean;
}

/** Menu item modifier option */
export interface ModifierOption {
  id: string;
  name: string;             // e.g. "Preparada", "Sencilla", "Grande", "Chica"
  priceAdjustment: number;  // Price difference in BOB (can be negative or 0)
  isDefault: boolean;
  sortOrder: number;
}

/** Menu item modifier group */
export interface ModifierGroup {
  id: string;
  name: string;             // e.g. "Tipo de michelada", "Tamaño"
  type: ModifierType;       // 'select' (one), 'multi' (many), 'toggle' (on/off)
  required: boolean;
  min: number;              // Minimum selections
  max: number;              // Maximum selections
  options: ModifierOption[];
  sortOrder: number;
}

/** Menu item (product) */
export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  subtitle?: string;         // Subtítulo o tagline del producto
  description: string;
  price: number | null;      // Final price with IVA included (BOB), null si es item con variantes
  currency: string;          // 'BOB' — se muestra como "Bs"
  ivaPercentage: number;     // 13% default for Bolivia
  imageUrl: string | null;
  isActive: boolean;
  isAvailable: boolean;      // Temporarily out of stock
  modifierGroups: ModifierGroup[];
  tags: string[];            // e.g. ['popular', 'new', 'recommended']
  preparationTime: number;   // Minutes
  sortOrder: number;
  area?: 'bar' | 'cocina';   // Para enrutar al KDS correcto
  ingredientes?: string[];   // Lista de ingredientes para mostrar
  garnish?: string[];        // Decoración/garnish para items de barra
  receta_tecnica?: {         // Receta técnica (solo barra)
    base?: string;
    mezcla?: string[];
  };
  sizeVariants?: Record<string, number | null>;  // Para items con variantes de tamaño (ej: pizzas)
  hasIce?: boolean;           // Sujeto a ICE (Impuesto al Consumo Específico)
}

/** A line item in an order (product + modifiers) */
export interface OrderLineItem {
  id: string;
  menuItemId: string;
  menuItemName: string;     // Denormalized for offline display
  quantity: number;
  unitPrice: number;
  modifiers: {
    groupName: string;
    optionName: string;
    priceAdjustment: number;
  }[];
  subtotal: number;         // (unitPrice + modifier adjustments) * quantity
  status: KDSStatus;
  preparationNotes: string;
  createdAt: string;
  /** Área KDS (cocina/bar) — camelCase (ordersApi) o snake_case (KDS WS). */
  kdsModule?: string;
  /** Área KDS en snake_case (server DB mi.area vía KDS WS). */
  kds_module?: string;
  /** FASE 4B: ronda ("segunda comanda") — items agregados a un pedido con
   *  platos ya procesados entran en una ronda nueva (max+1). */
  round?: number;
}

/** Customer order */
export interface Order {
  id: string;
  tableId: string;
  tableNumber: number;
  waiterId: string;
  waiterName: string;
  items: OrderLineItem[];
  status: OrderStatus;
  subtotal: number;
  ivaAmount: number;
  discount: number;
  discountReason: string;
  total: number;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;  // QR transaction ID, transfer ref, etc.
  isPaid: boolean;
  paidAt: string | null;
  notes: string;
  guestCount: number;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;           // For offline sync tracking
  localId: string;                    // Client-side ID (IndexedDB)
}

/** Payment transaction (FASE 3: sin propina; received/change = efectivo al centavo) */
export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  ivaAmount: number;
  received: number;          // efectivo: lo que el cliente entrega (0 si no aplica)
  change: number;            // efectivo: vuelto = received - amount (0 si no aplica)
  reference: string;         // QR code, transaction ID, etc.
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  processedBy: string;        // User ID
  processedAt: string;
  notes: string;
  syncedAt: string | null;
}

/** System user (staff) */
export interface StaffUser {
  id: string;
  username: string;
  pin: string;                  // 4-6 digit PIN for quick login
  role: UserRole;
  displayName: string;
  isActive: boolean;
  currentShift: Shift | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Shift record */
export interface ShiftRecord {
  id: string;
  userId: string;
  userName: string;
  shift: Shift;
  startedAt: string;
  endedAt: string | null;
  openingBalance: number;       // Cash in drawer at shift start
  closingBalance: number | null;
  totalSales: number;
  totalOrders: number;
  notes: string;
}

/** Daily cash closing (corte de caja) — campos REALES de la tabla v5+ */
export interface CashClosing {
  id: string;
  closingDate: string;            // YYYY-MM-DD
  openedAt: string;
  closedAt: string | null;
  openedBy: string;
  closedBy: string | null;
  expectedCash: number;           // SOLO efectivo (SUM amount cash completed del día)
  actualCash: number;             // lo que contó el cajero en el cajón
  cashDifference: number;         // actual - expected (al centavo)
  isReconciled: boolean;          // |difference| <= 0.01 → lo decide el server (M9)
  notes: string;
  createdAt: string;
}

// ============================================================
// API & EVENT TYPES
// ============================================================

/** KDS Event (WebSocket message) */
export interface KDSEvent {
  type: 'new_order' | 'status_change' | 'item_ready' | 'order_complete' | 'module_ready' | 'urgent' | 'cancelled';
  orderId: string;
  tableNumber: number;
  items: OrderLineItem[];
  timestamp: string;
}

/**
 * KDS event as received from the WebSocket broadcaster (server → client).
 * Items are already normalized to client shape by the parsing layer.
 */
export interface KDSIncomingEvent {
  type: 'new_order' | 'status_change' | 'item_ready' | 'order_complete' | 'module_ready';
  orderId: string;
  tableNumber?: number;
  tableId?: string;
  waiterId?: string;
  waiterName?: string;
  items?: OrderLineItem[];
  itemId?: string;
  module?: 'bar' | 'cocina';
  status?: OrderStatus | KDSStatus;
  previousStatus?: string;
  timestamp?: string;
}

/** Sync event for offline/online bridge */
export interface SyncEvent {
  type: 'order_created' | 'order_updated' | 'payment_processed' | 'table_status_changed';
  payload: unknown;
  localId: string;
  timestamp: string;
  retryCount: number;
}

/** Generic API response */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  timestamp: string;
}

// ============================================================
// UI STATE TYPES
// ============================================================

/** Table display state (for the grid component) */
export interface TableDisplay {
  table: Table;
  orderCount: number;       // Active orders on this table
  totalPending: number;     // Monetary value pending
  timeSinceLastActivity: number;  // Minutes
}

/** KDS display item */
export interface KDSDisplayItem {
  orderId: string;
  tableNumber: number;
  item: OrderLineItem;
  elapsedMinutes: number;
  status: KDSStatus;
  isUrgent: boolean;        // > 15 minutes
}

/** Toast notification */
export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration: number;
  createdAt: string;
}

// ============================================================
// WAITER CALLS
// ============================================================

/** Waiter call (client requests waiter or bill) */
export interface WaiterCall {
  id: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  callType: 'call_waiter' | 'request_bill';
  status: 'pending' | 'accepted' | 'done' | 'cancelled';
  acceptedBy: string | null;
  acceptedAt: string | null;
  createdAt: string;
}
