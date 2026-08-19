/**
 * Staff API — orders module (pure, injectable fetch)
 *
 * Maps server snake_case order rows to client Order type.
 * Covers the mesero flow: create → submit → confirm → status.
 */

import { apiFetch, type ApiResult } from './apiFetch';

/** Server order item row (snake_case) */
export interface ServerOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  menu_item_name: string;
  quantity: number;
  unit_price: number;
  modifiers_json: string | null;
  subtotal: number;
  status: string;
  preparation_notes: string;
  created_at: string;
  item_name?: string;
  kds_module?: string;
  /** FASE 4B: ronda ("segunda comanda") — el server lo incluye desde v7 */
  round?: number;
  /** Sprint 1 (E): "Promo" cuando el item se facturó con promo manual */
  promo_label?: string | null;
}

/** Server order row (snake_case) */
export interface ServerOrder {
  id: string;
  table_id: string;
  table_number: number;
  waiter_id: string;
  waiter_name: string;
  status: string;
  subtotal: number;
  iva_amount: number;
  discount: number;
  discount_reason: string;
  total: number;
  payment_method: string | null;
  payment_reference: string | null;
  is_paid: number;
  paid_at: string | null;
  notes: string;
  guest_count: number;
  created_at: string;
  updated_at: string;
  local_id: string | null;
  /** S2-C: suma de pagos completed (amount) — SSOT server */
  paid_amount?: number;
  items?: ServerOrderItem[];
}

export interface OrderLineItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  modifiers: { groupName: string; optionName: string; priceAdjustment: number }[];
  subtotal: number;
  status: string;
  preparationNotes: string;
  kdsModule?: string;
  /** FASE 4B: ronda ("segunda comanda") — items agregados a un pedido con
   *  platos ya procesados entran en una ronda nueva (max+1). */
  round?: number;
  /** Sprint 1 (E): "Promo" cuando el item se facturó con promo manual */
  promoLabel?: string | null;
}

export interface Order {
  id: string;
  tableId: string;
  tableNumber: number;
  waiterId: string;
  waiterName: string;
  status: string;
  subtotal: number;
  ivaAmount: number;
  discount: number;
  total: number;
  paymentMethod: string | null;
  paymentReference: string | null;
  isPaid: boolean;
  paidAt: string | null;
  notes: string;
  guestCount: number;
  createdAt: string;
  updatedAt: string;
  localId: string | null;
  /** S2-C: suma de pagos completed (amount) — SSOT server */
  paidAmount: number;
  items: OrderLineItem[];
}

export interface OrderItemPayload {
  menu_item_id: string;
  quantity: number;
  notes?: string;
  modifiers?: { groupName: string; optionName: string; priceAdjustment: number }[];
  /** Sprint 1 (B): precio manual "Consultar precio" (items price_variable, solo meseros) */
  manual_price?: number;
  /** Sprint 1 (E): aplicar promo manual (item con promo_price, solo meseros) */
  apply_promo?: boolean;
  /** Sprint Promos (2026-08-19): tipo de promo por día laboral aplicada a la línea */
  promo_type?: string;
}

export interface OrderPayload {
  table_id: string;
  items: OrderItemPayload[];
  notes?: string;
  guest_count?: number;
  local_id?: string;
}

export interface OrderResult extends ApiResult<{ order?: ServerOrder }> {
  order: Order | null;
}

export interface OrdersResult extends ApiResult<{ orders?: ServerOrder[]; count?: number }> {
  orders: Order[];
}

function parseModifiers(json: string | null) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeItem(item: ServerOrderItem): OrderLineItem {
  return {
    id: item.id,
    menuItemId: item.menu_item_id,
    menuItemName: item.item_name || item.menu_item_name,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    modifiers: parseModifiers(item.modifiers_json),
    subtotal: item.subtotal,
    status: item.status,
    preparationNotes: item.preparation_notes,
    kdsModule: item.kds_module,
    round: typeof item.round === 'number' ? item.round : 1,
    promoLabel: item.promo_label ?? null,
  };
}

function normalizeOrder(order: ServerOrder): Order {
  return {
    id: order.id,
    tableId: order.table_id,
    tableNumber: order.table_number,
    waiterId: order.waiter_id,
    waiterName: order.waiter_name,
    status: order.status,
    subtotal: order.subtotal,
    ivaAmount: order.iva_amount,
    discount: order.discount,
    total: order.total,
    paymentMethod: order.payment_method,
    paymentReference: order.payment_reference,
    isPaid: order.is_paid === 1,
    paidAt: order.paid_at,
    notes: order.notes,
    guestCount: order.guest_count,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    localId: order.local_id,
    paidAmount: typeof order.paid_amount === 'number' ? order.paid_amount : 0,
    items: Array.isArray(order.items) ? order.items.map(normalizeItem) : [],
  };
}

/** POST /api/orders — create a draft order (mesero flow) */
export async function createOrder(
  token: string,
  payload: OrderPayload,
  fetchImpl: typeof fetch = fetch
): Promise<OrderResult> {
  const result = await apiFetch<{ success: boolean; order?: ServerOrder }>('/api/orders', {
    method: 'POST',
    token,
    body: payload,
    fetchImpl,
  });

  if (!result.ok || !result.data?.order) {
    return { ...result, data: null, order: null } as OrderResult;
  }

  const order = normalizeOrder(result.data.order);
  return { ...result, data: { order: result.data.order }, order };
}

/** PATCH /api/orders/:id/submit — draft → called (send to mesero queue) */
export async function submitOrder(
  token: string,
  orderId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string }>> {
  return apiFetch<{ success: boolean; status?: string }>(`/api/orders/${orderId}/submit`, {
    method: 'PATCH',
    token,
    fetchImpl,
  });
}

/** PATCH /api/orders/:id/confirm — called → confirmed (mesero action) */
export async function confirmOrder(
  token: string,
  orderId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string }>> {
  return apiFetch<{ success: boolean; status?: string }>(`/api/orders/${orderId}/confirm`, {
    method: 'PATCH',
    token,
    fetchImpl,
  });
}

/** PATCH /api/orders/:id/status — change order status */
export async function updateOrderStatus(
  token: string,
  orderId: string,
  status: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string }>> {
  return apiFetch<{ success: boolean; status?: string }>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    token,
    body: { status },
    fetchImpl,
  });
}

/** GET /api/orders?status=... — list orders by status */
export async function fetchOrdersByStatus(
  token: string,
  status: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrdersResult> {
  const result = await apiFetch<{ success: boolean; orders?: ServerOrder[]; count?: number }>(
    `/api/orders?status=${encodeURIComponent(status)}`,
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.orders) {
    return { ...result, data: null, orders: [] } as OrdersResult;
  }

  return { ...result, data: { orders: result.data.orders }, orders: result.data.orders.map(normalizeOrder) };
}

/** GET /api/orders/:id — single order (with payments + items) */
export async function fetchOrderById(
  token: string,
  orderId: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrderResult> {
  const result = await apiFetch<{ success: boolean; order?: ServerOrder }>(`/api/orders/${orderId}`, {
    token,
    fetchImpl,
  });

  if (!result.ok || !result.data?.order) {
    return { ...result, data: null, order: null } as OrderResult;
  }

  const order = normalizeOrder(result.data.order);
  return { ...result, data: { order: result.data.order }, order };
}

/**
 * GET /api/orders?pending=1 — pedidos activos pendientes de cobro
 * (called, confirmed, preparing, ready, served). S2-C: la caja los lista
 * con totals y paid_amount (SSOT server).
 */
export async function fetchPendingOrders(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<OrdersResult> {
  const result = await apiFetch<{ success: boolean; orders?: ServerOrder[]; count?: number }>(
    '/api/orders?pending=1',
    { token, fetchImpl }
  );

  if (!result.ok || !result.data?.orders) {
    return { ...result, data: null, orders: [] } as OrdersResult;
  }

  return { ...result, data: { orders: result.data.orders }, orders: result.data.orders.map(normalizeOrder) };
}

/** PATCH /api/orders/:id/deliver — mesero entrega items listos (S2-B).
 *  FASE 4C: filtro opcional { module?, round? } → entrega SOLO la ronda de
 *  ese módulo (botón "Pedido Entregado" por ronda). Sin filtro → todos. */
export async function deliverOrder(
  token: string,
  orderId: string,
  opts?: { module?: 'bar' | 'cocina'; round?: number },
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string }>> {
  return apiFetch<{ success: boolean; status?: string }>(`/api/orders/${orderId}/deliver`, {
    method: 'PATCH',
    token,
    body: opts && (opts.module || opts.round) ? opts : undefined,
    fetchImpl,
  });
}

/** PUT /api/orders/:id — actualizar pedido INCREMENTAL (FASE 2/4B):
 *  items con id → update; sin id → insert (ronda asignada por el server);
 *  remove_item_ids → delete explícito; no mencionados → se conservan. */
export async function updateOrder(
  token: string,
  orderId: string,
  payload: { items?: OrderItemPayload[]; remove_item_ids?: string[]; notes?: string },
  fetchImpl: typeof fetch = fetch
): Promise<OrderResult> {
  const result = await apiFetch<{ success: boolean; order?: ServerOrder }>(`/api/orders/${orderId}`, {
    method: 'PUT',
    token,
    body: payload,
    fetchImpl,
  });

  if (!result.ok || !result.data?.order) {
    return { ...result, data: null, order: null } as OrderResult;
  }

  const order = normalizeOrder(result.data.order);
  return { ...result, data: { order: result.data.order }, order };
}

/** POST /api/orders/:id/items — agregar UN item a pedido existente (FASE 4B) */
export async function addOrderItem(
  token: string,
  orderId: string,
  item: OrderItemPayload,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string }>> {
  return apiFetch<{ success: boolean; status?: string }>(`/api/orders/${orderId}/items`, {
    method: 'POST',
    token,
    body: item,
    fetchImpl,
  });
}

/** DELETE /api/orders/:id/items/:itemId — quitar item del pedido (FASE 4A) */
export async function removeOrderItem(
  token: string,
  orderId: string,
  itemId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>(`/api/orders/${orderId}/items/${itemId}`, {
    method: 'DELETE',
    token,
    fetchImpl,
  });
}

/** PATCH /api/orders/:id/kds-status — FASE 4C: flujo KDS 2 CLICKS por
 *  tarjeta (pedido completo de un módulo+ronda). 'preparing' = Iniciar,
 *  'ready' = Listo (llama al mesero). Rol: kds/admin. */
export async function kdsSetStatus(
  token: string,
  orderId: string,
  body: { status: 'preparing' | 'ready'; module?: 'bar' | 'cocina'; round?: number },
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ success: boolean; status?: string; round?: number }>> {
  return apiFetch<{ success: boolean; status?: string; round?: number }>(`/api/orders/${orderId}/kds-status`, {
    method: 'PATCH',
    token,
    body,
    fetchImpl,
  });
}

export default {
  createOrder,
  submitOrder,
  confirmOrder,
  updateOrderStatus,
  fetchOrdersByStatus,
  fetchOrderById,
  fetchPendingOrders,
  deliverOrder,
  updateOrder,
  addOrderItem,
  removeOrderItem,
  kdsSetStatus,
};
