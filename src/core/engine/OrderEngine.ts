/**
 * ORDER ENGINE — SSOT for all order operations
 * 
 * Artículo I: SSOT — Every order state change passes through here
 * Artículo VI: Observability — Fail loud, never silent
 * 
 * Manages: order lifecycle, KDS events, payments, offline sync
 */

import type {
  Order,
  OrderLineItem,
  OrderStatus,
  KDSStatus,
  Payment,
  PaymentMethod,
  KDSEvent,
  KDSIncomingEvent,
  SyncEvent,
} from '../types';
import { computeTotals } from '../config/iva';
import { localDateStr } from '../config/local-date';

class OrderEngine {
  private orders: Map<string, Order> = new Map();
  private payments: Map<string, Payment> = new Map();
  private listeners: Set<() => void> = new Set();
  private kdsListeners: Set<(event: KDSEvent) => void> = new Set();
  private syncQueue: SyncEvent[] = [];

  // ============================================================
  // ORDER CRUD
  // ============================================================

  /** Create a new order */
  createOrder(params: {
    tableId: string;
    tableNumber: number;
    waiterId: string;
    waiterName: string;
    guestCount?: number;
    notes?: string;
    localId?: string;
  }): Order {
    const now = new Date().toISOString();

    const order: Order = {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      tableId: params.tableId,
      tableNumber: params.tableNumber,
      waiterId: params.waiterId,
      waiterName: params.waiterName,
      items: [],
      status: 'draft',
      subtotal: 0,
      ivaAmount: 0,
      discount: 0,
      discountReason: '',
      total: 0,
      paymentMethod: null,
      paymentReference: null,
      isPaid: false,
      paidAt: null,
      notes: params.notes || '',
      guestCount: params.guestCount || 1,
      createdAt: now,
      updatedAt: now,
      syncedAt: null,
      localId: params.localId || `local-${Date.now()}`,
    };

    this.orders.set(order.id, order);
    this._notify();
    return order;
  }

  /** Add item to an order */
  addItem(orderId: string, item: OrderLineItem): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.isPaid) return false;

    order.items.push(item);
    this._recalculateOrder(order);
    this._notify();
    return true;
  }

  /** Remove item from an order */
  removeItem(orderId: string, itemId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.isPaid) return false;

    order.items = order.items.filter(i => i.id !== itemId);
    this._recalculateOrder(order);
    this._notify();
    return true;
  }

  /** Update item quantity */
  updateItemQuantity(orderId: string, itemId: string, quantity: number): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.isPaid) return false;
    if (quantity < 1) return this.removeItem(orderId, itemId);

    const item = order.items.find(i => i.id === itemId);
    if (!item) return false;

    item.quantity = quantity;
    item.subtotal = (item.unitPrice + item.modifiers.reduce((s, m) => s + m.priceAdjustment, 0)) * quantity;
    this._recalculateOrder(order);
    this._notify();
    return true;
  }

  /** Confirm order (send to KDS) */
  confirmOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'draft') return false;

    order.status = 'confirmed';
    order.updatedAt = new Date().toISOString();

    // Set all items to pending for KDS
    order.items.forEach(item => {
      item.status = 'pending';
    });

    // Fire KDS event
    this._fireKDSEvent({
      type: 'new_order',
      orderId: order.id,
      tableNumber: order.tableNumber,
      items: order.items,
      timestamp: new Date().toISOString(),
    });

    this._notify();
    return true;
  }

  /** Update item status (cocina marks as preparing/ready) */
  updateItemStatus(orderId: string, itemId: string, status: KDSStatus): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;

    const item = order.items.find(i => i.id === itemId);
    if (!item) return false;

    item.status = status;
    order.updatedAt = new Date().toISOString();

    // Check if all items are delivered
    const allDelivered = order.items.every(i => 
      ['delivered', 'cancelled'].includes(i.status)
    );
    if (allDelivered) {
      order.status = 'served';
    }

    this._fireKDSEvent({
      type: 'status_change',
      orderId: order.id,
      tableNumber: order.tableNumber,
      items: [item],
      timestamp: new Date().toISOString(),
    });

    this._notify();
    return true;
  }

  /** Apply discount */
  setDiscount(orderId: string, amount: number, reason: string): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.isPaid) return false;

    order.discount = Math.min(amount, order.subtotal);
    order.discountReason = reason;
    this._recalculateOrder(order);
    this._notify();
    return true;
  }

  // ============================================================
  // PAYMENT
  // ============================================================

  /** Process payment for an order */
  processPayment(orderId: string, method: PaymentMethod, reference?: string): Payment | null {
    const order = this.orders.get(orderId);
    if (!order || order.isPaid) return null;

    const now = new Date().toISOString();
    const payment: Payment = {
      id: `pay-${Date.now()}`,
      orderId: order.id,
      method,
      amount: order.total,
      ivaAmount: order.ivaAmount,
      reference: reference || '',
      status: 'completed',
      processedBy: order.waiterId,
      processedAt: now,
      notes: '',
      syncedAt: null,
    };

    this.payments.set(payment.id, payment);
    order.paymentMethod = method;
    order.paymentReference = reference || null;
    order.isPaid = true;
    order.paidAt = now;
    order.status = 'paid';
    order.updatedAt = now;

    this._notify();
    return payment;
  }

  /** Get payment by ID */
  getPayment(id: string): Payment | undefined {
    return this.payments.get(id);
  }

  /** Get payments for an order */
  getOrderPayments(orderId: string): Payment[] {
    return Array.from(this.payments.values()).filter(p => p.orderId === orderId);
  }

  // ============================================================
  // QUERIES
  // ============================================================

  /** Get active orders (confirmed, preparing, ready) */
  getActiveOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o =>
      ['draft', 'confirmed', 'preparing', 'ready', 'served'].includes(o.status)
    );
  }

  /** Get orders for KDS display */
  getKDSOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o =>
      ['confirmed', 'preparing', 'ready'].includes(o.status)
    ).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  /** Get orders by table */
  getTableOrders(tableId: string): Order[] {
    return Array.from(this.orders.values()).filter(o => o.tableId === tableId);
  }

  /** Get today's orders */
  getTodayOrders(): Order[] {
    // C1/2.1: "hoy" = fecha LOCAL America/La_Paz (NUNCA toISOString)
    const today = localDateStr();
    return Array.from(this.orders.values()).filter(o =>
      o.createdAt.startsWith(today)
    );
  }

  /** Get a single order */
  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  // ============================================================
  // OFFLINE SYNC
  // ============================================================

  /** Queue a sync event for offline-to-online bridge */
  queueSync(event: SyncEvent): void {
    this.syncQueue.push(event);
  }

  /** Get pending sync events */
  getSyncQueue(): SyncEvent[] {
    return [...this.syncQueue];
  }

  /** Mark sync events as processed */
  clearSyncQueue(ids: string[]): void {
    this.syncQueue = this.syncQueue.filter(e => !ids.includes(e.localId));
  }

  /** Import order from sync */
  importOrder(order: Order): void {
    this.orders.set(order.id, order);
    this._notify();
  }

  /**
   * Apply an incoming KDS event received from the WebSocket broadcaster
   * (server → client). The server is the source of truth for order state:
   *  - new_order        → import the full order (replace if exists)
   *  - status_change    → update the order status
   *  - item_ready       → mark a single item as ready
   *  - order_complete   → mark the whole order as ready
   *
   * Fires the KDS event to listeners so UI alerts (sound, flash) still work.
   * Returns true when the event was applied, false when it was a no-op
   * (unknown type, missing orderId, or order not present).
   */
  applyKDSEvent(event: KDSIncomingEvent): boolean {
    if (!event || !event.orderId) return false;

    switch (event.type) {
      case 'new_order': {
        if (!event.items) return false;
        const order: Order = {
          id: event.orderId,
          tableId: event.tableId || `table-${event.tableNumber ?? 0}`,
          tableNumber: event.tableNumber ?? 0,
          waiterId: event.waiterId || '',
          waiterName: event.waiterName || '',
          items: event.items,
          status: (event.status as OrderStatus) || 'confirmed',
          subtotal: 0,
          ivaAmount: 0,
          discount: 0,
          discountReason: '',
          total: 0,
          paymentMethod: null,
          paymentReference: null,
          isPaid: false,
          paidAt: null,
          notes: '',
          guestCount: 1,
          createdAt: event.timestamp || new Date().toISOString(),
          updatedAt: event.timestamp || new Date().toISOString(),
          syncedAt: null,
          localId: event.orderId,
        };
        this._recalculateOrder(order);
        this.importOrder(order);
        this._fireKDSEvent({
          type: 'new_order',
          orderId: order.id,
          tableNumber: order.tableNumber,
          items: order.items,
          timestamp: order.createdAt,
        });
        return true;
      }

      case 'status_change': {
        const existing = this.orders.get(event.orderId);
        if (!existing) return false;
        if (event.status) {
          existing.status = event.status as OrderStatus;
        }
        existing.updatedAt = event.timestamp || new Date().toISOString();
        this._notify();
        this._fireKDSEvent({
          type: 'status_change',
          orderId: existing.id,
          tableNumber: existing.tableNumber,
          items: existing.items,
          timestamp: existing.updatedAt,
        });
        return true;
      }

      case 'item_ready': {
        const existing = this.orders.get(event.orderId);
        if (!existing) return false;
        const item = existing.items.find(i => i.id === event.itemId);
        if (!item) return false;
        item.status = 'ready';
        existing.updatedAt = event.timestamp || new Date().toISOString();
        this._notify();
        this._fireKDSEvent({
          type: 'item_ready',
          orderId: existing.id,
          tableNumber: existing.tableNumber,
          items: [item],
          timestamp: existing.updatedAt,
        });
        return true;
      }

      case 'order_complete': {
        const existing = this.orders.get(event.orderId);
        if (!existing) return false;
        existing.status = 'ready';
        existing.updatedAt = event.timestamp || new Date().toISOString();
        this._notify();
        this._fireKDSEvent({
          type: 'order_complete',
          orderId: existing.id,
          tableNumber: existing.tableNumber,
          items: existing.items,
          timestamp: existing.updatedAt,
        });
        return true;
      }

      default:
        return false;
    }
  }

  /** Export all orders for sync */
  exportOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  /** Get daily sales summary */
  getDailySummary(date?: string) {
    // C1/2.1: "hoy" = fecha LOCAL America/La_Paz (NUNCA toISOString)
    const day = date || localDateStr();
    const dayOrders = Array.from(this.orders.values())
      .filter(o => o.createdAt.startsWith(day) && o.isPaid);

    const methods: Record<string, number> = {};
    let total = 0;
    let totalIva = 0;

    dayOrders.forEach(order => {
      total += order.total;
      totalIva += order.ivaAmount;
      const method = order.paymentMethod || 'unknown';
      methods[method] = (methods[method] || 0) + order.total;
    });

    return {
      date: day,
      totalOrders: dayOrders.length,
      totalSales: Math.round(total * 100) / 100,
      totalIva: Math.round(totalIva * 100) / 100,
      byMethod: methods,
      averageTicket: dayOrders.length > 0 
        ? Math.round((total / dayOrders.length) * 100) / 100 
        : 0,
    };
  }

  // ============================================================
  // INTERNAL
  // ============================================================

  /** Recalculate order totals */
  private _recalculateOrder(order: Order): void {
    // MODELO SSOT EXTRACTIVO (precio INCLUYE IVA — iva.js):
    // item.subtotal ya incluye IVA → total = suma (gross), iva extraído.
    const grossTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
    const { subtotal, iva, total } = computeTotals(grossTotal);

    order.subtotal = subtotal;
    order.ivaAmount = iva;
    order.total = Math.round((total - order.discount) * 100) / 100;

    order.updatedAt = new Date().toISOString();
  }

  /** Fire KDS event to listeners */
  private _fireKDSEvent(event: KDSEvent): void {
    this.kdsListeners.forEach(cb => cb(event));
  }

  /** Subscribe to KDS events */
  onKDSEvent(callback: (event: KDSEvent) => void): () => void {
    this.kdsListeners.add(callback);
    return () => this.kdsListeners.delete(callback);
  }

  /** Subscribe to order changes */
  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private _notify(): void {
    this.listeners.forEach(cb => cb());
  }
}

const orderEngine = new OrderEngine();
export default orderEngine;
export { OrderEngine };
