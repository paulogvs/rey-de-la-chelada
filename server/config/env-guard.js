/**
 * ═══════════════════════════════════════════════════════════
 *  ENV GUARD — Fail-loud en producción (P0-2)
 *
 *  El server arranca con `node --env-file-if-exists=.env` (start-hidden.vbs,
 *  setup.bat, update.bat, npm scripts). En PRODUCCIÓN JWT_SECRET es
 *  OBLIGATORIO: sin él el auth usa el fallback de desarrollo y los tokens
 *  son predecibles. Este guard aborta el arranque antes de escuchar.
 *
 *  Artículo VI: Observabilidad — fail loud, never silent.
 *  Artículo VII: Secrets Boundary — Config desde .env.
 * ═══════════════════════════════════════════════════════════
 */

/**
 * Guard de arranque: en producción JWT_SECRET es OBLIGATORIO (fail-loud).
 * @param {NodeJS.ProcessEnv} [env] — process.env por defecto (inyectable para tests)
 */
export function assertProdSecret(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.JWT_SECRET) {
    throw new Error('[Auth] NODE_ENV=production requiere JWT_SECRET. Configúralo en .env (min 32 chars).');
  }
}

export default assertProdSecret;
