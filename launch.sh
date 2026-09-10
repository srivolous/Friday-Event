#!/bin/bash

# Initialize pyenv if installed (puts python3.12 etc. in PATH)
if [ -d "$HOME/.pyenv" ]; then
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/bin:$PYENV_ROOT/shims:$PATH"
    command -v pyenv &>/dev/null && eval "$(pyenv init -)" 2>/dev/null
fi

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

# Also check pyenv versions directory
PYENV_PYTHONS=""
if [ -d "$HOME/.pyenv/versions" ]; then
    for v in "$HOME/.pyenv/versions/"*/bin/python3; do
        [ -f "$v" ] && PYENV_PYTHONS="$PYENV_PYTHONS $v"
    done
fi

# Search for Python 3.11-3.13 (3.14+ has no spacy/numpy wheels yet)
for bin in python3.13 python3.12 python3.11 $PYENV_PYTHONS python3 python; do
    if command -v "$bin" &>/dev/null || [ -f "$bin" ]; then
        ver=$("$bin" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
        major=$(echo "$ver" | cut -d. -f1)
        minor=$(echo "$ver" | cut -d. -f2)
        if [ "$major" -eq 3 ] && [ "$minor" -ge 11 ] && [ "$minor" -le 13 ]; then
            PYTHON_BIN="$bin"
            break
        fi
    fi
done
[ -n "$PYTHON_BIN" ] || fail "Python 3.11-3.13 not found. Install: pyenv install 3.12"
echo -e "  ${GREEN}[OK]${RESET} $("$PYTHON_BIN" --version 2>&1) ($PYTHON_BIN)"

# === Step 2: Provider Selection ===
echo -e "  [2/7] Choose AI provider..."

# Read current config
CURRENT_PROVIDER=""
CURRENT_KEY=""
ENV_FILE=""
if [ -f "$CONFIG_ENV" ]; then
    ENV_FILE="$CONFIG_ENV"
elif [ -f "$DIR/.env" ]; then
    ENV_FILE="$DIR/.env"
fi
if [ -n "$ENV_FILE" ]; then
    CURRENT_KEY=$(grep "^GOOGLE_API_KEY=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -n "$CURRENT_KEY" ]; then
        CURRENT_PROVIDER="gemini"
    else
        CURRENT_PROVIDER="ollama"
    fi
fi

echo -e ""
echo -e "    ${BOLD}1${RESET}) Gemini (Cloud) — requires API key"
echo -e "    ${BOLD}2${RESET}) Ollama (Local) — requires Ollama running"
if [ -n "$CURRENT_PROVIDER" ]; then
    if [ "$CURRENT_PROVIDER" = "gemini" ]; then
        echo -e "    ${DIM}Currently: Gemini (${CURRENT_KEY:0:8}...${CURRENT_KEY: -4})${RESET}"
    else
        echo -e "    ${DIM}Currently: Ollama${RESET}"
    fi
fi
echo -e ""

PROVIDER_CHOICE=""
while true; do
    read -r -p "  Choose [1-2]: " PROVIDER_CHOICE
    case "$PROVIDER_CHOICE" in
        1) PROVIDER="gemini"; break ;;
        2) PROVIDER="ollama"; break ;;
        *) echo -e "  ${RED}Invalid choice.${RESET}" ;;
    esac
done

# Build .env based on choice
if [ "$PROVIDER" = "gemini" ]; then
    echo -e ""
    GEMINI_KEY=""
    if [ "$CURRENT_PROVIDER" = "gemini" ] && [ -n "$CURRENT_KEY" ]; then
        echo -e "  ${DIM}Existing key: ${CURRENT_KEY:0:8}...${CURRENT_KEY: -4}${RESET}"
        read -r -p "  Press Enter to keep, or paste a new key: " GEMINI_KEY
        if [ -z "$GEMINI_KEY" ]; then
            GEMINI_KEY="$CURRENT_KEY"
        fi
    else
        read -r -p "  Gemini API key: " GEMINI_KEY
    fi
    if [ -z "$GEMINI_KEY" ]; then
        fail "No API key provided."
    fi
    echo -e "  ${DIM}Validating key...${RESET}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "x-goog-api-key: $GEMINI_KEY" \
        "https://generativelanguage.googleapis.com/v1beta/models" --max-time 10 2>/dev/null)
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "  ${GREEN}[OK]${RESET} Key validated."
    elif [ "$HTTP_CODE" = "403" ]; then
        echo -e "  ${YELLOW}[WARN]${RESET} Key valid but may lack some permissions. Continuing."
    elif [ "$HTTP_CODE" = "429" ]; then
        echo -e "  ${YELLOW}[WARN]${RESET} Key valid (rate limited). Continuing."
    else
        echo -e "  ${YELLOW}[WARN]${RESET} Could not validate (HTTP $HTTP_CODE). Continuing."
    fi

    # Write .env
    cat > "$DIR/.env" << ENVEOF
GOOGLE_API_KEY=$GEMINI_KEY
GEMINI_MODEL=gemini-2.0-flash
OLLAMA_URL=
OLLAMA_MODEL=llama3.1:latest
ENVEOF
    mkdir -p "$(dirname "$CONFIG_ENV")"
    cp "$DIR/.env" "$CONFIG_ENV" 2>/dev/null
    echo -e "  ${GREEN}[OK]${RESET} Configured for Gemini."
else
    echo -e ""
    OLLAMA_URL="http://localhost:11434"
    read -r -p "  Ollama URL [http://localhost:11434]: " INPUT_URL
    if [ -n "$INPUT_URL" ]; then
        OLLAMA_URL="$INPUT_URL"
    fi
    echo -e "  ${DIM}Checking Ollama at $OLLAMA_URL ...${RESET}"
    if curl -s --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
        echo -e "  ${GREEN}[OK]${RESET} Ollama reachable."
    else
        echo -e "  ${RED}[WARN]${RESET} Cannot reach Ollama. Make sure it's running."
        read -r -p "  Continue anyway? [y/N]: " CONT
        case "$CONT" in
            [yY]*) ;;
            *) fail "Aborted." ;;
        esac
    fi
    read -r -p "  Ollama model [llama3.1:latest]: " OLLAMA_MODEL
    OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:latest}"

    cat > "$DIR/.env" << ENVEOF
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
OLLAMA_URL=$OLLAMA_URL
OLLAMA_MODEL=$OLLAMA_MODEL
ENVEOF
    mkdir -p "$(dirname "$CONFIG_ENV")"
    cp "$DIR/.env" "$CONFIG_ENV" 2>/dev/null
    echo -e "  ${GREEN}[OK]${RESET} Configured for Ollama."
fi

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

# Get expected Python version from our detected binary
NEED_VER=$("$PYTHON_BIN" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')

# Delete venv if it has wrong Python version
if [ -f ".venv/bin/python" ]; then
    VENV_VER=$(.venv/bin/python --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
    if [ "$VENV_VER" != "$NEED_VER" ]; then
        echo -e "  ${YELLOW}Venv has Python $VENV_VER, need $NEED_VER — recreating...${RESET}"
        rm -rf .venv
    fi
fi

if [ ! -d ".venv" ]; then
    echo -e "  ${DIM}Running uv sync with $PYTHON_BIN (may take a few minutes on first run)...${RESET}"
    # Clear uv build cache to avoid stale Python 3.13 builds
    uv cache clean 2>/dev/null
    uv sync --python "$PYTHON_BIN" >"$LOG_DIR/uv_sync.log" 2>&1
    if [ $? -ne 0 ]; then
        tail -20 "$LOG_DIR/uv_sync.log"
        fail "uv sync failed"
    fi
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

# Ensure all packages are fully installed (uv run would trigger more downloads)
cd "$DIR"
if [ -f ".venv/bin/python" ]; then
    echo -e "  ${DIM}Verifying packages are installed...${RESET}"
    .venv/bin/python -c "import faster_whisper; import kokoro; import google.genai; import numpy" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "  ${YELLOW}Some packages missing, running uv sync...${RESET}"
        uv sync --python "$PYTHON_BIN" >"$LOG_DIR/uv_sync.log" 2>&1 || { tail -20 "$LOG_DIR/uv_sync.log"; fail "uv sync failed"; }
    fi
    echo -e "  ${GREEN}[OK]${RESET} Packages verified."
fi

if command -v lsof &>/dev/null; then lsof -ti:5001 2>/dev/null | xargs kill -9 2>/dev/null || true; fi
sleep 1

cd "$DIR"
uv run python_backend.py 5001 >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# First run needs extra time for uv to finish installing packages
TIMEOUT=300
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
