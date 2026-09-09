@echo off
setlocal EnableDelayedExpansion

REM ─── F.R.I.D.A.Y. Launcher (Windows) ─────────────────────────────────────────
set "DIR=%~dp0"
set "CONFIG_ENV=%USERPROFILE%\.config\friday\.env"

REM ─── First-run check ─────────────────────────────────────────────────────────
if not exist "%CONFIG_ENV%" (
    if not exist "%DIR%.env" (
        echo.
        echo   No configuration found. Running setup wizard...
        echo.
        python "%DIR%setup.py"
        if errorlevel 1 (
            echo   Setup failed. Make sure Python 3.11+ is installed.
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
    python -m pip install uv
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
