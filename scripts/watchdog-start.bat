@echo off
REM ============================================================
REM  Rey de la Chelada - Watchdog Start (S1/T3)
REM  Lanza el watchdog en segundo plano (ventana oculta).
REM
REM  El watchdog revisa /health cada 5 min; si el server falla
REM  3 veces seguidas, lo mata del puerto y lo relanza.
REM
REM  Parar: scripts\watchdog-stop.bat (o crear scripts\watchdog.stop)
REM
REM  Task Scheduler (recomendado, inicio de sesión):
REM    Programa:  powershell.exe
REM    Argumentos: -ExecutionPolicy Bypass -WindowStyle Hidden
REM                -File "D:\...\scripts\watchdog.ps1"
REM ============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

echo   [Watchdog] Lanzando watchdog en segundo plano...
start "" powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%\watchdog.ps1"

timeout /t 2 /nobreak >nul
echo   [Watchdog] OK - revisa logs\watchdog.log para confirmar.
endlocal
