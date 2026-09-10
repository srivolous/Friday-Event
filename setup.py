#!/usr/bin/env python3
"""
F.R.I.D.A.Y. — First-Run Setup Wizard
Configures API keys, validates connectivity, installs dependencies.
"""
import os
import sys
import platform
import subprocess
import shutil
import json
from pathlib import Path

# ─── Colors ────────────────────────────────────────────────────────────────────
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
CYAN = "\033[96m"
RESET = "\033[0m"

PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_DIR = Path.home() / ".config" / "friday"
CONFIG_ENV = CONFIG_DIR / ".env"
PROJECT_ENV = PROJECT_ROOT / ".env"

# ─── Helpers ───────────────────────────────────────────────────────────────────
def clear():
    os.system("cls" if platform.system() == "Windows" else "clear")

def banner():
    print(f"""
{CYAN}{BOLD}╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     {CYAN}██████╗ ██████╗ ██╗██╗   ██╗███████╗{RESET}{CYAN}{BOLD}                     ║
║     {CYAN}██╔══██╗██╔══██╗██║██║   ██║██╔════╝{RESET}{CYAN}{BOLD}                     ║
║     {CYAN}██████╔╝██████╔╝██║██║   ██║█████╗{RESET}{CYAN}{BOLD}                       ║
║     {CYAN}██╔══██╗██╔══██╗██║╚██╗ ██╔╝██╔══╝{RESET}{CYAN}{BOLD}                       ║
║     {CYAN}██████╔╝██║  ██║██║ ╚████╔╝ ███████╗{RESET}{CYAN}{BOLD}                    ║
║     {CYAN}╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝{RESET}{CYAN}{BOLD}                    ║
║                                                              ║
║          {DIM}Desktop Assistant — Setup Wizard{RESET}{CYAN}{BOLD}                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")

def success(msg):
    print(f"  {GREEN}✓{RESET} {msg}")

def warn(msg):
    print(f"  {YELLOW}!{RESET} {msg}")

def error(msg):
    print(f"  {RED}✗{RESET} {msg}")

def info(msg):
    print(f"  {BLUE}i{RESET} {msg}")

def section(title):
    print(f"\n{BOLD}{CYAN}── {title} ──{RESET}\n")

def prompt_choice(question, options):
    print(f"  {question}")
    for i, opt in enumerate(options, 1):
        print(f"    {BOLD}{i}{RESET}) {opt}")
    while True:
        try:
            choice = input(f"\n  {BOLD}Choose [1-{len(options)}]:{RESET} ").strip()
            idx = int(choice)
            if 1 <= idx <= len(options):
                return idx
        except (ValueError, EOFError):
            pass
        error("Invalid choice.")

def prompt_input(question, default="", hidden=False):
    suffix = f" {DIM}({default}){RESET}" if default else ""
    if hidden:
        import getpass
        try:
            val = getpass.getpass(f"  {question}{suffix}: ")
        except (EOFError, KeyboardInterrupt):
            val = ""
    else:
        try:
            val = input(f"  {question}{suffix}: ").strip()
        except (EOFError, KeyboardInterrupt):
            val = ""
    return val if val else default

def prompt_yn(question, default=True):
    hint = "Y/n" if default else "y/N"
    try:
        val = input(f"  {question} [{hint}]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        val = ""
    if not val:
        return default
    return val in ("y", "yes")

# ─── Prerequisite checks ──────────────────────────────────────────────────────
def _find_compatible_python():
    """Find a Python 3.11–3.12 binary on the system."""
    candidates = []
    for name in ["python3.12", "python3.11", "python3", "python"]:
        path = shutil.which(name)
        if path:
            try:
                out = subprocess.check_output(
                    [path, "-c", "import sys; print(sys.version_info.major, sys.version_info.minor)"],
                    text=True, timeout=5
                ).strip()
                major, minor = map(int, out.split())
                if major == 3 and 11 <= minor <= 12:
                    candidates.append((minor, path))
            except Exception:
                pass
    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][1]
    return None

def _install_python():
    """Attempt to auto-install Python 3.12."""
    system = platform.system()
    info("Attempting automatic Python 3.12 installation...")
    try:
        if system == "Darwin":
            if shutil.which("brew"):
                subprocess.run(["brew", "install", "python@3.12"], check=True)
            else:
                warn("Homebrew not found. Install it from https://brew.sh")
                return False
        elif system == "Linux":
            if shutil.which("apt"):
                subprocess.run(["sudo", "apt", "update", "-qq"], check=True)
                subprocess.run(["sudo", "apt", "install", "-y", "python3.12", "python3.12-venv", "python3.12-dev"], check=True)
            elif shutil.which("dnf"):
                subprocess.run(["sudo", "dnf", "install", "-y", "python3.12"], check=True)
            elif shutil.which("pacman"):
                subprocess.run(["sudo", "pacman", "-S", "--noconfirm", "python", "python-pip"], check=True)
            else:
                warn("Could not detect package manager.")
                return False
        elif system == "Windows":
            if shutil.which("winget"):
                subprocess.run(["winget", "install", "Python.Python.3.12", "--silent",
                                "--accept-source-agreements", "--accept-package-agreements"], check=True)
            else:
                warn("winget not found. Install Python manually: https://www.python.org/downloads/")
                return False
        else:
            warn(f"Unsupported OS: {system}")
            return False
        return True
    except subprocess.CalledProcessError as e:
        error(f"Python installation failed: {e}")
        return False

def check_python():
    section("Python Check")
    v = sys.version_info
    if v >= (3, 11) and v < (3, 13):
        success(f"Python {v.major}.{v.minor}.{v.micro} — OK")
        return True

    warn(f"Python {v.major}.{v.minor}.{v.micro} found, but 3.11–3.12 required.")

    # Try to find a compatible version already installed
    found = _find_compatible_python()
    if found:
        success(f"Found compatible Python at: {found}")
        info(f"Re-launching setup with correct Python...")
        os.execv(found, [found, __file__] + sys.argv[1:])

    # Try to install
    info("No compatible Python found. Attempting auto-install...")
    if _install_python():
        found = _find_compatible_python()
        if found:
            success(f"Python installed. Re-launching...")
            os.execv(found, [found, __file__] + sys.argv[1:])

    error("Could not find or install Python 3.11–3.13.")
    info("Install manually: https://www.python.org/downloads/")
    return False

def check_uv():
    section("Package Manager (uv)")
    if shutil.which("uv"):
        success("uv is installed.")
        return True
    warn("uv not found. Installing...")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "uv"],
            check=True, capture_output=True
        )
        success("uv installed successfully.")
        return True
    except subprocess.CalledProcessError:
        error("Failed to install uv. Install manually: https://docs.astral.sh/uv/")
        return False

def check_node():
    section("Node.js Check")
    if shutil.which("node"):
        try:
            ver = subprocess.check_output(["node", "--version"], text=True).strip()
            success(f"Node.js {ver} — OK")
            return True
        except Exception:
            pass
    warn("Node.js not found (needed for Electron app).")
    info("Install: https://nodejs.org/")
    return prompt_yn("Continue without Node.js? (can build later)", default=True)

# ─── Provider setup ───────────────────────────────────────────────────────────
def setup_gemini():
    section("Gemini API Setup")
    info("Get your API key at: https://aistudio.google.com/apikey")
    print()
    key = prompt_input("Gemini API Key", hidden=True)
    if not key:
        error("No API key provided. Gemini setup cancelled.")
        return {}

    print(f"\n  {DIM}Validating key...{RESET}")
    try:
        import urllib.request
        import urllib.error
        # Lightweight validation: hit the models endpoint (no SDK needed)
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                success("API key validated.")
            else:
                warn(f"Key accepted with status {resp.status}. Continuing anyway.")
    except urllib.error.HTTPError as e:
        if e.code == 400:
            # 400 = invalid key format
            error(f"API key appears invalid (HTTP 400).")
            if not prompt_yn("Use this key anyway?", default=False):
                return {}
        elif e.code == 403:
            # 403 = key valid but no access — still usable, might just lack embed permissions
            warn("Key valid but may lack some API permissions. Continuing anyway.")
        else:
            error(f"Validation error: HTTP {e.code}")
            if not prompt_yn("Use this key anyway?", default=False):
                return {}
    except Exception as e:
        error(f"Could not validate key: {e}")
        if not prompt_yn("Use this key anyway?", default=False):
            return {}

    model = prompt_input("Gemini chat model", default="gemini-2.0-flash")
    return {
        "GOOGLE_API_KEY": key,
        "GEMINI_MODEL": model,
    }

def setup_ollama():
    section("Ollama Setup")
    info("Ollama must be running in the background.")
    info("Install: https://ollama.com")
    print()

    url = prompt_input("Ollama URL", default="http://localhost:11434")
    model = prompt_input("Ollama chat model", default="llama3.1:latest")

    print(f"\n  {DIM}Checking Ollama connectivity...{RESET}")
    try:
        import ollama
        host = url.replace("http://", "").replace("https://", "")
        client = ollama.Client(host=f"http://{host}" if "://" not in url else url)
        client.list()
        success(f"Ollama reachable at {url}")
    except Exception as e:
        error(f"Cannot reach Ollama at {url}: {e}")
        warn("Make sure Ollama is running: `ollama serve`")
        if not prompt_yn("Continue anyway?", default=False):
            return {}

    return {
        "OLLAMA_URL": url,
        "OLLAMA_MODEL": model,
    }

def setup_email():
    section("Email Setup (Optional)")
    if not prompt_yn("Configure Gmail for email sending?", default=False):
        return {}
    user = prompt_input("Gmail address")
    password = prompt_input("Gmail app password", hidden=True)
    if user and password:
        success("Email credentials saved.")
        return {"GMAIL_USER": user, "GMAIL_APP_PASSWORD": password}
    warn("Incomplete — skipping email config.")
    return {}

# ─── Write .env ────────────────────────────────────────────────────────────────
def write_env(config):
    section("Writing Configuration")

    # Merge with existing .env if present
    existing = {}
    env_path = PROJECT_ENV
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip().strip('"').strip("'")

    existing.update(config)
    existing = {k: v for k, v in existing.items() if v}  # remove empty vals

    lines = [
        "# --- LiveKit (optional, for voice agent) ---",
        f"LIVEKIT_URL={existing.get('LIVEKIT_URL', '')}",
        f"LIVEKIT_API_KEY={existing.get('LIVEKIT_API_KEY', '')}",
        f"LIVEKIT_API_SECRET={existing.get('LIVEKIT_API_SECRET', '')}",
        "",
        "# --- LLM Backend ---",
        f"GOOGLE_API_KEY={existing.get('GOOGLE_API_KEY', '')}",
        f"GEMINI_MODEL={existing.get('GEMINI_MODEL', 'gemini-2.0-flash')}",
        "",
        "# --- Ollama (fallback) ---",
        f"OLLAMA_URL={existing.get('OLLAMA_URL', '')}",
        f"OLLAMA_MODEL={existing.get('OLLAMA_MODEL', 'llama3.1:latest')}",
        "",
        "# --- Email ---",
        f"GMAIL_USER={existing.get('GMAIL_USER', '')}",
        f"GMAIL_APP_PASSWORD={existing.get('GMAIL_APP_PASSWORD', '')}",
    ]

    # Write to project root (UTF-8 for cross-platform compat)
    PROJECT_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    success(f"Written to {PROJECT_ENV}")

    # Also write to ~/.config/friday/ for installed builds
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    success(f"Written to {CONFIG_ENV}")

# ─── Install dependencies ─────────────────────────────────────────────────────
def install_deps():
    section("Installing Python Dependencies")
    info("Running: uv sync (this may take a minute)...")
    try:
        subprocess.run(
            ["uv", "sync"],
            cwd=str(PROJECT_ROOT),
            check=True
        )
        success("Python dependencies installed.")
    except subprocess.CalledProcessError as e:
        error(f"uv sync failed (exit code {e.returncode}).")
        warn("You may need to run manually: uv sync")
    except FileNotFoundError:
        error("uv not found. Install it: https://docs.astral.sh/uv/")

def install_node_deps():
    section("Installing Electron Dependencies")
    orb_dir = PROJECT_ROOT / "mark-orb"
    if not orb_dir.exists():
        warn("mark-orb directory not found — skipping Electron deps.")
        return
    if not shutil.which("npm"):
        warn("npm not found — skipping Electron deps.")
        return
    info("Running: npm install (in mark-orb/)...")
    try:
        subprocess.run(
            ["npm", "install"],
            cwd=str(orb_dir),
            check=True
        )
        success("Electron dependencies installed.")
    except subprocess.CalledProcessError as e:
        error(f"npm install failed (exit code {e.returncode}).")

# ─── Main ──────────────────────────────────────────────────────────────────────
def main():
    clear()
    banner()

    # Check if already configured
    if CONFIG_ENV.exists():
        info("Existing configuration found.")
        if not prompt_yn("Reconfigure from scratch?", default=False):
            print(f"\n  {GREEN}Setup skipped. Existing config preserved.{RESET}\n")
            return

    # Prereqs
    if not check_python():
        sys.exit(1)
    uv_ok = check_uv()
    check_node()

    # Provider selection
    print()
    choice = prompt_choice("Which AI provider do you want to use?", [
        f"{BOLD}Gemini{RESET} (Cloud) — requires API key, recommended",
        f"{BOLD}Ollama{RESET} (Local) — requires Ollama running in background",
    ])

    config = {}
    if choice == 1:
        config = setup_gemini()
    else:
        config = setup_ollama()

    if not config:
        error("Setup incomplete — no provider configured.")
        sys.exit(1)

    # Email (optional)
    config.update(setup_email())

    # Write config
    write_env(config)

    # Install deps
    if uv_ok:
        install_deps()
    install_node_deps()

    # Done
    print(f"""
{GREEN}{BOLD}╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   {GREEN}Setup complete!{RESET}{GREEN}{BOLD}                                           ║
║                                                              ║
║   To launch F.R.I.D.A.Y.:                                    ║
║                                                              ║
║     {CYAN}macOS / Linux:{RESET}  ./launch.sh                             ║
║     {CYAN}Windows:{RESET}        launch.bat                              ║
║                                                              ║
║   Or manually:                                               ║
║     {DIM}cd mark-orb && npm run dev{RESET}                               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")


if __name__ == "__main__":
    main()
