#!/usr/bin/env python3
"""Scan shipped glasses-app files for secrets and personal data.

This is a local check. It does not upload anything. Fail the scan if
keys, emails, customer data, or private files appear in files that
would be published with the static app.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Only files that would ship in a public GitHub Pages repo are scanned.
SHIP_GLOBS = [
    "index.html",
    "app.js",
    "major-transport.js",
    "scale.js",
    "tasks.js",
    "funds.js",
    "prompter.js",
    "focus-nav.js",
    "theme.js",
    "styles.css",
    "fonts/**/*.md",
    "fonts/**/*.txt",
    "sw.js",
    "library.json",
    "scale-library.json",
    "manifest.webmanifest",
    "icons/logo.svg",
    "README.md",
    "docs/**/*.md",
    ".gitignore",
    ".nojekyll",
    ".well-known/**",
    "server/ask_server.py",
    "server/.env.example",
    "scripts/*.py",
]

SKIP_DIR_PARTS = {".git", "node_modules", "__pycache__", ".venv", "venv"}

# Official product or documentation hosts that may appear in comments and docs.
ALLOWED_EMAIL_DOMAINS = {
    "example.com",
    "example.org",
    "example.net",
    "indiantypefoundry.com",  # official Rajdhani OFL copyright contact
}

# Placeholder local-part values allowed with mail.grokbot.com in design docs.
ALLOWED_LOCAL_PARTS = {
    "you",
    "yourname",
    "name",
    "username",
    "placeholder",
    "example",
}

SECRET_PATTERNS = [
    ("private_key", re.compile(r"BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY")),
    ("github_pat", re.compile(r"ghp_[A-Za-z0-9]{20,}")),
    ("github_fine_grained", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("openai_key", re.compile(r"sk-(?:proj-|live-|test-)?[A-Za-z0-9]{16,}")),
    ("cursor_routine_key", re.compile(r"crsr_[A-Za-z0-9]{16,}")),
    ("aws_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("bearer_jwt", re.compile(r"Bearer\s+eyJ[A-Za-z0-9_-]{20,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
]

# Hard-coded live service endpoints must not be baked into the client.
# Design docs may describe a routine's "POST to" field without pasting a host.
FORBIDDEN_HOSTS = [
    re.compile(r"api2\.cursor\.sh", re.I),
    re.compile(r"hooks\.slack\.com", re.I),
]

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.I)
HEX_SECRET = re.compile(r"\b[a-f0-9]{40,}\b", re.I)

# Known documentation or example strings that are not secrets.
HEX_ALLOW = {
    "4fc3f7",  # theme color may appear without hash in some checks
}


def iter_ship_files() -> list[Path]:
    found: set[Path] = set()
    for pattern in SHIP_GLOBS:
        for path in ROOT.glob(pattern):
            if not path.is_file():
                continue
            if any(part in SKIP_DIR_PARTS for part in path.parts):
                continue
            found.add(path)
    return sorted(found)


def is_allowed_email(address: str) -> bool:
    local, _, domain = address.partition("@")
    domain = domain.lower()
    local = local.lower()
    if domain in ALLOWED_EMAIL_DOMAINS:
        return True
    if domain == "mail.grokbot.com" and local in ALLOWED_LOCAL_PARTS:
        return True
    return False


def scan_text(path: Path, text: str) -> list[str]:
    hits: list[str] = []
    rel = path.relative_to(ROOT).as_posix()

    if path.name == ".env" or path.name.endswith(".pem") or path.name.endswith(".key"):
        hits.append(f"{rel}: secret-looking filename must not be shipped")

    if path.suffix.lower() == ".csv":
        hits.append(f"{rel}: CSV files must not be shipped (possible work/customer data)")

    for label, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            hits.append(f"{rel}: possible {label}")

    # Client code must not hard-code a remote API host. Docs may discuss
    # official product domains in prose, but not a pasteable secret URL.
    if path.suffix in {".js", ".html", ".css"}:
        for pattern in FORBIDDEN_HOSTS:
            if pattern.search(text):
                hits.append(f"{rel}: forbidden live host in client code")

    for match in EMAIL_RE.finditer(text):
        address = match.group(0)
        if not is_allowed_email(address):
            hits.append(f"{rel}: email address {address}")

    # Avoid shipping long hex blobs that look like tokens. Theme colors and
    # short hashes are fine; 40+ hex is flagged unless clearly a comment color.
    if path.suffix in {".js", ".html", ".json"}:
        for match in HEX_SECRET.finditer(text):
            value = match.group(0).lower()
            if value in HEX_ALLOW:
                continue
            # Allow uuid-looking values only if they are clearly documentation.
            hits.append(f"{rel}: long hex string that looks like a secret")

    return hits


def main() -> int:
    failures = scan_repo()
    if failures:
        print("PRIVACY SCAN FAIL")
        for item in failures:
            print("-", item)
        return 1
    files = iter_ship_files()
    print("PRIVACY SCAN PASS")
    print(f"Checked {len(files)} shipped files; no keys, emails, or personal data found.")
    return 0


def scan_repo() -> list[str]:
    failures: list[str] = []
    # Guard against accidentally adding private files at the repo root.
    for unexpected in ROOT.glob("*"):
        if unexpected.suffix.lower() in {".csv", ".pem", ".key"} or unexpected.name == ".env":
            failures.append(f"{unexpected.name}: must not sit in the app folder")

    files = iter_ship_files()
    if not files:
        failures.append("no shipped files found")
        return failures

    required = ["app.js", "major-transport.js", "index.html", "styles.css"]
    present = {path.relative_to(ROOT).as_posix() for path in files}
    for name in required:
        if name not in present:
            failures.append(f"missing required file {name}")

    transport = (ROOT / "major-transport.js").read_text(encoding="utf-8") if (ROOT / "major-transport.js").is_file() else ""
    if "thespia.hud.major.transport" not in transport:
        failures.append("major-transport.js must keep config in a localStorage key")
    if re.search(r"https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}", transport):
        failures.append("major-transport.js must not hard-code an https URL")

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Binary icons are not in SHIP_GLOBS as raw png content; skip binaries.
            continue
        failures.extend(scan_text(path, text))
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
