@echo off
:: sync.bat ? Sincroniza Rey de la Chelada con el ecosistema FORCH.iA
:: ============================================================

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo FORCH.iA ? Sync: Rey de la Chelada
echo ==========================================
echo.

set "ECOSYSTEM_PATH=D:\OTRO DISCO\FORCH-IA\FORCH-IA-ECOSYSTEM"
if exist "%ECOSYSTEM_PATH%\AGENTS.md" (
    echo [OK] Ecosistema encontrado: %ECOSYSTEM_PATH%
) else (
    echo [WARN] Ecosistema no encontrado.
    goto :end
)

echo.
echo --- Sincronizando skills ---
if exist "%ECOSYSTEM_PATH%\scripts\sync-skills-to-opencode.bat" (
    call "%ECOSYSTEM_PATH%\scripts\sync-skills-to-opencode.bat"
)

echo.
echo --- Verificando archivos del proyecto ---
if not exist "DESIGN.md" echo [WARN] DESIGN.md no encontrado
if not exist "SPEC_INICIAL.md" echo [WARN] SPEC_INICIAL.md no encontrado
if not exist "branding.json" echo [WARN] branding.json no encontrado
if not exist "ecosystem.config.js" echo [INFO] ecosystem.config.js no encontrado
if not exist "logo\rey_de_la_chelada_logo.png" echo [INFO] Logo no encontrado

echo.
echo --- Recordatorio de hardware ---
echo   Configurar en .env:
echo     PRINTER_NAME=XP-80C
echo     QR_SIMPLE_API_KEY=...
echo     BANCO_BISA_CUENTA=...

:end
echo.
echo ==========================================
echo Sync completado.
echo ==========================================
pause
