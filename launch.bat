@echo off
setlocal EnableDelayedExpansion

REM ─── F.R.I.D.A.Y. Launcher (Windows) ─────────────────────────────────────────
set "DIR=%~dp0"
set "CONFIG_ENV=%USERPROFILE%\.config\friday\.env"

REM ─── Python auto-install ─────────────────────────────────────────────────────
echo.
echo   ── Checking Python ──
echo.

set "PYTHON_BIN="

REM Try known Python binaries in priority order
for %%P in (python3.13 python3.12 python3.11) do (
    where %%P >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 13 (
                    set "PYTHON_BIN=%%P"
                )
            )
        )
    )
)

REM Fallback: generic "python" — must be 3.11-3.13, reject 3.14+
if not defined PYTHON_BIN (
    where python >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('python --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ=%%A"
                set /a "PYMIN=%%B"
                if !PYMAJ! equ 3 if !PYMIN! geq 11 if !PYMIN! leq 13 (
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

echo   [!!] Python 3.11-3.13 not found.
echo   Auto-installing...

REM Method 1: Try winget (fastest, silent)
where winget >nul 2>nul
if not errorlevel 1 (
    echo   [i] Installing via winget...
    winget install Python.Python.3.13 --silent --accept-source-agreements --accept-package-agreements
    if not errorlevel 1 (
        REM Refresh PATH
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python313;%PATH%"
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python313\Scripts;%PATH%"
        where python3.13 >nul 2>nul && set "PYTHON_BIN=python3.13" && goto :python_ok
        where python >nul 2>nul && set "PYTHON_BIN=python" && goto :python_ok
    )
)

REM Method 2: Try choco
where choco >nul 2>nul
if not errorlevel 1 (
    echo   [i] Installing via Chocolatey...
    choco install python3.13 -y
    if not errorlevel 1 (
        set "PATH=%PATH%;C:\Python313;C:\Python313\Scripts"
    )
)

REM Method 3: Download installer from python.org
echo   [i] Downloading Python 3.13 installer from python.org...
set "INSTALLER=%TEMP%\python-3.13.0-amd64.exe"
curl -L -o "%INSTALLER%" "https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe"
if exist "%INSTALLER%" (
    echo   [i] Running silent installer...
    "%INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1
    timeout /t 30 /nobreak >nul
    set "PATH=%PATH%;C:\Program Files\Python313;C:\Program Files\Python313\Scripts"
    del "%INSTALLER%" 2>nul
)

REM Re-check after install
for %%P in (python3.13 python3.12 python3.11 python) do (
    where %%P >nul 2>nul
    if not errorlevel 1 (
        for /f "tokens=2 delims= " %%V in ('%%P --version 2^>^&1') do (
            for /f "tokens=1,2 delims=." %%A in ("%%V") do (
                set /a "PYMAJ2=%%A"
                set /a "PYMIN2=%%B"
                if !PYMAJ2! equ 3 if !PYMIN2! geq 11 if !PYMIN2! leq 13 (
                    set "PYTHON_BIN=%%P"
                )
            )
        )
    )
)

if defined PYTHON_BIN goto :python_ok

echo   [!!] Python 3.11-3.13 installation failed.
echo   Install manually: https://www.python.org/downloads/
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
            echo   Setup failed.
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
    !PYTHON_BIN! -m pip install uv 2>nul || !PYTHON_BIN! -m ensurepip && !PYTHON_BIN! -m pip install uv
)

REM ─── Check Node.js ───────────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js not found. Please install it from https://nodejs.org/
    pause
    exit /b 1
)

REM ─── Install deps if needed ──────────────────────────────────────────────────
if not exist "%DIR%.venv" (
    echo   Installing Python dependencies...
    cd /d "%DIR%" && uv sync
)

if not exist "%DIR%mark-orb\node_modules" (
    echo   Installing Electron dependencies...
    cd /d "%DIR%mark-orb" && npm install
)

REM ─── Start Python backend ────────────────────────────────────────────────────
echo   Starting Python backend...
cd /d "%DIR%"
start /b uv run python_backend.py 5001

REM Wait for backend
echo   Waiting for backend...
set /a "count=0"
:wait_loop
if !count! geq 30 goto backend_ready
curl -s http://127.0.0.1:5001/health >nul 2>nul
if not errorlevel 1 goto backend_ready
timeout /t 1 /nobreak >nul
set /a "count+=1"
goto wait_loop

:backend_ready
echo   Backend ready.

REM ─── Start Electron app ──────────────────────────────────────────────────────
echo   Launching F.R.I.D.A.Y...
cd /d "%DIR%mark-orb"
npx electron-vite dev

echo.
echo   F.R.I.D.A.Y. has been closed.
pause
