@echo off
setlocal enabledelayedexpansion

REM ── Rey de la Chelada — Setup.bat ─────────────────────────
REM One-command installer for Windows Self-Hosted.
REM
REM Usage:
REM   1. Copy this file + .env to target PC via USB
REM   2. Edit .env with your credentials
REM   3. Run: setup.bat
REM
REM Flags:
REM   setup.bat --dry-run    → Preview without executing
REM   setup.bat --force      → Force reinstall service

set "DRY_RUN=0"
if /i "%1"=="--dry-run" set "DRY_RUN=1"
if /i "%1"=="-n" set "DRY_RUN=1"

set "FORCE=0"
if /i "%1"=="--force" set "FORCE=1"
if /i "%2"=="--force" set "FORCE=1"

title Rey de la Chelada — Setup

echo. ╔══════════════════════════════════════════════════════╗
echo. ║       Rey de la Chelada — Setup Automatizado        ║
echo. ║       Restaurante/Bar Management System             ║
echo. ╚══════════════════════════════════════════════════════╝
echo.

if "!DRY_RUN!"=="1" (
    echo   ℹ  Modo DRY-RUN: solo mostrando lo que se ejecutaria.
    echo.
)

set "EXEC="
if "!DRY_RUN!"=="0" set "EXEC=call "

REM ─── Phase 1: Prerequisites ───────────────────────────────
echo [1/9] Verificando prerequisitos...

where node >nul 2>&1
if !errorlevel! neq 0 (
    echo   Node.js no encontrado. Instalando via winget...
    if not "!DRY_RUN!"=="1" (
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements
        if !errorlevel! neq 0 (
            echo   [ERROR] No se pudo instalar Node.js.
            exit /b 1
        )
        call refreshenv >nul 2>&1 || set "PATH=%PATH%;C:\Program Files\nodejs"
    )
    echo   ✅ Node.js instalado
) else (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
    echo   ✅ Node.js !NODE_VER!
)

where npm >nul 2>&1
if !errorlevel! neq 0 (
    echo   [ERROR] npm no disponible.
    exit /b 1
)
echo   ✅ npm disponible

where git >nul 2>&1
if !errorlevel! neq 0 (
    echo   Git no encontrado. Instalando...
    if not "!DRY_RUN!"=="1" (
        winget install Git.Git --silent --accept-package-agreements
    )
    echo   ✅ Git instalado
) else (
    echo   ✅ Git instalado
)

echo.

REM ─── Phase 2: Load .env ───────────────────────────────────
echo [2/9] Cargando configuracion...

if not exist ".env" (
    echo   [WARNING] No se encontro .env
    if exist ".env.example" (
        if not "!DRY_RUN!"=="1" (
            copy ".env.example" ".env" >nul
        )
        echo   ⚠  EDIT .env antes de continuar.
        echo   Luego ejecuta setup.bat nuevamente.
        exit /b 1
    ) else (
        echo   [ERROR] No hay .env ni .env.example
        exit /b 1
    )
)

for /f "usebackq delims=" %%a in (".env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
            set "%%b=%%c"
        )
    )
)

if "!APP_NAME!"=="" (
    for %%i in ("!CD!") do set "APP_NAME=%%~nxi"
)

if "!GITHUB_TOKEN!"=="" (
    echo   [WARNING] GITHUB_TOKEN no definido. Auto-update desactivado.
)

if "!PORT!"=="" set PORT=3001
if "!DATABASE_PATH!"=="" set DATABASE_PATH=./data/app.db
if "!BACKUP_DIR!"=="" set BACKUP_DIR=./backups

echo   ✅ Configuracion cargada
echo     App:      !APP_NAME!
echo     Puerto:   !PORT!
echo     Mesas:    !DEFAULT_TABLES!
echo.

REM ─── Phase 3: Clone / Pull ────────────────────────────────
echo [3/9] Obteniendo codigo fuente...

set "APP_DIR=!CD!"

if not exist "package.json" (
    if not "!GITHUB_REPO!"=="" (
        echo   Clonando repositorio...
        set "CLONE_URL=https://!GITHUB_TOKEN!@github.com/!GITHUB_REPO!.git"
        cd ..
        if not "!DRY_RUN!"=="1" (
            git clone "!CLONE_URL!" "!APP_DIR!" --branch !GITHUB_BRANCH! --single-branch 2>nul
        )
        cd "!APP_DIR!"
        echo   ✅ Repositorio clonado
    ) else (
        echo   Usando codigo local
    )
) else (
    echo   ✅ Codigo ya presente
)

echo.

REM ─── Phase 4: Install Dependencies ────────────────────────
echo [4/9] Instalando dependencias...

set "PM=npm"
where pnpm >nul 2>&1
if !errorlevel! equ 0 set "PM=pnpm"

if not "!DRY_RUN!"=="1" (
    echo !PM! > ".pm-config"
)

if not exist "node_modules\package.json" (
    if "!PM!"=="pnpm" (
        %EXEC%call pnpm install
    ) else (
        %EXEC%call npm install
    )
    if not exist "node_modules\package.json" (
        echo   [ERROR] Fallo la instalacion de dependencias.
        exit /b 1
    )
    echo   ✅ Dependencias instaladas
) else (
    echo   ✅ Dependencias ya instaladas
)

echo.

REM ─── Phase 5: Build ───────────────────────────────────────
echo [5/9] Compilando aplicacion...

findstr /c:""build"" package.json >nul 2>&1
if !errorlevel! equ 0 (
    if "!PM!"=="pnpm" (
        %EXEC%call pnpm run build
    ) else (
        %EXEC%call npm run build
    )
    if exist "dist\" (
        echo   ✅ Build completado
    ) else (
        echo   ⚠  No se detecto output de build
    )
) else (
    echo   Sin build script
)

echo.

REM ─── Phase 6: Install PM2 + nssm ──────────────────────────
echo [6/9] Configurando servicio...

where pm2 >nul 2>&1
if !errorlevel! neq 0 (
    %EXEC%call npm install -g pm2
    if !errorlevel! equ 0 echo   ✅ PM2 instalado
) else (
    echo   ✅ PM2 ya instalado
)

net session >nul 2>&1
set "IS_ADMIN=!errorlevel!"

if "!IS_ADMIN!"=="0" (
    where nssm >nul 2>&1
    if !errorlevel! neq 0 (
        if not "!DRY_RUN!"=="1" (
            curl -L "https://nssm.cc/release/nssm-2.24.zip" -o "%TEMP%\nssm.zip" >nul 2>&1
            powershell -Command "Expand-Archive '%TEMP%\nssm.zip' '%TEMP%\nssm\' -Force" >nul 2>&1
            copy "%TEMP%\nssm\nssm-2.24\win64\nssm.exe" "%WINDIR%\system32\nssm.exe" >nul 2>&1
        )
        echo   ✅ nssm instalado
    )
    
    if not "!DRY_RUN!"=="1" (
        nssm stop "!APP_NAME!" >nul 2>&1
        nssm remove "!APP_NAME!" confirm >nul 2>&1
        nssm install "!APP_NAME!" "%APPDATA%\npm\pm2.cmd"
        nssm set "!APP_NAME!" AppParameters "start ecosystem.config.js --env production"
        nssm set "!APP_NAME!" AppDirectory "!APP_DIR!"
        nssm set "!APP_NAME!" Start SERVICE_AUTO_START
        nssm start "!APP_NAME!" >nul 2>&1
    )
    echo   ✅ Servicio Windows creado: !APP_NAME!
) else (
    echo   ⚠  Sin permisos admin. Usando Task Scheduler.
    if not "!DRY_RUN!"=="1" (
        schtasks /create /tn "!APP_NAME!" /tr "cmd /c start /min node server/index.js" /sc onlogon /f >nul 2>&1
    )
    echo   ✅ Tarea programada creada
)

echo.

REM ─── Phase 7: Tailscale Serve ─────────────────────────────
echo [7/9] Configurando Tailscale Serve...

where tailscale >nul 2>&1
if !errorlevel! equ 0 (
    if not "!DRY_RUN!"=="1" (
        tailscale serve --bg --set-path=/ http://localhost:!PORT! >nul 2>&1
    )
    echo   ✅ Tailscale Serve activo
    echo   URL: https://!COMPUTERNAME!.ts.net/
) else (
    echo   ℹ  Tailscale no instalado. La app corre solo en localhost.
)

echo.

REM ─── Phase 8: Auto-Update + Backup ────────────────────────
echo [8/9] Configurando actualizacion...

if not exist "logs" if "!DRY_RUN!"=="0" mkdir logs

if not "!GITHUB_REPO!"=="" (
    schtasks /query /tn "!APP_NAME!-update" >nul 2>&1
    if !errorlevel! neq 0 (
        if not "!DRY_RUN!"=="1" (
            schtasks /create /tn "!APP_NAME!-update" /tr "cmd /c \"!APP_DIR!\update.bat\"" /sc hourly /f >nul 2>&1
        )
        echo   ✅ Auto-update configurado (cada hora)
    ) else (
        echo   ✅ Auto-update ya configurado
    )
)

schtasks /query /tn "!APP_NAME!-backup" >nul 2>&1
if !errorlevel! neq 0 (
    if not "!DRY_RUN!"=="1" (
        schtasks /create /tn "!APP_NAME!-backup" /tr "cmd /c \"!APP_DIR!\backup.bat\"" /sc daily /st 0300 /f >nul 2>&1
    )
    echo   ✅ Backup diario configurado (3:00 AM)
) else (
    echo   ✅ Backup ya configurado
)

echo.

REM ─── Phase 9: Health Check ────────────────────────────────
echo [9/9] Verificando funcionamiento...

if not "!DRY_RUN!"=="1" (
    timeout /t 3 /nobreak >nul
    powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:!PORT!/health' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   ✅ App responde correctamente (localhost:!PORT!)
    ) else (
        echo   ⚠  Health check: la app puede estar iniciando...
    )
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║       ✅ SETUP COMPLETADO                           ║
echo ║       Rey de la Chelada                             ║
echo ║       Cochabamba, Bolivia                           ║
echo ╚══════════════════════════════════════════════════════╝
echo.
echo   Local:     http://localhost:!PORT!
echo   HTTPS:     https://!COMPUTERNAME!.ts.net/
echo   Logs:      !APP_DIR!\logs\
echo.
pause

endlocal
