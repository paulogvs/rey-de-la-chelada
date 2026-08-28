/**
 * printApi — Cliente de impresión térmica (server-side).
 *
 * v14 (2026-08-28): la impresión real vive en el server (POST /api/print).
 * Caja imprime el ticket al cobrar; Admin puede imprimir ticket de prueba.
 */

export interface PrintResult {
  ok: boolean;
  error?: string;
  code?: string;
  message?: string;
  bytes?: number;
}

export interface SettingsResult {
  ok: boolean;
  error?: string;
  settings?: Record<string, string>;
  effective?: {
    business: { name: string; slogan: string; address: string; phone: string; nit: string };
    tax: { iva: { percentage: number } };
    paperSize: '58mm' | '80mm';
    printerName: string;
  };
}

const API = '/api';

async function post(path: string, token: string, body?: unknown): Promise<PrintResult> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, error: json.error, code: json.code, message: json.message, bytes: json.bytes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de red al imprimir' };
  }
}

/** Imprime el ticket de un pedido (Caja). paymentId opcional (si hay varios pagos). */
export async function printOrderTicket(token: string, orderId: string, paymentId?: string): Promise<PrintResult> {
  return post('/print/ticket', token, { orderId, paymentId });
}

/** Imprime un ticket de prueba (Admin — configuración de impresora). */
export async function printTestTicket(token: string): Promise<PrintResult> {
  return post('/print/test', token);
}

/** GET /api/settings (Admin) */
export async function fetchSettings(token: string): Promise<SettingsResult> {
  try {
    const res = await fetch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, error: json.error, settings: json.settings, effective: json.effective };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de red' };
  }
}

/** PUT /api/settings (Admin) */
export async function saveSettings(token: string, patch: Record<string, string>): Promise<SettingsResult> {
  try {
    const res = await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, error: json.error, settings: json.settings, effective: json.effective };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error de red' };
  }
}