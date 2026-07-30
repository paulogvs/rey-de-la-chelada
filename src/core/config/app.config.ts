/**
 * ═══════════════════════════════════════════════════════════
 *  APP CONFIG — SSOT Global del Restaurante
 * ═══════════════════════════════════════════════════════════
 *
 *  Artículo I:  SINGLE SOURCE OF TRUTH
 *  Artículo II: ZERO HARDCODED VALUES
 *
 *  Este archivo es la ÚNICA fuente de verdad para toda
 *  configuración del restaurante.
 *
 *  🔴 REGLA DE ORO:
 *  - Si un valor puede cambiar por restaurante → VA AQUÍ
 *  - Si un valor puede cambiar por temporada → VA AQUÍ
 *  - Si usas un valor en 2+ lugares → DEFÍNELO AQUÍ
 *
 *  Cómo agregar un nuevo valor global:
 *  1.  Agrégalo a la interfaz RestaurantConfig
 *  2.  Asígnale un valor por defecto en DEFAULT_CONFIG
 *  3.  El compilador TS te dirá dónde falta
 *  4.  Cada PWA importa solo lo que necesita desde aquí
 * ═══════════════════════════════════════════════════════════
 */

// ============================================================
// INTERFACES — Tipado completo
// ============================================================

export type PwaModuleId = 'cocina' | 'bar' | 'meseros' | 'caja' | 'admin' | 'clientes';

export interface PwaModule {
  id: PwaModuleId;
  label: string;
  shortLabel: string;
  route: string;
  scope: string;
  icon: string;
  roles: string[];
}

export interface BusinessHours {
  [day: string]: { open: string; close: string } | null;
}

export interface TaxConfig {
  percentage: number;
  label: string;
  includedInPrices: boolean;
}

export interface ThemeConfig {
  defaultPalette: string;
  defaultTheme: 'dark' | 'light';
  allowThemeSwitch: boolean;
}

export interface ClientModuleConfig {
  qrTokenDurationMinutes: number;
  sessionOnOrderOnly: boolean;
  features: {
    menuVisible: boolean;
    callWaiter: boolean;
    requestBill: boolean;
  };
}

export interface RestaurantConfig {
  /** Información del negocio */
  business: {
    name: string;
    legalName: string;
    slogan: string;
    nit: string;
    address: string;
    city: string;
    country: string;
    phone: string;
    email: string;
  };

  /** Moneda */
  currency: {
    code: string;
    symbol: string;
    name: string;
    decimals: number;
  };

  /** Impuestos */
  taxes: {
    iva: TaxConfig;
  };

  /** Horarios por día */
  businessHours: BusinessHours;

  /** Temas visuales */
  theme: ThemeConfig;

  /** Módulos PWA activos */
  activeModules: PwaModule[];

  /** Config del módulo clientes */
  clientModule: ClientModuleConfig;

  /** Capacidad del local */
  capacity: {
    totalTables: number;
    maxGuestsPerTable: number;
  };

  /** Versión de la app para cache-busting */
  appVersion: string;
}

// ============================================================
// VALORES POR DEFECTO
// ============================================================

export const DEFAULT_CONFIG: RestaurantConfig = {
  business: {
    name: 'Rey de la Chelada',
    legalName: 'Rey de la Chelada S.R.L.',
    slogan: 'Donde las mejores historias comienzan con una chelada.',
    nit: '---',         // ⚠️ Completar con NIT real
    address: '---',     // ⚠️ Completar dirección
    city: 'Cochabamba',
    country: 'Bolivia',
    phone: '---',       // ⚠️ Completar teléfono
    email: '---',       // ⚠️ Completar email
  },

  currency: {
    code: 'BOB',
    symbol: 'Bs.',
    name: 'Boliviano',
    decimals: 2,
  },

  taxes: {
    iva: {
      percentage: 13,
      label: 'IVA',
      includedInPrices: true,
    },
  },

  businessHours: {
    monday:    { open: '17:00', close: '00:00' },
    tuesday:   { open: '17:00', close: '00:00' },
    wednesday: { open: '17:00', close: '00:00' },
    thursday:  { open: '17:00', close: '00:00' },
    friday:    { open: '17:00', close: '02:00' },
    saturday:  { open: '12:00', close: '02:00' },
    sunday:    { open: '12:00', close: '22:00' },
  },

  theme: {
    defaultPalette: 'rey-de-la-chelada',
    defaultTheme: 'dark',
    allowThemeSwitch: true,
  },

  activeModules: [
    { id: 'cocina',   label: 'Cocina',            shortLabel: 'Cocina',   route: '/cocina',   scope: '/cocina/',   icon: '/icons/cocina-192.png',   roles: ['cocina'] },
    { id: 'bar',      label: 'Bar',               shortLabel: 'Bar',      route: '/bar',      scope: '/bar/',      icon: '/icons/bar-192.png',      roles: ['bartender'] },
    { id: 'meseros',  label: 'Meseros',           shortLabel: 'Meseros',  route: '/meseros',  scope: '/meseros/',  icon: '/icons/meseros-192.png',  roles: ['mesero'] },
    { id: 'caja',     label: 'Caja',              shortLabel: 'Caja',     route: '/caja',     scope: '/caja/',     icon: '/icons/caja-192.png',     roles: ['caja'] },
    { id: 'admin',    label: 'Administración',    shortLabel: 'Admin',    route: '/admin',    scope: '/admin/',    icon: '/icons/admin-192.png',    roles: ['admin'] },
    { id: 'clientes', label: 'Menú Digital',      shortLabel: 'Clientes', route: '/clientes', scope: '/clientes/', icon: '/icons/clientes-192.png', roles: [] },
  ],

  clientModule: {
    qrTokenDurationMinutes: 180,
    sessionOnOrderOnly: true,
    features: {
      menuVisible: true,
      callWaiter: true,
      requestBill: true,
    },
  },

  capacity: {
    totalTables: 10,
    maxGuestsPerTable: 8,
  },

  appVersion: '1.0.0',
};

// ============================================================
// SINGLETON — AppConfig runtime
// ============================================================

class AppConfig {
  private config: RestaurantConfig;

  constructor(initial?: Partial<RestaurantConfig>) {
    this.config = this._mergeDeep(DEFAULT_CONFIG, initial || {});
  }

  /** Obtén toda la configuración */
  get all(): RestaurantConfig {
    return this.config;
  }

  /** Actualiza parcialmente la config (en runtime si es necesario) */
  update(partial: Partial<RestaurantConfig>): void {
    this.config = this._mergeDeep(this.config, partial);
  }

  /** Obtén un módulo PWA por su ID */
  getModule(id: PwaModuleId): PwaModule | undefined {
    return this.config.activeModules.find(m => m.id === id);
  }

  /** Obtén la URL base de un módulo PWA */
  getModuleUrl(id: PwaModuleId): string {
    const mod = this.getModule(id);
    return mod?.route || '/';
  }

  /** ¿Está el restaurante abierto ahora? */
  isOpen(): boolean {
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = dayNames[now.getDay()];
    const hours = this.config.businessHours[today];
    if (!hours) return false;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    let closeMinutes = closeH * 60 + closeM;

    // Si cierra después de medianoche, ajusta
    if (closeMinutes <= openMinutes) closeMinutes += 1440;

    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  }

  /** Calcula IVA de un monto que YA incluye IVA */
  extractIva(amountWithIva: number): number {
    const rate = this.config.taxes.iva.percentage / 100;
    return Math.round((amountWithIva - (amountWithIva / (1 + rate))) * 100) / 100;
  }

  /** Calcula el precio sin IVA desde un precio con IVA incluido */
  priceWithoutIva(priceWithIva: number): number {
    const rate = this.config.taxes.iva.percentage / 100;
    return Math.round((priceWithIva / (1 + rate)) * 100) / 100;
  }

  /** Merge deep simple */
  private _mergeDeep<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
    const result = { ...base };
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key];
      if (val !== undefined) {
        if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof result[key] === 'object') {
          result[key] = this._mergeDeep(result[key] as Record<string, unknown>, val as Record<string, unknown>) as T[keyof T];
        } else {
          result[key] = val as T[keyof T];
        }
      }
    }
    return result;
  }
}

// Singleton global — única instancia en toda la app
export const appConfig = new AppConfig();
export default appConfig;
