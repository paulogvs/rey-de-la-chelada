@echo off
setlocal enabledelayedexpansion

REM ==========================================================
REM  Rey de la Chelada - Update.bat
REM  Auto-update from GitHub (repositorio PUBLICO, sin token).
REM  Pattern: pull -> install -> build -> restart (real).
REM
REM  v1.4 FIX: el paso de restart ya NO depende de PM2 (no estaba
REM  instalado y el servicio corria con node server/index.js via
REM  start-hidden.vbs). Ahora mata el proceso del puerto y relanza
REM  con start-hidden.vbs. Cada fase verifica y hace pausa.
REM
REM  Uso:  scripts\update.bat   (o npm run update)
REM        scripts\update.bat --force  (reset hard + reinstalar)
REM ==========================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%\.."
cd /d "!APP_DIR!"

set "FORCE=0"
if /i "%1"=="--force" set "FORCE=1"

title Rey de la Chelada - Auto-Update

echo.
echo   ==========================================
echo     Rey de la Chelada - Auto-Update
echo     %DATE% %TIME%
echo   ==========================================
echo.
echo   Carpeta: !APP_DIR!
echo.
echo   Presiona cualquier tecla para comenzar...
pause >nul
echo.

REM ==========================================================
REM Load config from .env
REM ==========================================================
if not exist "!APP_DIR!\.env" (
    echo   [ERROR] No .env found. Copialo antes de actualizar.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%a in ("!APP_DIR!\.env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
            if "%%b"=="GITHUB_REPO" set "GITHUB_REPO=%%c"
            if "%%b"=="APP_NAME" set "APP_NAME=%%c"
            if "%%b"=="PORT" set "PORT=%%c"
        )
    )
)

if "!APP_NAME!"=="" set "APP_NAME=rey-de-la-chelada"
if "!PORT!"=="" set "PORT=3002"
if "!GITHUB_REPO!"=="" set "GITHUB_REPO=paulogvs/rey-de-la-chelada"

echo   Config: app=!APP_NAME! puerto=!PORT! repo=!GITHUB_REPO!
echo.

REM ==========================================================
REM Phase 1: Pull (repositorio publico - sin token)
REM ==========================================================
echo [1/4] Actualizando desde GitHub...
echo.

git fetch origin >nul 2>&1

for /f "tokens=*" %%i in ('git rev-parse HEAD') do set "LOCAL=%%i"
for /f "tokens=*" %%i in ('git rev-parse @{u} 2^>nul') do set "REMOTE=%%i"

if "!FORCE!"=="1" (
    echo   [FORCE] Reset hard a origin/main...
    git reset --hard origin/main
    if !errorlevel! neq 0 (
        echo   [ERROR] git reset fallo.
        pause
        exit /b 1
    )
    echo   [OK] Codigo reseteado
) else if "!REMOTE!"=="" (
    echo   [WARN] Sin upstream configurado. Haciendo pull directo...
    git pull origin main
    if !errorlevel! neq 0 (
        echo   [ERROR] git pull fallo - posibles conflictos locales.
        echo   Solucion: scripts\update.bat --force
        pause
        exit /b 1
    )
    echo   [OK] Pull completado
) else if "!LOCAL!"=="!REMOTE!" (
    echo   [OK] Ya esta actualizado - nada que hacer.
    echo   Version actual: !LOCAL!
    goto :PHASE2
) else (
    git pull --ff-only origin main
    if !errorlevel! neq 0 (
        echo   [ERROR] git pull fallo - posibles conflictos locales.
        echo   Solucion: scripts\update.bat --force
        pause
        exit /b 1
    )
    for /f "tokens=*" %%i in ('git log -1 --oneline') do set "LATEST=%%i"
    echo   [OK] Actualizado a: !LATEST!
)

:PHASE2
echo.

REM ==========================================================
REM Phase 2: Install (SIEMPRE npm --legacy-peer-deps)
REM ==========================================================
echo [2/4] Instalando dependencias...
echo.
call npm install --legacy-peer-deps
if not exist "node_modules\.package-lock.json" (
    echo   [ERROR] Install failed.
    pause
    exit /b 1
)
echo   [OK] Dependencias instaladas
echo.

REM ==========================================================
REM Phase 3: Build
REM ==========================================================
echo [3/4] Compilando...
echo.
call npm run build
if not exist "dist\clientes\index.html" (
    echo   [ERROR] Build fallo (no se genero dist\clientes).
    pause
    exit /b 1
)
echo   [OK] Build completado (6 PWAs)
echo.

REM ==========================================================
REM Phase 4: Restart (REAL - sin PM2)
REM ==========================================================
echo [4/4] Reiniciando servicio en puerto !PORT!...
echo.

REM 4a. Garantizar regla de firewall explicita (acceso LAN + Tailscale).
REM Idempotente: elimina duplicados y verifica el resultado real.
powershell -Command "Get-NetFirewallRule -DisplayName 'Rey de la Chelada :!PORT!' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; try { New-NetFirewallRule -DisplayName 'Rey de la Chelada :!PORT!' -Description 'Rey de la Chelada 6-PWA TCP inbound (LAN + Tailscale)' -Direction Inbound -Protocol TCP -LocalPort !PORT! -Action Allow -Profile Any -ErrorAction Stop | Out-Null; Write-Output OK } catch { exit 1 }" >nul 2>&1
if !errorlevel! neq 0 (
    echo   [AVISO] No se pudo garantizar la regla de firewall TCP !PORT! ^(requiere admin^).
    echo   Localhost seguira funcionando, pero LAN/Tailscale pueden fallar.
    echo   Solucion: ejecuta scripts\setup.bat ^(auto-eleva^) o creala como admin:
    echo   New-NetFirewallRule -DisplayName "Rey de la Chelada :!PORT!" -Direction Inbound -Protocol TCP -LocalPort !PORT! -Action Allow -Profile Any
) else (
    echo   [OK] Regla de firewall TCP !PORT! garantizada (perfiles Any)
)
echo.

REM 4b. Detener proceso en el puerto
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do (
    echo   Deteniendo proceso %%p...
    taskkill /f /pid %%p >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM 4c. Verificar puerto libre
set "STILL=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do set "STILL=1"
if "!STILL!"=="1" (
    echo   [WARN] El puerto !PORT! sigue ocupado. No se pudo detener.
    echo   Cierra manualmente el proceso y relanza scripts\start.bat
    pause
    exit /b 1
)
echo   [OK] Puerto !PORT! liberado

REM 4d. Relanzar servicio oculto
cscript //nologo "!APP_DIR!\scripts\start-hidden.vbs"
echo   Servicio relanzado (oculto), esperando respuesta...

set "READY=0"
for /l %%i in (1,1,15) do (
    if "!READY!"=="0" (
        timeout /t 1 /nobreak >nul
        curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
        if !errorlevel! equ 0 set "READY=1"
    )
)

if "!READY!"=="1" (
    echo   [OK] Servidor responde en http://localhost:!PORT!
) else (
    echo   [AVISO] Servidor iniciado, verifica en unos segundos:
    echo   http://localhost:!PORT!/clientes/
)

echo.
echo   ==========================================
echo     UPDATE COMPLETADO - %DATE% %TIME%
echo     App: http://localhost:!PORT!
echo   ==========================================
echo.
echo   Logs de la app: !APP_DIR!\logs\  (si existe)
echo   Detener:  scripts\stop.bat
echo   Iniciar:  scripts\start.bat
echo.
pause

endlocal
