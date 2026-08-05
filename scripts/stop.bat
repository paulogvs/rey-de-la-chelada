@echo off
REM ============================================================
REM  Rey de la Chelada - Stop Server
REM  Detiene el servicio: mata el proceso node que escucha en el
REM  puerto de la app (3002 por defecto). Sin dependencia de PM2.
REM ============================================================
setlocal enabledelayedexpansion
title Rey de la Chelada - Stop Server

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "ROOT=%SCRIPT_DIR%\.."
set "PORT=3002"

REM Leer PORT del .env si existe
if exist "%ROOT%\.env" (
    for /f "usebackq delims=" %%a in ("%ROOT%\.env") do (
        set "LINE=%%a"
        if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
            for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
                if "%%b"=="PORT" set "PORT=%%c"
            )
        )
    )
)

echo.
echo   ==========================================
echo     Rey de la Chelada - Stopping Server
echo   ==========================================
echo.

REM -------------------------------------------------------
REM 1. Buscar proceso en el puerto
REM -------------------------------------------------------
set "FOUND=0"
echo   [1/2] Buscando proceso en puerto !PORT!...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do (
    set "FOUND=1"
    echo     Proceso encontrado: PID %%p
    taskkill /f /pid %%p >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] Proceso %%p detenido
    ) else (
        echo     [WARN] No se pudo matar el PID %%p (puede requerir admin)
    )
)

if "!FOUND!"=="0" (
    echo     [INFO] No habia proceso escuchando en el puerto !PORT!
)

timeout /t 2 /nobreak >nul

REM -------------------------------------------------------
REM 2. Verificar que el puerto quedo libre
REM -------------------------------------------------------
echo   [2/2] Verificando puerto libre...
set "STILL=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do set "STILL=1"

if "!STILL!"=="1" (
    echo     [ERROR] El puerto !PORT! sigue ocupado.
    echo     Ejecuta:  netstat -ano | findstr :!PORT!
    echo     Y mata el PID manualmente:  taskkill /f /pid ^<PID^>
) else (
    echo     [OK] Puerto !PORT! libre - servicio detenido
)

echo.
echo   ==========================================
echo     Rey de la Chelada DETENIDO
echo   ==========================================
echo.
echo     Para iniciar: scripts\start.bat
echo.
pause

endlocal
