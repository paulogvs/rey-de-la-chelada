@echo off
setlocal enabledelayedexpansion

REM ==========================================================
REM  Rey de la Chelada - Daily Database Backup
REM  Creates a timestamped copy. Keeps last 7 days.
REM  v1.4: ahora vive en scripts\ - APP_DIR apunta a la raiz.
REM ==========================================================

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%\.."

set "DB_PATH=!APP_DIR!data\rey-de-la-chelada.db"
set "BACKUP_DIR=!APP_DIR!backups"

if exist "!APP_DIR!\.env" (
    for /f "usebackq delims=" %%a in ("!APP_DIR!\.env") do (
        set "LINE=%%a"
        if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
            for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
                if "%%b"=="DATABASE_PATH" (
                    set "RAW_PATH=%%c"
                    if "!RAW_PATH:~0,1!"=="." set "DB_PATH=!APP_DIR!data\rey-de-la-chelada.db"
                )
                if "%%b"=="BACKUP_DIR" (
                    set "RAW_DIR=%%c"
                    if "!RAW_DIR:~0,1!"=="." set "BACKUP_DIR=!APP_DIR!backups"
                )
            )
        )
    )
)

set "LOG_FILE=!APP_DIR!logs\backup.log"

if not exist "!BACKUP_DIR!" mkdir "!BACKUP_DIR!"
if not exist "!APP_DIR!logs" mkdir "!APP_DIR!logs"

if not exist "!DB_PATH!" (
    echo [!DATE! !TIME!] [SKIP] No database found >> "!LOG_FILE!"
    exit /b 0
)

for /f %%i in ('powershell -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"') do set "TS=%%i"
set "BACKUP_FILE=!BACKUP_DIR!\backup-!TS!.db"

copy "!DB_PATH!" "!BACKUP_FILE!" >nul 2>&1
if !errorlevel! equ 0 (
    echo [!DATE! !TIME!] [OK] Backup: !BACKUP_FILE! >> "!LOG_FILE!"
    forfiles /p "!BACKUP_DIR!" /m *.db /d -7 /c "cmd /c del @path" >nul 2>&1
) else (
    echo [!DATE! !TIME!] [ERROR] Backup failed >> "!LOG_FILE!"
)

endlocal
