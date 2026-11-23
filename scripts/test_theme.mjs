#!/usr/bin/env node
/* Color scheme and font preference tests. No personal data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const theme = require(join(dirname(fileURLToPath(import.meta.url)), "..", "theme.js"));

test("defaults are cyan and the HUD (Rajdhani) font", () => {
  assert.equal(theme.DEFAULT_THEME, "cyan");
  assert.equal(theme.DEFAULT_FONT, "rajdhani");
  assert.equal(theme.THEMES.length, 5);
  assert.deepEqual(theme.THEMES.map((item) => item.id), ["cyan", "amber", "green", "magenta", "white"]);
  assert.deepEqual(theme.FONTS.map((item) => item.id), ["rajdhani", "inter", "mono", "system"]);
});

test("saveTheme and saveFont persist allowed ids and reject unknown ones", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };
  theme.saveTheme("amber");
  theme.saveFont("mono");
  assert.equal(theme.loadTheme(), "amber");
  assert.equal(theme.loadFont(), "mono");
  theme.saveTheme("not-a-theme");
  theme.saveFont("comic-sans");
  assert.equal(theme.loadTheme(), "cyan");
  assert.equal(theme.loadFont(), "rajdhani");
});

test("each scheme has a tinted text color; White stays white; time uses a brighter shade", () => {
  assert.ok(theme.THEMES.every((item) => item.text && item.textStrong && item.muted));
  const white = theme.THEMES.find((item) => item.id === "white");
  assert.equal(white.text.toLowerCase(), "#f5f5f5");
  assert.equal(white.textStrong.toLowerCase(), "#ffffff");
  for (const item of theme.THEMES) {
    if (item.id === "white") continue;
    assert.notEqual(item.text.toLowerCase(), "#f5f5f5");
    assert.notEqual(item.text.toLowerCase(), "#ffffff");
    assert.notEqual(item.textStrong.toLowerCase(), item.text.toLowerCase());
  }
});

test("styles.css applies per-scheme text tokens to body, clock, and date", () => {
  const fs = require("node:fs");
  const css = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");
  assert.match(css, /\.hud-clock[^{]*\{[^}]*color:\s*var\(--text-strong\)/s);
  assert.match(css, /\.hud-date[^{]*\{[^}]*color:\s*var\(--text-strong\)/s);
  assert.match(css, /body\s*\{[^}]*color:\s*var\(--text\)/s);
  for (const item of theme.THEMES) {
    assert.ok(css.includes(item.text), "styles.css missing text token " + item.text + " for " + item.id);
    assert.ok(css.includes(item.textStrong), "styles.css missing textStrong token " + item.textStrong + " for " + item.id);
  }
});
