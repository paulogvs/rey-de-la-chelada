@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  Rey de la Chelada - Install Autostart (PC nueva / oficial)
REM
REM  Configura el auto-arranque para que el servicio corra SIEMPRE,
REM  incluso despues de reiniciar la PC (mientras el usuario haga
REM  login en Windows):
REM    1. Atajo "ReyChelada-Server.lnk"  -> scripts\startup-runner.bat
REM    2. Atajo "ReyChelada-Watchdog.lnk" -> scripts\watchdog-start.bat
REM    3. Tarea programada "ReyChelada-Backup" (diaria 01:00)
REM
REM  Uso (como el usuario normal, NO admin requerido):
REM    scripts\install-autostart.bat
REM
REM  NOTA: la carpeta Startup arranca al LOGIN de Windows. Si la PC
REM  oficial no tiene auto-login, crea uno (netplwiz) o corre la tarea
REM  como "al iniciar" (schtasks /sc onstart) para que arranque sin
REM  que nadie inicie sesion.
REM ============================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%\.."
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "!STARTUP_DIR!" (
    echo [ERROR] Carpeta Startup no encontrada: !STARTUP_DIR!
    exit /b 1
)

echo ============================================================
echo  Rey de la Chelada - Instalando auto-arranque
echo  App:    !APP_DIR!
echo ============================================================

REM 1. Atajo del server (startup-runner.bat)
if not exist "!SCRIPT_DIR!\startup-runner.bat" (
    echo [ERROR] Falta scripts\startup-runner.bat
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('!STARTUP_DIR!\ReyChelada-Server.lnk');" ^
  "$s.TargetPath='!SCRIPT_DIR!\startup-runner.bat';" ^
  "$s.WorkingDirectory='!APP_DIR!';" ^
  "$s.Save()"
if !errorlevel! equ 0 (
    echo [OK] ReyChelada-Server.lnk  -^> arranca el server al login
) else (
    echo [ERROR] No se pudo crear ReyChelada-Server.lnk
)

REM 2. Atajo del watchdog (watchdog-start.bat)
if not exist "!SCRIPT_DIR!\watchdog-start.bat" (
    echo [ERROR] Falta scripts\watchdog-start.bat
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('!STARTUP_DIR!\ReyChelada-Watchdog.lnk');" ^
  "$s.TargetPath='!SCRIPT_DIR!\watchdog-start.bat';" ^
  "$s.WorkingDirectory='!APP_DIR!';" ^
  "$s.Save()"
if !errorlevel! equ 0 (
    echo [OK] ReyChelada-Watchdog.lnk -^> watchdog cada 5 min
) else (
    echo [ERROR] No se pudo crear ReyChelada-Watchdog.lnk
)

REM 3. Tarea programada de backup diario (01:00)
schtasks /create /tn "ReyChelada-Backup" /tr "cmd /c \"!SCRIPT_DIR!\backup.bat\"" /sc daily /st 01:00 /f >nul 2>&1
if !errorlevel! equ 0 (
    echo [OK] Tarea ReyChelada-Backup  -^> backup diario 01:00
) else (
    echo [ERROR] No se pudo crear la tarea de backup. Ejecuta con permisos si falla:
    echo         schtasks /create /tn "ReyChelada-Backup" /tr "cmd /c \"!SCRIPT_DIR!\backup.bat\"" /sc daily /st 01:00 /f
)

echo.
echo Listo. Verifica con:
echo   - scripts\startup-runner.bat   (arranca el server si no corre)
echo   - schtasks /query /tn ReyChelada-Backup
echo.
echo NOTA: la carpeta Startup corre al LOGIN. Para que arranque
echo aunque nadie inicie sesion en la PC oficial, activa el
echo auto-login (Win+R -^> netplwiz) o crea la tarea con /sc onstart.
exit /b 0