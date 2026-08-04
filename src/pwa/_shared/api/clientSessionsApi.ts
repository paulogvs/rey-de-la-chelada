/**
 * Client Sessions API — Sesiones QR server-side
 *
 * FIX del bug "pantalla en blanco QR":
 * - Antes: session en memoria del navegador Admin + URL localhost
 * - Ahora: la sesión vive en SQLite y el servidor construye la URL con
 *   host real / PUBLIC_BASE_URL.
 *
 * QR ESTÁTICO (Opción A):
 * - El QR de mesa codifica SOLO `{base}/clientes?mesa=N` (SIN sid).
 * - `getStaticTableQrUrl` devuelve la URL ESTÁTICA estable (sin crear una
 *   sesión efímera para cada impresión) → el QR es único e imprimible una vez.
 * - La sesión se crea lazy en el servidor cuando el cliente abre la URL.
 *
 * Convención: ApiResult normalizado, nunca lanza.
 */

import { apiFetch, type ApiResult } from './apiFetch';

export interface ClientSessionCreated extends ApiResult<{
  sessionId: string;
  tableNumber: number;
  expiresAt: string;
  url: string;
}> {
  sessionId?: string;
  tableNumber?: number;
  expiresAt?: string;
  url?: string;
}

/**
 * Devuelve SIEMPRE la URL estática del QR de mesa (admin, JWT).
 *
 * Opción A: la URL NO incluye sid → estable, imprimible una vez.
 * Usa POST /api/client-sessions/table/:mesa (sin crear sesión efímera
 * extra) para que el servidor resuelva el host real/PUBLIC_BASE_URL.
 *
 * @param token — JWT admin (se pasa pero el endpoint es público/persistente)
 * @param tableNumber
 */
export async function getStaticTableQrUrl(
  token: string,
  tableNumber: number
): Promise<ClientSessionCreated> {
  const res = await apiFetch<{
    sessionId: string;
    tableNumber: number;
    expiresAt: string;
    url: string;
  }>(`/api/client-sessions/table/${encodeURIComponent(tableNumber)}`, {
    method: 'POST',
    token,
  });

  if (!res.ok || !res.data) {
    return { ok: false, status: res.status, code: res.code, error: res.error, data: null };
  }

  return {
    ok: true,
    status: res.status,
    code: null,
    error: null,
    data: res.data,
    sessionId: res.data.sessionId,
    tableNumber: res.data.tableNumber,
    expiresAt: res.data.expiresAt,
    url: res.data.url,
  };
}

/**
 * Crea una sesión QR para una mesa (admin, JWT) — legacy/transición.
 * POST /api/client-sessions  → { sessionId, tableNumber, expiresAt, url }
 * (La URL incluye sid; se conserva por compatibilidad con flujos previos.)
 */
export async function createClientSession(
  token: string,
  tableNumber: number,
  ttlMinutes?: number
): Promise<ClientSessionCreated> {
  const res = await apiFetch<{
    sessionId: string;
    tableNumber: number;
    expiresAt: string;
    url: string;
  }>('/api/client-sessions', {
    method: 'POST',
    token,
    body: { tableNumber, ttlMinutes },
  });

  if (!res.ok || !res.data) {
    return { ok: false, status: res.status, code: res.code, error: res.error, data: null };
  }

  return {
    ok: true,
    status: res.status,
    code: null,
    error: null,
    data: res.data,
    sessionId: res.data.sessionId,
    tableNumber: res.data.tableNumber,
    expiresAt: res.data.expiresAt,
    url: res.data.url,
  };
}
