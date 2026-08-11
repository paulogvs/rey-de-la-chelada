/**
 * ═══════════════════════════════════════════════════════════
 *  CAPABILITIES — Qué puede hacer cada módulo PWA
 * ═══════════════════════════════════════════════════════════
 *
 *  Artículo I:  SSOT — Capacidades definidas en un solo lugar
 *  Artículo IV: Simplicidad — Cada PWA solo ve lo que necesita
 *
 *  Esto permite:
 *  - Escalabilidad: agregas capabilities sin tocar cada PWA
 *  - Seguridad: un módulo NO puede hacer lo que no tiene
 *  - Claridad: cada desarrollador sabe qué hace cada PWA
 * ═══════════════════════════════════════════════════════════
 */

import type { PwaModuleId } from './app.config';

// ============================================================
// CAPABILITIES — Acciones atómicas del sistema
// ============================================================

export enum Capability {
  // 📋 MESAS
  VIEW_TABLES          = 'view:tables',
  MANAGE_TABLES        = 'manage:tables',   // Abrir/cerrar mesas
  ASSIGN_WAITER        = 'assign:waiter',

  // 🍽️ PEDIDOS
  VIEW_ORDERS          = 'view:orders',
  CREATE_ORDERS        = 'create:orders',
  EDIT_ORDERS          = 'edit:orders',
  CONFIRM_ORDERS       = 'confirm:orders',  // Enviar a cocina
  CANCEL_ORDERS        = 'cancel:orders',
  VIEW_KDS             = 'view:kds',         // Ver pedidos en cocina
  UPDATE_KDS_STATUS    = 'update:kds-status', // Marcar "preparando" / "listo"

  // 🍺 BARRA
  VIEW_BAR_ORDERS      = 'view:bar-orders',
  UPDATE_BAR_STATUS    = 'update:bar-status',

  // 💳 PAGOS
  PROCESS_PAYMENT      = 'process:payment',
  VIEW_PAYMENTS        = 'view:payments',
  REFUND_PAYMENT       = 'refund:payment',
  GENERATE_INVOICE     = 'generate:invoice',

  // 📊 REPORTES
  VIEW_DAILY_SUMMARY   = 'view:daily-summary',
  VIEW_SALES_REPORT    = 'view:sales-report',
  VIEW_STAFF_REPORT    = 'view:staff-report',
  CLOSE_CASH           = 'close:cash',

  // 👥 STAFF
  MANAGE_STAFF         = 'manage:staff',
  VIEW_SHIFTS          = 'view:shifts',

  // ⚙️ ADMIN
  MANAGE_CONFIG        = 'manage:config',
  VIEW_LOGS            = 'view:logs',
  MANAGE_MODULES       = 'manage:modules',

  // 🧑 CLIENTES
  VIEW_MENU            = 'view:menu',         // Ver menú (siempre activo)
  CALL_WAITER          = 'call:waiter',        // Llamar mesero
  REQUEST_BILL         = 'request:bill',       // Pedir cuenta
  VIEW_ORDER_STATUS    = 'view:order-status',  // Ver estado del pedido
}

// ============================================================
// FEATURE — Agrupación lógica de capabilities
// ============================================================

export interface Feature {
  id: string;
  label: string;
  description: string;
  capabilities: Capability[];
}

// ============================================================
// CAPABILITY MAP — Qué capabilities tiene cada módulo PWA
// ============================================================

export const MODULE_CAPABILITIES: Record<PwaModuleId, Capability[]> = {
  // ==========================================================
  // COCINA
  // ==========================================================
  cocina: [
    Capability.VIEW_KDS,
    Capability.UPDATE_KDS_STATUS,
    Capability.VIEW_ORDERS,
  ],

  // ==========================================================
  // BAR
  // ==========================================================
  bar: [
    Capability.VIEW_BAR_ORDERS,
    Capability.UPDATE_BAR_STATUS,
  ],

  // ==========================================================
  // MESEROS
  // ==========================================================
  meseros: [
    Capability.VIEW_TABLES,
    Capability.MANAGE_TABLES,
    Capability.VIEW_ORDERS,
    Capability.CREATE_ORDERS,
    Capability.EDIT_ORDERS,
    Capability.CONFIRM_ORDERS,
    Capability.CANCEL_ORDERS,
    Capability.PROCESS_PAYMENT,
    Capability.VIEW_PAYMENTS,
  ],

  // ==========================================================
  // CAJA
  // ==========================================================
  caja: [
    Capability.VIEW_PAYMENTS,
    Capability.REFUND_PAYMENT,
    Capability.GENERATE_INVOICE,
    Capability.VIEW_DAILY_SUMMARY,
    Capability.VIEW_SALES_REPORT,
    Capability.CLOSE_CASH,
    Capability.VIEW_ORDERS,
  ],

  // ==========================================================
  // ADMIN
  // ==========================================================
  admin: [
    // Todo — el admin puede hacer todo
    Capability.VIEW_TABLES,
    Capability.MANAGE_TABLES,
    Capability.VIEW_ORDERS,
    Capability.CREATE_ORDERS,
    Capability.EDIT_ORDERS,
    Capability.CONFIRM_ORDERS,
    Capability.CANCEL_ORDERS,
    Capability.VIEW_KDS,
    Capability.UPDATE_KDS_STATUS,
    Capability.VIEW_BAR_ORDERS,
    Capability.UPDATE_BAR_STATUS,
    Capability.PROCESS_PAYMENT,
    Capability.VIEW_PAYMENTS,
    Capability.REFUND_PAYMENT,
    Capability.GENERATE_INVOICE,
    Capability.VIEW_DAILY_SUMMARY,
    Capability.VIEW_SALES_REPORT,
    Capability.VIEW_STAFF_REPORT,
    Capability.CLOSE_CASH,
    Capability.MANAGE_STAFF,
    Capability.VIEW_SHIFTS,
    Capability.MANAGE_CONFIG,
    Capability.VIEW_LOGS,
    Capability.MANAGE_MODULES,
  ],

  // ==========================================================
  // CLIENTES
  // ==========================================================
  clientes: [
    Capability.VIEW_MENU,
    Capability.CALL_WAITER,
    Capability.REQUEST_BILL,
    Capability.VIEW_ORDER_STATUS,
  ],
};

// ============================================================
// AUTHORIZATION — Helper de verificación
// ============================================================

export class AuthorizationEngine {
  /** Verifica si un módulo PWA tiene una capability */
  static hasCapability(moduleId: PwaModuleId, capability: Capability): boolean {
    return MODULE_CAPABILITIES[moduleId]?.includes(capability) ?? false;
  }

  /** Verifica si un módulo PWA tiene TODAS las capabilities listadas */
  static hasAllCapabilities(moduleId: PwaModuleId, capabilities: Capability[]): boolean {
    return capabilities.every(cap => AuthorizationEngine.hasCapability(moduleId, cap));
  }

  /** Obtén todas las capabilities de un módulo */
  static getCapabilities(moduleId: PwaModuleId): Capability[] {
    return [...(MODULE_CAPABILITIES[moduleId] || [])];
  }

  /** Filtra los módulos que pueden hacer X */
  static findModulesWithCapability(capability: Capability): PwaModuleId[] {
    const result: PwaModuleId[] = [];
    for (const [moduleId, caps] of Object.entries(MODULE_CAPABILITIES)) {
      if ((caps as Capability[]).includes(capability)) {
        result.push(moduleId as PwaModuleId);
      }
    }
    return result;
  }
}
