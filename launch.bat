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

REM === Step 2: Config ===
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
    uv sync >"%LOG_DIR%\uv_sync.log" 2>&1
    if !errorlevel! neq 0 (
        echo   [FATAL] uv sync failed.
        type "%LOG_DIR%\uv_sync.log"
        pause & exit /b 1
    )
)
echo   [OK]

REM === Step 6: Node deps ===
echo   [6/7] Checking Electron dependencies...
cd /d "%DIR%mark-orb"
if not exist "node_modules\.package-lock.json" (
    echo   Running npm install...
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
)
if not exist "node_modules" (
    echo   [FATAL] npm install failed.
    type "%LOG_DIR%\npm_install.log"
    pause & exit /b 1
)
if not exist "node_modules\.bin\electron-vite.cmd" (
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
    if not exist "node_modules\.bin\electron-vite.cmd" (
        echo   [FATAL] electron-vite missing. & pause & exit /b 1
    )
)
echo   [OK]

REM === Step 7: Launch ===
echo   [7/7] Starting F.R.I.D.A.Y. ...
echo.

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :5001 ^| findstr LISTENING 2^>nul') do taskkill /PID %%p /F >nul 2>nul
timeout /t 1 /nobreak >nul

cd /d "%DIR%"
start "Friday-Backend" /B uv run python_backend.py 5001 >"%LOG_DIR%\backend.log" 2>&1

set /a "WAIT=0"
:wait_backend
if !WAIT! geq 30 (
    echo   [FATAL] Backend did not start in 30s.
    powershell -Command "Get-Content '%LOG_DIR%\backend.log' -Tail 20" 2>nul
    pause & exit /b 1
)
curl -s http://127.0.0.1:5001/health >nul 2>nul
if !errorlevel! equ 0 goto :backend_up
timeout /t 1 /nobreak >nul
set /a "WAIT+=1"
goto :wait_backend

:backend_up
echo   [OK] Backend running on port 5001.
echo.

cd /d "%DIR%mark-orb"
npx electron-vite dev

echo.
echo   ========================================
echo     F.R.I.D.A.Y. closed.
echo     Log: %LOG_DIR%\backend.log
echo   ========================================
echo.
pause
