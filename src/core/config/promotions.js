/**
 * ═══════════════════════════════════════════════════════════
 *  PROMOTIONS — SSOT de promociones del restobar (compartido)
 *
 *  Cliente (Vite/TS) y server (Node ESM) lo importan — mismo patrón
 *  que iva.js. Por eso es JS puro SIN imports de TS (el server no
 *  transpila TS): recibe el businessDayStr 'YYYY-MM-DD' ya calculado
 *  (server: date-utils.js businessDayDateStr; cliente: local-date.ts
 *  businessDayDateStr) y devuelve qué promos aplican.
 *
 *  Contrato aprobado 2026-08-19 (días = DÍAS LABORALES 15:00→06:00 +1):
 *    - 2x1 (Jueves de Chelada)   : solo jueves
 *    - Miércoles de Barra        : solo miércoles (artesanal 15 → 12)
 *    - Combo Michelada + Cerveza : mié/jue/dom (Signature 30 + Cerveza 15 = 45)
 *    - Primera Visita (Instagram): mié/jue/dom (Signature → 25, 1 vez/pedido)
 *    - Shot + Michelada          : mié/jue/dom (modifier +15 — informativo)
 *    - Doble Escarchado          : mié/jue/dom (modifier +5 — informativo)
 *
 *  La categoría objetivo se referencia por NOMBRE (el upsert de
 *  load-menu.js usa name+category como clave; los ids del seed no
 *  sobreviven a la DB).
 * ═══════════════════════════════════════════════════════════
 */

/** Índice del día de la semana: 0=domingo … 6=sábado (getUTCDay) */
export const PROMOTION_DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/** Categorías objetivo (nombres SSOT del menú real) */
export const SIGNATURE_CATEGORY = 'Micheladas Signature';
export const ARTESANAL_CATEGORY = 'Cerveza Artesanal';

/**
 * Definiciones de promos. `promoType`:
 *   - BOGO             → 2x1: la línea adicional va GRATIS (unit 0)
 *   - PRICE_OVERRIDE   → precio fijo sobre items de `categoryName`
 *   - COMBO            → reparto fijo por categoría (comboPrices) que suma `price`
 *   - MODIFIER         → adicional dentro del item (ya existe) — solo informativo
 */
export const PROMOTIONS = [
  {
    id: '2x1',
    name: 'Jueves de Chelada 2x1',
    label: '2x1',
    description: '2x1 en Micheladas Signature. Solo los jueves.',
    days: ['jueves'],
    promoType: 'BOGO',
    categoryName: SIGNATURE_CATEGORY,
    price: null,
  },
  {
    id: 'barra',
    name: 'Miércoles de Barra',
    label: 'Miércoles de Barra',
    description: 'Cerveza Artesanal a precio especial. Solo los miércoles.',
    days: ['miercoles'],
    promoType: 'PRICE_OVERRIDE',
    categoryName: ARTESANAL_CATEGORY,
    price: 12,
  },
  {
    id: 'combo',
    name: 'Combo Michelada + Cerveza',
    label: 'Combo',
    description: '1 Michelada Signature + 1 Cerveza Artesanal. Miércoles, jueves y domingo.',
    days: ['miercoles', 'jueves', 'domingo'],
    promoType: 'COMBO',
    price: 45,
    comboPrices: { [SIGNATURE_CATEGORY]: 30, [ARTESANAL_CATEGORY]: 15 },
  },
  {
    id: 'primera-visita',
    name: 'Primera Visita',
    label: 'Primera Visita',
    description: 'Michelada Signature para nuevos seguidores en Instagram. Miércoles, jueves y domingo.',
    days: ['miercoles', 'jueves', 'domingo'],
    promoType: 'PRICE_OVERRIDE',
    categoryName: SIGNATURE_CATEGORY,
    price: 25,
    oncePerOrder: true,
  },
  {
    id: 'shot',
    name: 'Shot + Michelada',
    description: 'Remátala con un shot a tu elección. Miércoles, jueves y domingo.',
    days: ['miercoles', 'jueves', 'domingo'],
    promoType: 'MODIFIER',
    price: 15,
  },
  {
    id: 'escarchado',
    name: 'Doble Escarchado',
    description: 'Súmale un segundo escarchado: Tajín, coco o chamoy. Miércoles, jueves y domingo.',
    days: ['miercoles', 'jueves', 'domingo'],
    promoType: 'MODIFIER',
    price: 5,
  },
];

/** Mapa id → definición */
export const PROMOTIONS_BY_ID = Object.fromEntries(PROMOTIONS.map(p => [p.id, p]));

/**
 * Nombre del día de la semana (español, sin acento) de un businessDayStr.
 * @param {string} businessDayStr — 'YYYY-MM-DD' del día laboral
 * @returns {string} 'domingo'..'sabado'
 */
export function businessDayName(businessDayStr) {
  const [y, m, d] = String(businessDayStr).split('-').map(Number);
  // Mediodía UTC (mismo patrón que addDaysLocal) — getUTCDay nunca cruza día.
  return PROMOTION_DAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/**
 * Promos activas para un día laboral.
 * @param {string} businessDayStr — 'YYYY-MM-DD' del día laboral
 * @returns {Array<object>} definiciones activas (orden de PROMOTIONS)
 */
export function activePromotionsForDay(businessDayStr) {
  const day = businessDayName(businessDayStr);
  return PROMOTIONS.filter(p => p.days.includes(day));
}

/**
 * ¿La promo está activa este día laboral?
 * @param {string} promoId
 * @param {string} businessDayStr
 * @returns {boolean}
 */
export function isPromotionActiveForDay(promoId, businessDayStr) {
  return activePromotionsForDay(businessDayStr).some(p => p.id === promoId);
}

/** @param {string} promoId @returns {object|undefined} */
export function promoById(promoId) {
  return PROMOTIONS_BY_ID[promoId];
}

/**
 * Precio de línea que el server debe facturar para esta promo sobre un
 * item de `categoryName` (nombre de categoría del menú), o null si la
 * promo no aplica como línea (MODIFIER).
 * @param {object} promo — definición (promoById)
 * @param {string|null} categoryName
 * @returns {number|null}
 */
export function promoUnitPrice(promo, categoryName) {
  if (!promo) return null;
  switch (promo.promoType) {
    case 'BOGO': return 0;
    case 'PRICE_OVERRIDE': return promo.price ?? null;
    case 'COMBO': return promo.comboPrices?.[categoryName] ?? null;
    default: return null; // MODIFIER — informativo, sin línea propia
  }
}

export default {
  PROMOTIONS,
  PROMOTIONS_BY_ID,
  PROMOTION_DAYS,
  SIGNATURE_CATEGORY,
  ARTESANAL_CATEGORY,
  businessDayName,
  activePromotionsForDay,
  isPromotionActiveForDay,
  promoById,
  promoUnitPrice,
};