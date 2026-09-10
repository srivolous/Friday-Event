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

# ─── Python auto-install ──────────────────────────────────────────────────────
install_python_macos() {
    echo -e "${YELLOW}! Python 3.11–3.12 not found on macOS.${RESET}"
    if command -v brew &>/dev/null; then
        echo -e "${DIM}Installing Python 3.12 via Homebrew...${RESET}"
        brew install python@3.12
    else
        echo -e "${DIM}Homebrew not found. Installing Python 3.12 from python.org...${RESET}"
        ARCH=$(uname -m)
        if [ "$ARCH" = "arm64" ]; then
            URL="https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg"
        else
            URL="https://www.python.org/ftp/python/3.12.7/python-3.12.7-macosx10.9.pkg"
        fi
        TMP_PKG="/tmp/python-installer.pkg"
        curl -L -o "$TMP_PKG" "$URL"
        sudo installer -pkg "$TMP_PKG" -target /
        rm -f "$TMP_PKG"
    fi
}

install_python_linux() {
    echo -e "${YELLOW}! Python 3.11–3.12 not found on Linux.${RESET}"
    if command -v apt &>/dev/null; then
        echo -e "${DIM}Detected Debian/Ubuntu. Installing Python 3.12 via apt...${RESET}"
        sudo apt update -qq
        sudo apt install -y python3.12 python3.12-venv python3.12-dev
    elif command -v dnf &>/dev/null; then
        echo -e "${DIM}Detected Fedora/RHEL. Installing Python 3.12 via dnf...${RESET}"
        sudo dnf install -y python3.12
    elif command -v pacman &>/dev/null; then
        echo -e "${DIM}Detected Arch. Installing Python via pacman...${RESET}"
        sudo pacman -S --noconfirm python python-pip
    elif command -v apk &>/dev/null; then
        echo -e "${DIM}Detected Alpine. Installing Python via apk...${RESET}"
        sudo apk add python3 python3-dev
    else
        echo -e "${RED}✗ Could not detect package manager.${RESET}"
        echo -e "${DIM}Install Python 3.12 manually: https://www.python.org/downloads/${RESET}"
        exit 1
    fi
}

find_python() {
    # Try python3.12, python3.11, python3, python in order
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

echo -e "\n${CYAN}${BOLD}── Checking Python ──${RESET}\n"

PYTHON_BIN=""
if PYTHON_BIN=$(find_python); then
    PY_VER=$("$PYTHON_BIN" --version 2>&1)
    echo -e "  ${GREEN}✓${RESET} $PY_VER found: $PYTHON_BIN"
else
    echo -e "  ${RED}✗${RESET} Python 3.11–3.12 not found."
    echo -e "  ${DIM}Auto-installing Python 3.12...${RESET}"
    if [ "$(uname)" = "Darwin" ]; then
        install_python_macos
    else
        install_python_linux
    fi
    # Re-check after install — scan all common binary names
    echo -e "  ${DIM}Verifying installation...${RESET}"
    sleep 2
    if PYTHON_BIN=$(find_python); then
        PY_VER=$("$PYTHON_BIN" --version 2>&1)
        echo -e "  ${GREEN}✓${RESET} Installed: $PY_VER ($PYTHON_BIN)"
    else
        echo -e "  ${RED}✗${RESET} Python installation failed or not in PATH."
        echo -e "  ${DIM}Try: export PATH=\"/usr/local/bin:\$PATH\" and re-run.${RESET}"
        echo -e "  ${DIM}Or install manually: https://www.python.org/downloads/${RESET}"
        exit 1
    fi
fi

# ─── First-run check ──────────────────────────────────────────────────────────
if [ ! -f "$CONFIG_ENV" ] && [ ! -f "$DIR/.env" ]; then
    echo -e "\n${CYAN}${BOLD}No configuration found. Running setup wizard...${RESET}\n"
    "$PYTHON_BIN" "$DIR/setup.py"
    echo ""
fi

# ─── Check uv ─────────────────────────────────────────────────────────────────
if ! command -v uv &>/dev/null; then
    echo -e "${YELLOW}! uv not found. Installing...${RESET}"
    "$PYTHON_BIN" -m pip install uv 2>/dev/null || "$PYTHON_BIN" -m ensurepip | "$PYTHON_BIN" -m pip install uv
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
