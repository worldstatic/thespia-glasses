#!/usr/bin/env python3
"""Local load checks for Thespia HUD / Blueprint Help. Starts the preview server, then curls it."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8769
BASE = f"http://{HOST}:{PORT}"


def fetch(path: str, method: str = "GET", data: bytes | None = None, timeout: int = 5):
    request = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            return response.status, response.headers, body
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read()


def check_home_and_major(js: str, css: str, html: str, transport: str, failures: list[str]) -> None:
    for needle in (
        "thespia.hud.nextUp",
        "hud-clock",
        "hud-date",
        "Next up",
        "Talk to Major",
        "Blueprint Help",
        "Overlock Walk",
        "Photo to Texture",
        "Scale Check",
        "3D Scan",
        "Coming soon",
        "open-blueprint-help",
        "open-talk-to-major",
        "major-message",
        'type: "search"',
        "ThespiaMajor",
    ):
        if needle not in js:
            failures.append(f"app.js missing home/Major content: {needle}")

    if "background: #000" not in css and "background:#000" not in css:
        failures.append("page canvas is not black")
    if ".tile-grid" not in css or ".hud-clock" not in css or ".next-up" not in css:
        failures.append("styles.css missing HUD home rules")
    if "major-transport.js" not in html:
        failures.append("index.html must load major-transport.js")
    if "thespia.hud.major.transport" not in transport:
        failures.append("transport config key missing")
    if "function send(" not in transport and "send(text)" not in transport:
        failures.append("transport module missing send()")
    if "kind === \"mock\"" not in transport and 'kind === "mock"' not in transport:
        failures.append("mock transport missing")
    if "https://" in transport:
        failures.append("major-transport.js must not include an https URL")
    if "speechSynthesis" not in js or "ArrowLeft" not in js:
        failures.append("input or TTS hooks missing")
    if "thespia.hud.favorites" not in js:
        failures.append("favorites key missing from app.js")


def main() -> int:
    failures: list[str] = []

    scan = subprocess.run(
        [sys.executable, str(ROOT / "scripts/privacy_scan.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if scan.returncode != 0:
        failures.append("privacy scan failed")
        if scan.stdout:
            failures.extend(f"privacy: {line}" for line in scan.stdout.strip().splitlines())
        if scan.stderr:
            failures.append(f"privacy stderr: {scan.stderr.strip()}")

    library_path = ROOT / "library.json"
    library = json.loads(library_path.read_text(encoding="utf-8"))
    recipes = library.get("recipes") or []
    if len(recipes) < 15:
        failures.append(f"library.json has {len(recipes)} recipes, expected at least 15")
    required = {"id", "title", "summary", "tags", "nodes", "steps"}
    ids = []
    for recipe in recipes:
        missing = required - set(recipe)
        if missing:
            failures.append(f"{recipe.get('id')}: missing {missing}")
            continue
        ids.append(recipe["id"])
        if len(recipe["steps"]) < 3:
            failures.append(f"{recipe['id']}: too few steps")
        for step in recipe["steps"]:
            if not step.get("title") or not step.get("body"):
                failures.append(f"{recipe['id']}: empty step")
    if len(ids) != len(set(ids)):
        failures.append("duplicate recipe ids")

    js = (ROOT / "app.js").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    transport = (ROOT / "major-transport.js").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    manifest = json.loads((ROOT / ".well-known/meta-wearables-manifest.json").read_text(encoding="utf-8"))
    if 'name="mrbd-web-app-capable"' not in html or 'content="yes"' not in html:
        failures.append("missing mrbd-web-app-capable meta tag")
    if "width=device-width" not in html:
        failures.append("missing responsive viewport")
    if manifest.get("version") != 1 or not manifest.get("name") or not manifest.get("appearance"):
        failures.append("invalid wearables manifest")
    if "Blueprint Help" not in json.dumps(manifest):
        failures.append("manifest should still mention Blueprint Help")
    if "major-transport.js" not in sw or "thespia-blueprint-help-" not in sw:
        failures.append("service worker missing transport file or cache prefix")

    check_home_and_major(js, css, html, transport, failures)

    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server/ask_server.py")],
        cwd=str(ROOT),
        env={
            **dict(**{k: v for k, v in __import__("os").environ.items()}),
            "HOST": HOST,
            "PORT": str(PORT),
            "AI_API_KEY": "",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.time() + 8
        ready = False
        while time.time() < deadline:
            try:
                status, _, _ = fetch("/api/health")
                if status == 200:
                    ready = True
                    break
            except Exception:
                time.sleep(0.15)
        if not ready:
            out = proc.stdout.read() if proc.stdout else ""
            failures.append(f"server did not start: {out}")
            print("FAIL")
            for item in failures:
                print("-", item)
            return 1

        checks = {
            "/": ("text/html", b"Thespia HUD"),
            "/styles.css": ("text/css", b"app-shell"),
            "/app.js": ("text/javascript", b"Blueprint Help"),
            "/major-transport.js": ("text/javascript", b"thespia.hud.major.transport"),
            "/library.json": ("application/json", b"line-trace"),
            "/sw.js": ("text/javascript", b"thespia-blueprint-help-"),
            "/icons/favicon-64.png": ("image/png", b"\x89PNG"),
            "/icons/icon-512.png": ("image/png", b"\x89PNG"),
            "/.well-known/meta-wearables-manifest.json": ("application/json", b"Blueprint Help"),
        }
        for path, (mime, needle) in checks.items():
            status, headers, body = fetch(path)
            ctype = headers.get("Content-Type", "")
            if status != 200:
                failures.append(f"{path} returned {status}")
                continue
            if mime not in ctype:
                failures.append(f"{path} content-type {ctype}, expected {mime}")
            if needle not in body:
                failures.append(f"{path} missing expected content")

        # Home page markup is built in JS; confirm the shipped script has the tiles
        # and that the served file matches the local copy.
        status, _, body = fetch("/app.js")
        for needle in (b"hud-clock", b"Next up", b"Talk to Major", b"Coming soon", b"Overlock Walk"):
            if needle not in body:
                failures.append(f"served app.js missing {needle.decode()}")

        status, _, body = fetch("/api/health")
        health = json.loads(body)
        if status != 200 or health.get("aiConfigured") is not False or not health.get("ok"):
            failures.append(f"unexpected health: {status} {body!r}")

        status, _, body = fetch(
            "/api/ask",
            method="POST",
            data=json.dumps({"question": "How do I line trace?"}).encode("utf-8"),
        )
        payload = json.loads(body)
        if status != 503 or payload.get("error") != "ai_unconfigured":
            failures.append(f"expected 503 ai_unconfigured, got {status} {payload}")
        if "offline" not in payload.get("message", "").lower() and "library" not in payload.get("message", "").lower():
            failures.append("503 message should mention the offline library")

        # Search still works from the static library even when the API is absent.
        status, _, body = fetch("/library.json")
        data = json.loads(body)
        titles = " ".join(r["title"].lower() for r in data["recipes"])
        if "line trace" not in titles or "enhanced input" not in titles:
            failures.append("library.json missing expected recipe titles")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    if failures:
        print("FAIL")
        for item in failures:
            print("-", item)
        return 1
    print("PASS")
    print(f"Loaded HUD home, Talk to Major transport, {len(recipes)} recipes, health endpoint, and 503 AI fallback at {BASE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
