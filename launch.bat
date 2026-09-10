@echo off
setlocal EnableDelayedExpansion

REM ─── F.R.I.D.A.Y. Launcher (Windows) ─────────────────────────────────────────
set "DIR=%~dp0"
set "CONFIG_ENV=%USERPROFILE%\.config\friday\.env"
set "LOG_DIR=%DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo   ========================================
echo     F.R.I.D.A.Y. Launcher
echo   ========================================
echo.

REM ─── Step 1: Python ─────────────────────────────────────────────────────────
echo   [1/7] Checking Python...
set "PYTHON_BIN="

for %%P in (python3.12 python3.11) do (
    where %%P >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 12 set "PYTHON_BIN=%%P"
            )
        )
    )
)
if not defined PYTHON_BIN (
    where python >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('python --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 12 set "PYTHON_BIN=python"
            )
        )
    )
)

if not defined PYTHON_BIN (
    echo   [!!] Python 3.11-3.12 not found. Auto-installing...
    where winget >nul 2>nul
    if not errorlevel 1 (
        winget install Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
    ) else where choco >nul 2>nul
    if not errorlevel 1 (
        choco install python3.12 -y
        set "PATH=%PATH%;C:\Python312;C:\Python312\Scripts"
    ) else (
        echo   [!!] No package manager found. Install Python 3.12 manually.
        echo   https://www.python.org/downloads/
        pause
        exit /b 1
    )
    REM Re-check
    for %%P in (python3.12 python3.11 python) do (
        where %%P >nul 2>nul
        if not errorlevel 1 (
            for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
                for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                    set /a "PM=%%A"
                    set /a "PN=%%B"
                    if !PM! equ 3 if !PN! geq 11 if !PN! leq 12 set "PYTHON_BIN=%%P"
                )
            )
        )
    )
)
if not defined PYTHON_BIN (
    echo   [!!] Python not available. Cannot continue.
    pause
    exit /b 1
)
echo   [OK] !PYTHON_BIN!

REM ─── Step 2: Config ─────────────────────────────────────────────────────────
echo   [2/7] Checking configuration...
if not exist "%CONFIG_ENV%" (
    if not exist "%DIR%.env" (
        echo   Running setup wizard...
        !PYTHON_BIN! "%DIR%setup.py"
        if errorlevel 1 (
            echo   [!!] Setup failed.
            pause
            exit /b 1
        )
    )
)
if not exist "%CONFIG_ENV%" if not exist "%DIR%.env" (
    echo   [!!] No .env file found after setup.
    pause
    exit /b 1
)
echo   [OK]

REM ─── Step 3: uv ─────────────────────────────────────────────────────────────
echo   [3/7] Checking uv...
where uv >nul 2>nul
if errorlevel 1 (
    echo   Installing uv...
    !PYTHON_BIN! -m pip install uv 2>nul
    if errorlevel 1 (
        !PYTHON_BIN! -m ensurepip 2>nul
        !PYTHON_BIN! -m pip install uv 2>nul
    )
    where uv >nul 2>nul
    if errorlevel 1 (
        echo   [!!] uv failed to install.
        pause
        exit /b 1
    )
)
echo   [OK]

REM ─── Step 4: Node.js ────────────────────────────────────────────────────────
echo   [4/7] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   [!!] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODE_VER=%%v"
echo   [OK] !NODE_VER!

REM ─── Step 5: Python deps ────────────────────────────────────────────────────
echo   [5/7] Checking Python dependencies...
cd /d "%DIR%"
if not exist ".venv" (
    echo   Running uv sync...
    uv sync >"%LOG_DIR%\uv_sync.log" 2>&1
    if errorlevel 1 (
        echo   [!!] uv sync failed. Log: %LOG_DIR%\uv_sync.log
        type "%LOG_DIR%\uv_sync.log"
        pause
        exit /b 1
    )
)
REM Verify critical deps exist
if not exist ".venv\Lib\site-packages\fastwhisper" (
    if not exist ".venv\Lib\site-packages\faster_whisper" (
        echo   [!!] faster-whisper not installed. Re-running uv sync...
        uv sync >"%LOG_DIR%\uv_sync.log" 2>&1
        if errorlevel 1 (
            echo   [!!] uv sync failed again. Log: %LOG_DIR%\uv_sync.log
            pause
            exit /b 1
        )
    )
)
echo   [OK]

REM ─── Step 6: Node deps ──────────────────────────────────────────────────────
echo   [6/7] Checking Electron dependencies...
cd /d "%DIR%mark-orb"
if not exist "node_modules" (
    echo   Running npm install...
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
    if errorlevel 1 (
        echo   [!!] npm install failed. Log: %LOG_DIR%\npm_install.log
        type "%LOG_DIR%\npm_install.log"
        pause
        exit /b 1
    )
)
REM Verify electron-vite exists
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   [!!] electron-vite not found. Re-running npm install...
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
    if errorlevel 1 (
        echo   [!!] npm install failed again. Log: %LOG_DIR%\npm_install.log
        pause
        exit /b 1
    )
)
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   [!!] electron-vite still missing after install.
    pause
    exit /b 1
)
echo   [OK]

REM ─── Step 7: Launch ─────────────────────────────────────────────────────────
echo   [7/7] Starting F.R.I.D.A.Y. ...
echo.

REM Kill stale backend
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :5001 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%p /F >nul 2>nul
)
timeout /t 1 /nobreak >nul

REM Start backend
cd /d "%DIR%"
start "Friday-Backend" /B uv run python_backend.py 5001 >"%LOG_DIR%\backend.log" 2>&1

REM Wait for backend
set /a "WAIT=0"
:wait_backend
if !WAIT! geq 30 (
    echo.
    echo   [!!] Backend did not start in 30s.
    echo   Last 20 lines of backend.log:
    echo   ----------------------------------------
    powershell -Command "Get-Content '%LOG_DIR%\backend.log' -Tail 20"
    echo   ----------------------------------------
    echo.
    pause
    exit /b 1
)
curl -s http://127.0.0.1:5001/health >nul 2>nul
if not errorlevel 1 goto backend_up
timeout /t 1 /nobreak >nul
set /a "WAIT+=1"
goto wait_backend

:backend_up
echo   [OK] Backend running on port 5001.
echo.

REM Start Electron
cd /d "%DIR%mark-orb"
npx electron-vite dev 2>&1

echo.
echo   ========================================
echo     F.R.I.D.A.Y. closed.
echo     Backend log: %LOG_DIR%\backend.log
echo   ========================================
echo.
pause
