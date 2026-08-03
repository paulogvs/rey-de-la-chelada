@echo off
REM ============================================================
REM  Rey de la Chelada - Stop Server
REM  Stops the Windows service (if installed) and any node
REM  process listening on the app port.
REM ============================================================
setlocal enabledelayedexpansion
title Rey de la Chelada - Stop Server

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "ROOT=%SCRIPT_DIR%\.."
set "APP_NAME=rey-de-la-chelada"
set "PORT=3002"

echo.
echo   ==========================================
echo     Rey de la Chelada - Stopping Server
echo   ==========================================
echo.

REM -------------------------------------------------------
REM 1. Stop Windows service (nssm/PM2) if installed
REM -------------------------------------------------------
echo   [1/3] Deteniendo servicio Windows...
net stop "%APP_NAME%" >nul 2>&1
if !errorlevel! equ 0 (
    echo     [OK] Servicio detenido
) else (
    echo     [INFO] Servicio no estaba corriendo
)

REM -------------------------------------------------------
REM 2. Stop PM2 process if managed by PM2
REM -------------------------------------------------------
echo   [2/3] Deteniendo proceso PM2...
where pm2 >nul 2>&1
if !errorlevel! equ 0 (
    pm2 stop "%APP_NAME%" >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] PM2 detenido
    ) else (
        echo     [INFO] PM2 no tenia el proceso activo
    )
) else (
    echo     [INFO] PM2 no instalado
)

REM -------------------------------------------------------
REM 3. Kill node process on the app port (safety net)
REM -------------------------------------------------------
echo   [3/3] Liberando puerto !PORT!...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :!PORT! ^| findstr LISTENING') do (
    echo     Matando proceso %%p...
    taskkill /f /pid %%p >nul 2>&1
)
echo     [OK] Puerto !PORT! liberado

echo.
echo   ==========================================
echo     Rey de la Chelada Detenido
echo   ==========================================
echo.
echo     Para iniciar: scripts\start.bat
echo.
pause
