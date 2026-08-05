@echo off
setlocal enabledelayedexpansion

REM ==========================================================
REM  Rey de la Chelada - Setup.bat
REM  One-command installer for Windows Self-Hosted.
REM  Copia este archivo + elevate.vbs + .env a la PC nueva y ejecutalo.
REM  Descarga la ultima version de GitHub (repositorio PUBLICO),
REM  instala dependencias, compila, verifica y deja la app corriendo.
REM
REM  Uso:
REM    1. Copiar setup.bat + elevate.vbs + .env a la carpeta destino
REM    2. Doble clic en setup.bat (auto-eleva a Administrador)
REM
REM  Flags:
REM    setup.bat --dry-run   Preview sin ejecutar
REM    setup.bat --skip-pull No clonar/pull (usar codigo local)
REM
REM  IMPORTANTE (v1.4): despues de un setup exitoso, este archivo
REM  se mueve a scripts\setup.bat (la raiz queda limpia, solo .env).
REM  La raiz se detecta por la ubicacion de .env:
REM    - Si .env esta junto al script  -> estamos en la raiz (bootstrap)
REM    - Si .env esta en el padre      -> estamos en scripts/ (ya instalado)
REM ==========================================================

set "DRY_RUN=0"
if /i "%1"=="--dry-run" set "DRY_RUN=1"
if /i "%1"=="-n" set "DRY_RUN=1"

set "SKIP_PULL=0"
if /i "%1"=="--skip-pull" set "SKIP_PULL=1"
if /i "%2"=="--skip-pull" set "SKIP_PULL=1"

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%"
if not exist "%SCRIPT_DIR%\.env" if exist "%SCRIPT_DIR%\..\.env" set "APP_DIR=%SCRIPT_DIR%\.."

title Rey de la Chelada - Setup

REM ==========================================================
REM Auto-elevation to Administrator (VBScript)
REM ==========================================================
net session >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo   [INFO] Este instalador necesita permisos de Administrador.
    echo   Solicitando elevacion UAC, acepta el prompt...
    cscript //nologo "!APP_DIR!\elevate.vbs"
    exit /b 0
)

echo.
echo   ==========================================
echo     Rey de la Chelada - Setup Automatizado
echo     Restaurante/Bar Management System
echo     FORCH.i by Paulo Velasco - Bolivia
echo   ==========================================
echo.
echo   Ruta instalacion: !APP_DIR!
echo.
echo   Presiona cualquier tecla para comenzar...
pause >nul
echo.

if "!DRY_RUN!"=="1" (
    echo   Modo DRY-RUN: solo mostrando lo que se ejecutaria.
    echo.
)

set "EXEC="
if "!DRY_RUN!"=="0" set "EXEC=call "

REM ==========================================================
REM Phase 1: Prerequisites (Node.js, npm, Git)
REM ==========================================================
echo [1/7] Verificando prerequisitos...
echo.

where node >nul 2>&1
if !errorlevel! neq 0 (
    echo   [WARN] Node.js no encontrado. Instalando via winget...
    if not "!DRY_RUN!"=="1" (
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements
        if !errorlevel! neq 0 (
            echo   [ERROR] No se pudo instalar Node.js.
            echo   Instalalo manualmente desde https://nodejs.org y reintenta.
            pause
            exit /b 1
        )
        call refreshenv >nul 2>&1 || set "PATH=%PATH%;C:\Program Files\nodejs"
    )
    echo   [OK] Node.js instalado
) else (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
    echo   [OK] Node.js !NODE_VER!
)

where npm >nul 2>&1
if !errorlevel! neq 0 (
    echo   [ERROR] npm no disponible ^(viene con Node.js^).
    pause
    exit /b 1
) else (
    echo   [OK] npm disponible
)

where git >nul 2>&1
if !errorlevel! neq 0 (
    echo   [WARN] Git no encontrado. Instalando via winget...
    if not "!DRY_RUN!"=="1" (
        winget install Git.Git --silent --accept-package-agreements
        if !errorlevel! neq 0 (
            echo   [ERROR] No se pudo instalar Git.
            pause
            exit /b 1
        )
    )
    echo   [OK] Git instalado
) else (
    echo   [OK] Git instalado
)

echo.

REM ==========================================================
REM Phase 2: Load .env
REM ==========================================================
echo [2/7] Cargando configuracion (.env)...
echo.

if not exist "!APP_DIR!\.env" (
    echo   [ERROR] No se encontro .env en !APP_DIR!
    echo.
    echo   El .env NO se sube a git ^(contiene secretos^).
    echo   Copialo junto con setup.bat a la PC nueva.
    echo   Contenido minimo: PORT y PUBLIC_BASE_URL.
    echo.
    pause
    exit /b 1
)

for /f "usebackq delims=" %%a in ("!APP_DIR!\.env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
            set "%%b=%%c"
        )
    )
)

if "!APP_NAME!"=="" (
    for %%i in ("!APP_DIR!") do set "APP_NAME=%%~nxi"
)

if "!PORT!"=="" set PORT=3002
if "!DATABASE_PATH!"=="" set DATABASE_PATH=./data/rey-de-la-chelada.db
if "!BACKUP_DIR!"=="" set BACKUP_DIR=./backups
if "!GITHUB_REPO!"=="" set "GITHUB_REPO=paulogvs/rey-de-la-chelada"
if "!GITHUB_BRANCH!"=="" set "GITHUB_BRANCH=main"

echo   [OK] Configuracion cargada:
echo     App:      !APP_NAME!
echo     Puerto:   !PORT!
echo     Repo:     !GITHUB_REPO! (branch: !GITHUB_BRANCH!)
echo.

REM ==========================================================
REM Phase 3: Clone / Pull (repositorio PUBLICO, sin token)
REM ==========================================================
echo [3/7] Obteniendo ultima version de GitHub...
echo.

cd /d "!APP_DIR!"

if "!SKIP_PULL!"=="1" (
    echo   [INFO] --skip-pull: usando codigo local.
) else if not exist "package.json" (
    echo   Clonando repositorio !GITHUB_REPO!...
    if not "!DRY_RUN!"=="1" (
        git clone "https://github.com/!GITHUB_REPO!.git" temp-clone --branch !GITHUB_BRANCH! --single-branch
        if not exist "temp-clone\package.json" (
            echo   [ERROR] No se pudo clonar el repositorio.
            echo   Revisa la conexion a internet y el nombre del repo.
            rmdir /s /q temp-clone >nul 2>&1
            pause
            exit /b 1
        )
        xcopy "temp-clone\*" "!APP_DIR!\" /E /H /Y >nul 2>&1
        rmdir /s /q temp-clone >nul 2>&1
    )
    echo   [OK] Repositorio clonado
) else (
    echo   Codigo ya presente. Actualizando...
    if not "!DRY_RUN!"=="1" (
        git fetch origin !GITHUB_BRANCH! >nul 2>&1
        git pull --ff-only origin !GITHUB_BRANCH! >nul 2>&1
        if !errorlevel! neq 0 (
            echo   [WARN] git pull fallo ^(cambios locales^). Forzando...
            git reset --hard origin/!GITHUB_BRANCH! >nul 2>&1
        )
    )
    echo   [OK] Codigo actualizado
)

echo.

REM ==========================================================
REM Phase 4: Install Dependencies (SIEMPRE npm --legacy-peer-deps)
REM ==========================================================
echo [4/7] Instalando dependencias...
echo.

if not "!DRY_RUN!"=="1" (
    call npm install --legacy-peer-deps
    if not exist "node_modules\.package-lock.json" (
        echo   [ERROR] Fallo la instalacion de dependencias.
        echo   Revisa la conexion a internet y reintenta.
        pause
        exit /b 1
    )
    echo   [OK] Dependencias instaladas
) else (
    echo   [DRY-RUN] npm install --legacy-peer-deps
)

echo.

REM ==========================================================
REM Phase 5: Build
REM ==========================================================
echo [5/7] Compilando aplicacion (6 PWAs)...
echo.

findstr /c:"build" package.json >nul 2>&1
if !errorlevel! equ 0 (
    if not "!DRY_RUN!"=="1" (
        call npm run build
        if exist "dist\clientes\index.html" (
            echo   [OK] Build completado, 6 PWAs
        ) else (
            echo   [ERROR] Build no genero output esperado.
            echo   Revisa los errores de compilacion arriba.
            pause
            exit /b 1
        )
    ) else (
        echo   [DRY-RUN] npm run build
    )
) else (
    echo   [WARN] Sin build script en package.json
)

echo.

REM ==========================================================
REM Phase 6: Firewall + arranque del servicio
REM ==========================================================
echo [6/7] Abriendo puerto y arrancando servicio...
echo.

if not "!DRY_RUN!"=="1" (
    powershell -Command "New-NetFirewallRule -DisplayName 'Rey de la Chelada' -Direction Inbound -Protocol TCP -LocalPort !PORT! -Action Allow -ErrorAction SilentlyContinue" >nul 2>&1
)
echo   [OK] Firewall: puerto !PORT! abierto

if not "!DRY_RUN!"=="1" (
    REM Detener cualquier proceso en el puerto antes de arrancar
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do (
        taskkill /f /pid %%p >nul 2>&1
    )
    cscript //nologo "!APP_DIR!\scripts\start-hidden.vbs"
    timeout /t 4 /nobreak >nul
)
echo   [OK] Servicio iniciado (oculto)
echo.

REM ==========================================================
REM Phase 7: Health Check
REM ==========================================================
echo [7/7] Verificando funcionamiento...
echo.

if not "!DRY_RUN!"=="1" (
    set "READY=0"
    for /l %%i in (1,1,15) do (
        if "!READY!"=="0" (
            timeout /t 1 /nobreak >nul
            curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
            if !errorlevel! equ 0 set "READY=1"
        )
    )
    if "!READY!"=="1" (
        echo   [OK] App responde correctamente en localhost:!PORT!
    ) else (
        echo   [AVISO] La app puede estar iniciando aun.
        echo   Verifica: http://localhost:!PORT!/clientes/
    )
)

echo.
echo   ==========================================
echo     SETUP COMPLETADO
echo     Rey de la Chelada
echo     FORCH.i by Paulo Velasco - Bolivia
echo   ==========================================
echo.
echo   Local:     http://localhost:!PORT!/clientes/
echo   Admin:     http://localhost:!PORT!/admin/
echo   Detener:   scripts\stop.bat
echo   Iniciar:   scripts\start.bat
echo   Actualizar: scripts\update.bat
echo.
echo   NOTA: todos los scripts quedan en scripts\
echo   (este setup.bat se movio alla al terminar).
echo.

REM ==========================================================
REM Auto-mover setup.bat a scripts\ (raiz queda limpia)
REM ==========================================================
if not "!DRY_RUN!"=="1" (
    if not exist "!APP_DIR!\scripts\setup.bat" (
        move /y "!APP_DIR!\setup.bat" "!APP_DIR!\scripts\setup.bat" >nul 2>&1
        echo   [OK] setup.bat movido a scripts\
    ) else (
        REM Ya existe en scripts\ (vino del repo) - eliminar el bootstrap
        del /q "!APP_DIR!\setup.bat" >nul 2>&1
        echo   [OK] bootstrap eliminado ^(scripts\setup.bat ya existe del repo^)
    )
)

echo.
pause

endlocal
