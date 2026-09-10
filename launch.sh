#!/bin/bash

# ─── F.R.I.D.A.Y. Launcher (macOS / Linux) ────────────────────────────────────
DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_ENV="$HOME/.config/friday/.env"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

BOLD="\033[1m"
GREEN="\033[92m"
YELLOW="\033[93m"
RED="\033[91m"
CYAN="\033[96m"
DIM="\033[2m"
RESET="\033[0m"

cleanup() {
    echo ""
    echo -e "${DIM}Shutting down F.R.I.D.A.Y...${RESET}"
    if [ -n "$BACKEND_PID" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

fail() {
    echo -e "\n${RED}  [FATAL] $1${RESET}\n"
    exit 1
}

# ─── Step 1: Python ───────────────────────────────────────────────────────────
echo -e "\n  [1/7] Checking Python..."

install_python_macos() {
    echo -e "  ${YELLOW}! Auto-installing Python 3.12...${RESET}"
    if command -v brew &>/dev/null; then
        brew install python@3.12 || fail "brew install python@3.12 failed"
    else
        ARCH=$(uname -m)
        if [ "$ARCH" = "arm64" ]; then
            URL="https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg"
        else
            URL="https://www.python.org/ftp/python/3.12.7/python-3.12.7-macosx10.9.pkg"
        fi
        curl -L -o /tmp/python.pkg "$URL" || fail "Download failed"
        sudo installer -pkg /tmp/python.pkg -target / || fail "Installer failed"
        rm -f /tmp/python.pkg
    fi
}

install_python_linux() {
    echo -e "  ${YELLOW}! Auto-installing Python 3.12...${RESET}"
    if command -v apt &>/dev/null; then
        sudo apt update -qq 2>/dev/null
        sudo apt install -y python3.12 python3.12-venv python3.12-dev || fail "apt install failed"
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3.12 || fail "dnf install failed"
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm python python-pip || fail "pacman install failed"
    else
        fail "No package manager found. Install Python 3.12 manually: https://www.python.org/downloads/"
    fi
}

find_python() {
    for bin in python3.12 python3.11 python3 python; do
        if command -v "$bin" &>/dev/null; then
            MAJOR=$("$bin" -c "import sys; print(sys.version_info.major)" 2>/dev/null)
            MINOR=$("$bin" -c "import sys; print(sys.version_info.minor)" 2>/dev/null)
            if [ "$MAJOR" = "3" ] && [ "$MINOR" -ge 11 ] && [ "$MINOR" -le 12 ] 2>/dev/null; then
                echo "$bin"
                return 0
            fi
        fi
    done
    return 1
}

PYTHON_BIN=""
if PYTHON_BIN=$(find_python); then
    echo -e "  ${GREEN}[OK]${RESET} $("$PYTHON_BIN" --version 2>&1) ($PYTHON_BIN)"
else
    if [ "$(uname)" = "Darwin" ]; then
        install_python_macos
    else
        install_python_linux
    fi
    sleep 2
    if PYTHON_BIN=$(find_python); then
        echo -e "  ${GREEN}[OK]${RESET} Installed: $("$PYTHON_BIN" --version 2>&1) ($PYTHON_BIN)"
    else
        fail "Python installation failed. Try: export PATH=\"/usr/local/bin:\$PATH\""
    fi
fi

# ─── Step 2: Config ───────────────────────────────────────────────────────────
echo -e "  [2/7] Checking configuration..."
if [ ! -f "$CONFIG_ENV" ] && [ ! -f "$DIR/.env" ]; then
    echo -e "  ${YELLOW}Running setup wizard...${RESET}"
    "$PYTHON_BIN" "$DIR/setup.py" || fail "Setup wizard failed"
fi
[ -f "$CONFIG_ENV" ] || [ -f "$DIR/.env" ] || fail "No .env file after setup"
echo -e "  ${GREEN}[OK]${RESET}"

# ─── Step 3: uv ───────────────────────────────────────────────────────────────
echo -e "  [3/7] Checking uv..."
if ! command -v uv &>/dev/null; then
    echo -e "  ${YELLOW}Installing uv...${RESET}"
    "$PYTHON_BIN" -m pip install uv 2>/dev/null || "$PYTHON_BIN" -m ensurepip 2>/dev/null | "$PYTHON_BIN" -m pip install uv
    command -v uv &>/dev/null || fail "uv install failed. Install manually: pip install uv"
fi
echo -e "  ${GREEN}[OK]${RESET}"

# ─── Step 4: Node.js ──────────────────────────────────────────────────────────
echo -e "  [4/7] Checking Node.js..."
command -v node &>/dev/null || fail "Node.js not found. Install: https://nodejs.org/"
echo -e "  ${GREEN}[OK]${RESET} $(node --version)"

# ─── Step 5: Python deps ─────────────────────────────────────────────────────
echo -e "  [5/7] Checking Python dependencies..."
cd "$DIR"
if [ ! -d ".venv" ]; then
    echo -e "  ${DIM}Running uv sync...${RESET}"
    uv sync >"$LOG_DIR/uv_sync.log" 2>&1 || { cat "$LOG_DIR/uv_sync.log"; fail "uv sync failed"; }
fi
# Verify critical deps
if [ ! -d ".venv/lib/python3.12/site-packages/faster_whisper" ] && \
   [ ! -d ".venv/lib/python3.11/site-packages/faster_whisper" ]; then
    echo -e "  ${YELLOW}! faster-whisper missing, re-installing...${RESET}"
    uv sync >"$LOG_DIR/uv_sync.log" 2>&1 || { cat "$LOG_DIR/uv_sync.log"; fail "uv sync failed"; }
fi
echo -e "  ${GREEN}[OK]${RESET}"

# ─── Step 6: Node deps ────────────────────────────────────────────────────────
echo -e "  [6/7] Checking Electron dependencies..."
cd "$DIR/mark-orb"
if [ ! -d "node_modules" ]; then
    echo -e "  ${DIM}Running npm install...${RESET}"
    npm install >"$LOG_DIR/npm_install.log" 2>&1 || { cat "$LOG_DIR/npm_install.log"; fail "npm install failed"; }
fi
# Verify electron-vite
if [ ! -f "node_modules/.bin/electron-vite" ]; then
    echo -e "  ${YELLOW}! electron-vite missing, re-installing...${RESET}"
    npm install >"$LOG_DIR/npm_install.log" 2>&1 || { cat "$LOG_DIR/npm_install.log"; fail "npm install failed"; }
fi
[ -f "node_modules/.bin/electron-vite" ] || fail "electron-vite still missing after install"
echo -e "  ${GREEN}[OK]${RESET}"

# ─── Step 7: Launch ───────────────────────────────────────────────────────────
echo -e "  [7/7] Starting F.R.I.D.A.Y. ..."
echo ""

# Kill stale backend
if command -v lsof &>/dev/null; then
    lsof -ti:5001 2>/dev/null | xargs kill -9 2>/dev/null || true
elif command -v fuser &>/dev/null; then
    fuser -k 5001/tcp 2>/dev/null || true
fi
sleep 1

# Start backend
cd "$DIR"
uv run python_backend.py 5001 >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend
TIMEOUT=30
for i in $(seq 1 $TIMEOUT); do
    if curl -s http://127.0.0.1:5001/health >/dev/null 2>&1; then
        echo -e "  ${GREEN}[OK]${RESET} Backend running on port 5001."
        break
    fi
    if [ "$i" -eq "$TIMEOUT" ]; then
        echo ""
        echo -e "  ${RED}[FATAL] Backend did not start in ${TIMEOUT}s.${RESET}"
        echo -e "  Last 20 lines of backend.log:"
        echo "  ─────────────────────────────────"
        tail -20 "$LOG_DIR/backend.log" 2>/dev/null
        echo "  ─────────────────────────────────"
        echo ""
        exit 1
    fi
    sleep 1
done

echo ""

# Start Electron
cd "$DIR/mark-orb"
npx electron-vite dev 2>&1

echo ""
echo -e "  ─────────────────────────────────────"
echo -e "  F.R.I.D.A.Y. closed."
echo -e "  Backend log: $LOG_DIR/backend.log"
echo -e "  ─────────────────────────────────────"
echo ""
