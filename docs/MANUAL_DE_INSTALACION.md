# Manual de Instalación — Rey de la Chelada

Instalación en PC nueva: copia `setup.bat` + `elevate.vbs` + `.env` a la
carpeta destino y ejecuta `setup.bat` como Administrador (auto-eleva,
clona el repo, instala dependencias, compila las 6 PWAs y deja el servicio
corriendo oculto).

Actualización: `scripts\update.bat` (pull → install → build → restart real).

## Variables de entorno obligatorias

El server arranca con `node --env-file-if-exists=.env server/index.js`
(NODE ≥ 22.9 soporta `--env-file-if-exists`; el repo declara
`"engines": { "node": ">=22.9.0" }`). El `.env` vive en la raíz del
proyecto, NO se sube a git y debe contener como mínimo:

| Variable     | Obligatoria | Descripción |
|--------------|-------------|-------------|
| `JWT_SECRET` | SÍ (prod)   | Secreto de firma de tokens. **Mínimo 32 caracteres**; en `NODE_ENV=production` su ausencia ABORTA el arranque (fail-loud, guard en `server/config/env-guard.js`). Genéralo con `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `NODE_ENV`   | SÍ (prod)   | `production` en el bar (desactiva stack traces y exige `JWT_SECRET`); `development` en la máquina de trabajo. |
| `PORT`       | Recomendada | Puerto del servidor (default `3002`). Debe coincidir con la regla de firewall que crea `setup.bat`. |

Otras variables opcionales leídas por el server: `DB_PATH`,
`AUTH_RATE_LIMIT_MAX`, `CORS_ORIGINS`, `JWT_EXPIRES_IN`, `LOG_DIR`,
`DEFAULT_TABLES` (debe coincidir con `capacity.totalTables` del SSOT — 10),
`PUBLIC_BASE_URL`.

> **Nota:** en producción el server aborta si `NODE_ENV=production` sin
> `JWT_SECRET` — nunca dejes un server productivo con el fallback de
> desarrollo (`dev-secret-do-not-use-in-production`).
