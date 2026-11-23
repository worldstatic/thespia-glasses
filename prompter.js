/* World Static Teleprompter helpers.
   Script storage, segment parsing, and export/import (JSON or plain text).
*/
(function (root) {
  "use strict";

  const STORAGE_KEY = "thespia.hud.prompter";
  const TITLE_MAX = 80;
  const BODY_MAX = 8000;
  const MAX_SCRIPTS = 30;
  const FONT_SIZES = [28, 36, 44, 56];
  const SPEEDS = [18, 28, 40, 56, 72];

  const DEFAULT_SCRIPT_BODY = [
    "## Intro 2m",
    "Hey everyone, welcome back to the stream. Today we're jumping into some game dev, and I'll talk through the work as I go.",
    "",
    "## Today's plan 3m",
    "First I'll recap what we finished last time. Then we'll build the next piece, test it, and I'll take questions at the end.",
    "",
    "## Outro 1m",
    "Thanks for hanging out. If you want to follow along, I'll be back again soon. Take care, and I'll see you in the next one.",
  ].join("\n");

  let idSeq = 0;

  function newId(prefix) {
    idSeq += 1;
    return prefix + "-" + Date.now() + "-" + idSeq;
  }

  function parseDuration(text) {
    const raw = String(text || "").trim().toLowerCase();
    if (!raw) return null;
    const clock = raw.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (clock) {
      if (clock[3] != null) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
      return Number(clock[1]) * 60 + Number(clock[2]);
    }
    const parts = raw.match(
      /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?)?)?(?:\s*)(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?(?:\s*)(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?)?$/
    );
    if (!parts || (!parts[1] && !parts[2] && !parts[3])) return null;
    const hours = parts[1] ? Number(parts[1]) : 0;
    const minutes = parts[2] ? Number(parts[2]) : 0;
    const seconds = parts[3] ? Number(parts[3]) : 0;
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  function parseSegmentHeading(raw) {
    const text = String(raw || "").trim();
    if (!text) return { title: "Segment", targetSeconds: null };
    const tokens = text.split(/\s+/);
    for (let count = Math.min(3, tokens.length - 1); count >= 1; count -= 1) {
      const dur = parseDuration(tokens.slice(tokens.length - count).join(" "));
      if (dur != null) {
        const title = tokens.slice(0, tokens.length - count).join(" ").trim() || "Segment";
        return { title, targetSeconds: dur };
      }
    }
    return { title: text, targetSeconds: null };
  }

  function parseSegments(body) {
    const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
    const segments = [];
    let current = null;
    const buffer = [];

    function flush() {
      if (!current) return;
      current.text = buffer.join("\n").replace(/^\n+|\n+$/g, "");
      current.body = current.text;
      segments.push(current);
      buffer.length = 0;
    }

    for (const line of lines) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) {
        flush();
        const parsed = parseSegmentHeading(heading[1]);
        current = {
          title: parsed.title,
          targetSeconds: parsed.targetSeconds,
          text: "",
          body: "",
        };
      } else if (current) {
        buffer.push(line);
      } else {
        current = { title: "Start", targetSeconds: null, text: "", body: "" };
        buffer.push(line);
      }
    }
    flush();

    const trimmed = String(body || "").trim();
    if (!segments.length && trimmed) {
      return [{ title: "Script", targetSeconds: null, text: trimmed, body: trimmed }];
    }
    if (segments.length === 1 && segments[0].title === "Start") {
      segments[0].title = "Script";
    }
    if (segments.length && segments[0].title === "Start" && !String(segments[0].text || "").trim()) {
      segments.shift();
    }
    return segments;
  }

  function formatTimer(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    }
    return minutes + ":" + String(secs).padStart(2, "0");
  }

  function clampFontSize(value) {
    const number = Number(value);
    if (FONT_SIZES.indexOf(number) >= 0) return number;
    let best = FONT_SIZES[1];
    let gap = Infinity;
    for (const size of FONT_SIZES) {
      const diff = Math.abs(size - number);
      if (diff < gap) {
        gap = diff;
        best = size;
      }
    }
    return best;
  }

  function clampSpeed(value) {
    const number = Number(value);
    if (SPEEDS.indexOf(number) >= 0) return number;
    let best = SPEEDS[1];
    let gap = Infinity;
    for (const speed of SPEEDS) {
      const diff = Math.abs(speed - number);
      if (diff < gap) {
        gap = diff;
        best = speed;
      }
    }
    return best;
  }

  function nextValue(list, current, direction) {
    const index = list.indexOf(current);
    const start = index < 0 ? 0 : index;
    const next = Math.max(0, Math.min(list.length - 1, start + direction));
    return list[next];
  }

  function normalizeScript(item) {
    if (!item) return null;
    const title = String(item.title || "").trim().slice(0, TITLE_MAX);
    const body = String(item.body || "").trim().slice(0, BODY_MAX);
    if (!title && !body) return null;
    return {
      id: String(item.id || newId("script")),
      title: title || "Untitled script",
      body,
    };
  }

  function defaultScript() {
    return {
      id: newId("script"),
      title: "Stream intro",
      body: DEFAULT_SCRIPT_BODY,
    };
  }

  function emptyData() {
    return { version: 1, fontSize: 36, speed: 28, scripts: [] };
  }

  function seedData() {
    const data = emptyData();
    data.scripts = [defaultScript()];
    return data;
  }

  function normalizeData(parsed) {
    if (!parsed || typeof parsed !== "object") return emptyData();
    const scripts = Array.isArray(parsed.scripts)
      ? parsed.scripts.map(normalizeScript).filter(Boolean).slice(0, MAX_SCRIPTS)
      : [];
    const seen = new Set();
    for (const script of scripts) {
      if (seen.has(script.id)) script.id = newId("script");
      seen.add(script.id);
    }
    return {
      version: 1,
      fontSize: clampFontSize(parsed.fontSize),
      speed: clampSpeed(parsed.speed),
      scripts,
    };
  }

  function load(storage) {
    storage = storage || root.localStorage;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { data: seedData(), seeded: true };
      return { data: normalizeData(JSON.parse(raw)), seeded: false };
    } catch (err) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (_ignored) {}
      return { data: seedData(), seeded: true };
    }
  }

  function save(data, storage) {
    storage = storage || root.localStorage;
    const normalized = normalizeData(data);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { ok: true, data: normalized };
    } catch (err) {
      return { ok: false, data: normalized, message: "Could not save on this device." };
    }
  }

  function loadAndPersist(storage) {
    storage = storage || root.localStorage;
    const result = load(storage);
    if (result.seeded) save(result.data, storage);
    return result.data;
  }

  function scriptById(data, id) {
    return ((data && data.scripts) || []).find((script) => script.id === id) || null;
  }

  function addScript(data, fields) {
    if (data.scripts.length >= MAX_SCRIPTS) return { ok: false, message: "Script limit reached." };
    const script = normalizeScript({
      id: newId("script"),
      title: (fields && fields.title) || "Untitled script",
      body: (fields && fields.body) || "",
    });
    if (!script) return { ok: false, message: "Enter a title or some script text." };
    data.scripts.unshift(script);
    return { ok: true, script, data };
  }

  function updateScript(data, scriptId, patch) {
    const script = scriptById(data, scriptId);
    if (!script) return { ok: false, message: "Script not found." };
    const next = normalizeScript({ ...script, ...(patch || {}), id: script.id });
    if (!next) return { ok: false, message: "Enter a title or some script text." };
    const index = data.scripts.findIndex((item) => item.id === scriptId);
    data.scripts[index] = next;
    return { ok: true, script: next, data };
  }

  function deleteScript(data, scriptId) {
    const index = ((data && data.scripts) || []).findIndex((item) => item.id === scriptId);
    if (index < 0) return { ok: false, message: "Script not found." };
    data.scripts.splice(index, 1);
    return { ok: true, data };
  }

  function setFontSize(data, value) {
    data.fontSize = clampFontSize(value);
    return data.fontSize;
  }

  function setSpeed(data, value) {
    data.speed = clampSpeed(value);
    return data.speed;
  }

  function nudgeFontSize(data, direction) {
    data.fontSize = nextValue(FONT_SIZES, clampFontSize(data.fontSize), direction);
    return data.fontSize;
  }

  function nudgeSpeed(data, direction) {
    data.speed = nextValue(SPEEDS, clampSpeed(data.speed), direction);
    return data.speed;
  }

  function exportBlob(data) {
    const normalized = normalizeData(data);
    return JSON.stringify(
      { version: 1, fontSize: normalized.fontSize, speed: normalized.speed, scripts: normalized.scripts },
      null,
      2
    );
  }

  function importBlob(text, data) {
    const raw = String(text || "").trim();
    if (!raw) return { ok: false, message: "Paste JSON or a plain-text script first.", data };

    const current = normalizeData(data);
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      parsed = null;
    }

    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.scripts)) {
        const incoming = normalizeData(parsed);
        const byId = new Map(current.scripts.map((script) => [script.id, script]));
        let imported = 0;
        for (const script of incoming.scripts.reverse()) {
          if (byId.has(script.id)) {
            const index = current.scripts.findIndex((item) => item.id === script.id);
            current.scripts[index] = script;
            imported += 1;
          } else if (current.scripts.length < MAX_SCRIPTS) {
            current.scripts.unshift(script);
            imported += 1;
          }
        }
        if (parsed.fontSize) current.fontSize = clampFontSize(parsed.fontSize);
        if (parsed.speed) current.speed = clampSpeed(parsed.speed);
        return { ok: true, message: "Imported scripts on this device.", data: current, imported };
      }
      if (parsed.title || parsed.body) {
        const script = normalizeScript(parsed);
        if (!script) return { ok: false, message: "That script was empty.", data: current };
        if (current.scripts.length >= MAX_SCRIPTS) return { ok: false, message: "Script limit reached.", data: current };
        script.id = newId("script");
        current.scripts.unshift(script);
        return { ok: true, message: "Imported a script on this device.", data: current, imported: 1 };
      }
      return { ok: false, message: "JSON needs a scripts list or a title and body.", data: current };
    }

    if (current.scripts.length >= MAX_SCRIPTS) return { ok: false, message: "Script limit reached.", data: current };
    const firstLine = raw.split(/\n/)[0].replace(/^#+\s*/, "").trim().slice(0, TITLE_MAX);
    const script = normalizeScript({
      id: newId("script"),
      title: firstLine || "Imported script",
      body: raw.slice(0, BODY_MAX),
    });
    current.scripts.unshift(script);
    return { ok: true, message: "Imported a plain-text script on this device.", data: current, imported: 1 };
  }

  const api = {
    STORAGE_KEY,
    TITLE_MAX,
    BODY_MAX,
    FONT_SIZES,
    SPEEDS,
    DEFAULT_SCRIPT_BODY,
    parseDuration,
    parseSegmentHeading,
    parseSegments,
    formatTimer,
    clampFontSize,
    clampSpeed,
    defaultScript,
    emptyData,
    seedData,
    normalizeData,
    normalizeScript,
    load,
    save,
    loadAndPersist,
    scriptById,
    addScript,
    updateScript,
    deleteScript,
    setFontSize,
    setSpeed,
    nudgeFontSize,
    nudgeSpeed,
    exportBlob,
    importBlob,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticPrompter = api;
})(typeof window !== "undefined" ? window : globalThis);
