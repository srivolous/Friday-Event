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

REM === Step 2: Provider Selection ===
echo   [2/7] Choose AI provider:
echo.
echo     1^) Gemini ^(Cloud^) — requires API key
echo     2^) Ollama ^(Local^) — requires Ollama running
echo.

:provider_choice
set /p "PROVIDER_CHOICE=  Choose [1-2]: "
if "!PROVIDER_CHOICE!"=="1" goto :provider_gemini
if "!PROVIDER_CHOICE!"=="2" goto :provider_ollama
echo   Invalid choice.
goto :provider_choice

:provider_gemini
echo.
set "GEMINI_KEY="
if exist "%DIR%.env" (
    for /f "tokens=1,* delims==" %%a in ('findstr /b "GOOGLE_API_KEY=" "%DIR%.env" 2^>nul') do set "GEMINI_KEY=%%b"
)
if defined GEMINI_KEY (
    echo   Existing key: !GEMINI_KEY:~0,8!...!GEMINI_KEY:~-4!
    set /p "NEW_KEY=  Press Enter to keep, or paste a new key: "
    if defined NEW_KEY set "GEMINI_KEY=!NEW_KEY!"
) else (
    set /p "GEMINI_KEY=  Gemini API key: "
)
if not defined GEMINI_KEY ( echo   [FATAL] No key provided. & pause & exit /b 1 )

echo   Validating key...
curl -s -o nul -w "%%{http_code}" -H "x-goog-api-key: !GEMINI_KEY!" "https://generativelanguage.googleapis.com/v1beta/models" --max-time 10 >"%TEMP%\friday_http.txt" 2>nul
set /p HTTP_CODE=<"%TEMP%\friday_http.txt"
if "!HTTP_CODE!"=="200" ( echo   [OK] Key validated. ) else ( echo   [WARN] Could not validate ^(!HTTP_CODE!^). Continuing. )

(
    echo GOOGLE_API_KEY=!GEMINI_KEY!
    echo GEMINI_MODEL=gemini-3.5-flash
    echo OLLAMA_URL=
    echo OLLAMA_MODEL=llama3.1:latest
) > "%DIR%.env"
if not exist "%USERPROFILE%\.config\friday" mkdir "%USERPROFILE%\.config\friday"
copy "%DIR%.env" "%USERPROFILE%\.config\friday\.env" >nul 2>nul
echo   [OK] Configured for Gemini.
goto :provider_done

:provider_ollama
echo.
set "OLLAMA_URL=http://localhost:11434"
set /p "INPUT_URL=  Ollama URL [http://localhost:11434]: "
if defined INPUT_URL set "OLLAMA_URL=!INPUT_URL!"
echo   Checking Ollama at !OLLAMA_URL! ...
curl -s --max-time 3 "!OLLAMA_URL!/api/tags" >nul 2>nul
if !errorlevel! neq 0 (
    echo   [WARN] Cannot reach Ollama. Make sure it's running.
    set /p "CONT=  Continue anyway? [y/N]: "
    if /i not "!CONT!"=="y" ( echo   Aborted. & pause & exit /b 1 )
)
set "OLLAMA_MODEL=llama3.1:latest"
set /p "OLLAMA_MODEL=  Ollama model [llama3.1:latest]: "

(
    echo GOOGLE_API_KEY=
    echo GEMINI_MODEL=gemini-3.5-flash
    echo OLLAMA_URL=!OLLAMA_URL!
    echo OLLAMA_MODEL=!OLLAMA_MODEL!
) > "%DIR%.env"
if not exist "%USERPROFILE%\.config\friday" mkdir "%USERPROFILE%\.config\friday"
copy "%DIR%.env" "%USERPROFILE%\.config\friday\.env" >nul 2>nul
echo   [OK] Configured for Ollama.

:provider_done

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
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   Running npm install...
    npm install
)
if not exist "node_modules\electron\dist\electron.exe" (
    echo   Electron binary missing, running npx electron install...
    npx electron install
)
if not exist "node_modules\.bin\electron-vite.cmd" (
    echo   [FATAL] electron-vite missing after install. & pause & exit /b 1
)
echo   [OK]

REM === Step 7: Launch ===
echo   [7/7] Starting F.R.I.D.A.Y. ...
echo.

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr :5001 ^| findstr LISTENING 2^>nul') do taskkill /PID %%p /F >nul 2>nul
timeout /t 1 /nobreak >nul

cd /d "%DIR%"
start "Friday-Backend" /B uv run python_backend.py 5001

REM Wait for backend with PowerShell (reliable, no goto loop)
echo   Waiting for backend...
powershell -Command "$timeout=30; $elapsed=0; while($elapsed -lt $timeout) { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:5001/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200) { Write-Host '  [OK] Backend running on port 5001.'; exit 0 } } catch {}; Start-Sleep 1; $elapsed++ }; Write-Host '  [FATAL] Backend did not start in 30s.'; exit 1"
if !errorlevel! neq 0 (
    echo   Check log: %LOG_DIR%\backend.log
    pause & exit /b 1
)
echo.

cd /d "%DIR%mark-orb"
npx electron-vite dev

echo.
echo   ========================================
echo     F.R.I.D.A.Y. closed. Log: %LOG_DIR%\backend.log
echo   ========================================
echo.
pause
