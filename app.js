/* Thespia HUD / Blueprint Help
   Meta Ray-Ban Display Web App. Directional input arrives as Arrow keys + Enter.
   Web Apps cannot use the microphone; text fields open the on-glasses composer
   (handwriting, dictation, keyboard) on firmware v127+ / Meta AI app v272+.
*/

(function () {
  "use strict";

  const HOME_STATE = { screen: "home" };
  const FAVORITES_KEY = "thespia.hud.favorites";
  const NEXT_UP_KEY = "thespia.hud.nextUp";
  const API_ASK = "./api/ask";
  const API_HEALTH = "./api/health";
  const NEXT_UP_MAX = 120;

  const APP_TILES = [
    {
      id: "blueprint",
      title: "Blueprint Help",
      sub: "UE 5.6 node-by-node steps",
      screen: "help",
      available: true,
      buttonId: "open-blueprint-help",
    },
    {
      id: "major",
      title: "Talk to Major",
      sub: "Message your assistant",
      screen: "major",
      available: true,
      buttonId: "open-talk-to-major",
    },
    { id: "overlock", title: "Overlock Walk", sub: "Coming soon", available: false },
    { id: "texture", title: "Photo to Texture", sub: "Coming soon", available: false },
    { id: "scale", title: "Scale Check", sub: "Coming soon", available: false },
    { id: "scan", title: "3D Scan", sub: "Coming soon", available: false },
  ];

  const app = document.getElementById("app");
  const previewHint = document.querySelector(".preview-hint");

  /** @type {{version:number, engine:string, mode:string, recipes:Array} | null} */
  let library = null;
  let aiConfigured = false;
  let lastFocusSelector = null;
  let clockTimer = null;

  if (previewHint) previewHint.hidden = false;

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "className") node.className = value;
        else if (key === "dataset") Object.assign(node.dataset, value);
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === "attrs") {
          for (const [name, attr] of Object.entries(value)) {
            if (attr != null && attr !== false) node.setAttribute(name, attr === true ? "" : String(attr));
          }
        } else {
          node[key] = value;
        }
      }
    }
    if (children) {
      for (const child of children) {
        if (child == null || child === false) continue;
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  function currentState() {
    return history.state && history.state.screen ? history.state : HOME_STATE;
  }

  function navigate(state, { push = true } = {}) {
    const next = { ...state };
    if (push) {
      try {
        history.pushState(next, "");
      } catch (err) {
        history.replaceState(next, "");
      }
    } else {
      history.replaceState(next, "");
    }
    render(next);
  }

  function goHome() {
    navigate(HOME_STATE);
  }

  function goBack() {
    if (history.state && history.state.screen && history.state.screen !== "home") {
      history.back();
      return;
    }
    navigate(HOME_STATE, { push: false });
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return { libraryIds: [], custom: [] };
      const parsed = JSON.parse(raw);
      return {
        libraryIds: Array.isArray(parsed.libraryIds) ? parsed.libraryIds : [],
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      };
    } catch (err) {
      try {
        localStorage.removeItem(FAVORITES_KEY);
      } catch (_ignored) {}
      return { libraryIds: [], custom: [] };
    }
  }

  function saveFavorites(favs) {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
      return true;
    } catch (err) {
      console.warn("Could not save favorites:", err);
      return false;
    }
  }

  const RECIPE_TITLE_MAX = 80;
  const STEP_TITLE_MAX = 80;
  const STEP_BODY_MAX = 400;
  const MAX_CUSTOM_RECIPES = 50;
  const MAX_CUSTOM_STEPS = 20;
  let customIdSeq = 0;

  function newCustomId() {
    customIdSeq += 1;
    return `user-${Date.now()}-${customIdSeq}`;
  }

  function normalizeStep(step) {
    if (!step) return null;
    const title = String(step.title || "").trim().slice(0, STEP_TITLE_MAX);
    const body = String(step.body || "").trim().slice(0, STEP_BODY_MAX);
    if (!title && !body) return null;
    return { title: title || "Step", body };
  }

  function normalizeCustomRecipe(item) {
    if (!item || typeof item !== "object") return null;
    const title = String(item.title || "").trim().slice(0, RECIPE_TITLE_MAX);
    if (!title) return null;
    const steps = (Array.isArray(item.steps) ? item.steps : []).map(normalizeStep).filter(Boolean);
    if (!steps.length) return null;
    const rawId = String(item.id || "").trim();
    const id = rawId || newCustomId();
    const origin = item.origin === "ai" || id.startsWith("ai-") ? "ai" : "user";
    return {
      id,
      title,
      summary: String(item.summary || "Your recipe").trim().slice(0, 160) || "Your recipe",
      steps,
      source: "custom",
      origin,
      nodes: Array.isArray(item.nodes)
        ? item.nodes.map((node) => String(node).trim().slice(0, 80)).filter(Boolean).slice(0, 12)
        : [],
    };
  }

  function listCustomRecipes() {
    return loadFavorites().custom.map(normalizeCustomRecipe).filter(Boolean);
  }

  function getCustomRecipe(id) {
    return listCustomRecipes().find((recipe) => recipe.id === id) || null;
  }

  function customLabel(recipe) {
    if (!recipe) return "Your recipe";
    if (recipe.origin === "ai" || String(recipe.id || "").startsWith("ai-")) return "Saved answer";
    return "Your recipe";
  }

  function upsertCustomRecipe(recipe) {
    const normalized = normalizeCustomRecipe(recipe);
    if (!normalized) return { ok: false, reason: "invalid", recipe: null };
    const favs = loadFavorites();
    const index = favs.custom.findIndex((item) => item && item.id === normalized.id);
    if (index >= 0) {
      favs.custom[index] = normalized;
    } else {
      if (favs.custom.length >= MAX_CUSTOM_RECIPES) return { ok: false, reason: "full", recipe: null };
      favs.custom.unshift(normalized);
    }
    const ok = saveFavorites(favs);
    return { ok, reason: ok ? "" : "storage", recipe: normalized };
  }

  function deleteCustomRecipe(id) {
    const favs = loadFavorites();
    const next = favs.custom.filter((item) => !(item && item.id === id));
    if (next.length === favs.custom.length) return false;
    favs.custom = next;
    return saveFavorites(favs);
  }

  function exportCustomRecipesBlob() {
    return JSON.stringify({ version: 1, recipes: listCustomRecipes() }, null, 2);
  }

  function importCustomRecipesBlob(text) {
    let data;
    try {
      data = JSON.parse(String(text || "").trim());
    } catch (_err) {
      return { ok: false, imported: 0, message: "That backup is not valid JSON." };
    }
    const list = Array.isArray(data)
      ? data
      : data && Array.isArray(data.recipes)
        ? data.recipes
        : null;
    if (!list) return { ok: false, imported: 0, message: "No recipes found in that backup." };
    const favs = loadFavorites();
    let imported = 0;
    for (const item of list) {
      const normalized = normalizeCustomRecipe(item);
      if (!normalized) continue;
      const index = favs.custom.findIndex((row) => row && row.id === normalized.id);
      if (index >= 0) favs.custom[index] = normalized;
      else {
        if (favs.custom.length >= MAX_CUSTOM_RECIPES) break;
        favs.custom.unshift(normalized);
      }
      imported += 1;
    }
    if (!imported) return { ok: false, imported: 0, message: "No usable recipes in that backup." };
    const ok = saveFavorites(favs);
    return {
      ok,
      imported,
      message: ok
        ? `Imported ${imported} recipe${imported === 1 ? "" : "s"}.`
        : "Could not save on this device.",
    };
  }

  function blankEditorState(overrides) {
    return {
      screen: "recipe-editor",
      phase: "title",
      editId: null,
      title: "",
      steps: [],
      editingStep: null,
      notice: "",
      noticeKind: "",
      ...overrides,
    };
  }

  function openNewRecipe() {
    navigate(blankEditorState());
  }

  function openEditRecipe(recipe) {
    const stored = recipe && recipe.id ? getCustomRecipe(recipe.id) : null;
    const source = stored || recipe || {};
    const steps = (source.steps || []).map(normalizeStep).filter(Boolean);
    navigate(
      blankEditorState({
        editId: source.id || null,
        title: source.title || "",
        steps,
        phase: "title",
      })
    );
  }

  function loadNextUp() {
    try {
      const raw = localStorage.getItem(NEXT_UP_KEY);
      return raw ? String(raw).trim().slice(0, NEXT_UP_MAX) : "";
    } catch (err) {
      return "";
    }
  }

  function saveNextUp(text) {
    const value = String(text || "").trim().slice(0, NEXT_UP_MAX);
    try {
      if (value) localStorage.setItem(NEXT_UP_KEY, value);
      else localStorage.removeItem(NEXT_UP_KEY);
      return true;
    } catch (err) {
      console.warn("Could not save Next up on this device.");
      return false;
    }
  }

  function recipeById(id) {
    return library && library.recipes ? library.recipes.find((r) => r.id === id) : null;
  }

  function allFavoriteRecipes() {
    const favs = loadFavorites();
    const fromLibrary = favs.libraryIds.map(recipeById).filter(Boolean);
    return { fromLibrary, custom: favs.custom, favs };
  }

  function isFavorite(recipe) {
    const favs = loadFavorites();
    if (recipe.source === "custom") {
      return favs.custom.some((item) => item.id === recipe.id);
    }
    return favs.libraryIds.includes(recipe.id);
  }

  function toggleFavorite(recipe) {
    const favs = loadFavorites();
    if (recipe.source === "custom") {
      const index = favs.custom.findIndex((item) => item.id === recipe.id);
      if (index >= 0) favs.custom.splice(index, 1);
      else {
        favs.custom.unshift({
          id: recipe.id,
          title: recipe.title,
          summary: recipe.summary || "",
          steps: recipe.steps,
          source: "custom",
          origin: recipe.origin || (String(recipe.id || "").startsWith("ai-") ? "ai" : "user"),
          nodes: recipe.nodes || [],
        });
      }
    } else if (favs.libraryIds.includes(recipe.id)) {
      favs.libraryIds = favs.libraryIds.filter((id) => id !== recipe.id);
    } else {
      favs.libraryIds.unshift(recipe.id);
    }
    return saveFavorites(favs);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9+\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreRecipe(recipe, query) {
    const q = normalize(query);
    if (!q) return 0;
    let score = 0;
    const title = normalize(recipe.title);
    const summary = normalize(recipe.summary);
    const tags = (recipe.tags || []).map(normalize);
    const nodes = (recipe.nodes || []).map(normalize);
    if (title === q) score += 20;
    if (title.includes(q) || q.includes(title)) score += 10;
    for (const tag of tags) {
      if (q.includes(tag) || tag.includes(q)) score += 5;
    }
    for (const node of nodes) {
      if (q.includes(node) || node.includes(q)) score += 6;
    }
    const stepText = normalize(
      (recipe.steps || []).map((step) => `${step.title || ""} ${step.body || ""}`).join(" ")
    );
    for (const word of q.split(" ")) {
      if (word.length < 3) continue;
      if (title.includes(word)) score += 3;
      if (summary.includes(word)) score += 1;
      if (stepText.includes(word)) score += 1;
      if (tags.some((tag) => tag.includes(word) || word.includes(tag))) score += 2;
      if (nodes.some((node) => node.includes(word) || word.includes(node))) score += 2;
    }
    return score;
  }

  function searchLibrary(query) {
    const builtIn = library && Array.isArray(library.recipes) ? library.recipes : [];
    const pool = [...listCustomRecipes(), ...builtIn];
    return pool
      .map((recipe) => ({ recipe, score: scoreRecipe(recipe, query) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function canSpeak() {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  function speak(text) {
    if (!canSpeak()) return false;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onerror = (event) => {
        console.warn("Speech failed:", event.error);
      };
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      console.warn("Speech failed:", err);
      return false;
    }
  }

  function formatTime(now) {
    try {
      return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch (_err) {
      let hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const suffix = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      return `${hours}:${minutes} ${suffix}`;
    }
  }

  function formatDate(now) {
    try {
      return now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch (_err) {
      return now.toDateString();
    }
  }

  function tickClock() {
    const timeEl = document.getElementById("hud-clock");
    const dateEl = document.getElementById("hud-date");
    if (!timeEl || !dateEl) {
      stopClock();
      return;
    }
    const now = new Date();
    timeEl.textContent = formatTime(now);
    dateEl.textContent = formatDate(now);
  }

  function stopClock() {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function startClock() {
    stopClock();
    tickClock();
    clockTimer = setInterval(tickClock, 10000);
  }

  function header(eyebrow, title, meta) {
    return el("header", { className: "screen-header" }, [
      eyebrow ? el("p", { className: "eyebrow", text: eyebrow }) : null,
      el("h1", { text: title }),
      meta ? el("p", { className: "meta", text: meta }) : null,
    ]);
  }

  function homeButton() {
    return el("button", { type: "button", className: "secondary", id: "go-home", onClick: goHome }, "Home");
  }

  function recipeButton(recipe, sourceLabel) {
    return el(
      "button",
      {
        type: "button",
        className: "tile",
        onClick: () => openRecipe(recipe),
      },
      [
        el("span", { className: "tile-title", text: recipe.title }),
        el("span", {
          className: "tile-sub",
          text: sourceLabel ? `${sourceLabel} · ${recipe.summary || ""}` : recipe.summary || "",
        }),
      ]
    );
  }

  function screen(children, extraClass) {
    return el("section", { className: extraClass ? `screen ${extraClass}` : "screen" }, children);
  }

  function openTile(tile) {
    if (!tile.available) {
      navigate({ screen: "coming-soon", title: tile.title, appId: tile.id });
      return;
    }
    if (tile.screen === "major") {
      navigate({ screen: "major", cardIndex: 0, cards: [], query: "" });
      return;
    }
    navigate({ screen: tile.screen });
  }

  function renderHome() {
    const now = new Date();
    const nextUp = loadNextUp();
    const tiles = APP_TILES.map((tile) =>
      el(
        "button",
        {
          type: "button",
          className: tile.available ? (tile.id === "blueprint" ? "tile primary" : "tile") : "tile soon",
          id: tile.buttonId || `open-${tile.id}`,
          dataset: { soon: tile.available ? "false" : "true" },
          onClick: () => openTile(tile),
        },
        [
          el("span", { className: "tile-title", text: tile.title }),
          el("span", { className: "tile-sub", text: tile.sub }),
        ]
      )
    );

    return screen(
      [
        el("header", { className: "screen-header hud-header" }, [
          el("p", { className: "eyebrow", text: "Thespia" }),
          el("h1", { id: "hud-clock", className: "hud-clock", text: formatTime(now) }),
          el("p", { id: "hud-date", className: "hud-date", text: formatDate(now) }),
        ]),
        el("div", { className: "content stack" }, [
          el(
            "button",
            {
              type: "button",
              className: "next-up",
              id: "next-up",
              onClick: () => navigate({ screen: "next-up", value: nextUp }),
            },
            [
              el("span", { className: "next-up-label", text: "Next up" }),
              el("span", {
                className: "next-up-text",
                text: nextUp || "Tap to set your next task",
              }),
            ]
          ),
          el("div", { className: "tile-grid", attrs: { role: "list" } }, tiles),
        ]),
      ],
      "hud-home"
    );
  }

  function renderNextUp(state) {
    const value = state.value != null ? state.value : loadNextUp();
    const notice = state.notice || "";
    return screen([
      header("Home", "Next up", "Saved on this device only"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "next-up-input", text: "What should show on your home screen?" }),
          el("input", {
            id: "next-up-input",
            type: "search",
            name: "next-up",
            autocomplete: "off",
            placeholder: "Write or speak a short task",
            value,
            attrs: { enterkeyhint: "done", maxlength: String(NEXT_UP_MAX), spellcheck: "true" },
          }),
          el("p", {
            className: "hint",
            text: "On glasses, activate this field to dictate. This stays in local storage on the device.",
          }),
        ]),
        notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-next-up", onClick: saveNextUpFromForm }, "Save"),
        el("button", { type: "button", className: "secondary", onClick: clearNextUpFromForm }, "Clear"),
        homeButton(),
      ]),
    ]);
  }

  function saveNextUpFromForm() {
    const input = document.getElementById("next-up-input");
    const value = input && input.value ? input.value.trim() : "";
    const ok = saveNextUp(value);
    navigate(
      {
        screen: "next-up",
        value,
        notice: ok ? (value ? "Saved on this device." : "Cleared.") : "Could not save on this device.",
        noticeKind: ok ? "ok" : "error",
      },
      { push: false }
    );
    if (ok) {
      setTimeout(() => navigate(HOME_STATE), 450);
    }
  }

  function clearNextUpFromForm() {
    saveNextUp("");
    navigate({ screen: "next-up", value: "", notice: "Cleared.", noticeKind: "ok" }, { push: false });
  }

  function renderComingSoon(state) {
    const title = state.title || "This app";
    return screen([
      header("Thespia", title, "Coming soon"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", {
            className: "step-body",
            text: `${title} is on the list, but it is not built yet. Blueprint Help and Talk to Major are ready to try.`,
          }),
        ]),
      ]),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }

  function majorApi() {
    return window.ThespiaMajor || null;
  }

  function renderMajor(state) {
    const api = majorApi();
    const cards = state.cards || [];
    const index = Math.max(0, Math.min(Math.max(cards.length - 1, 0), state.cardIndex || 0));
    const card = cards[index];
    const query = state.query || "";
    const pending = Boolean(state.pending);
    const notice = state.notice || "";
    const status = api ? api.statusLabel() : "Talk to Major is unavailable.";
    const hint = api
      ? "On glasses, activate the field to dictate. Web Apps cannot use the microphone directly."
      : "The transport module did not load. Refresh the app.";

    let panel;
    if (pending) {
      panel = el("article", { className: "step-card", id: "major-card" }, [
        el("p", { className: "step-index", text: "Sending" }),
        el("h2", { text: "Please wait" }),
        el("p", { className: "step-body", text: "Your message is on its way." }),
      ]);
    } else if (card) {
      panel = el(
        "article",
        {
          className: "step-card",
          tabIndex: 0,
          id: "major-card",
          attrs: { "aria-label": `Reply ${index + 1} of ${cards.length}` },
        },
        [
          el("p", { className: "step-index", text: `Reply ${index + 1} of ${cards.length}` }),
          el("h2", { text: card.title || "Reply" }),
          el("p", { className: "step-body", text: card.body || "" }),
        ]
      );
    } else {
      panel = el("article", { className: "step-card", id: "major-card" }, [
        el("p", { className: "step-index", text: "Talk to Major" }),
        el("h2", { text: "Ask Major" }),
        el("p", {
          className: "step-body",
          text: "Type or dictate a short message, then send. Preview replies work now. Live replies need a bridge you add in Settings.",
        }),
      ]);
    }

    return screen(
      [
        header("Thespia", "Talk to Major", status),
        el("div", { className: "content stack" }, [
          panel,
          notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "major-message", text: "Message" }),
            el("input", {
              id: "major-message",
              type: "search",
              name: "major-message",
              autocomplete: "off",
              placeholder: "Write or speak a message",
              value: query,
              disabled: pending,
              attrs: { enterkeyhint: "send", spellcheck: "true" },
            }),
            el("p", { className: "hint", text: hint }),
            el(
              "button",
              {
                type: "button",
                className: "primary",
                id: "major-send",
                disabled: pending || !api,
                onClick: () => submitMajorMessage(),
              },
              pending ? "Sending…" : "Send"
            ),
          ]),
        ]),
        el("div", { className: "footer" }, [
          canSpeak()
            ? el("button", { type: "button", className: "secondary", id: "major-speak", onClick: speakMajorCard }, "Speak")
            : null,
          el(
            "button",
            {
              type: "button",
              className: "secondary",
              id: "major-settings",
              onClick: () => navigate({ screen: "major-settings" }),
            },
            "Settings"
          ),
          homeButton(),
        ]),
      ],
      "major-screen"
    );
  }

  function updateMajorCard(state, index, { speakCard = false } = {}) {
    const cards = state.cards || [];
    if (!cards.length) return;
    const nextIndex = Math.max(0, Math.min(cards.length - 1, index));
    const next = { ...state, cardIndex: nextIndex };
    history.replaceState(next, "");
    render(next);
    if (speakCard) speakMajorFromState(next);
  }

  function speakMajorFromState(state) {
    const cards = state.cards || [];
    const card = cards[state.cardIndex || 0];
    if (!card) return false;
    return speak(`${card.title}. ${card.body}`);
  }

  function speakMajorCard() {
    const state = currentState();
    if (!speakMajorFromState(state)) {
      const next = { ...state, notice: "Text to speech is not available here.", noticeKind: "error" };
      history.replaceState(next, "");
      render(next);
    }
  }

  async function submitMajorMessage() {
    const api = majorApi();
    const input = document.getElementById("major-message");
    const query = input && input.value ? input.value.trim() : "";
    const base = { screen: "major", query, cards: currentState().cards || [], cardIndex: currentState().cardIndex || 0 };
    if (!api) {
      navigate({ ...base, notice: "The transport module did not load.", noticeKind: "error" }, { push: false });
      return;
    }
    if (!query) {
      navigate({ ...base, notice: "Type or dictate a message first.", noticeKind: "error" }, { push: false });
      return;
    }
    navigate({ ...base, pending: true, notice: "", cards: [], cardIndex: 0 }, { push: false });
    const result = await api.send(query);
    if (result && result.error) {
      navigate(
        {
          screen: "major",
          query,
          pending: false,
          cards: [],
          cardIndex: 0,
          notice: result.error,
          noticeKind: "error",
        },
        { push: false }
      );
      return;
    }
    navigate(
      {
        screen: "major",
        query: "",
        pending: false,
        cards: (result && result.cards) || [],
        cardIndex: 0,
        notice: result && result.source === "mock" ? "Preview only. Nothing left this device." : "",
        noticeKind: result && result.source === "mock" ? "ok" : "",
      },
      { push: false }
    );
  }

  function renderMajorSettings() {
    const api = majorApi();
    const config = api ? api.loadConfig() : { kind: "mock", endpoint: "", pollUrl: "", token: "" };
    return screen([
      header("Talk to Major", "Settings", "Stored on this device only"),
      el("div", { className: "content stack" }, [
        el("p", {
          className: "hint",
          text: "Preview mode works with no account. A live bridge URL is optional and is never stored in the app's source.",
        }),
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "major-kind", text: "Reply source" }),
          (function () {
            const select = el(
              "select",
              { id: "major-kind", className: "field-select" },
              [
                el("option", { value: "mock", text: "Preview (on this device)" }),
                el("option", { value: "http", text: "HTTPS bridge I control" }),
              ]
            );
            select.value = config.kind === "http" ? "http" : "mock";
            return select;
          })(),
        ]),
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "major-endpoint", text: "Bridge URL (optional)" }),
          el("input", {
            id: "major-endpoint",
            type: "text",
            name: "major-endpoint",
            autocomplete: "off",
            placeholder: "Paste an HTTPS URL you control",
            value: config.endpoint || "",
            attrs: { enterkeyhint: "next", spellcheck: "false" },
          }),
          el("label", { htmlFor: "major-poll", text: "Poll URL (optional)" }),
          el("input", {
            id: "major-poll",
            type: "text",
            name: "major-poll",
            autocomplete: "off",
            placeholder: "Optional. Use {id} where the request id goes",
            value: config.pollUrl || "",
            attrs: { enterkeyhint: "next", spellcheck: "false" },
          }),
          el("label", { htmlFor: "major-token", text: "Device token (optional)" }),
          el("input", {
            id: "major-token",
            type: "text",
            name: "major-token",
            autocomplete: "off",
            placeholder: "Kept on this device, never in the repo",
            value: config.token || "",
            attrs: { enterkeyhint: "done", spellcheck: "false" },
          }),
        ]),
        el("p", {
          className: "hint",
          text: "Do not paste work data, passwords, or personal files here. A live bridge must allow this app's origin (CORS) and speak HTTPS.",
        }),
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-major-settings", onClick: saveMajorSettings }, "Save"),
        el("button", { type: "button", className: "secondary", id: "clear-major-settings", onClick: clearMajorSettings }, "Clear"),
        el("button", { type: "button", className: "secondary", onClick: () => navigate({ screen: "major", cards: [], cardIndex: 0, query: "" }) }, "Back"),
      ]),
    ]);
  }

  function saveMajorSettings() {
    const api = majorApi();
    if (!api) return;
    const kind = (document.getElementById("major-kind") || {}).value || "mock";
    const endpoint = (document.getElementById("major-endpoint") || {}).value || "";
    const pollUrl = (document.getElementById("major-poll") || {}).value || "";
    const token = (document.getElementById("major-token") || {}).value || "";
    api.saveConfig({ kind, endpoint, pollUrl, token });
    navigate({ screen: "major", query: "", cards: [], cardIndex: 0, notice: "Saved on this device.", noticeKind: "ok" });
  }

  function clearMajorSettings() {
    const api = majorApi();
    if (api) api.clearConfig();
    navigate({ screen: "major-settings" }, { push: false });
  }

  function renderHelp() {
    const favCount = loadFavorites().libraryIds.length + loadFavorites().custom.length;
    return screen([
      header("Blueprint Help", "What do you need?", "UE 5.6 · Blueprints only"),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile primary",
            id: "open-ask",
            onClick: () => navigate({ screen: "ask" }),
          },
          [
            el("span", { className: "tile-title", text: "Ask a question" }),
            el("span", {
              className: "tile-sub",
              text: aiConfigured
                ? "Dictate or type, then search the library and AI"
                : "Dictate or type, then search the offline library",
            }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-new-recipe",
            onClick: openNewRecipe,
          },
          [
            el("span", { className: "tile-title", text: "New recipe" }),
            el("span", {
              className: "tile-sub",
              text: "Write your own steps, saved on this device",
            }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            onClick: () => navigate({ screen: "library" }),
          },
          [
            el("span", { className: "tile-title", text: "Common recipes" }),
            el("span", {
              className: "tile-sub",
              text: library ? `${library.recipes.length} built-in Blueprint walkthroughs` : "Loading…",
            }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            onClick: () => navigate({ screen: "favorites" }),
          },
          [
            el("span", { className: "tile-title", text: "Favorites" }),
            el("span", { className: "tile-sub", text: favCount ? `${favCount} saved` : "None saved yet" }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-recipe-backup",
            onClick: () => navigate({ screen: "recipe-backup" }),
          },
          [
            el("span", { className: "tile-title", text: "Export / Import" }),
            el("span", {
              className: "tile-sub",
              text: "Back up your recipes as a JSON text blob",
            }),
          ]
        ),
      ]),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }

  function renderAsk(state) {
    const query = state.query || "";
    const results = state.results || null;
    const notice = state.notice || null;
    const noticeKind = state.noticeKind || "";
    const form = el("div", { className: "field-wrap stack" }, [
      el("label", { htmlFor: "question", text: "Ask a Blueprint question" }),
      el("input", {
        id: "question",
        type: "search",
        name: "question",
        autocomplete: "off",
        placeholder: "Write or speak a question",
        value: query,
        attrs: { enterkeyhint: "search", spellcheck: "true" },
      }),
      el("p", {
        className: "hint",
        text: "On glasses, activate this field to write or dictate in the composer. Web Apps cannot use the microphone directly.",
      }),
      el(
        "button",
        { type: "button", className: "primary", id: "ask-submit", onClick: () => submitQuestion() },
        "Search"
      ),
    ]);

    const blocks = [form];
    if (notice) {
      blocks.push(el("p", { className: "status", text: notice, dataset: { kind: noticeKind } }));
    }
    if (results && results.length) {
      blocks.push(el("p", { className: "meta", text: "Matches in your library" }));
      blocks.push(
        el(
          "ul",
          { className: "list" },
          results.map((row) =>
            el("li", null, [
              recipeButton(
                row.recipe,
                row.recipe && row.recipe.source === "custom" ? customLabel(row.recipe) : null
              ),
            ])
          )
        )
      );
    }
    if (state.aiRecipe) {
      blocks.push(el("p", { className: "meta", text: "AI answer" }));
      blocks.push(recipeButton(state.aiRecipe, "From the AI helper"));
    }
    if (state.pending) {
      blocks.push(el("p", { className: "status", text: "Asking the AI helper…" }));
    }

    return screen([
      header("Blueprint Help", "Ask", aiConfigured ? "Library first, then AI if needed" : "Offline library"),
      el("div", { className: "content stack" }, blocks),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }

  function renderLibrary() {
    const recipes = library ? library.recipes : [];
    return screen([
      header("Blueprint Help", "Common recipes", "Works offline, no account needed"),
      el("div", { className: "content" }, [
        el(
          "ul",
          { className: "list" },
          recipes.map((recipe) => el("li", null, [recipeButton(recipe)]))
        ),
      ]),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }

  function renderFavorites() {
    const { fromLibrary, custom } = allFavoriteRecipes();
    const items = [
      ...fromLibrary.map((recipe) => ({ recipe, label: "Library" })),
      ...custom.map((recipe) => ({
        recipe: { ...recipe, source: "custom" },
        label: customLabel(recipe),
      })),
    ];
    const body = items.length
      ? el(
          "ul",
          { className: "list" },
          items.map((item) => el("li", null, [recipeButton(item.recipe, item.label)]))
        )
      : el("p", {
          className: "muted",
          text: "Nothing saved yet. Add a new recipe, or open a library recipe and choose Save.",
        });
    return screen([
      header("Blueprint Help", "Favorites", "Saved on this device"),
      el("div", { className: "content" }, [body]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "open-recipe-backup-fav",
            onClick: () => navigate({ screen: "recipe-backup" }),
          },
          "Export / Import"
        ),
        homeButton(),
      ]),
    ]);
  }

  function openRecipe(recipe, step = 0, { push = true } = {}) {
    const payload = {
      id: recipe.id,
      title: recipe.title,
      summary: recipe.summary || "",
      steps: recipe.steps,
      source: recipe.source || "library",
      origin: recipe.origin || "",
      nodes: recipe.nodes || [],
    };
    navigate({ screen: "recipe", recipe: payload, step }, { push });
  }

  function updateStep(state, step, { speakStep = false } = {}) {
    const steps = state.recipe && state.recipe.steps ? state.recipe.steps : [];
    const nextStep = Math.max(0, Math.min(steps.length - 1, step));
    const next = { ...state, step: nextStep };
    history.replaceState(next, "");
    render(next);
    if (speakStep) speakCurrent(next);
  }

  function speakCurrent(state) {
    const recipe = state.recipe;
    if (!recipe) return;
    const steps = recipe.steps || [];
    const step = steps[state.step || 0];
    if (!step) return;
    const ok = speak(`${step.title}. ${step.body}`);
    if (!ok) {
      const next = { ...state, notice: "Text to speech is not available here." };
      history.replaceState(next, "");
      render(next);
    }
  }

  function renderRecipe(state) {
    const recipe = state.recipe;
    const steps = recipe.steps || [];
    const index = Math.max(0, Math.min(steps.length - 1, state.step || 0));
    const step = steps[index] || { title: "No steps", body: "This recipe has no steps." };
    const saved = isFavorite(recipe);
    const storedCustom = recipe.source === "custom" && Boolean(recipe.id && getCustomRecipe(recipe.id));
    const last = index >= steps.length - 1;

    const panel = el("article", {
      className: "step-card",
      tabIndex: 0,
      id: "step-panel",
      attrs: { "aria-label": `Step ${index + 1} of ${steps.length}` },
    }, [
      el("p", { className: "step-index", text: `Step ${index + 1} of ${steps.length}` }),
      el("h2", { text: step.title }),
      el("p", { className: "step-body", text: step.body }),
      recipe.nodes && recipe.nodes.length && index === 0
        ? el("p", { className: "nodes", text: `Nodes: ${recipe.nodes.join(", ")}` })
        : null,
    ]);

    return screen(
      [
        header("Blueprint Help", recipe.title, "Swipe left or right to change steps"),
        el("div", { className: "content" }, [panel]),
        el("div", { className: "footer" }, [
          storedCustom
            ? el(
                "button",
                {
                  type: "button",
                  className: "secondary",
                  id: "edit-recipe",
                  onClick: () => openEditRecipe(recipe),
                },
                "Edit"
              )
            : el(
                "button",
                {
                  type: "button",
                  className: "secondary",
                  onClick: () => {
                    toggleFavorite(recipe);
                    updateStep(currentState(), currentState().step || 0);
                  },
                },
                saved ? "Saved" : "Save"
              ),
          storedCustom
            ? el(
                "button",
                {
                  type: "button",
                  className: "secondary",
                  id: "delete-recipe",
                  onClick: () => navigate({ screen: "recipe-delete", recipe }),
                },
                "Delete"
              )
            : null,
          canSpeak()
            ? el(
                "button",
                { type: "button", className: "secondary", onClick: () => speakCurrent(currentState()) },
                "Speak"
              )
            : null,
          last
            ? el("button", { type: "button", className: "secondary primary", onClick: goBack }, "Done")
            : el("button", { type: "button", className: "secondary", onClick: goBack }, "Done"),
        ]),
      ],
      "recipe-screen"
    );
  }

  function readEditorDrafts(state) {
    const titleInput = document.getElementById("recipe-title");
    const stepTitleInput = document.getElementById("step-title");
    const stepBodyInput = document.getElementById("step-body");
    const next = { ...state };
    if (titleInput) next.title = titleInput.value.trim().slice(0, RECIPE_TITLE_MAX);
    if (stepTitleInput || stepBodyInput) {
      next.draftTitle = stepTitleInput ? stepTitleInput.value : "";
      next.draftBody = stepBodyInput ? stepBodyInput.value : "";
    }
    return next;
  }

  function continueFromTitle() {
    const state = readEditorDrafts(currentState());
    const title = String(state.title || "").trim();
    if (!title) {
      navigate(
        { ...state, phase: "title", notice: "Add a title first.", noticeKind: "error" },
        { push: false }
      );
      return;
    }
    navigate(
      { ...state, title, phase: "steps", notice: "", noticeKind: "" },
      { push: false }
    );
  }

  function addStepFromForm({ andDone = false } = {}) {
    const state = readEditorDrafts(currentState());
    const draft = normalizeStep({ title: state.draftTitle, body: state.draftBody });
    let steps = Array.isArray(state.steps) ? state.steps.slice() : [];
    let notice = "";
    let noticeKind = "";

    if (state.editingStep != null && state.editingStep >= 0 && state.editingStep < steps.length) {
      if (!draft) {
        navigate(
          { ...state, notice: "Write a step title or body first.", noticeKind: "error" },
          { push: false }
        );
        return false;
      }
      steps[state.editingStep] = draft;
      notice = "Step updated.";
      noticeKind = "ok";
    } else if (draft) {
      if (steps.length >= MAX_CUSTOM_STEPS) {
        navigate(
          {
            ...state,
            notice: "This recipe already has the maximum number of steps.",
            noticeKind: "error",
          },
          { push: false }
        );
        return false;
      }
      steps.push(draft);
      notice = "Step added.";
      noticeKind = "ok";
    } else if (!andDone) {
      navigate(
        { ...state, notice: "Write a step title or body first.", noticeKind: "error" },
        { push: false }
      );
      return false;
    }

    const next = {
      ...state,
      steps,
      editingStep: null,
      draftTitle: "",
      draftBody: "",
      notice,
      noticeKind,
    };
    if (andDone) return finishRecipe(next);
    navigate(next, { push: false });
    return true;
  }

  function removeEditingStep() {
    const state = readEditorDrafts(currentState());
    if (state.editingStep == null) return;
    const steps = (state.steps || []).slice();
    if (state.editingStep < 0 || state.editingStep >= steps.length) return;
    steps.splice(state.editingStep, 1);
    navigate(
      {
        ...state,
        steps,
        editingStep: null,
        draftTitle: "",
        draftBody: "",
        notice: "Step removed.",
        noticeKind: "ok",
      },
      { push: false }
    );
  }

  function startEditStep(index) {
    const state = readEditorDrafts(currentState());
    const step = (state.steps || [])[index];
    if (!step) return;
    navigate(
      {
        ...state,
        phase: "steps",
        editingStep: index,
        draftTitle: step.title || "",
        draftBody: step.body || "",
        notice: `Editing step ${index + 1}.`,
        noticeKind: "",
      },
      { push: false }
    );
  }

  function finishRecipe(state) {
    const current = state || readEditorDrafts(currentState());
    let steps = Array.isArray(current.steps) ? current.steps.slice() : [];
    const draft = normalizeStep({ title: current.draftTitle, body: current.draftBody });
    if (draft) {
      if (current.editingStep != null && current.editingStep >= 0 && current.editingStep < steps.length) {
        steps[current.editingStep] = draft;
      } else if (steps.length < MAX_CUSTOM_STEPS) {
        steps.push(draft);
      }
    }
    const title = String(current.title || "").trim();
    if (!title) {
      navigate(
        { ...current, phase: "title", steps, notice: "Add a title first.", noticeKind: "error" },
        { push: false }
      );
      return false;
    }
    if (!steps.length) {
      navigate(
        {
          ...current,
          phase: "steps",
          steps,
          editingStep: null,
          notice: "Add at least one step before done.",
          noticeKind: "error",
        },
        { push: false }
      );
      return false;
    }
    const result = upsertCustomRecipe({
      id: current.editId || newCustomId(),
      title,
      summary: "Your recipe",
      steps,
      source: "custom",
      origin: "user",
    });
    if (!result.ok) {
      const message =
        result.reason === "full"
          ? "You already have the maximum number of recipes on this device."
          : "Could not save on this device.";
      navigate({ ...current, steps, notice: message, noticeKind: "error" }, { push: false });
      return false;
    }
    openRecipe(result.recipe, 0, { push: false });
    return true;
  }

  function renderRecipeEditor(state) {
    const phase = state.phase === "steps" ? "steps" : "title";
    const isEdit = Boolean(state.editId);
    const title = state.title || "";
    const steps = state.steps || [];
    const notice = state.notice || "";
    const editing = state.editingStep != null && state.editingStep >= 0;

    if (phase === "title") {
      return screen([
        header(
          "Blueprint Help",
          isEdit ? "Edit recipe" : "New recipe",
          "Title first, then steps"
        ),
        el("div", { className: "content stack" }, [
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "recipe-title", text: "Recipe title" }),
            el("input", {
              id: "recipe-title",
              type: "search",
              name: "recipe-title",
              autocomplete: "off",
              placeholder: "Write or speak a title",
              value: title,
              attrs: { enterkeyhint: "next", maxlength: String(RECIPE_TITLE_MAX), spellcheck: "true" },
            }),
            el("p", {
              className: "hint",
              text: "On glasses, activate this field to dictate. Your recipe stays in local storage on this device.",
            }),
          ]),
          notice
            ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } })
            : null,
        ]),
        el("div", { className: "footer" }, [
          el(
            "button",
            {
              type: "button",
              className: "secondary primary",
              id: "recipe-title-continue",
              onClick: continueFromTitle,
            },
            "Continue"
          ),
          el("button", { type: "button", className: "secondary", onClick: goBack }, "Cancel"),
        ]),
      ]);
    }

    const list =
      steps.length
        ? el(
            "ul",
            { className: "list" },
            steps.map((step, index) =>
              el("li", null, [
                el(
                  "button",
                  {
                    type: "button",
                    className: "tile",
                    onClick: () => startEditStep(index),
                  },
                  [
                    el("span", { className: "tile-title", text: `Step ${index + 1}` }),
                    el("span", { className: "tile-sub", text: step.title || step.body || "" }),
                  ]
                ),
              ])
            )
          )
        : el("p", { className: "muted", text: "No steps yet. Add them one at a time." });

    return screen([
      header("Blueprint Help", title || "New recipe", `${steps.length} step${steps.length === 1 ? "" : "s"} so far`),
      el("div", { className: "content stack" }, [
        list,
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "step-title", text: editing ? `Edit step ${state.editingStep + 1} title` : "Step title" }),
          el("input", {
            id: "step-title",
            type: "search",
            name: "step-title",
            autocomplete: "off",
            placeholder: "Write or speak a short step title",
            value: state.draftTitle || "",
            attrs: { enterkeyhint: "next", maxlength: String(STEP_TITLE_MAX), spellcheck: "true" },
          }),
          el("label", { htmlFor: "step-body", text: "What to do" }),
          el("input", {
            id: "step-body",
            type: "text",
            name: "step-body",
            autocomplete: "off",
            placeholder: "Write or speak the step",
            value: state.draftBody || "",
            attrs: { enterkeyhint: "done", maxlength: String(STEP_BODY_MAX), spellcheck: "true" },
          }),
          el("p", {
            className: "hint",
            text: "Activate a field to dictate. Add step, then keep going, or choose Done when you are finished.",
          }),
        ]),
        notice
          ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } })
          : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "add-step",
            onClick: () => addStepFromForm(),
          },
          editing ? "Save step" : "Add step"
        ),
        editing
          ? el(
              "button",
              { type: "button", className: "secondary", id: "remove-step", onClick: removeEditingStep },
              "Remove step"
            )
          : null,
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "finish-recipe",
            onClick: () => addStepFromForm({ andDone: true }),
          },
          "Done"
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            onClick: () =>
              navigate(
                { ...readEditorDrafts(currentState()), phase: "title", notice: "", noticeKind: "" },
                { push: false }
              ),
          },
          "Back"
        ),
      ]),
    ]);
  }

  function renderRecipeDelete(state) {
    const recipe = state.recipe || {};
    return screen([
      header("Blueprint Help", "Delete recipe?", "This cannot be undone"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", {
            className: "step-body",
            text: `Remove "${recipe.title || "this recipe"}" from this device?`,
          }),
        ]),
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "confirm-delete-recipe",
            onClick: () => {
              deleteCustomRecipe(recipe.id);
              navigate({ screen: "favorites" }, { push: false });
            },
          },
          "Delete"
        ),
        el("button", { type: "button", className: "secondary", onClick: goBack }, "Cancel"),
      ]),
    ]);
  }

  function renderRecipeBackup(state) {
    const blob = state.blob != null ? state.blob : exportCustomRecipesBlob();
    const notice = state.notice || "";
    return screen([
      header("Blueprint Help", "Export / Import", "Backup stays on this device until you copy it"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "recipe-backup-blob", text: "JSON text blob" }),
          el("textarea", {
            id: "recipe-backup-blob",
            className: "field-area",
            name: "recipe-backup",
            value: blob,
            attrs: { spellcheck: "false", rows: "8", autocomplete: "off" },
          }),
          el("p", {
            className: "hint",
            text: "Copy this to back up your recipes, or paste a backup and choose Import. Nothing is uploaded.",
          }),
        ]),
        notice
          ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } })
          : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "refresh-recipe-backup",
            onClick: () =>
              navigate({ screen: "recipe-backup", blob: exportCustomRecipesBlob(), notice: "", noticeKind: "" }, { push: false }),
          },
          "Refresh export"
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "import-recipes",
            onClick: importRecipesFromForm,
          },
          "Import"
        ),
        homeButton(),
      ]),
    ]);
  }

  function importRecipesFromForm() {
    const area = document.getElementById("recipe-backup-blob");
    const textValue = area && area.value ? area.value : "";
    const result = importCustomRecipesBlob(textValue);
    navigate(
      {
        screen: "recipe-backup",
        blob: result.ok ? exportCustomRecipesBlob() : textValue,
        notice: result.message,
        noticeKind: result.ok ? "ok" : "error",
      },
      { push: false }
    );
  }

  function render(state) {
    const screenName = state && state.screen ? state.screen : "home";
    if (screenName !== "home") stopClock();
    app.replaceChildren();
    let view;
    switch (screenName) {
      case "help":
        view = renderHelp();
        lastFocusSelector = "#open-ask";
        break;
      case "ask":
        view = renderAsk(state);
        lastFocusSelector = "#question";
        break;
      case "library":
        view = renderLibrary();
        lastFocusSelector = "button.tile";
        break;
      case "favorites":
        view = renderFavorites();
        lastFocusSelector = "button.tile, .content p";
        break;
      case "recipe":
        view = renderRecipe(state);
        lastFocusSelector = "#step-panel";
        break;
      case "recipe-editor":
        view = renderRecipeEditor(state);
        lastFocusSelector = state.phase === "steps" ? "#step-title" : "#recipe-title";
        break;
      case "recipe-delete":
        view = renderRecipeDelete(state);
        lastFocusSelector = "#confirm-delete-recipe";
        break;
      case "recipe-backup":
        view = renderRecipeBackup(state);
        lastFocusSelector = "#recipe-backup-blob";
        break;
      case "next-up":
        view = renderNextUp(state);
        lastFocusSelector = "#next-up-input";
        break;
      case "coming-soon":
        view = renderComingSoon(state);
        lastFocusSelector = "#go-home";
        break;
      case "major":
        view = renderMajor(state);
        lastFocusSelector = state.pending ? "#major-card" : "#major-message";
        break;
      case "major-settings":
        view = renderMajorSettings();
        lastFocusSelector = "#major-kind";
        break;
      default:
        view = renderHome();
        lastFocusSelector = "#open-blueprint-help";
    }
    app.append(view);
    if (screenName === "home") startClock();
    window.requestAnimationFrame(() => {
      const target = lastFocusSelector ? app.querySelector(lastFocusSelector) : null;
      if (target && typeof target.focus === "function") target.focus();
    });
  }

  async function submitQuestion() {
    const input = document.getElementById("question");
    const query = input && input.value ? input.value.trim() : "";
    if (!query) {
      navigate(
        {
          screen: "ask",
          query: "",
          notice: "Enter a question, or open Common recipes.",
          noticeKind: "error",
        },
        { push: false }
      );
      return;
    }

    const matches = searchLibrary(query);
    const askState = {
      screen: "ask",
      query,
      results: matches.slice(0, 6),
      notice: matches.length
        ? "Open a match below, or wait if AI is enabled."
        : aiConfigured
          ? "No library match. Asking the AI helper…"
          : "No library match. AI is not configured, so try another wording or open Common recipes.",
      noticeKind: matches.length ? "ok" : aiConfigured ? "" : "error",
      pending: Boolean(aiConfigured),
    };
    navigate(askState, { push: false });

    if (!aiConfigured) return;

    try {
      const response = await fetch(API_ASK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      if (!response.ok) {
        let message = "The AI helper is unavailable. Use a library match, or try again later.";
        try {
          const payload = await response.json();
          if (payload && payload.message) message = payload.message;
        } catch (_ignored) {}
        navigate(
          {
            ...askState,
            pending: false,
            notice: matches.length ? `${message} Library matches are still listed below.` : message,
            noticeKind: "error",
          },
          { push: false }
        );
        return;
      }
      const data = await response.json();
      if (!data || !Array.isArray(data.steps) || !data.steps.length) {
        throw new Error("empty");
      }
      const recipe = {
        id: `ai-${Date.now()}`,
        title: data.title || query,
        summary: "AI answer for your question",
        steps: data.steps.map((step) => ({
          title: String(step.title || "Step"),
          body: String(step.body || ""),
        })),
        source: "custom",
        origin: "ai",
        nodes: Array.isArray(data.nodes) ? data.nodes.map(String) : [],
      };
      if (matches.length) {
        navigate(
          {
            ...askState,
            pending: false,
            aiRecipe: recipe,
            notice: "Library matches are listed first. An AI answer is also ready.",
            noticeKind: "ok",
          },
          { push: false }
        );
        return;
      }
      openRecipe(recipe, 0);
    } catch (err) {
      navigate(
        {
          ...askState,
          pending: false,
          notice: matches.length
            ? "Could not reach the AI helper. Library matches are still listed below."
            : "Could not reach the AI helper. The app still works from the offline library.",
          noticeKind: "error",
        },
        { push: false }
      );
    }
  }

  function isTypingTarget(target) {
    return Boolean(
      target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
    );
  }

  function onGlobalKeyDown(event) {
    const state = currentState();
    if (event.key === "Enter" && event.target && event.target.id === "question") {
      event.preventDefault();
      submitQuestion();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "major-message") {
      event.preventDefault();
      submitMajorMessage();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "next-up-input") {
      event.preventDefault();
      saveNextUpFromForm();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "recipe-title") {
      event.preventDefault();
      continueFromTitle();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "step-title") {
      event.preventDefault();
      const body = document.getElementById("step-body");
      if (body && typeof body.focus === "function") body.focus();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "step-body") {
      event.preventDefault();
      addStepFromForm();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (state && state.screen === "recipe") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateStep(state, (state.step || 0) - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        updateStep(state, (state.step || 0) + 1);
      }
      return;
    }
    if (state && state.screen === "major" && (state.cards || []).length) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateMajorCard(state, (state.cardIndex || 0) - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        updateMajorCard(state, (state.cardIndex || 0) + 1);
      }
    }
  }

  async function loadLibrary() {
    const response = await fetch("./library.json");
    const data = await response.json();
    if (!data || !Array.isArray(data.recipes)) throw new Error("invalid library");
    library = data;
  }

  async function checkHealth() {
    try {
      const response = await fetch(API_HEALTH, { method: "GET" });
      if (!response.ok) return;
      const data = await response.json();
      aiConfigured = Boolean(data && data.aiConfigured);
    } catch (_err) {
      aiConfigured = false;
    }
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Offline support is unavailable:", error);
    });
  }

  async function start() {
    history.replaceState(HOME_STATE, "");
    try {
      await loadLibrary();
    } catch (err) {
      console.warn(err);
      app.replaceChildren(
        screen([
          header("Thespia", "Could not load", "The recipe library is missing."),
          el("div", { className: "content" }, [
            el("p", { className: "status", dataset: { kind: "error" }, text: "Refresh, or check that library.json is next to this page." }),
          ]),
        ])
      );
      return;
    }
    await checkHealth();
    render(currentState());
    registerWorker();
  }

  window.addEventListener("popstate", (event) => {
    render(event.state && event.state.screen ? event.state : HOME_STATE);
  });
  document.addEventListener("keydown", onGlobalKeyDown);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
