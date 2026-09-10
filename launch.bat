@echo off
setlocal EnableDelayedExpansion

REM === F.R.I.D.A.Y. Launcher (Windows) ===
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

where python3.12 >nul 2>nul
if !errorlevel! equ 0 (
    set "PYTHON_BIN=python3.12"
    goto :python_found
)
where python3.11 >nul 2>nul
if !errorlevel! equ 0 (
    set "PYTHON_BIN=python3.11"
    goto :python_found
)
where python >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
    echo !PYVER! | findstr /C:"3.12" >nul 2>nul
    if !errorlevel! equ 0 ( set "PYTHON_BIN=python" & goto :python_found )
    echo !PYVER! | findstr /C:"3.11" >nul 2>nul
    if !errorlevel! equ 0 ( set "PYTHON_BIN=python" & goto :python_found )
    echo   [!!] Found !PYVER! but need 3.11 or 3.12.
)

:python_not_found
echo   [!!] Python 3.11-3.12 not found. Auto-installing...

REM Try winget
where winget >nul 2>nul
if !errorlevel! equ 0 (
    echo   [i] Trying winget...
    winget install Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
    set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
    set "PATH=C:\Program Files\Python312;C:\Program Files\Python312\Scripts;%PATH%"
    set "PATH=C:\Python312;C:\Python312\Scripts;%PATH%"
)

REM Try choco
where choco >nul 2>nul
if !errorlevel! equ 0 (
    echo   [i] Trying Chocolatey...
    choco install python --version=3.12.7 -y
    set "PATH=%PATH%;C:\Python312;C:\Python312\Scripts"
)

REM Try direct download
where curl >nul 2>nul
if !errorlevel! equ 0 (
    echo   [i] Downloading from python.org...
    curl -L -o "%TEMP%\py312.exe" "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe"
    if exist "%TEMP%\py312.exe" (
        echo   [i] Running installer...
        "%TEMP%\py312.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1
        timeout /t 20 /nobreak >nul
        set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
        set "PATH=C:\Program Files\Python312;C:\Program Files\Python312\Scripts;%PATH%"
        del "%TEMP%\py312.exe" 2>nul
    ) else (
        echo   [!!] Download failed.
    )
)

REM Re-check
set "PYTHON_BIN="
where python3.12 >nul 2>nul
if !errorlevel! equ 0 set "PYTHON_BIN=python3.12"
if not defined PYTHON_BIN where python >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
    echo !PYVER! | findstr /C:"3.12" >nul 2>nul
    if !errorlevel! equ 0 set "PYTHON_BIN=python"
    echo !PYVER! | findstr /C:"3.11" >nul 2>nul
    if !errorlevel! equ 0 set "PYTHON_BIN=python"
)

if not defined PYTHON_BIN (
    echo.
    echo   [FATAL] Python 3.11-3.12 could not be installed.
    echo   Download manually: https://www.python.org/downloads/release/python-3127/
    echo.
    pause
    exit /b 1
)

:python_found
echo   [OK] !PYTHON_BIN!

REM === Step 2: Config ===
echo   [2/7] Checking configuration...
if not exist "%CONFIG_ENV%" (
    if not exist "%DIR%.env" (
        echo   Running setup wizard...
        !PYTHON_BIN! "%DIR%setup.py"
        if !errorlevel! neq 0 (
            echo   [FATAL] Setup wizard failed.
            pause
            exit /b 1
        )
    )
)
if not exist "%CONFIG_ENV%" if not exist "%DIR%.env" (
    echo   [FATAL] No .env file after setup.
    pause
    exit /b 1
)
echo   [OK]

REM === Step 3: uv ===
echo   [3/7] Checking uv...
where uv >nul 2>nul
if !errorlevel! neq 0 (
    echo   Installing uv...
    !PYTHON_BIN! -m pip install uv 2>nul
    if !errorlevel! neq 0 !PYTHON_BIN! -m ensurepip 2>nul && !PYTHON_BIN! -m pip install uv 2>nul
    where uv >nul 2>nul
    if !errorlevel! neq 0 (
        echo   [FATAL] uv install failed.
        pause
        exit /b 1
    )
)
echo   [OK]

REM === Step 4: Node.js ===
echo   [4/7] Checking Node.js...
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo   [FATAL] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
echo   [OK]

REM === Step 5: Python deps ===
echo   [5/7] Checking Python dependencies...
cd /d "%DIR%"
if not exist ".venv" (
    echo   Installing (uv sync)...
    uv sync >"%LOG_DIR%\uv_sync.log" 2>&1
    if !errorlevel! neq 0 (
        echo   [FATAL] uv sync failed. Log: %LOG_DIR%\uv_sync.log
        type "%LOG_DIR%\uv_sync.log"
        pause
        exit /b 1
    )
)
echo   [OK]

REM === Step 6: Node deps ===
echo   [6/7] Checking Electron dependencies...
cd /d "%DIR%mark-orb"
if not exist "node_modules" (
    echo   Installing (npm install)...
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
    if !errorlevel! neq 0 (
        echo   [FATAL] npm install failed. Log: %LOG_DIR%\npm_install.log
        type "%LOG_DIR%\npm_install.log"
        pause
        exit /b 1
    )
)
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   electron-vite missing. Re-installing...
    npm install >"%LOG_DIR%\npm_install.log" 2>&1
    if not exist "node_modules\.bin\electron-vite.cmd" (
        echo   [FATAL] electron-vite still missing.
        pause
        exit /b 1
    )
)
echo   [OK]

REM === Step 7: Launch ===
echo   [7/7] Starting F.R.I.D.A.Y. ...
echo.

REM Kill stale backend on port 5001
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :5001 ^| findstr LISTENING 2^>nul') do taskkill /PID %%p /F >nul 2>nul
timeout /t 1 /nobreak >nul

REM Start backend (background, log to file)
cd /d "%DIR%"
start "Friday-Backend" /B uv run python_backend.py 5001 >"%LOG_DIR%\backend.log" 2>&1

REM Wait for backend
set /a "WAIT=0"
:wait_backend
if !WAIT! geq 30 (
    echo.
    echo   [FATAL] Backend did not start in 30s.
    echo   Last 20 lines:
    powershell -Command "Get-Content '%LOG_DIR%\backend.log' -Tail 20" 2>nul
    echo.
    pause
    exit /b 1
)
curl -s http://127.0.0.1:5001/health >nul 2>nul
if !errorlevel! equ 0 goto :backend_up
timeout /t 1 /nobreak >nul
set /a "WAIT+=1"
goto :wait_backend

:backend_up
echo   [OK] Backend running on port 5001.
echo.

REM Start Electron
cd /d "%DIR%mark-orb"
npx electron-vite dev

echo.
echo   ========================================
echo     F.R.I.D.A.Y. closed.
echo     Log: %LOG_DIR%\backend.log
echo   ========================================
echo.
pause
