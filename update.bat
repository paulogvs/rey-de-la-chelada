@echo off
setlocal enabledelayedexpansion

REM ==========================================================
REM  Rey de la Chelada - Update.bat
REM  Auto-update from GitHub (runs hourly via Scheduled Task
REM  or manually by double-click).
REM  Pattern: pull -> install -> build -> restart (EcoJet-proven)
REM ==========================================================

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "!APP_DIR!"

title Rey de la Chelada - Auto-Update

echo.
echo   ==========================================
echo     Rey de la Chelada - Auto-Update
echo     %DATE% %TIME%
echo   ==========================================
echo.

if not exist "!APP_DIR!\.env" (
    echo [SKIP] No .env found.
    exit /b 0
)

REM ==========================================================
REM Read config from .env
REM ==========================================================
for /f "usebackq delims=" %%a in ("!APP_DIR!\.env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
            if "%%b"=="GITHUB_TOKEN" set "GITHUB_TOKEN=%%c"
            if "%%b"=="GITHUB_REPO" set "GITHUB_REPO=%%c"
            if "%%b"=="APP_NAME" set "APP_NAME=%%c"
            if "%%b"=="PORT" set "PORT=%%c"
        )
    )
)

if "!GITHUB_TOKEN!"=="" (
    echo [SKIP] No GITHUB_TOKEN configured.
    exit /b 0
)

if "!APP_NAME!"=="" set "APP_NAME=rey-de-la-chelada"
if "!PORT!"=="" set "PORT=3002"
if "!GITHUB_REPO!"=="" set "GITHUB_REPO=paulogvs/rey-de-la-chelada"

set "PM=npm"
if exist "!APP_DIR!\.pm-config" set /p PM=<"!APP_DIR!\.pm-config"
echo   Package manager: !PM!
echo.

REM ==========================================================
REM Phase 1: Pull
REM ==========================================================
echo [1/4] Pulling from GitHub...

git remote set-url origin "https://oauth2:!GITHUB_TOKEN!@github.com/!GITHUB_REPO!.git" >nul 2>&1
git fetch origin >nul 2>&1

for /f "tokens=*" %%i in ('git rev-parse HEAD') do set "LOCAL=%%i"
for /f "tokens=*" %%i in ('git rev-parse @{u} 2^>nul') do set "REMOTE=%%i"

if "!REMOTE!"=="" (
    echo   [WARNING] No upstream branch configured. Saltando pull
    goto :SKIP_PULL
) else if "!LOCAL!"=="!REMOTE!" (
    echo   Ya esta actualizado - nada que hacer.
    goto :DONE
)

if "%1"=="--force" (
    git reset --hard origin/main
) else (
    git pull --ff-only origin main
    if !errorlevel! neq 0 (
        echo   [ERROR] git pull fallo - posibles conflictos locales.
        echo   Solucion: ejecuta update.bat --force
        exit /b 1
    )
)
for /f "tokens=*" %%i in ('git log -1 --oneline') do set "LATEST=%%i"
echo   Actualizado a: !LATEST!
echo.

:SKIP_PULL

REM ==========================================================
REM Phase 2: Install
REM ==========================================================
echo [2/4] Instalando dependencias...
if "!PM!"=="pnpm" (
    call pnpm install
) else (
    call npm install
)
if not exist "node_modules\package.json" (
    echo   [ERROR] Install failed.
    exit /b 1
)
echo   Dependencias instaladas
echo.

REM ==========================================================
REM Phase 3: Build
REM ==========================================================
echo [3/4] Compilando...
findstr /c:"build" package.json >nul 2>&1
if !errorlevel! equ 0 (
    if "!PM!"=="pnpm" (
        call pnpm run build
    ) else (
        call npm run build
    )
    echo   Build completado
) else (
    echo   Sin build script
)
echo.

REM ==========================================================
REM Phase 4: Restart
REM ==========================================================
echo [4/4] Reiniciando servicio...
where pm2 >nul 2>&1
if !errorlevel! equ 0 (
    pm2 restart !APP_NAME! >nul 2>&1
    if !errorlevel! equ 0 (
        echo   App reiniciada: !APP_NAME!
    ) else (
        pm2 start ecosystem.config.cjs --env production >nul 2>&1
        echo   App iniciada
    )
) else (
    echo   [WARNING] PM2 no encontrado. Inicia manualmente: node server/index.js
)

:DONE
echo.
echo   ==========================================
echo     Update completo - %DATE% %TIME%
echo     App: http://localhost:!PORT!
echo   ==========================================
echo.

endlocal
