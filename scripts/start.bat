@echo off
REM ============================================================
REM  Rey de la Chelada - Start Server
REM  Starts the server (hidden via VBScript, no console window).
REM  Safe to close this window - server keeps running.
REM ============================================================
setlocal enabledelayedexpansion
title Rey de la Chelada - Start Server

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "ROOT=%SCRIPT_DIR%\.."

set "PORT=3002"

echo.
echo   ==========================================
echo     Rey de la Chelada - Starting Server
echo   ==========================================
echo.

REM -------------------------------------------------------
REM 1. Check if already running
REM -------------------------------------------------------
echo   [1/2] Verificando estado del servidor...
curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
if !errorlevel! equ 0 (
    echo     [OK] Server ya esta corriendo en http://localhost:!PORT!
    echo.
    goto :DONE
)

REM -------------------------------------------------------
REM 2. Start server hidden (VBScript, no window)
REM -------------------------------------------------------
echo   [2/2] Iniciando servidor (oculto)...
cd /d "%ROOT%"
cscript //nologo "%ROOT%\scripts\start-hidden.vbs"

echo     Esperando respuesta del servidor...
set "READY=0"
for /l %%i in (1,1,15) do (
    if "!READY!"=="0" (
        timeout /t 1 /nobreak >nul
        curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
        if !errorlevel! equ 0 set "READY=1"
    )
)

if "%READY%"=="1" (
    echo     [OK] Servidor listo
) else (
    echo     [AVISO] Servidor iniciado, verifica en unos segundos
)

:DONE
echo.
echo   ==========================================
echo     Rey de la Chelada Listo
echo   ==========================================
echo.
echo     Clientes:  http://localhost:!PORT!/clientes/
echo     Cocina:    http://localhost:!PORT!/cocina/
echo     Meseros:   http://localhost:!PORT!/meseros/
echo     Caja:      http://localhost:!PORT!/caja/
echo     Admin:     http://localhost:!PORT!/admin/
echo.
echo     Para detener: scripts\stop.bat
echo.
pause
