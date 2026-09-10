@echo off
setlocal EnableDelayedExpansion

REM ─── F.R.I.D.A.Y. Launcher (Windows) ─────────────────────────────────────────
set "DIR=%~dp0"
set "CONFIG_ENV=%USERPROFILE%\.config\friday\.env"
set "LOG_DIR=%DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM ─── Python auto-install ─────────────────────────────────────────────────────
echo.
echo   ── Checking Python ──
echo.

set "PYTHON_BIN="

REM Try known Python binaries in priority order
for %%P in (python3.12 python3.11) do (
    where %%P >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 12 (
                    set "PYTHON_BIN=%%P"
                )
            )
        )
    )
)

REM Fallback: generic "python" — must be 3.11-3.12, reject 3.13+
if not defined PYTHON_BIN (
    where python >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('python --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 12 (
                    set "PYTHON_BIN=python"
                )
            )
        )
    )
)

if defined PYTHON_BIN (
    echo   [OK] Python found: !PYTHON_BIN!
    goto :python_ok
)

echo   [!!] Python 3.11-3.12 not found.
echo   Auto-installing Python 3.12...

REM Method 1: Try winget (fastest, silent)
where winget >nul 2>nul
if not errorlevel 1 (
    echo   [i] Installing via winget...
    winget install Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
    if not errorlevel 1 (
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%PATH%"
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
    )
)

REM Method 2: Try choco
where choco >nul 2>nul
if not errorlevel 1 (
    echo   [i] Installing via Chocolatey...
    choco install python3.12 -y
    if not errorlevel 1 (
        set "PATH=%PATH%;C:\Python312;C:\Python312\Scripts"
    )
)

REM Method 3: Download installer from python.org
echo   [i] Downloading Python 3.12 installer from python.org...
set "INSTALLER=%TEMP%\python-3.12.7-amd64.exe"
curl -L -o "%INSTALLER%" "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe"
if exist "%INSTALLER%" (
    echo   [i] Running silent installer...
    "%INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1
    timeout /t 30 /nobreak >nul
    set "PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts"
    del "%INSTALLER%" 2>nul
)

REM Re-check after install
for %%P in (python3.12 python3.11 python) do (
    where %%P >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ2=%%A"
                set /a "PYMIN2=%%B"
                if !PYMAJ2! equ 3 if !PYMIN2! geq 11 if !PYMIN2! leq 12 (
                    set "PYTHON_BIN=%%P"
                )
            )
        )
    )
)

if defined PYTHON_BIN goto :python_ok

echo.
echo   [!!] Python 3.11-3.12 installation failed.
echo   Install manually: https://www.python.org/downloads/
echo.
pause
exit /b 1

:python_ok

REM ─── First-run check ─────────────────────────────────────────────────────────
if not exist "%CONFIG_ENV%" (
    if not exist "%DIR%.env" (
        echo.
        echo   No configuration found. Running setup wizard...
        echo.
        !PYTHON_BIN! "%DIR%setup.py"
        if errorlevel 1 (
            echo.
            echo   [!!] Setup failed. Check the output above for errors.
            echo.
            pause
            exit /b 1
        )
        echo.
    )
)

REM ─── Check uv ────────────────────────────────────────────────────────────────
where uv >nul 2>nul
if errorlevel 1 (
    echo   uv not found. Installing...
    !PYTHON_BIN! -m pip install uv 2>nul
    if errorlevel 1 (
        !PYTHON_BIN! -m ensurepip 2>nul && !PYTHON_BIN! -m pip install uv
    )
    where uv >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   [!!] Failed to install uv.
        echo   Install manually: pip install uv
        echo.
        pause
        exit /b 1
    )
)

REM ─── Check Node.js ───────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [!!] Node.js not found.
    echo   Install from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM ─── Install Python deps ─────────────────────────────────────────────────────
if not exist "%DIR%.venv" (
    echo.
    echo   Installing Python dependencies (uv sync)...
    cd /d "%DIR%"
    uv sync 2>&1
    if errorlevel 1 (
        echo.
        echo   [!!] uv sync failed. Check the error above.
        echo   Common fix: make sure Python 3.12 is installed and in PATH.
        echo.
        pause
        exit /b 1
    )
    echo   [OK] Python dependencies installed.
)

REM ─── Install Node deps ───────────────────────────────────────────────────────
if not exist "%DIR%mark-orb\node_modules" (
    echo.
    echo   Installing Electron dependencies (npm install)...
    cd /d "%DIR%mark-orb"
    npm install 2>&1
    if errorlevel 1 (
        echo.
        echo   [!!] npm install failed. Check the error above.
        echo.
        pause
        exit /b 1
    )
    echo   [OK] Electron dependencies installed.
)

REM ─── Start Python backend ────────────────────────────────────────────────────
echo.
echo   Starting Python backend...
cd /d "%DIR%"

REM Kill any existing backend on port 5001
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :5001 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%p /F >nul 2>nul
)

REM Start backend and log output
uv run python_backend.py 5001 >"%LOG_DIR%\backend.log" 2>&1
set "BACKEND_PID=!errorlevel!"

REM Wait for backend
echo   Waiting for backend to start...
set /a "count=0"
:wait_loop
if !count! geq 30 (
    echo.
    echo   [!!] Backend did not start within 30 seconds.
    echo   Check log: %LOG_DIR%\backend.log
    echo.
    type "%LOG_DIR%\backend.log"
    echo.
    pause
    exit /b 1
)
curl -s http://127.0.0.1:5001/health >nul 2>nul
if not errorlevel 1 goto backend_ready
timeout /t 1 /nobreak >nul
set /a "count+=1"
goto wait_loop

:backend_ready
echo   [OK] Backend ready on port 5001.

REM ─── Start Electron app ──────────────────────────────────────────────────────
echo.
echo   Launching F.R.I.D.A.Y. ...
cd /d "%DIR%mark-orb"
npx electron-vite dev 2>&1

echo.
echo   ──────────────────────────────────────────
echo   F.R.I.D.A.Y. has been closed.
echo.
echo   Backend log: %LOG_DIR%\backend.log
echo   ──────────────────────────────────────────
echo.
pause
