/**
 * E2E flujo 8 — Llamar mesero (waiter-calls): cliente → mesero → atendido.
 *
 *   node scripts/e2e-waiter-calls.mjs
 *
 * Cliente (público, sin auth) crea una llamada con session_id → el mesero
 * la ve en el board (GET /api/waiter-calls) → acepta → marca done.
 * Incluye: duplicado (409), request_bill, cancelar.
 */

import { api, makeReporter, ensureThrowawayTable, getCleanupDb } from './e2e-lib.mjs';
import { tokenFor } from './e2e-session.mjs';

const reporter = makeReporter('waiter-calls');
const TABLE_NUMBER = 96;
const SESSION = `e2e-waiter-${Date.now()}`;

async function run() {
  console.log('== Flujo 8: Llamar mesero ==');

  const adminToken = tokenFor('admin');
  const meseroToken = tokenFor('mesero');
  reporter.assert(!!adminToken && !!meseroToken, 'sesión compartida');

  const table = await ensureThrowawayTable(TABLE_NUMBER, { adminToken });

  // 1. Cliente llama mesero (sin auth — endpoint público)
  console.log('1. Cliente llama mesero (call_waiter)');
  const call = await api('/api/waiter-calls', {
    method: 'POST',
    body: {
      table_id: table.id,
      table_number: TABLE_NUMBER,
      session_id: SESSION,
      call_type: 'call_waiter',
    },
  });
  reporter.assert(call.status === 201 && call.json.call, `llamada creada (${call.status})`);
  const callId = call.json.call.id;
  reporter.assert(call.json.call.status === 'pending', `status pending (${call.json.call.status})`);

  // 2. Duplicado → 409 (no spamear al mesero)
  console.log('2. Duplicado bloqueado');
  const dup = await api('/api/waiter-calls', {
    method: 'POST',
    body: {
      table_id: table.id,
      table_number: TABLE_NUMBER,
      session_id: SESSION,
      call_type: 'call_waiter',
    },
  });
  reporter.assert(dup.status === 409 && dup.json.code === 'CALL_ALREADY_PENDING', `duplicado → 409 (${dup.status})`);

  // 3. Mesero ve la llamada en su board
  console.log('3. Mesero ve la llamada');
  const list = await api('/api/waiter-calls?status=pending', { token: meseroToken });
  reporter.assert(list.json.calls?.some(c => c.id === callId), 'llamada visible en board de mesero');
  reporter.assert(list.json.calls?.find(c => c.id === callId)?.table_number === TABLE_NUMBER, 'mesa correcta');

  // 4. Mesero acepta
  console.log('4. Mesero acepta');
  const accept = await api(`/api/waiter-calls/${callId}/accept`, { method: 'PATCH', token: meseroToken });
  reporter.assert(accept.status === 200 && accept.json.call?.status === 'accepted', `aceptada (${accept.status})`);

  // 5. Aceptar de nuevo → 409 (atómico)
  const acceptAgain = await api(`/api/waiter-calls/${callId}/accept`, { method: 'PATCH', token: meseroToken });
  reporter.assert(acceptAgain.status === 409, `doble aceptar → 409 (${acceptAgain.status})`);

  // 6. Mesero marca done
  console.log('5. Mesero marca atendido (done)');
  const done = await api(`/api/waiter-calls/${callId}/done`, { method: 'PATCH', token: meseroToken });
  reporter.assert(done.status === 200, `done (${done.status})`);

  // 7. Ya no aparece en pending
  const list2 = await api('/api/waiter-calls?status=pending', { token: meseroToken });
  reporter.assert(!list2.json.calls?.some(c => c.id === callId), 'fuera de pending tras done');

  // 8. Cliente pide cuenta (request_bill) → otra llamada
  console.log('6. Cliente pide cuenta (request_bill)');
  const bill = await api('/api/waiter-calls', {
    method: 'POST',
    body: {
      table_id: table.id,
      table_number: TABLE_NUMBER,
      session_id: SESSION,
      call_type: 'request_bill',
    },
  });
  reporter.assert(bill.status === 201, `request_bill creada (${bill.status})`);
  const billId = bill.json.call.id;

  // 9. Cliente cancela (DELETE)
  console.log('7. Cliente cancela la llamada');
  const cancel = await api(`/api/waiter-calls/${billId}`, { method: 'DELETE' });
  reporter.assert(cancel.status === 200, `llamada cancelada (${cancel.status})`);

  // 10. Llamada inexistente → 404
  const missing = await api('/api/waiter-calls/no-existe/done', { method: 'PATCH', token: meseroToken });
  reporter.assert(missing.status === 404, `llamada inexistente → 404 (${missing.status})`);

  // Limpieza
  const db = await getCleanupDb();
  db.prepare('DELETE FROM waiter_calls WHERE session_id = ?').run(SESSION);
  await api(`/api/tables/${table.id}`, { method: 'DELETE', token: adminToken });
  reporter.assert(true, 'limpieza completa');

  reporter.finish();
}

run().catch(err => {
  console.error('E2E crash:', err);
  process.exit(1);
});
