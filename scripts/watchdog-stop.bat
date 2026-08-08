@echo off
REM ============================================================
REM  Rey de la Chelada - Watchdog Stop (S1/T3)
REM  Detiene el watchdog de forma limpia: crea el flag watchdog.stop
REM  en scripts\ (el watchdog lo detecta en su próximo ciclo y sale).
REM ============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

echo   [Watchdog] Creando flag de parada limpia...
echo stop > "%SCRIPT_DIR%\watchdog.stop"
echo   [Watchdog] Flag creado. El watchdog se detendrá en su próximo ciclo (max %1 5 minutos).
echo   [Watchdog] Si no se detiene, matalo con:  Get-Process powershell | Where-Object {$_.CommandLine -like '*watchdog.ps1*'}
endlocal
