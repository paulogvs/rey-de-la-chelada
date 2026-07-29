@echo off
setlocal enabledelayedexpansion

REM ── Rey de la Chelada — Update from GitHub ────────────────

set "APP_DIR=%~dp0"
cd /d "!APP_DIR!"

echo ═══════════════════════════════════════════════════════════
echo  Rey de la Chelada — Auto-Update
echo  %DATE% %TIME%
echo ═══════════════════════════════════════════════════════════

if not exist ".env" (
    echo [SKIP] No .env found.
    exit /b 0
)

REM Read config
for /f "usebackq delims=" %%a in (".env") do (
    set "LINE=%%a"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        for /f "tokens=1,* delims==" %%b in ("!LINE!") do (
            if "%%b"=="GITHUB_TOKEN" set "GITHUB_TOKEN=%%c"
            if "%%b"=="GITHUB_REPO" set "GITHUB_REPO=%%c"
            if "%%b"=="APP_NAME" set "APP_NAME=%%c"
            if "%%b"=="PORT" set "PORT=%%c"
        )
    )
)

if "!GITHUB_TOKEN!"=="" (
    echo [SKIP] No GITHUB_TOKEN configured.
    exit /b 0
)

if "!APP_NAME!"=="" set "APP_NAME=rey-de-la-chelada"

set "PM=npm"
if exist ".pm-config" set /p PM=<".pm-config"
echo   Package manager: !PM!

REM Phase 1: Pull
echo [1/4] Pulling from GitHub...
if "%1"=="--force" (
    git fetch "https://!GITHUB_TOKEN!@github.com/!GITHUB_REPO!.git"
    git reset --hard origin/main
) else (
    git pull "https://!GITHUB_TOKEN!@github.com/!GITHUB_REPO!.git" --ff-only
    if !errorlevel! neq 0 (
        echo   [WARNING] git pull failed.
        exit /b 1
    )
)
echo   ✅ Code updated

REM Phase 2: Install
echo [2/4] Installing dependencies...
if "!PM!"=="pnpm" (
    call pnpm install
) else (
    call npm install
)
if not exist "node_modules\package.json" (
    echo   [ERROR] Install failed.
    exit /b 1
)
echo   ✅ Dependencies installed

REM Phase 3: Build
echo [3/4] Building...
findstr /c:""build"" package.json >nul 2>&1
if !errorlevel! equ 0 (
    if "!PM!"=="pnpm" (
        call pnpm run build
    ) else (
        call npm run build
    )
    echo   ✅ Build complete
)

REM Phase 4: Restart
echo [4/4] Restarting service...
where pm2 >nul 2>&1
if !errorlevel! equ 0 (
    pm2 restart !APP_NAME! >nul 2>&1
    if !errorlevel! equ 0 (
        echo   ✅ App restarted: !APP_NAME!
    ) else (
        pm2 start ecosystem.config.js --env production >nul 2>&1
        echo   ✅ App started
    )
)

echo ═══════════════════════════════════════════════════════════
echo  Update complete at %DATE% %TIME%
echo ═══════════════════════════════════════════════════════════

endlocal
