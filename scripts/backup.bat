@echo off
setlocal enabledelayedexpansion

REM ==========================================================
REM  Rey de la Chelada - Daily Database Backup (v1.5)
REM  Delega en scripts\backup-db.mjs (better-sqlite3 backup API).
REM  WAL-safe: ya NO copia el .db crudo (eso producía backups
REM  vacios de 4KB — bug N2). Verifica integridad + prune 7 dias.
REM ==========================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%\..\"
set "LOG_FILE=!APP_DIR!logs\backup.log"

if not exist "!APP_DIR!logs" mkdir "!APP_DIR!logs"

echo [!DATE! !TIME!] [START] Backup iniciado >> "!LOG_FILE!"
node "!SCRIPT_DIR!\backup-db.mjs" >> "!LOG_FILE!" 2>&1
echo [!DATE! !TIME!] [END] Backup finalizado (exit=!errorlevel!) >> "!LOG_FILE!"

endlocal
exit /b 0