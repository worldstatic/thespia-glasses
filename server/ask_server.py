#!/usr/bin/env python3
"""Local preview server for Thespia Blueprint Help.

Serves the static Web App and an optional /api/ask helper.
The app works fully offline from library.json when AI_API_KEY is unset.
Does not deploy or send anything except the explicit AI request the user
opts into by setting AI_API_KEY.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))
AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()
AI_BASE_URL = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """You are a Unreal Engine 5.6 Blueprint tutor.
The user builds a game called Thespia in UE 5.6 using Blueprints only. Never use C++.
Reply with JSON only, no markdown, in this exact shape:
{"title":"short title","nodes":["Exact Node Name"],"steps":[{"title":"short title","body":"one or two short sentences"}]}
Rules:
- Use exact UE 5.6 Blueprint node names (for example Line Trace By Channel, Add Mapping Context, Spawn Actor from Class, Cast To, Interact (Message), Set Timer by Event, Create Widget, Launch Character).
- One node or short action per step.
- 4 to 8 steps.
- Each step body must be under 280 characters.
- Keep titles short enough for a 600x600 wearable display.
- If the question is not about Unreal Blueprints, still answer only with the same JSON and say so in the first step.
"""

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}


def load_dotenv() -> None:
    path = Path(__file__).resolve().parent / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def json_bytes(payload: dict, status: int = 200) -> tuple[int, bytes]:
    body = json.dumps(payload).encode("utf-8")
    return status, body


def extract_json(text: str) -> dict:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("AI response was not an object")
    steps = data.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("AI response had no steps")
    title = str(data.get("title") or "Blueprint steps")
    nodes = data.get("nodes") if isinstance(data.get("nodes"), list) else []
    clean_steps = []
    for step in steps[:8]:
        if not isinstance(step, dict):
            continue
        clean_steps.append(
            {
                "title": str(step.get("title") or "Step")[:80],
                "body": str(step.get("body") or "")[:400],
            }
        )
    if not clean_steps:
        raise ValueError("AI response had no usable steps")
    return {"title": title[:120], "nodes": [str(n) for n in nodes[:16]], "steps": clean_steps}


def ask_model(question: str) -> dict:
    if not AI_API_KEY:
        raise RuntimeError("unconfigured")
    payload = {
        "model": AI_MODEL,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
    }
    request = urllib.request.Request(
        f"{AI_BASE_URL}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AI_API_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"upstream_{err.code}: {detail[:200]}") from err
    choices = raw.get("choices") or []
    content = ""
    if choices:
        content = ((choices[0] or {}).get("message") or {}).get("content") or ""
    return extract_json(content)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def guess_type(self, path):
        ext = Path(path).suffix.lower()
        if ext in MIME:
            return MIME[ext]
        return super().guess_type(path)

    def write_json(self, payload: dict, status: int = 200) -> None:
        status, body = json_bytes(payload, status)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/health":
            self.write_json(
                {
                    "ok": True,
                    "aiConfigured": bool(AI_API_KEY),
                    "model": AI_MODEL if AI_API_KEY else None,
                }
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/ask":
            self.write_json({"error": "not_found"}, 404)
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length > 20_000:
            self.write_json({"error": "too_large", "message": "Question is too long."}, 413)
            return
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.write_json({"error": "bad_json", "message": "Request must be JSON."}, 400)
            return
        question = str((data or {}).get("question") or "").strip()
        if not question:
            self.write_json({"error": "missing_question", "message": "Provide a question."}, 400)
            return
        if not AI_API_KEY:
            self.write_json(
                {
                    "error": "ai_unconfigured",
                    "message": "Set AI_API_KEY to enable AI answers. The app still works offline from the library.",
                },
                503,
            )
            return
        try:
            result = ask_model(question)
        except Exception as err:  # noqa: BLE001 — surface a safe client message
            self.write_json(
                {
                    "error": "ai_failed",
                    "message": "The AI helper could not answer. Use the offline library instead.",
                },
                502,
            )
            sys.stderr.write(f"ask_model failed: {err}\n")
            return
        self.write_json(result)


def main() -> int:
    load_dotenv()
    global HOST, PORT, AI_API_KEY, AI_BASE_URL, AI_MODEL
    HOST = os.environ.get("HOST", HOST)
    PORT = int(os.environ.get("PORT", str(PORT)))
    AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()
    AI_BASE_URL = os.environ.get("AI_BASE_URL", AI_BASE_URL).rstrip("/")
    AI_MODEL = os.environ.get("AI_MODEL", AI_MODEL)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = "AI enabled" if AI_API_KEY else "offline library only (AI_API_KEY not set)"
    print(f"Blueprint Help preview: http://{HOST}:{PORT}/")
    print(f"Health: http://{HOST}:{PORT}/api/health  ({mode})")
    print("This is a local preview server. It is not public HTTPS hosting for the glasses.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
