@echo off
setlocal EnableDelayedExpansion

set "DIR=%~dp0"
set "CONFIG_ENV=%USERPROFILE%\.config\friday\.env"
set "LOG_DIR=%DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo   ========================================
echo     F.R.I.D.A.Y. Launcher
echo   ========================================
echo.

REM === Step 1: Python ===
echo   [1/7] Checking Python...
set "PYTHON_BIN="

where python3 >nul 2>nul
if !errorlevel! equ 0 ( set "PYTHON_BIN=python3" & goto :python_found )
where python >nul 2>nul
if !errorlevel! equ 0 ( set "PYTHON_BIN=python" & goto :python_found )

echo   [FATAL] Python not found on system.
echo   Install: https://www.python.org/downloads/
pause
exit /b 1

:python_found
for /f "tokens=*" %%v in ('!PYTHON_BIN! --version 2^>^&1') do echo   [OK] %%v

REM === Step 2: Config (delegate to setup.py — works reliably on Windows) ===
echo   [2/7] Checking configuration...
if not exist "%CONFIG_ENV%" (
    if not exist "%DIR%.env" (
        echo   Running setup wizard...
        !PYTHON_BIN! "%DIR%setup.py"
        if !errorlevel! neq 0 ( echo   [FATAL] Setup failed. & pause & exit /b 1 )
    )
)
if not exist "%CONFIG_ENV%" if not exist "%DIR%.env" (
    echo   [FATAL] No .env file. & pause & exit /b 1
)
echo   [OK]

REM === Step 3: uv ===
echo   [3/7] Checking uv...
where uv >nul 2>nul
if !errorlevel! neq 0 (
    echo   Installing uv...
    !PYTHON_BIN! -m pip install uv 2>nul || !PYTHON_BIN! -m ensurepip 2>nul && !PYTHON_BIN! -m pip install uv 2>nul
    where uv >nul 2>nul
    if !errorlevel! neq 0 ( echo   [FATAL] uv install failed. & pause & exit /b 1 )
)
echo   [OK]

REM === Step 4: Node.js ===
echo   [4/7] Checking Node.js...
where node >nul 2>nul
if !errorlevel! neq 0 ( echo   [FATAL] Node.js not found. https://nodejs.org/ & pause & exit /b 1 )
echo   [OK]

REM === Step 5: Python deps ===
echo   [5/7] Checking Python dependencies...
cd /d "%DIR%"
if not exist ".venv" (
    echo   Running uv sync...
    uv sync
    if !errorlevel! neq 0 (
        echo   [FATAL] uv sync failed.
        pause & exit /b 1
    )
)
echo   [OK]

REM === Step 6: Node deps ===
echo   [6/7] Checking Electron dependencies...
cd /d "%DIR%mark-orb"

REM Restore package.json from git if missing
if not exist "package.json" (
    echo   package.json missing, restoring from git...
    git checkout -- package.json 2>nul
)
if not exist "package.json" (
    echo   [FATAL] package.json missing and not in git. & pause & exit /b 1
)

REM Always run npm install
echo   Running npm install...
npm install

REM Verify electron binary — if missing, try downloading
if not exist "node_modules\electron\dist\electron.exe" (
    echo   Electron binary missing, downloading...
    node node_modules\electron\install.js
)
REM If still missing, try reinstalling
if not exist "node_modules\electron\dist\electron.exe" (
    echo   Reinstalling electron package...
    rm -rf node_modules\electron
    npm install electron
)

if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   [FATAL] electron-vite missing after install. & pause & exit /b 1
)
echo   [OK]

REM === Step 7: Launch ===
echo   [7/7] Starting F.R.I.D.A.Y. ...
echo.
echo   Electron owns backend startup from here (it will reuse an existing
echo   Friday backend on port 5001 if one's already running, or start one).

cd /d "%DIR%mark-orb"
npx electron-vite dev

echo.
echo   ========================================
echo     F.R.I.D.A.Y. closed.
echo   ========================================
echo.
pause
