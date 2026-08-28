@echo off
REM ============================================================
REM  Rey de la Chelada - Startup Runner (auto-arranque al login)
REM  Lanzado desde la carpeta Startup (shell:startup).
REM  Arranca el server oculto si no esta corriendo, y sale.
REM  No abre ventanas: usa start-hidden.vbs (sin consola).
REM ============================================================
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
for %%i in ("%ROOT%") do set "ROOT=%%~fi"

set "PORT=3002"
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

REM 1. Si ya corre, no hacer nada
curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
if !errorlevel! equ 0 goto :EXIT

REM 2. Arrancar oculto
cd /d "%ROOT%"
cscript //nologo "%ROOT%\scripts\start-hidden.vbs"

REM 3. Esperar respuesta (max 20s)
for /l %%i in (1,1,20) do (
    curl -s http://localhost:!PORT!/clientes/ >nul 2>&1
    if !errorlevel! equ 0 goto :EXIT
    timeout /t 1 /nobreak >nul
)

:EXIT
exit /b 0