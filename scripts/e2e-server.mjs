/**
 * e2e-server — arranca el server para Playwright con una DB de test limpia.
 *
 * Elimina data/test-e2e.db (y sus archivos -wal/-shm) antes de levantar el
 * server, para que cada corrida e2e parta de un estado predecible. El server
 * (server/index.js) lee PORT y DB_PATH del entorno.
 */
import { existsSync, rmSync } from 'node:fs';

const dbPath = process.env.DB_PATH || 'data/test-e2e.db';
for (const suffix of ['', '-wal', '-shm']) {
  const target = dbPath + suffix;
  if (existsSync(target)) {
    rmSync(target, { force: true });
  }
}

// El server inicia al importarse (server.listen al final del módulo).
await import('../server/index.js');
