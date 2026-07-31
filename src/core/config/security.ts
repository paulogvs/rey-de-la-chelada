/**
 * ═══════════════════════════════════════════════════════════
 *  SECURITY — QR Tokens, Sesiones, Restricciones
 * ═══════════════════════════════════════════════════════════
 *
 *  Estrategia de seguridad para el módulo clientes:
 *
 *  "El pedido activo es el permiso"
 *
 *  - El QR de la mesa es público (está impreso en la mesa)
 *  - Mientras la mesa tenga un pedido ACTIVO, el cliente puede
 *    llamar mesero y pedir cuenta desde su celular
 *  - Sin pedido activo → modo solo lectura (menú visible)
 *  - No necesitamos WiFi, ni IP, ni geocerca
 *  - El token QR es de corta duración (3h) y se renueva
 *    automáticamente mientras el pedido siga activo
 * ═══════════════════════════════════════════════════════════
 */

import { appConfig, type PwaModuleId } from './app.config';

// ============================================================
// QR TOKEN — Para el módulo clientes
// ============================================================

export interface QrTokenPayload {
  /** Número de mesa (no el ID interno) */
  tableNumber: number;

  /** Timestamp de creación (ISO) */
  issuedAt: string;

  /** Timestamp de expiración (ISO) */
  expiresAt: string;

  /** ID de sesión único (para tracking) */
  sessionId: string;

  /** Versión del token para futuras migraciones */
  version: number;
}

export interface ClientSession {
  sessionId: string;
  tableNumber: number;
  issuedAt: string;
  expiresAt: string;
  lastActiveAt: string;
  orderId: string | null;
  interactions: number;
}

// ============================================================
// ⚠️ NOTA DE SEGURIDAD CRÍTICA
//
//  El QR token NO es criptográficamente seguro por diseño.
//  Es un token de conveniencia: permite acceso rápido.
//  La SEGURIDAD REAL está en que sin pedido activo
//  NO hay funciones interactivas (llamar mesero, pedir cuenta).
//
//  Si en el futuro necesitas más seguridad:
//  - Agrega JWT firmado con HMAC
//  - Agrega rate limiting por mesa
//  - Agrega verificación de que el cliente está en la red local
// ============================================================

class SecurityEngine {
  private activeSessions: Map<string, ClientSession> = new Map();

  // ==========================================================
  // QR TOKENS
  // ==========================================================

  /**
   * Genera un token QR para una mesa.
   * El token es simplemente una URL con parámetros de sesión.
   * La seguridad real está en sessionOnOrderOnly.
   */
  generateQrUrl(tableNumber: number): string {
    const config = appConfig.all.clientModule;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.qrTokenDurationMinutes * 60 * 1000);

    const session: ClientSession = {
      sessionId: this._generateSessionId(),
      tableNumber,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActiveAt: now.toISOString(),
      orderId: null,
      interactions: 0,
    };

    this.activeSessions.set(session.sessionId, session);

    // URL del QR → PWA Clientes con parámetros de sesión
    return `${this._getBaseUrl()}/clientes?mesa=${tableNumber}&sid=${session.sessionId}`;
  }

  /**
   * Valida una sesión de cliente.
   * Retorna { valid, reason } si no es válida.
   */
  validateSession(
    sessionId: string,
    tableNumber: number,
    hasActiveOrder: boolean
  ): { valid: boolean; reason?: string } {
    const session = this.activeSessions.get(sessionId);

    // Caso 1: Sesión no encontrada
    if (!session) {
      return { valid: false, reason: 'Sesión no encontrada. Escanea el QR nuevamente.' };
    }

    // Caso 2: Mesa incorrecta
    if (session.tableNumber !== tableNumber) {
      return { valid: false, reason: 'Mesa incorrecta.' };
    }

    // Caso 3: Token expirado
    if (new Date(session.expiresAt) < new Date()) {
      this.activeSessions.delete(sessionId);

      // Si hay pedido activo, renueva automáticamente
      if (hasActiveOrder) {
        return this._renewSession(session, tableNumber);
      }

      return { valid: false, reason: 'Sesión expirada. Escanea el QR nuevamente.' };
    }

    // Caso 4: Sin pedido activo — solo menú (modo lectura)
    if (appConfig.all.clientModule.sessionOnOrderOnly && !hasActiveOrder) {
      return {
        valid: true,
        reason: 'readonly', // El menú se ve, pero no hay funciones interactivas
      };
    }

    // ✅ Válido
    session.lastActiveAt = new Date().toISOString();
    session.interactions++;
    return { valid: true };
  }

  /**
   * Limpia sesiones expiradas (llamar periódicamente)
   */
  cleanExpiredSessions(): number {
    let cleaned = 0;
    const now = new Date();
    for (const [id, session] of this.activeSessions) {
      if (new Date(session.expiresAt) < now && !session.orderId) {
        this.activeSessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Asocia un pedido a una sesión de cliente
   */
  associateOrder(sessionId: string, orderId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.orderId = orderId;
      // Renueva automáticamente cuando se asocia un pedido
      const config = appConfig.all.clientModule;
      const expiresAt = new Date(Date.now() + config.qrTokenDurationMinutes * 60 * 1000);
      session.expiresAt = expiresAt.toISOString();
    }
  }

  /**
   * Invalida una sesión (cuando se paga la cuenta)
   */
  invalidateSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  // ==========================================================
  // HELPERS PRIVADOS
  // ==========================================================

  private _renewSession(oldSession: ClientSession, tableNumber: number): { valid: boolean; reason?: string } {
    const config = appConfig.all.clientModule;
    const expiresAt = new Date(Date.now() + config.qrTokenDurationMinutes * 60 * 1000);

    const newSession: ClientSession = {
      ...oldSession,
      sessionId: this._generateSessionId(), // Nuevo ID
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActiveAt: new Date().toISOString(),
    };

    this.activeSessions.set(newSession.sessionId, newSession);
    this.activeSessions.delete(oldSession.sessionId);

    return { valid: true };
  }

  private _generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private _getBaseUrl(): string {
    // En producción, la IP local de Tailscale
    // Se configura en app.config o se detecta automáticamente
    return typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://100.100.100.100:3001'; // Placeholder
  }
}

// Singleton
export const securityEngine = new SecurityEngine();
export default securityEngine;
