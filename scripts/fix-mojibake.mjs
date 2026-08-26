/**
 * fix-mojibake.mjs — Limpia caracteres corruptos (doble-encoding UTF-8→Latin-1)
 *
 * Problema: "Flor de CaÃ±a" debería ser "Flor de Caña". El texto se guardó
 * con los bytes UTF-8 de "ñ" (C3 B1) interpretados como Latin-1 → "Ã±".
 *
 * Uso:
 *   node scripts/fix-mojibake.mjs --seed --dry-run   → muestra qué cambiaría en el seed
 *   node scripts/fix-mojibake.mjs --seed             → corrige menu-seed.json (UTF-8 sin BOM)
 *   node scripts/fix-mojibake.mjs --db --dry-run     → muestra qué cambiaría en la DB
 *   node scripts/fix-mojibake.mjs --db               → corrige la DB (menu_items, menu_categories, etc.)
 *
 * Seguro: solo reemplaza patrones de mojibake conocidos; nunca toca texto sano.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '../server/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../src/core/data/menu-seed.json');

const args = process.argv.slice(2);
const targetSeed = args.includes('--seed');
const targetDb = args.includes('--db');
const dryRun = args.includes('--dry-run');

if (!targetSeed && !targetDb) {
  console.error('Uso: node scripts/fix-mojibake.mjs [--seed|--db] [--dry-run]');
  process.exit(1);
}

/** Mapa de mojibake → carácter correcto (orden: dobles primero, luego simples). */
const MOJIBAKE_MAP = [
  // Doble mojibake (triple encoding) — raro pero posible
  ['ÃƒÂ±', 'ñ'], ['ÃƒÂ¡', 'á'], ['ÃƒÂ©', 'é'], ['ÃƒÂ­', 'í'], ['ÃƒÂ³', 'ó'], ['ÃƒÂº', 'ú'], ['ÃƒÂ¼', 'ü'],
  // Doble-encoding 2ª generación (Jägermeister → "JÍ¤germeister" en el seed viejo)
  ['Í¤', 'ä'], ['Û¢', 'ü'], ['Ä©', 'é'], ['Ä°', 'í'], ['Ã¼', 'ü'], ['Ä³', 'ó'], ['Ã¡', 'á'],
  // Mojibake simple UTF-8→Latin-1 (el caso real)
  ['Ã±', 'ñ'], ['Ã¡', 'á'], ['Ã©', 'é'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'], ['Ã¼', 'ü'],
  ['Ã€', 'À'], ['Ã‰', 'É'], ['Ãš', 'Ú'], ['Ã“', 'Ó'], ['Ãœ', 'Ü'], ['Ã', 'Í'],
  ['Ã§', 'ç'], ['Ã‡', 'Ç'], ['Ã¼', 'ü'], ['Ã¶', 'ö'], ['Ã¤', 'ä'], ['Ã¸', 'ø'],
  // Símbolos comunes doble-encoding
  ['â€“', '–'], ['â€”', '—'], ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'], ['â€¦', '…'],
];

function fixText(text) {
  let out = text;
  let count = 0;
  for (const [bad, good] of MOJIBAKE_MAP) {
    if (out.includes(bad)) {
      const parts = out.split(bad);
      count += parts.length - 1;
      out = parts.join(good);
    }
  }
  return { text: out, count };
}

/** Corrige un valor si tiene mojibake; devuelve { changed, value } */
function fixField(value) {
  if (typeof value !== 'string' || !value) return { changed: false, value };
  const { text, count } = fixText(value);
  return { changed: count > 0, value: text, count };
}

async function fixSeed() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const { text, count } = fixText(raw);
  if (count === 0) {
    console.log('[seed] Sin mojibake detectado ✓');
    return;
  }
  console.log(`[seed] ${count} reemplazo(s) de mojibake detectados`);
  if (dryRun) {
    console.log('[seed] DRY RUN — no se escribe nada');
    return;
  }
  fs.writeFileSync(SEED_PATH, text, { encoding: 'utf8' });
  console.log('[seed] Corregido (UTF-8 sin BOM)');
}

function fixDb() {
  const db = getDb();
  // Columnas de texto del menú que pueden tener mojibake
  const targets = [
    { table: 'menu_items', cols: ['name', 'subtitle', 'description'] },
    { table: 'menu_categories', cols: ['name', 'description'] },
  ];
  let totalChanged = 0;

  for (const { table, cols } of targets) {
    const rows = db.prepare(`SELECT id, ${cols.join(', ')} FROM ${table}`).all();
    for (const row of rows) {
      for (const col of cols) {
        const { changed, value, count } = fixField(row[col]);
        if (changed) {
          if (dryRun) {
            console.log(`[db] DRY RUN: ${table}.${col} (${row[col]}) → (${value})`);
          } else {
            db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(value, row.id);
          }
          totalChanged += count;
        }
      }
    }
  }

  if (totalChanged === 0) {
    console.log('[db] Sin mojibake en menú detectado ✓');
  } else {
    console.log(`[db] ${totalChanged} reemplazo(s)${dryRun ? ' (DRY RUN — sin escribir)' : ' aplicados'}`);
  }
}

if (targetSeed) await fixSeed();
if (targetDb) {
  fixDb();
  closeDb();
}