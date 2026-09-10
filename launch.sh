#!/bin/bash

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_ENV="$HOME/.config/friday/.env"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"; CYAN="\033[96m"; DIM="\033[2m"; BOLD="\033[1m"; RESET="\033[0m"

cleanup() { echo -e "\n${DIM}Shutting down...${RESET}"; [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM
fail() { echo -e "\n${RED}  [FATAL] $1${RESET}\n"; exit 1; }

echo -e "\n  ========================================"
echo -e "    F.R.I.D.A.Y. Launcher"
echo -e "  ========================================\n"

# === Step 1: Python ===
echo -e "  [1/7] Checking Python..."
PYTHON_BIN=""
for bin in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$bin" &>/dev/null; then
        ver=$("$bin" --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
        major=$(echo "$ver" | cut -d. -f1)
        minor=$(echo "$ver" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
            PYTHON_BIN="$bin"
            break
        fi
    fi
done
[ -n "$PYTHON_BIN" ] || fail "Python 3.11+ not found. Install: https://www.python.org/downloads/"
echo -e "  ${GREEN}[OK]${RESET} $("$PYTHON_BIN" --version 2>&1) ($PYTHON_BIN)"

# === Step 2: Config ===
echo -e "  [2/7] Checking configuration..."
if [ ! -f "$CONFIG_ENV" ] && [ ! -f "$DIR/.env" ]; then
    echo -e "  ${YELLOW}Running setup wizard...${RESET}"
    "$PYTHON_BIN" "$DIR/setup.py" || fail "Setup failed"
fi
[ -f "$CONFIG_ENV" ] || [ -f "$DIR/.env" ] || fail "No .env file"
echo -e "  ${GREEN}[OK]${RESET}"

# === Step 3: uv ===
echo -e "  [3/7] Checking uv..."
if ! command -v uv &>/dev/null; then
    echo -e "  ${YELLOW}Installing uv...${RESET}"
    "$PYTHON_BIN" -m pip install uv 2>/dev/null || "$PYTHON_BIN" -m ensurepip 2>/dev/null | "$PYTHON_BIN" -m pip install uv
    command -v uv &>/dev/null || fail "uv install failed"
fi
echo -e "  ${GREEN}[OK]${RESET}"

# === Step 4: Node.js ===
echo -e "  [4/7] Checking Node.js..."
command -v node &>/dev/null || fail "Node.js not found. https://nodejs.org/"
echo -e "  ${GREEN}[OK]${RESET} $(node --version)"

# === Step 5: Python deps ===
echo -e "  [5/7] Checking Python dependencies..."
cd "$DIR"
if [ ! -d ".venv" ]; then
    echo -e "  ${DIM}Running uv sync...${RESET}"
    uv sync >"$LOG_DIR/uv_sync.log" 2>&1 || { tail -20 "$LOG_DIR/uv_sync.log"; fail "uv sync failed"; }
fi
# Verify venv has correct Python
VENV_PYTHON=".venv/bin/python"
if [ -f "$VENV_PYTHON" ]; then
    VENV_VER=$("$VENV_PYTHON" --version 2>&1)
    echo -e "  ${GREEN}[OK]${RESET} venv Python: $VENV_VER"
else
    fail "No Python in .venv — run: uv sync"
fi

# === Step 6: Node deps ===
echo -e "  [6/7] Checking Electron dependencies..."
cd "$DIR/mark-orb"
if [ ! -d "node_modules" ]; then
    echo -e "  ${DIM}Running npm install...${RESET}"
    npm install >"$LOG_DIR/npm_install.log" 2>&1 || { tail -20 "$LOG_DIR/npm_install.log"; fail "npm install failed"; }
fi
[ -f "node_modules/.bin/electron-vite" ] || { npm install 2>/dev/null; } || fail "electron-vite missing"
echo -e "  ${GREEN}[OK]${RESET}"

# === Step 7: Launch ===
echo -e "  [7/7] Starting F.R.I.D.A.Y. ...\n"

if command -v lsof &>/dev/null; then lsof -ti:5001 2>/dev/null | xargs kill -9 2>/dev/null || true; fi
sleep 1

cd "$DIR"
uv run python_backend.py 5001 >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

TIMEOUT=30
for i in $(seq 1 $TIMEOUT); do
    curl -s http://127.0.0.1:5001/health >/dev/null 2>&1 && break
    if [ "$i" -eq "$TIMEOUT" ]; then
        echo -e "\n  ${RED}Backend log (last 30 lines):${RESET}"
        tail -30 "$LOG_DIR/backend.log" 2>/dev/null
        fail "Backend did not start in ${TIMEOUT}s"
    fi
    sleep 1
done
echo -e "  ${GREEN}[OK]${RESET} Backend running on port 5001.\n"

cd "$DIR/mark-orb"
npx electron-vite dev 2>&1

echo -e "\n  ========================================"
echo -e "    F.R.I.D.A.Y. closed. Log: $LOG_DIR/backend.log"
echo -e "  ========================================\n"
