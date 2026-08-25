/**
 * Public Client Session API — validación de sesión QR (clientes PWA, sin JWT)
 *
 * GET  /api/client-sessions/:sid/validate?mesa=N → { valid, reason?, sessionId?, hasActiveOrder }
 * POST /api/client-sessions/table/:mesa            → crea/obtiene la sesión de forma LAZY
 *
 * QR ESTÁTICO (Opción A): el QR codifica SOLO `?mesa=N` (sin sid). Cuando
 * el cliente abre la URL sin sid, el hook crea la sesión lazy vía
 * `getOrCreateSession` y la persiste en localStorage. Una vez creada, el
 * sid se usa para validar el pedido activo (\"el pedido activo es el permiso\").
 *
 * FIX: la sesión ya no se valida contra el SecurityEngine del navegador
 * (que estaba vacío en el cliente). Se valida contra el SERVIDOR.
 */

export interface ClientSessionValidation {
  success: boolean;
  valid: boolean;
  reason?: string;
  sessionId?: string;
  hasActiveOrder?: boolean;
}

/**
 * Crea u obtiene la sesión activa de una mesa (lazy, QR estático).
 * POST /api/client-sessions/table/:mesa
 * @param tableNumber — mesa del QR estático
 */
export async function getOrCreateSession(
  tableNumber: number
): Promise<ClientSessionValidation> {
  try {
    const res = await fetch(`/api/client-sessions/table/${encodeURIComponent(tableNumber)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return { success: false, valid: false, reason: `Servidor respondió ${res.status}` };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      return { success: false, valid: false, reason: 'Respuesta inválida del servidor' };
    }
    if (!data.success || !data.sessionId) {
      return {
        success: false,
        valid: false,
        reason: data.error || 'No se pudo crear la sesión de la mesa',
      };
    }
    return {
      success: true,
      valid: true,
      sessionId: data.sessionId,
      hasActiveOrder: !!data.hasActiveOrder,
    };
  } catch {
    return { success: false, valid: false, reason: 'Error de conexión. Reintentando…' };
  }
}

/**
 * Valida la sesión QR contra el servidor.
 * @param sessionId — sid de la URL
 * @param tableNumber — mesa de la URL
 */
export async function validateClientSession(
  sessionId: string,
  tableNumber: number
): Promise<ClientSessionValidation> {
  try {
    const res = await fetch(
      `/api/client-sessions/${encodeURIComponent(sessionId)}/validate?mesa=${tableNumber}`
    );
    if (!res.ok) {
      return { success: false, valid: false, reason: `Servidor respondió ${res.status}` };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      return { success: false, valid: false, reason: 'Respuesta inválida del servidor' };
    }
    return {
      success: true,
      valid: !!data.valid,
      reason: data.reason,
      sessionId: data.sessionId || sessionId,
      hasActiveOrder: !!data.hasActiveOrder,
    };
  } catch {
    return { success: false, valid: false, reason: 'Error de conexión. Reintentando…' };
  }
}
