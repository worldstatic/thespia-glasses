/* Color scheme and font preferences for World Static.
   Stored on this device only. Palettes are for an additive 600x600 display:
   the canvas stays black; only accent, outline, and text colors change.
*/
(function (root) {
  "use strict";

  const THEME_KEY = "thespia.hud.theme";
  const FONT_KEY = "thespia.hud.font";
  const DEFAULT_THEME = "cyan";
  const DEFAULT_FONT = "rajdhani";

  const THEMES = [
    { id: "cyan", title: "Cyan", accent: "#7ee0ff", text: "#d8f4ff", textStrong: "#f2fbff", muted: "#9ecbda", mutedDim: "#6f9eac" },
    { id: "amber", title: "Amber", accent: "#ffb86b", text: "#ffe4bf", textStrong: "#fff3e0", muted: "#d4b48a", mutedDim: "#a8885e" },
    { id: "green", title: "Green", accent: "#8cff9a", text: "#d4ffd8", textStrong: "#edffee", muted: "#9ed4a4", mutedDim: "#6fa376" },
    { id: "magenta", title: "Magenta", accent: "#ff7ad9", text: "#ffd4f2", textStrong: "#ffeaf8", muted: "#d49cc6", mutedDim: "#a86e99" },
    { id: "white", title: "White", accent: "#f5f5f5", text: "#f5f5f5", textStrong: "#ffffff", muted: "#bdbdbd", mutedDim: "#8d8d8d" },
  ];

  const FONTS = [
    { id: "rajdhani", title: "HUD" },
    { id: "inter", title: "Sans" },
    { id: "mono", title: "Mono" },
    { id: "system", title: "System" },
  ];

  function allowed(list, id, fallback) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return id;
    }
    return fallback;
  }

  function read(key, fallback) {
    try {
      const value = root.localStorage && root.localStorage.getItem(key);
      return value || fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, value);
    } catch (_err) {
      /* ignore quota */
    }
  }

  function loadTheme() {
    return allowed(THEMES, read(THEME_KEY, DEFAULT_THEME), DEFAULT_THEME);
  }

  function loadFont() {
    return allowed(FONTS, read(FONT_KEY, DEFAULT_FONT), DEFAULT_FONT);
  }

  function apply(themeId, fontId) {
    const theme = allowed(THEMES, themeId, loadTheme());
    const font = allowed(FONTS, fontId, loadFont());
    const doc = root.document;
    if (!doc || !doc.documentElement) return { theme: theme, font: font };
    doc.documentElement.setAttribute("data-theme", theme);
    doc.documentElement.setAttribute("data-font", font);
    const meta = doc.querySelector && doc.querySelector('meta[name="theme-color"]');
    if (meta) {
      const preset = THEMES.filter((item) => item.id === theme)[0];
      if (preset) meta.setAttribute("content", preset.accent);
    }
    return { theme: theme, font: font };
  }

  function saveTheme(id) {
    const theme = allowed(THEMES, id, DEFAULT_THEME);
    write(THEME_KEY, theme);
    return apply(theme, loadFont());
  }

  function saveFont(id) {
    const font = allowed(FONTS, id, DEFAULT_FONT);
    write(FONT_KEY, font);
    return apply(loadTheme(), font);
  }

  function boot() {
    return apply(loadTheme(), loadFont());
  }

  const api = {
    THEME_KEY: THEME_KEY,
    FONT_KEY: FONT_KEY,
    DEFAULT_THEME: DEFAULT_THEME,
    DEFAULT_FONT: DEFAULT_FONT,
    THEMES: THEMES,
    FONTS: FONTS,
    loadTheme: loadTheme,
    loadFont: loadFont,
    saveTheme: saveTheme,
    saveFont: saveFont,
    apply: apply,
    boot: boot,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticTheme = api;
  if (root.document) boot();
})(typeof window !== "undefined" ? window : globalThis);
