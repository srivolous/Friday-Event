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
PYTHON_BIN = sys.executable  # Default, overridden by check_python()

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
def check_python():
    section("Python Check")
    # Search for Python 3.11+ — check common versioned names first
    found_bin = None
    found_ver = None
    for name in ["python3.13", "python3.12", "python3.11", "python3", "python"]:
        try:
            import shutil
            path = shutil.which(name)
            if not path:
                continue
            import subprocess
            out = subprocess.check_output([path, "--version"], text=True, stderr=subprocess.STDOUT).strip()
            # Parse "Python 3.13.14" → (3, 13, 14)
            ver_str = out.replace("Python", "").strip()
            parts = ver_str.split(".")
            major, minor = int(parts[0]), int(parts[1])
            if major == 3 and minor >= 11:
                found_bin = path
                found_ver = f"{major}.{minor}.{parts[2] if len(parts) > 2 else '0'}"
                break
        except Exception:
            continue

    if found_bin:
        success(f"Python {found_ver} — OK ({found_bin})")
        # Make this the python for the rest of setup
        import shutil as _shutil
        global PYTHON_BIN
        PYTHON_BIN = found_bin
        return True

    error("Python 3.11+ not found.")
    info("Install: https://www.python.org/downloads/")
    info("After install, run: brew link python3  (if using Homebrew)")
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
    node = shutil.which("node") or shutil.which("node.exe")
    if node:
        try:
            ver = subprocess.check_output([node, "--version"], text=True,
                shell=(platform.system() == "Windows")).strip()
            success(f"Node.js {ver} — OK")
            return True
        except Exception:
            pass
    warn("Node.js not found (needed for Electron app).")
    info("Install: https://nodejs.org/")
    return prompt_yn("Continue without Node.js? (can build later)", default=True)

# ─── Provider setup ───────────────────────────────────────────────────────────
def _validate_gemini_key(key):
    """Validate a Gemini API key. Returns (ok: bool, message: str)."""
    import urllib.request
    import urllib.error
    import ssl

    # Try multiple validation approaches
    endpoints = [
        # Standard Gemini API key endpoint
        f"https://generativelanguage.googleapis.com/v1beta/models?key={key}",
        # Alternative: try a lightweight model call
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}",
    ]

    # Create SSL context that works on all platforms
    ctx = ssl.create_default_context()

    for url in endpoints:
        try:
            if "generateContent" in url:
                # POST request with minimal payload
                data = json.dumps({"contents": [{"parts": [{"text": "hi"}]}]}).encode()
                req = urllib.request.Request(url, data=data, method="POST",
                    headers={"Content-Type": "application/json"})
            else:
                req = urllib.request.Request(url, method="GET")

            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                if resp.status == 200:
                    return True, "API key validated."
                return True, f"Key accepted (HTTP {resp.status})."

        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")
            except Exception:
                pass

            if e.code == 400:
                # 400 often means bad request format, not necessarily bad key
                if "API_KEY_INVALID" in body or "invalid" in body.lower():
                    return False, "API key is invalid."
                # Could be the endpoint format, try next
                continue
            elif e.code == 403:
                # 403 = key exists but lacks permission — still usable
                if "API_KEY_INVALID" in body:
                    return False, "API key is invalid."
                return True, "Key valid but may lack some permissions. Continuing."
            elif e.code == 429:
                return True, "Key valid (rate limited on validation, but usable)."
            elif e.code in (500, 502, 503):
                # Server error — key might be fine, endpoint is down
                continue
            else:
                # For other errors, try next endpoint
                continue

        except (urllib.error.URLError, TimeoutError, OSError) as e:
            # Network error — can't validate, but key might work
            continue

    # All endpoints failed — try a completely different approach: DNS check
    try:
        import socket
        socket.getaddrinfo("generativelanguage.googleapis.com", 443, timeout=5)
        # DNS resolves but API calls failed — key might be wrong format
        return None, "Could not reach Gemini API. Check your internet connection."
    except (socket.gaierror, OSError):
        return None, "No internet connection. Key will be saved but not validated."

def setup_gemini():
    section("Gemini API Setup")
    info("Get your API key at: https://aistudio.google.com/apikey")
    info("Standard keys start with 'AIza...'")
    print()

    # Check if there's already a key in .env
    existing_key = ""
    if PROJECT_ENV.exists():
        for line in PROJECT_ENV.read_text().splitlines():
            if line.strip().startswith("GOOGLE_API_KEY="):
                existing_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

    if existing_key:
        if existing_key.startswith("AIza"):
            info(f"Existing key found: {existing_key[:8]}...{existing_key[-4:]}")
            if not prompt_yn("Replace with a new key?", default=False):
                print(f"\n  {GREEN}Keeping existing key.{RESET}")
                return {"GOOGLE_API_KEY": existing_key, "GEMINI_MODEL": "gemini-2.0-flash"}
        else:
            warn(f"Existing key ({existing_key[:12]}...) is not a valid Gemini API key.")
            info("Valid keys start with 'AIza'.")

    key = prompt_input("Gemini API Key", hidden=True)
    if not key:
        error("No API key provided. Gemini setup cancelled.")
        return {}

    print(f"\n  {DIM}Validating key (this may take a moment)...{RESET}")
    ok, msg = _validate_gemini_key(key)

    if ok is True:
        success(msg)
    elif ok is False:
        error(msg)
        if not prompt_yn("Use this key anyway?", default=False):
            return {}
    else:
        # None = couldn't validate (network issue)
        warn(msg)
        info("Saving key anyway — it will be validated when Friday starts.")

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

    # Check connectivity — try with ollama lib if available, else use urllib
    print(f"\n  {DIM}Checking Ollama connectivity...{RESET}")
    try:
        try:
            import ollama as _ollama
            host = url.replace("http://", "").replace("https://", "")
            client = _ollama.Client(host=f"http://{host}" if "://" not in url else url)
            client.list()
        except ImportError:
            # ollama lib not installed yet — use raw HTTP
            import urllib.request
            test_url = url.rstrip("/") + "/api/tags"
            req = urllib.request.Request(test_url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                pass  # If we get here, Ollama is reachable
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

    # Merge with existing .env if present — preserve all existing values
    existing = {}
    env_path = PROJECT_ENV
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                # Strip quotes AND leading/trailing whitespace from values
                existing[k.strip()] = v.strip().strip('"').strip("'").strip()

    # Apply new config (only non-empty values)
    for k, v in config.items():
        if v:
            existing[k] = v

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

    content = "\n".join(lines) + "\n"

    # Write to project root
    try:
        PROJECT_ENV.write_text(content, encoding="utf-8")
        success(f"Written to {PROJECT_ENV}")
    except Exception as e:
        error(f"Failed to write {PROJECT_ENV}: {e}")

    # Also write to ~/.config/friday/ for installed builds
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_ENV.write_text(content, encoding="utf-8")
        success(f"Written to {CONFIG_ENV}")
    except Exception as e:
        warn(f"Could not write to {CONFIG_ENV}: {e}")

# ─── Install dependencies ─────────────────────────────────────────────────────
def install_deps():
    section("Installing Python Dependencies")
    uv = shutil.which("uv") or shutil.which("uv.exe")
    if not uv:
        error("uv not found. Install it: https://docs.astral.sh/uv/")
        return
    info("Running: uv sync (this may take a minute)...")
    try:
        result = subprocess.run(
            [uv, "sync"],
            cwd=str(PROJECT_ROOT),
            shell=(platform.system() == "Windows")
        )
        if result.returncode == 0:
            success("Python dependencies installed.")
        else:
            error(f"uv sync failed (exit code {result.returncode}).")
            warn("You may need to run manually: uv sync")
    except FileNotFoundError:
        error("uv not found. Install it: https://docs.astral.sh/uv/")
    except KeyboardInterrupt:
        warn("Interrupted.")
    except Exception as e:
        error(f"Unexpected error during install: {e}")

def install_node_deps():
    section("Installing Electron Dependencies")
    orb_dir = PROJECT_ROOT / "mark-orb"
    if not orb_dir.exists():
        warn("mark-orb directory not found — skipping Electron deps.")
        return
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        warn("npm not found — skipping Electron deps.")
        return

    # Already installed?
    if (orb_dir / "node_modules").exists() and (orb_dir / "node_modules" / ".package-lock.json").exists():
        success("Electron dependencies already installed.")
        return

    info("Running: npm install (in mark-orb/)...")
    try:
        result = subprocess.run(
            [npm, "install"],
            cwd=str(orb_dir),
            capture_output=True, text=True,
            shell=(platform.system() == "Windows")
        )
        # npm exits non-zero on audit vulnerabilities even when install succeeded
        # Check if node_modules actually exists instead of trusting exit code
        if (orb_dir / "node_modules").exists():
            success("Electron dependencies installed.")
            if result.returncode != 0 and result.stderr:
                warn("Some npm audit warnings (non-critical, install succeeded).")
        else:
            error("npm install failed.")
            if result.stderr:
                err_lines = result.stderr.strip().splitlines()
                for line in err_lines[-5:]:
                    print(f"    {DIM}{line}{RESET}")
    except FileNotFoundError:
        warn("npm not found — skipping Electron deps.")
    except Exception as e:
        error(f"Unexpected error during npm install: {e}")

# ─── Main ──────────────────────────────────────────────────────────────────────
def main():
    try:
        clear()
        banner()

        # Check if already configured — detect incomplete/broken configs
        has_config = CONFIG_ENV.exists() or PROJECT_ENV.exists()
        has_gemini = False
        has_ollama = False
        if has_config:
            env_path = CONFIG_ENV if CONFIG_ENV.exists() else PROJECT_ENV
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("GOOGLE_API_KEY="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    # Valid Gemini keys start with AIza
                    has_gemini = val.startswith("AIza")
                if line.startswith("OLLAMA_URL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    has_ollama = bool(val)

        if has_config and (has_gemini or has_ollama):
            info("Existing configuration found.")
            if not prompt_yn("Reconfigure provider or settings?", default=False):
                print(f"\n  {GREEN}Setup skipped. Existing config preserved.{RESET}\n")
                return
        elif has_config:
            warn("Existing config has no valid provider. Let's set one up.")

        # Prereqs — Python is mandatory, uv and node are nice-to-have
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

        # Email (optional — don't fail if user cancels)
        try:
            config.update(setup_email())
        except (KeyboardInterrupt, EOFError):
            warn("Skipping email setup.")

        # Write config
        write_env(config)

        # Install deps (optional — warn but don't fail)
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

    except KeyboardInterrupt:
        print(f"\n\n  {YELLOW}Setup cancelled by user.{RESET}\n")
        sys.exit(0)
    except Exception as e:
        error(f"Unexpected error: {e}")
        info("You can re-run setup.py to try again.")
        sys.exit(1)


if __name__ == "__main__":
    main()
