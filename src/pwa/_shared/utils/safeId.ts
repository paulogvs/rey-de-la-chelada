/**
 * safeId — Generador de UUID compatible con contextos no-seguros.
 *
 * `crypto.randomUUID()` solo existe en contextos SEGUROS (https o localhost).
 * En una PWA servida por IP LAN/Tailscale (http://192.168.x.x o 100.x.x.x),
 * `crypto` existe pero `crypto.randomUUID` es `undefined` → TypeError al
 * invocarlo → rompe el cobro (idempotency_key) con "Error al procesar el pago".
 *
 * Este helper usa crypto.randomUUID cuando está disponible y cae a un
 * UUID v4 basado en getRandomValues (siempre disponible) cuando no.
 */
export function safeId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* cae al fallback */
    }
  }
  // Fallback UUID v4
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC4122
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default safeId;