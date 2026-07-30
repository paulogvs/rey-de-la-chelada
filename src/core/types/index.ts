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
export type OrderStatus = 'draft' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';

/** System roles */
export type UserRole = 'admin' | 'mesero' | 'cocina' | 'caja' | 'bartender';

/** Payment methods */
export type PaymentMethod = 'cash' | 'qr_yape' | 'qr_simple' | 'card' | 'transfer';

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
  description: string;
  price: number;            // Final price with IVA included (BOB)
  ivaPercentage: number;    // 13% default for Bolivia
  imageUrl: string | null;
  isActive: boolean;
  isAvailable: boolean;     // Temporarily out of stock
  modifierGroups: ModifierGroup[];
  tags: string[];           // e.g. ['popular', 'new', 'recommended']
  preparationTime: number;  // Minutes
  sortOrder: number;
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

/** Payment transaction */
export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  ivaAmount: number;
  reference: string;          // QR code, transaction ID, etc.
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

/** Daily cash closing (corte de caja) */
export interface CashClosing {
  id: string;
  date: string;                    // YYYY-MM-DD
  openedAt: string;
  closedAt: string;
  openedBy: string;
  closedBy: string;
  
  // Sales breakdown
  totalSales: number;
  totalIva: number;
  totalOrders: number;
  
  // By payment method
  salesByMethod: Record<PaymentMethod, number>;
  
  // Cash reconciliation
  expectedCash: number;
  actualCash: number;
  cashDifference: number;
  
  // Notes
  notes: string;
  isReconciled: boolean;
}

/** Inventory item */
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;             // 'unidad' | 'kg' | 'litro' | 'caja' | 'bolsa'
  unitPrice: number;
  currentStock: number;
  minStock: number;         // Alert threshold
  supplierId: string | null;
  category: string;         // 'insumos' | 'bebidas' | 'limpieza' | etc.
  lastRestockedAt: string | null;
  updatedAt: string;
}

/** Recipe (links menu items to inventory) */
export interface Recipe {
  id: string;
  menuItemId: string;
  ingredients: {
    inventoryItemId: string;
    quantity: number;
    unit: string;
  }[];
  yield: number;            // How many portions this recipe makes
  preparationInstructions: string;
}

// ============================================================
// API & EVENT TYPES
// ============================================================

/** KDS Event (WebSocket message) */
export interface KDSEvent {
  type: 'new_order' | 'status_change' | 'urgent' | 'cancelled';
  orderId: string;
  tableNumber: number;
  items: OrderLineItem[];
  timestamp: string;
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
