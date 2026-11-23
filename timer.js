/* World Static timer helpers.
   Stopwatch, countdown, and a simple focus session stay in localStorage
   on this device. Nothing is uploaded.
*/
(function (root) {
  "use strict";

  const STORAGE_KEY = "thespia.hud.timer";
  const MODES = ["stopwatch", "countdown", "focus"];
  const COUNTDOWN_PRESETS = [5, 10, 15, 25];
  const FOCUS_MINUTES = 25;
  const BREAK_MINUTES = 5;
  const CUSTOM_MAX = 180;

  function ymd(date) {
    const value = date || new Date();
    return (
      value.getFullYear() +
      "-" +
      String(value.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(value.getDate()).padStart(2, "0")
    );
  }

  function clampMinutes(value) {
    const n = Math.round(Number(value) || 0);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(CUSTOM_MAX, n);
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
    }
    return String(minutes) + ":" + String(seconds).padStart(2, "0");
  }

  function blank(now) {
    return {
      version: 1,
      mode: "stopwatch",
      running: false,
      startedAt: 0,
      elapsedMs: 0,
      durationMs: COUNTDOWN_PRESETS[0] * 60 * 1000,
      lastCountdownMin: COUNTDOWN_PRESETS[0],
      focusPhase: "focus",
      focusSessions: 0,
      focusDay: ymd(now || new Date()),
    };
  }

  function normalize(parsed, now) {
    const base = blank(now);
    if (!parsed || typeof parsed !== "object") return base;
    const mode = MODES.indexOf(parsed.mode) >= 0 ? parsed.mode : "stopwatch";
    const lastCountdownMin = clampMinutes(parsed.lastCountdownMin) || COUNTDOWN_PRESETS[0];
    const durationMs = Math.max(1000, Number(parsed.durationMs) || lastCountdownMin * 60 * 1000);
    const today = ymd(now || new Date());
    const sameDay = parsed.focusDay === today;
    return {
      version: 1,
      mode,
      running: Boolean(parsed.running),
      startedAt: Number(parsed.startedAt) || 0,
      elapsedMs: Math.max(0, Number(parsed.elapsedMs) || 0),
      durationMs,
      lastCountdownMin,
      focusPhase: parsed.focusPhase === "break" ? "break" : "focus",
      focusSessions: sameDay ? Math.max(0, Number(parsed.focusSessions) || 0) : 0,
      focusDay: today,
    };
  }

  function snapshot(data, now) {
    const current = normalize(data, now);
    const then = now || new Date();
    const ts = then.getTime();
    if (current.running && current.startedAt) {
      current.elapsedMs += Math.max(0, ts - current.startedAt);
      current.startedAt = ts;
    }
    if (current.mode !== "stopwatch") {
      if (current.elapsedMs >= current.durationMs) {
        current.elapsedMs = current.durationMs;
        current.running = false;
        current.startedAt = 0;
      }
    }
    return current;
  }

  function displayMs(data, now) {
    const current = snapshot(data, now);
    if (current.mode === "stopwatch") return current.elapsedMs;
    return Math.max(0, current.durationMs - current.elapsedMs);
  }

  function isDone(data, now) {
    const current = snapshot(data, now);
    return current.mode !== "stopwatch" && current.elapsedMs >= current.durationMs;
  }

  function setMode(data, mode, now) {
    const current = snapshot(data, now);
    const nextMode = MODES.indexOf(mode) >= 0 ? mode : current.mode;
    current.mode = nextMode;
    current.running = false;
    current.startedAt = 0;
    current.elapsedMs = 0;
    if (nextMode === "countdown") {
      current.durationMs = (current.lastCountdownMin || COUNTDOWN_PRESETS[0]) * 60 * 1000;
    }
    if (nextMode === "focus") {
      current.focusPhase = "focus";
      current.durationMs = FOCUS_MINUTES * 60 * 1000;
    }
    return current;
  }

  function setCountdown(data, minutes, now) {
    const current = snapshot(data, now);
    const value = clampMinutes(minutes);
    if (value == null) return { ok: false, message: "Enter minutes.", data: current };
    current.mode = "countdown";
    current.lastCountdownMin = value;
    current.durationMs = value * 60 * 1000;
    current.elapsedMs = 0;
    current.running = false;
    current.startedAt = 0;
    return { ok: true, data: current };
  }

  function start(data, now) {
    const current = snapshot(data, now);
    if (isDone(current, now)) {
      current.elapsedMs = 0;
    }
    if (!current.running) {
      current.running = true;
      current.startedAt = (now || new Date()).getTime();
    }
    return current;
  }

  function pause(data, now) {
    const current = snapshot(data, now);
    current.running = false;
    current.startedAt = 0;
    return current;
  }

  function toggle(data, now) {
    const current = snapshot(data, now);
    return current.running ? pause(current, now) : start(current, now);
  }

  function reset(data, now) {
    const current = snapshot(data, now);
    current.running = false;
    current.startedAt = 0;
    current.elapsedMs = 0;
    if (current.mode === "focus") {
      current.focusPhase = "focus";
      current.durationMs = FOCUS_MINUTES * 60 * 1000;
    }
    if (current.mode === "countdown") {
      current.durationMs = (current.lastCountdownMin || COUNTDOWN_PRESETS[0]) * 60 * 1000;
    }
    return current;
  }

  function completeFocus(data, now) {
    const current = snapshot(data, now);
    const today = ymd(now || new Date());
    if (current.focusDay !== today) {
      current.focusDay = today;
      current.focusSessions = 0;
    }
    if (current.focusPhase === "focus") {
      current.focusSessions += 1;
      current.focusPhase = "break";
      current.durationMs = BREAK_MINUTES * 60 * 1000;
    } else {
      current.focusPhase = "focus";
      current.durationMs = FOCUS_MINUTES * 60 * 1000;
    }
    current.elapsedMs = 0;
    current.running = false;
    current.startedAt = 0;
    current.mode = "focus";
    return current;
  }

  function skipPhase(data, now) {
    return completeFocus(data, now);
  }

  function load(storage, now) {
    const store = storage || root.localStorage;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return blank(now);
      return snapshot(normalize(JSON.parse(raw), now), now);
    } catch (_err) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch (_ignored) {}
      return blank(now);
    }
  }

  function save(data, storage, now) {
    const next = snapshot(data, now);
    const store = storage || root.localStorage;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_err) {
      console.warn("Could not save the timer on this device.");
    }
    return next;
  }

  const api = {
    STORAGE_KEY,
    MODES,
    COUNTDOWN_PRESETS,
    FOCUS_MINUTES,
    BREAK_MINUTES,
    CUSTOM_MAX,
    clampMinutes,
    formatClock,
    blank,
    normalize,
    snapshot,
    displayMs,
    isDone,
    setMode,
    setCountdown,
    start,
    pause,
    toggle,
    reset,
    completeFocus,
    skipPhase,
    load,
    save,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticTimer = api;
})(typeof window !== "undefined" ? window : globalThis);
