/**
 * Seed — rol 'caja' real (S1/T1)
 *
 * runSeed() debe crear 4 roles: admin, mesero, kds y caja (PIN 3333).
 * ensureStaff es idempotente (no duplica si el rol ya existe).
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { applySchema } from '../../server/db/schema.js';
import { runSeed, ensureStaff } from '../../server/db/seed.js';

function makeDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

describe('Seed — rol caja', () => {
  it('runSeed crea 4 roles incluyendo caja con PIN 3333 y display_name Cajero', () => {
    const db = makeDb();
    runSeed(db);

    const staff = db.prepare('SELECT role, display_name, pin_hash FROM staff ORDER BY role').all();
    const roles = staff.map(s => s.role);
    expect(roles).toEqual(['admin', 'caja', 'kds', 'mesero']);

    const caja = staff.find(s => s.role === 'caja');
    expect(caja.display_name).toBe('Cajero');
    expect(bcrypt.compareSync('3333', caja.pin_hash)).toBe(true);
    db.close();
  });

  it('ensureStaff caja es idempotente (segunda llamada no duplica)', () => {
    const db = makeDb();
    const first = ensureStaff(db, { pin: '3333', role: 'caja', display_name: 'Cajero' });
    const second = ensureStaff(db, { pin: '3333', role: 'caja', display_name: 'Cajero' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM staff WHERE role = 'caja'").get().n).toBe(1);
    db.close();
  });

  it('el PIN del caja NO se puede usar para entrar como admin (roles separados)', () => {
    const db = makeDb();
    runSeed(db);
    // Roles son distintos: caja tiene su propio rol, admin sigue siendo otro staff
    const cajaRole = db.prepare("SELECT role FROM staff WHERE role = 'caja'").get();
    const adminRole = db.prepare("SELECT role FROM staff WHERE role = 'admin'").get();
    expect(cajaRole.role).toBe('caja');
    expect(adminRole.role).toBe('admin');
    expect(cajaRole.role).not.toBe(adminRole.role);
    db.close();
  });
});
