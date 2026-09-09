#!/bin/bash
set -e

# ─── F.R.I.D.A.Y. Launcher (macOS / Linux) ────────────────────────────────────
DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_ENV="$HOME/.config/friday/.env"

# Colors
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
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# ─── First-run check ──────────────────────────────────────────────────────────
if [ ! -f "$CONFIG_ENV" ] && [ ! -f "$DIR/.env" ]; then
    echo -e "\n${CYAN}${BOLD}No configuration found. Running setup wizard...${RESET}\n"
    python3 "$DIR/setup.py" || python "$DIR/setup.py"
    echo ""
fi

# ─── Check uv ─────────────────────────────────────────────────────────────────
if ! command -v uv &>/dev/null; then
    echo -e "${YELLOW}! uv not found. Installing...${RESET}"
    python3 -m pip install uv 2>/dev/null || python -m pip install uv
fi

# ─── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install it: https://nodejs.org/${RESET}"
    exit 1
fi

# ─── Install deps if needed ───────────────────────────────────────────────────
if [ ! -d "$DIR/.venv" ]; then
    echo -e "${DIM}Installing Python dependencies...${RESET}"
    cd "$DIR" && uv sync
fi

if [ ! -d "$DIR/mark-orb/node_modules" ]; then
    echo -e "${DIM}Installing Electron dependencies...${RESET}"
    cd "$DIR/mark-orb" && npm install
fi

# ─── Start Python backend ─────────────────────────────────────────────────────
echo -e "${GREEN}✓${RESET} Starting Python backend..."
cd "$DIR"
uv run python_backend.py 5001 &
BACKEND_PID=$!

# Wait for backend to be ready
echo -e "${DIM}Waiting for backend...${RESET}"
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:5001/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓${RESET} Backend ready."
        break
    fi
    sleep 1
done

# ─── Start Electron app ───────────────────────────────────────────────────────
echo -e "${GREEN}✓${RESET} Launching F.R.I.D.A.Y..."
cd "$DIR/mark-orb"
npx electron-vite dev

echo -e "\n${GREEN}F.R.I.D.A.Y. has been closed.${RESET}"
