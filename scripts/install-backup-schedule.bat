@echo off
REM ============================================================
REM  Rey de la Chelada - Install Backup Schedule (S1/T4)
REM
REM  Crea la tarea programada "ReyChelada-Backup" en Task Scheduler:
REM    - Diaria a las 01:00
REM    - Ejecuta scripts\backup.bat (copia la DB a backups\ con
REM      timestamp y retiene 7 días)
REM
REM  Usa rutas ABSOLUTAS (backup.bat ya resuelve APP_DIR con %~dp0).
REM
REM  Desagendar:
REM    schtasks /delete /tn "ReyChelada-Backup" /f
REM
REM  Ejecutar ahora (una vez):
REM    schtasks /run /tn "ReyChelada-Backup"
REM ============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "TASK_NAME=ReyChelada-Backup"
set "BAT_PATH=%SCRIPT_DIR%\backup.bat"
set "SCHEDULE_TIME=01:00"

echo   [Backup] Instalando tarea programada "%TASK_NAME%" (diaria %SCHEDULE_TIME%)...
schtasks /create /tn "%TASK_NAME%" /tr "cmd /c \"%BAT_PATH%\"" /sc daily /st %SCHEDULE_TIME% /f

if %errorlevel% neq 0 (
    echo   [ERROR] No se pudo crear la tarea. Ejecuta con permisos de administrador si es necesario.
    exit /b 1
)

echo.
echo   [Backup] Tarea creada. Verificando:
schtasks /query /tn "%TASK_NAME%" /v /fo LIST | findstr /i "TaskName Status Start Time Task To Run"

echo.
echo   [Backup] Para ejecutarla AHORA (una vez):
echo       schtasks /run /tn "%TASK_NAME%"
echo   Para desagendar:
echo       schtasks /delete /tn "%TASK_NAME%" /f
echo.
endlocal
