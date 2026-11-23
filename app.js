/* World Static — home, Blueprint Help, Task Cards, Teleprompter, Scale Check, Talk (Major or C 2)
   Meta Ray-Ban Display Web App. Directional input arrives as Arrow keys + Enter.
   Web Apps cannot use the microphone; text fields open the on-glasses composer
   (handwriting, dictation, keyboard) on firmware v127+ / Meta AI app v272+.
*/

(function () {
  "use strict";

  const HOME_STATE = { screen: "home" };
  const FAVORITES_KEY = "thespia.hud.favorites";
  const NEXT_UP_KEY = "thespia.hud.nextup";
  const NEXT_UP_MAX = 80;
  const API_ASK = "./api/ask";
  const API_HEALTH = "./api/health";

  const APP_TILES = [
    {
      id: "funds",
      title: "Add spend",
      sub: "Log today's total",
      screen: "funds-entry",
      available: true,
      buttonId: "open-add-spend",
      icon: "funds",
    },
    {
      id: "tasks",
      title: "Task Cards",
      sub: "Work, home, and projects",
      screen: "tasks",
      available: true,
      buttonId: "open-task-cards",
      icon: "tasks",
    },
    {
      id: "prompter",
      title: "Teleprompter",
      sub: "Stream scripts",
      screen: "prompter",
      available: true,
      buttonId: "open-teleprompter",
      icon: "prompter",
    },
    {
      id: "blueprint",
      title: "Blueprint Help",
      sub: "UE 5.6 node-by-node steps",
      screen: "help",
      available: true,
      buttonId: "open-blueprint-help",
      icon: "blueprint",
    },
    {
      id: "scale",
      title: "Scale Check",
      sub: "Real size in UE units",
      screen: "scale",
      available: true,
      buttonId: "open-scale-check",
      icon: "scale",
    },
    {
      id: "talk",
      title: "Talk",
      sub: "Major or C 2",
      screen: "talk-picker",
      available: true,
      buttonId: "open-talk",
      icon: "talk",
    },
    { id: "scan", title: "3D Scan", sub: "Coming soon", available: false, icon: "scan" },
    { id: "overlock", title: "Overlock Walk", sub: "Coming soon", available: false, icon: "overlock" },
  ];

  const app = document.getElementById("app");
  const previewHint = document.querySelector(".preview-hint");

  /** @type {{version:number, engine:string, mode:string, recipes:Array} | null} */
  let library = null;
  /** @type {{version?:number, engine?:string, mannyHeightCm?:number, categories:Array} | null} */
  let scaleLibrary = null;
  let aiConfigured = false;
  let lastFocusSelector = null;
  let talkInFlight = false;
  let clockTimer = null;
  let prompterRaf = null;
  let prompterPlay = null;

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

  function backButton() {
    return el("button", { type: "button", className: "secondary", id: "go-back", onClick: goBack }, "Back");
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
    if (tile.screen === "talk-picker" || tile.screen === "major") {
      navigate({ screen: "talk-picker" });
      return;
    }
    if (tile.screen === "tasks") {
      navigate({ screen: "tasks", listId: null, taskIndex: 0 });
      return;
    }
    navigate({ screen: tile.screen });
  }

  function fundsApi() {
    return window.WorldStaticFunds || null;
  }

  function loadNextUp() {
    try {
      const raw = localStorage.getItem(NEXT_UP_KEY);
      if (!raw) return { text: "" };
      const parsed = JSON.parse(raw);
      const text = typeof parsed === "string" ? parsed : parsed && parsed.text;
      return { text: String(text || "").slice(0, NEXT_UP_MAX) };
    } catch (err) {
      try {
        localStorage.removeItem(NEXT_UP_KEY);
      } catch (_ignored) {}
      return { text: "" };
    }
  }

  function saveNextUp(text) {
    const next = { text: String(text || "").trim().slice(0, NEXT_UP_MAX) };
    try {
      localStorage.setItem(NEXT_UP_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Could not save Next up on this device.");
    }
    return next;
  }

  function clearNextUp() {
    try {
      localStorage.removeItem(NEXT_UP_KEY);
    } catch (_ignored) {}
    return { text: "" };
  }

  function lastTalkPreview() {
    const api = majorApi();
    if (!api || typeof api.loadThread !== "function") return null;
    const people = api.RECIPIENTS || ["major", "c2"];
    let best = null;
    for (const who of people) {
      const list = api.loadThread(who) || [];
      for (const message of list) {
        if (!message || message.role !== "assistant" || !message.text) continue;
        const ts = Number(message.ts) || 0;
        if (!best || ts >= best.ts) {
          best = { to: who, text: String(message.text), ts };
        }
      }
    }
    return best;
  }

  function clipText(text, max) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (value.length <= max) return value;
    return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  }

  function dashCard(id, label, text, sub, onClick, extraClass) {
    return el(
      "button",
      {
        type: "button",
        className: extraClass ? "dash-card " + extraClass : "dash-card",
        id,
        onClick,
      },
      [
        el("span", { className: "dash-label", text: label }),
        el("span", { className: "dash-text", text: text || "" }),
        sub ? el("span", { className: "dash-sub", text: sub }) : null,
      ]
    );
  }

  function fundsBadge(funds) {
    const api = fundsApi();
    const money = api && api.formatMoney ? api.formatMoney : (n) => "$" + n;
    const budget = funds ? Number(funds.budget) || 0 : 0;
    const spent = funds ? Number(funds.spent) || 0 : 0;
    const left = api && funds ? api.remaining(funds) : 0;
    const ratio = api && funds ? api.spentRatio(funds) : 0;
    const over = left < 0;
    const leftText = budget ? "Left " + money(left) : "Set budget";
    const spentText = budget ? "Spent " + money(spent) : "Daily funds";
    return el(
      "button",
      {
        type: "button",
        className: over ? "funds-badge over" : "funds-badge",
        id: "open-funds",
        onClick: () => navigate({ screen: "funds-budget" }),
        attrs: {
          "aria-label": budget ? leftText + ", " + spentText : "Set a daily budget",
        },
      },
      [
        strokeIcon("funds"),
        el("div", { className: "funds-badge-copy" }, [
          el("span", { className: "funds-badge-left", text: leftText }),
          el("span", { className: "funds-badge-spent", text: spentText }),
          el("div", { className: "funds-bar funds-bar-tiny", attrs: { "aria-hidden": "true" } }, [
            el("span", {
              className: "funds-bar-fill",
              attrs: { style: "inline-size:" + Math.round(ratio * 100) + "%" },
            }),
          ]),
        ]),
      ]
    );
  }

  function renderTaskCard(current, due) {
    const tasks = tasksApi();
    const items = current && tasks && typeof tasks.openChecklistItems === "function"
      ? tasks.openChecklistItems(current.task)
      : [];
    const shown = items.slice(0, 3);
    const more = Math.max(0, items.length - shown.length);
    return el(
      "button",
      {
        type: "button",
        className: "dash-card task-dash",
        id: "open-current-task",
        onClick: () => {
          if (current) {
            navigate({ screen: "tasks", listId: current.list.id, taskId: current.task.id });
            return;
          }
          navigate({ screen: "tasks" });
        },
      },
      [
        el("span", { className: "dash-label", text: "Task" }),
        el("span", { className: "dash-text", text: current ? current.task.title : "No open tasks" }),
        shown.length
          ? el(
              "ul",
              { className: "dash-bullets" },
              shown.map((item) => el("li", { text: item.text }))
            )
          : null,
        more ? el("p", { className: "dash-more", text: "+" + more + " more" }) : null,
        el(
          "span",
          {
            className: "dash-sub",
            text: current ? current.list.name + (due ? " · " + due : "") : "Open Apps to add one",
          }
        ),
      ]
    );
  }

  function appTiles() {
    return APP_TILES.map((tile) =>
      el(
        "button",
        {
          type: "button",
          className: tile.available ? "tile" : "tile soon",
          id: tile.buttonId || `open-${tile.id}`,
          dataset: { soon: tile.available ? "false" : "true" },
          onClick: () => openTile(tile),
        },
        [
          strokeIcon(tile.icon || tile.id),
          el("span", { className: "tile-title", text: tile.title }),
          el("span", { className: "tile-sub", text: tile.sub }),
        ]
      )
    );
  }

  function renderHome() {
    const now = new Date();
    const tasks = tasksApi();
    const data = tasks ? tasks.loadAndPersist() : null;
    const current = data && tasks ? tasks.topUnfinished(data) : null;
    const due = current && tasks && current.task.due ? tasks.formatDue(current.task.due, now) : "";
    const funds = fundsApi() ? fundsApi().loadAndPersist() : null;
    const next = loadNextUp();
    const talk = lastTalkPreview();
    const talkNameText = talk ? talkName(talk.to) : "Talk";
    const talkBody = talk ? clipText(talk.text, 72) : "No messages yet";
    return screen(
      [
        el("header", { className: "screen-header hud-header" }, [
          el("div", { className: "hud-top" }, [
            el("div", { className: "hud-time-col" }, [
              el("h1", { id: "hud-clock", className: "hud-clock", text: formatTime(now) }),
              el("p", { id: "hud-date", className: "hud-date", text: formatDate(now) }),
            ]),
            fundsBadge(funds),
          ]),
        ]),
        el("div", { className: "content stack dash-stack" }, [
          dashCard(
            "open-next-up",
            "Next up",
            next.text || "Set the next stream or shift",
            next.text ? "Enter to change" : "Stored on this device",
            () => navigate({ screen: "next-up", text: next.text || "" })
          ),
          renderTaskCard(current, due),
          dashCard(
            "open-talk-preview",
            talk ? talkNameText : "Talk",
            talkBody,
            talk ? "Last message" : "Open Talk to write one",
            () => (talk ? openTalk(talk.to) : navigate({ screen: "talk-picker" })),
            "talk-preview"
          ),
        ]),
        el("div", { className: "footer hud-footer" }, [
          el(
            "button",
            {
              type: "button",
              className: "secondary primary",
              id: "open-apps",
              onClick: () => navigate({ screen: "apps" }),
            },
            "Apps"
          ),
        ]),
      ],
      "hud-home"
    );
  }

  function renderApps() {
    return screen(
      [
        header("World Static", "Apps", "Arrow to a tile, then Enter"),
        el("div", { className: "content stack" }, [
          el("div", { className: "tile-grid", attrs: { role: "list" } }, appTiles()),
        ]),
        el("div", { className: "footer" }, [homeButton()]),
      ],
      "apps-screen"
    );
  }

  function renderFundsEntry(state) {
    const api = fundsApi();
    const funds = api ? api.loadAndPersist() : null;
    const money = api && api.formatMoney ? api.formatMoney : (n) => "$" + n;
    const spentLine = funds ? "Today " + money(funds.spent) : "Kept on this device";
    const notice = state && state.notice;
    return screen(
      [
        header("Daily funds", "Add spend", spentLine),
        el("div", { className: "content stack" }, [
          notice
            ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "error" } })
            : null,
          el("p", {
            className: "hint",
            text: "Type an amount and press Enter. It is added to today's total and stays on this device.",
          }),
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "funds-amount", text: "Amount" }),
            el("input", {
              id: "funds-amount",
              type: "search",
              name: "funds-amount",
              autocomplete: "off",
              placeholder: "Amount, like 5",
              value: (state && state.amount) || "",
              attrs: { enterkeyhint: "done", inputmode: "decimal", spellcheck: "false" },
            }),
            el("label", { htmlFor: "funds-label", text: "Label (optional)" }),
            el("input", {
              id: "funds-label",
              type: "search",
              name: "funds-label",
              autocomplete: "off",
              placeholder: "What was it for?",
              value: (state && state.label) || "",
              attrs: { enterkeyhint: "done", spellcheck: "true" },
            }),
          ]),
        ]),
        el("div", { className: "footer" }, [
          el(
            "button",
            { type: "button", className: "secondary primary", id: "save-funds-spend", onClick: submitAddSpend },
            "Save"
          ),
          homeButton(),
        ]),
      ],
      "funds-entry-screen"
    );
  }

  function renderFundsBudget(state) {
    const api = fundsApi();
    const funds = api ? api.loadAndPersist() : null;
    const money = api && api.formatMoney ? api.formatMoney : (n) => "$" + n;
    const notice = state && state.notice;
    const spent = funds ? money(funds.spent) : "$0";
    const left = funds && api ? money(api.remaining(funds)) : "$0";
    const budgetValue =
      state && state.budget != null && state.budget !== ""
        ? String(state.budget)
        : funds && funds.budget
          ? String(funds.budget)
          : "";
    return screen(
      [
        header("Daily funds", "Budget", "Spent resets at midnight"),
        el("div", { className: "content stack" }, [
          el("p", { className: "hint", text: "Spent today " + spent + "  ·  Left " + left }),
          notice
            ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "error" } })
            : null,
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "funds-budget", text: "Daily budget" }),
            el("input", {
              id: "funds-budget",
              type: "search",
              name: "funds-budget",
              autocomplete: "off",
              placeholder: "Daily budget, like 40",
              value: budgetValue,
              attrs: { enterkeyhint: "done", inputmode: "decimal", spellcheck: "false" },
            }),
          ]),
        ]),
        el("div", { className: "footer" }, [
          el(
            "button",
            { type: "button", className: "secondary primary", id: "save-funds-budget", onClick: submitFundsBudget },
            "Save"
          ),
          el(
            "button",
            {
              type: "button",
              className: "secondary",
              id: "funds-budget-add",
              onClick: () => navigate({ screen: "funds-entry", amount: "", label: "" }),
            },
            "Add spend"
          ),
          homeButton(),
        ]),
      ],
      "funds-budget-screen"
    );
  }

  function renderNextUpEditor(state) {
    const current = loadNextUp();
    const value = state && state.text != null ? state.text : current.text;
    const notice = state && state.notice;
    return screen(
      [
        header("World Static", "Next up", "Stored on this device"),
        el("div", { className: "content stack" }, [
          notice
            ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } })
            : null,
          el("p", { className: "hint", text: "One line for the next stream, shift, or plan." }),
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "next-up-text", text: "Next up" }),
            el("input", {
              id: "next-up-text",
              type: "search",
              name: "next-up-text",
              autocomplete: "off",
              placeholder: "Next stream or shift",
              value: value || "",
              attrs: { enterkeyhint: "done", spellcheck: "true", maxlength: String(NEXT_UP_MAX) },
            }),
          ]),
        ]),
        el("div", { className: "footer" }, [
          el(
            "button",
            { type: "button", className: "secondary primary", id: "save-next-up", onClick: saveNextUpFromForm },
            "Save"
          ),
          el(
            "button",
            { type: "button", className: "secondary", id: "clear-next-up", onClick: clearNextUpFromForm },
            "Clear"
          ),
          homeButton(),
        ]),
      ],
      "next-up-screen"
    );
  }

  function submitAddSpend() {
    const api = fundsApi();
    const amount = ((document.getElementById("funds-amount") || {}).value || "").trim();
    const label = ((document.getElementById("funds-label") || {}).value || "").trim();
    if (!api) {
      navigate({ screen: "funds-entry", amount, label, notice: "Funds could not load.", noticeKind: "error" }, { push: false });
      return;
    }
    const result = api.addSpend(api.loadAndPersist(), amount, label);
    if (!result.ok) {
      navigate(
        { screen: "funds-entry", amount, label, notice: result.message, noticeKind: "error" },
        { push: false }
      );
      return;
    }
    api.save(result.data);
    navigate(HOME_STATE, { push: false });
  }

  function submitFundsBudget() {
    const api = fundsApi();
    const budget = ((document.getElementById("funds-budget") || {}).value || "").trim();
    if (!api) {
      navigate({ screen: "funds-budget", budget, notice: "Funds could not load.", noticeKind: "error" }, { push: false });
      return;
    }
    const result = api.setBudget(api.loadAndPersist(), budget);
    if (!result.ok) {
      navigate(
        { screen: "funds-budget", budget, notice: result.message, noticeKind: "error" },
        { push: false }
      );
      return;
    }
    api.save(result.data);
    navigate(HOME_STATE, { push: false });
  }

  function saveNextUpFromForm() {
    const input = document.getElementById("next-up-text");
    const text = input && input.value ? input.value : "";
    saveNextUp(text);
    navigate(HOME_STATE, { push: false });
  }

  function clearNextUpFromForm() {
    clearNextUp();
    navigate({ screen: "next-up", text: "", notice: "Cleared.", noticeKind: "ok" }, { push: false });
  }

  function renderComingSoon(state) {
    const title = state.title || "This app";
    return screen([
      header("World Static", title, "Coming soon"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", {
            className: "step-body",
            text: `${title} is on the list, but it is not built yet. Task Cards, the Teleprompter, Blueprint Help, Scale Check, and Talk are ready to try.`,
          }),
        ]),
      ]),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }


  function talkRecipient(state) {
    const api = majorApi();
    const value = state && state.to;
    return api && api.normalizeTo ? api.normalizeTo(value) : value === "c2" ? "c2" : "major";
  }

  function talkName(to) {
    const api = majorApi();
    if (api && api.recipientName) return api.recipientName(to);
    return to === "c2" ? "C 2" : "Major";
  }

  function avatarEl(to, className) {
    const who = to === "c2" ? "c2" : "major";
    const src = who === "c2" ? "./icons/avatar-c2.svg" : "./icons/avatar-major.svg";
    return el("img", {
      className: className || "talk-avatar",
      src,
      alt: "",
      width: 48,
      height: 48,
      attrs: { "aria-hidden": "true" },
    });
  }

  function openTalk(to, extra) {
    const api = majorApi();
    const who = api && api.normalizeTo ? api.normalizeTo(to) : to === "c2" ? "c2" : "major";
    navigate({
      screen: "talk",
      to: who,
      query: "",
      notice: "",
      pending: false,
      requestId: "",
      ...(extra || {}),
    });
  }

  function formatTalkTime(ts) {
    const value = Number(ts);
    if (!value) return "";
    return formatTime(new Date(value));
  }

  function stillOnTalk(to) {
    const state = currentState();
    if (!state) return false;
    if (state.screen !== "talk" && state.screen !== "major") return false;
    return talkRecipient(state) === to;
  }

  function composerValue() {
    const input = document.getElementById("major-message");
    return input && input.value ? input.value : "";
  }

  function loadTalkMessages(to) {
    const api = majorApi();
    if (!api || typeof api.loadThread !== "function") return [];
    const list = api.loadThread(to) || [];
    return Array.isArray(list) ? list : [];
  }

  function scrollTalkThread() {
    const thread = document.getElementById("talk-thread");
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }

  function typingDots() {
    return el("span", { className: "talk-dots", attrs: { "aria-hidden": "true" } }, [
      el("span"),
      el("span"),
      el("span"),
    ]);
  }

  function talkBubbleRow(message, to) {
    const role = message && message.role;
    const time = formatTalkTime(message && message.ts);
    if (role === "system" || (message && message.status === "timeout")) {
      return el(
        "button",
        {
          type: "button",
          className: "talk-retry",
          id: "talk-retry",
          onClick: () => retryTalkReply(message.requestId),
        },
        [
          el("p", { className: "talk-bubble-text", text: message.text || "No reply yet. Tap to check again." }),
          time ? el("p", { className: "talk-ts", text: time }) : null,
        ]
      );
    }
    if (role === "user") {
      return el("div", { className: "talk-row talk-row-me" }, [
        el("div", { className: "talk-bubble-col" }, [
          el("div", { className: "talk-bubble talk-bubble-me" }, [
            el("p", { className: "talk-bubble-text", text: message.text || "" }),
          ]),
          time ? el("p", { className: "talk-ts", text: time }) : null,
        ]),
      ]);
    }
    return el("div", { className: "talk-row talk-row-them", dataset: { to } }, [
      avatarEl(to, "talk-avatar talk-avatar-sm"),
      el("div", { className: "talk-bubble-col" }, [
        el("div", { className: "talk-bubble talk-bubble-them" }, [
          el("p", { className: "talk-bubble-text", text: message.text || "" }),
        ]),
        time ? el("p", { className: "talk-ts", text: time }) : null,
      ]),
    ]);
  }

  function typingRow(to) {
    const name = talkName(to);
    return el(
      "div",
      {
        className: "talk-row talk-row-them talk-typing-row",
        id: "talk-typing",
        tabIndex: 0,
        dataset: { to },
        attrs: { "aria-label": `${name} is typing` },
      },
      [
        avatarEl(to, "talk-avatar talk-avatar-sm"),
        el("div", { className: "talk-bubble-col" }, [
          el("div", { className: "talk-bubble talk-bubble-them talk-bubble-typing" }, [
            el("p", { className: "talk-bubble-text", text: `${name} is typing…` }),
            typingDots(),
          ]),
        ]),
      ]
    );
  }


  function renderTalkSetup(state) {
    const ok = !(state && state.error);
    return screen([
      header("Talk", ok ? "Ready" : "Setup link", ok ? "Live relay is on." : "The link could not be used."),
      el("div", { className: "content stack" }, [
        el("article", { className: "card", id: "talk-setup-card" }, [
          el("p", {
            className: "step-body",
            text: ok
              ? "Talk is set up. Live relay is on."
              : "That setup link was not valid. Your Talk settings were not changed.",
          }),
        ]),
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "talk-setup-open",
            onClick: () => navigate({ screen: "talk-picker" }),
          },
          "Talk"
        ),
        homeButton(),
      ]),
    ]);
  }

  function renderTalkPicker() {
    const api = majorApi();
    const status = api ? api.statusLabel() : "Talk is unavailable.";
    const people = [
      {
        id: "major",
        title: "Major",
        sub: "Commanding assistant",
        buttonId: "talk-pick-major",
      },
      {
        id: "c2",
        title: "C 2",
        sub: "Your personal assistant",
        buttonId: "talk-pick-c2",
      },
    ];
    return screen(
      [
        header("Talk", "Who are you messaging?", status),
        el("div", { className: "content stack" }, [
          el(
            "div",
            { className: "talk-picker-grid" },
            people.map((person) =>
              el(
                "button",
                {
                  type: "button",
                  className: "tile talk-pick",
                  id: person.buttonId,
                  onClick: () => openTalk(person.id),
                },
                [
                  avatarEl(person.id, "talk-avatar talk-avatar-lg"),
                  el("span", { className: "tile-title", text: person.title }),
                  el("span", { className: "tile-sub", text: person.sub }),
                ]
              )
            )
          ),
        ]),
        el("div", { className: "footer" }, [
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
      "talk-picker-screen"
    );
  }

  function majorApi() {
    return window.ThespiaMajor || null;
  }

  function renderMajor(state) {
    const api = majorApi();
    const query = state.query || "";
    const pending = Boolean(state.pending);
    const notice = state.notice || "";
    const status = api ? api.statusLabel() : "Talk is unavailable.";
    const to = talkRecipient(state);
    const who = talkName(to);
    const messages = loadTalkMessages(to);
    const rows = messages.map((message) => talkBubbleRow(message, to));
    if (pending) rows.push(typingRow(to));
    if (!rows.length) {
      rows.push(
        el("p", {
          className: "talk-empty",
          text: `Type or dictate a short message to ${who}. Preview replies stay on this device.`,
        })
      );
    }
    return screen(
      [
        header("Talk", who, status),
        el(
          "div",
          {
            className: "talk-thread",
            id: "talk-thread",
            tabIndex: 0,
            attrs: { "aria-label": `${who} message thread` },
          },
          rows.concat([el("div", { id: "talk-thread-end" })])
        ),
        el("div", { className: "talk-compose" }, [
          notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
          el("label", { htmlFor: "major-message", className: "sr-only", text: "Message" }),
          el("div", { className: "talk-compose-row" }, [
            el("input", {
              id: "major-message",
              type: "search",
              name: "major-message",
              autocomplete: "off",
              placeholder: "Write or speak a message",
              value: query,
              attrs: { enterkeyhint: "send", spellcheck: "true" },
            }),
            el(
              "button",
              {
                type: "button",
                className: "primary",
                id: "major-send",
                onClick: () => submitMajorMessage(),
              },
              pending ? "Wait" : "Send"
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
              id: "talk-people",
              onClick: () => navigate({ screen: "talk-picker" }),
            },
            "People"
          ),
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
      "talk-thread-screen"
    );
  }

  function lastAssistantText(to) {
    const messages = loadTalkMessages(to);
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant" && messages[i].text) return messages[i].text;
    }
    return "";
  }

  function speakMajorFromState(state) {
    const text = lastAssistantText(talkRecipient(state));
    if (!text) return false;
    return speak(text);
  }

  function speakMajorCard() {
    const state = currentState();
    if (!speakMajorFromState(state)) {
      const next = { ...state, notice: "Text to speech is not available here.", noticeKind: "error" };
      history.replaceState(next, "");
      render(next);
    }
  }

  function talkBase(to, extras) {
    return {
      screen: "talk",
      to,
      query: composerValue(),
      pending: false,
      requestId: "",
      notice: "",
      noticeKind: "",
      ...(extras || {}),
    };
  }

  function applyTalkResult(to, requestId, result) {
    const api = majorApi();
    if (api && typeof api.removeMessages === "function") {
      api.removeMessages(to, (item) => item.requestId === requestId && (item.role === "system" || item.status === "timeout"));
    }
    if (result && result.timeout) {
      if (api && typeof api.appendMessage === "function") {
        api.appendMessage(to, {
          role: "system",
          text: "No reply yet. Tap to check again.",
          requestId,
          status: "timeout",
        });
      }
    } else if (result && result.error) {
      if (stillOnTalk(to)) {
        navigate(talkBase(to, { notice: result.error, noticeKind: "error", requestId }), { push: false });
      }
      return;
    } else if (api && typeof api.appendMessage === "function") {
      const cards = (result && result.cards) || [];
      const reply = (result && result.reply) || cards.map((card) => card.body).join(" ");
      if (reply) {
        api.appendMessage(to, {
          role: "assistant",
          text: reply,
          requestId,
          from: (result && result.from) || to,
        });
      }
    }
    if (stillOnTalk(to)) {
      navigate(
        talkBase(to, {
          requestId: result && result.timeout ? requestId : "",
        }),
        { push: false }
      );
    }
  }

  async function retryTalkReply(requestId) {
    const api = majorApi();
    const current = currentState();
    const to = talkRecipient(current);
    const id = String(requestId || current.requestId || "");
    if (!api || !id || talkInFlight) return;
    if (typeof api.removeMessages === "function") {
      api.removeMessages(to, (item) => item.requestId === id && (item.role === "system" || item.status === "timeout"));
    }
    talkInFlight = true;
    navigate(talkBase(to, { pending: true, requestId: id, query: composerValue() }), { push: false });
    try {
      const result = await api.awaitReply(id, { to, source: (api.loadConfig() || {}).kind });
      applyTalkResult(to, id, result);
    } finally {
      talkInFlight = false;
    }
  }

  async function submitMajorMessage() {
    const api = majorApi();
    const input = document.getElementById("major-message");
    const query = input && input.value ? input.value.trim() : "";
    const current = currentState();
    const to = talkRecipient(current);
    if (talkInFlight || (current && current.pending)) return;
    if (!api) {
      navigate(talkBase(to, { query, notice: "The transport module did not load.", noticeKind: "error" }), { push: false });
      return;
    }
    if (!query) {
      navigate(talkBase(to, { query: "", notice: "Type or dictate a message first.", noticeKind: "error" }), { push: false });
      return;
    }
    if (typeof api.appendMessage === "function") {
      api.appendMessage(to, { role: "user", text: query, ts: Date.now() });
    }
    talkInFlight = true;
    navigate(talkBase(to, { query: "", pending: true, notice: "" }), { push: false });
    try {
      const posted = await api.postText(query, { to });
      if (posted && posted.error) {
        if (stillOnTalk(to)) {
          navigate(talkBase(to, { query, notice: posted.error, noticeKind: "error" }), { push: false });
        }
        return;
      }
      const requestId = posted && posted.requestId;
      if (requestId && typeof api.replaceMessage !== "function") {
        /* request id is used for poll retries */
      }
      if (stillOnTalk(to)) {
        navigate(talkBase(to, { query: "", pending: true, requestId }), { push: false });
      }
      const result = await api.awaitReply(requestId, {
        to,
        source: posted && posted.source,
        text: query,
        immediate: posted && posted.immediate,
      });
      applyTalkResult(to, requestId, result);
    } finally {
      talkInFlight = false;
    }
  }

  function selectedTalkKind() {
    const group = document.getElementById("major-kind");
    const value = group && group.dataset ? group.dataset.kind : "";
    return value === "relay" ? "relay" : "mock";
  }

  function setTalkKindToggle(value) {
    const kind = value === "relay" ? "relay" : "mock";
    const group = document.getElementById("major-kind");
    if (!group) return kind;
    group.dataset.kind = kind;
    const buttons = group.querySelectorAll("button.kind-toggle");
    for (const button of buttons) {
      const on = button.getAttribute("data-kind") === kind;
      button.classList.toggle("selected", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
    return kind;
  }

  function kindToggleButton(value, label, id, selected) {
    return el(
      "button",
      {
        type: "button",
        id,
        className: selected ? "kind-toggle selected" : "kind-toggle",
        onClick: () => setTalkKindToggle(value),
        attrs: {
          "data-kind": value,
          "aria-pressed": selected ? "true" : "false",
        },
      },
      label
    );
  }

  function renderMajorSettings(state) {
    const api = majorApi();
    const config = api ? api.loadConfig() : { kind: "mock", relayUrl: "", token: "" };
    const live = config.kind === "relay" || config.kind === "http";
    const notice = state && state.notice ? state.notice : "";
    const noticeKind = (state && state.noticeKind) || "";
    return screen([
      header("Talk", "Settings", "Stored on this device only"),
      el("div", { className: "content stack" }, [
        el("p", {
          className: "hint",
          text: "Preview mode works with no account. For live replies, paste your Worker URL and device token. Nothing here is stored in the app's source.",
        }),
        notice
          ? el("p", { className: "status", id: "major-settings-status", text: notice, dataset: { kind: noticeKind } })
          : null,
        el("div", { className: "field-wrap stack" }, [
          el("p", { className: "field-label", id: "major-kind-label", text: "Reply source" }),
          el(
            "div",
            {
              className: "kind-toggle-row",
              id: "major-kind",
              dataset: { kind: live ? "relay" : "mock" },
              attrs: { role: "group", "aria-labelledby": "major-kind-label" },
            },
            [
              kindToggleButton("mock", "Preview", "major-kind-preview", !live),
              kindToggleButton("relay", "Live relay", "major-kind-relay", live),
            ]
          ),
        ]),
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "major-endpoint", text: "Relay URL" }),
          el("input", {
            id: "major-endpoint",
            type: "search",
            name: "major-endpoint",
            autocomplete: "off",
            placeholder: "Paste your Worker URL",
            value: config.relayUrl || config.endpoint || "",
            attrs: { enterkeyhint: "next", spellcheck: "false" },
          }),
          el("label", { htmlFor: "major-token", text: "Device token" }),
          el("input", {
            id: "major-token",
            type: "search",
            name: "major-token",
            autocomplete: "off",
            placeholder: "Kept on this device, never in the repo",
            value: config.token || "",
            attrs: { enterkeyhint: "done", spellcheck: "false" },
          }),
        ]),
        el("p", {
          className: "hint",
          text: "Do not paste work data, passwords, or personal files here. The live relay only allows the published app origin.",
        }),
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-major-settings", onClick: saveMajorSettings }, "Save"),
        el("button", { type: "button", className: "secondary", id: "clear-major-settings", onClick: clearMajorSettings }, "Clear"),
        el("button", { type: "button", className: "secondary", onClick: () => navigate({ screen: "talk-picker" }) }, "Back"),
      ]),
    ]);
  }

  function saveMajorSettings() {
    const api = majorApi();
    if (!api) return;
    const relayUrl = ((document.getElementById("major-endpoint") || {}).value || "").trim();
    const token = ((document.getElementById("major-token") || {}).value || "").trim();
    let kind = selectedTalkKind();
    if (relayUrl && token) kind = "relay";
    api.saveConfig({ kind, relayUrl, token, endpoint: relayUrl, pollUrl: "" });
    const notice = kind === "relay" ? "Saved. Live relay is on." : "Saved. Preview mode.";
    navigate({ screen: "major-settings", notice, noticeKind: "ok" }, { push: false });
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
        backButton(),
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

  function scaleApi() {
    return window.ThespiaScale || null;
  }

  function mannyHeightCm() {
    if (scaleLibrary && Number(scaleLibrary.mannyHeightCm) > 0) return Number(scaleLibrary.mannyHeightCm);
    const api = scaleApi();
    return api ? api.MANNY_HEIGHT_CM : 180;
  }

  function scaleCategoryById(id) {
    if (!scaleLibrary || !Array.isArray(scaleLibrary.categories)) return null;
    return scaleLibrary.categories.find((category) => category.id === id) || null;
  }

  function scaleReadout(cm) {
    const api = scaleApi();
    if (!api) {
      return { feetInches: "", cm: `${cm} cm`, uu: `${cm} uu`, meters: "", mannyPercent: "" };
    }
    return api.formatAll(cm, mannyHeightCm());
  }

  function formatScaleValue(value) {
    if (!value) return "";
    if (value.text) return value.text;
    if (value.cm != null) {
      const all = scaleReadout(value.cm);
      return `${all.feetInches}  ·  ${all.cm}  ·  ${all.uu}`;
    }
    return "";
  }

  function scaleKindLabel(kind) {
    const api = scaleApi();
    return api ? api.kindLabel(kind) : "";
  }

  function renderScale() {
    const cats = scaleLibrary && Array.isArray(scaleLibrary.categories) ? scaleLibrary.categories.length : 0;
    const api = scaleApi();
    const saved = api ? api.loadMeasurements().length : 0;
    return screen([
      header("Scale Check", "Real-world size", "1 uu = 1 cm · UE 5.6"),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile primary",
            id: "open-scale-library",
            onClick: () => navigate({ screen: "scale-library" }),
          },
          [
            el("span", { className: "tile-title", text: "Reference library" }),
            el("span", {
              className: "tile-sub",
              text: cats ? `${cats} categories for doors, cover, characters, and more` : "Library unavailable",
            }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-scale-convert",
            onClick: () =>
              navigate({
                screen: "scale-convert",
                cm: mannyHeightCm(),
                stepId: "1in",
                query: "",
                notice: "",
              }),
          },
          [
            el("span", { className: "tile-title", text: "Converter" }),
            el("span", { className: "tile-sub", text: "Feet, inches, cm, uu, and percent of Manny" }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-scale-pace",
            onClick: () =>
              navigate({
                screen: "scale-pace",
                steps: 0,
                strideCm: scaleApi() ? scaleApi().loadStride() : 75,
                notice: "",
              }),
          },
          [
            el("span", { className: "tile-title", text: "Pace measure" }),
            el("span", { className: "tile-sub", text: "Count steps with Enter while you walk" }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-scale-mine",
            onClick: () => navigate({ screen: "scale-mine" }),
          },
          [
            el("span", { className: "tile-title", text: "My measurements" }),
            el("span", {
              className: "tile-sub",
              text: saved ? `${saved} saved on this device` : "Save a named size on this device",
            }),
          ]
        ),
      ]),
      el("div", { className: "footer" }, [homeButton()]),
    ]);
  }

  function renderScaleLibrary() {
    const categories = (scaleLibrary && scaleLibrary.categories) || [];
    const body = categories.length
      ? el(
          "ul",
          { className: "list" },
          categories.map((category) =>
            el("li", null, [
              el(
                "button",
                {
                  type: "button",
                  className: "tile",
                  onClick: () => navigate({ screen: "scale-category", categoryId: category.id, entryIndex: 0 }),
                },
                [
                  el("span", { className: "tile-title", text: category.title }),
                  el("span", {
                    className: "tile-sub",
                    text: `${category.entries ? category.entries.length : 0} · ${category.summary || ""}`,
                  }),
                ]
              ),
            ])
          )
        )
      : el("p", {
          className: "status",
          dataset: { kind: "error" },
          text: "The reference library could not be loaded. Converter, pace, and saved measurements still work.",
        });
    return screen([
      header("Scale Check", "Reference library", "Standards, code, engine defaults, and conventions"),
      el("div", { className: "content" }, [body]),
      el("div", { className: "footer" }, [backButton(), homeButton()]),
    ]);
  }

  function renderScaleEntryValues(entry) {
    const values = (entry && entry.values) || [];
    return values.map((value) =>
      el("p", { className: "scale-line" }, [
        el("span", { className: "scale-label", text: value.label ? `${value.label}` : "Size" }),
        el("span", { className: "scale-line-value", text: formatScaleValue(value) }),
      ])
    );
  }

  function renderScaleCategory(state) {
    const category = scaleCategoryById(state.categoryId);
    const entries = (category && category.entries) || [];
    const index = Math.max(0, Math.min(Math.max(entries.length - 1, 0), state.entryIndex || 0));
    const entry = entries[index];
    if (!category || !entry) {
      return screen([
        header("Scale Check", "Reference library", "Entry missing"),
        el("div", { className: "content" }, [
          el("p", { className: "status", dataset: { kind: "error" }, text: "That entry is not in the library." }),
        ]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ]);
    }
    const panel = el(
      "article",
      {
        className: "step-card scale-readout",
        tabIndex: 0,
        id: "scale-entry-panel",
        attrs: { "aria-label": `${entry.title}, ${index + 1} of ${entries.length}` },
      },
      [
        el("p", { className: "step-index", text: `${category.title} · ${index + 1} of ${entries.length}` }),
        el("h2", { text: entry.title }),
        el("p", { className: "kind-tag", text: scaleKindLabel(entry.kind) }),
        el("div", { className: "scale-lines" }, renderScaleEntryValues(entry)),
        entry.kindNote ? el("p", { className: "scale-note", text: entry.kindNote }) : null,
        entry.tip ? el("p", { className: "step-body", text: entry.tip }) : null,
      ]
    );
    return screen(
      [
        header("Scale Check", category.title, "Left or right to browse"),
        el("div", { className: "content" }, [panel]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ],
      "scale-screen"
    );
  }

  function updateScaleCategory(state, entryIndex) {
    const category = scaleCategoryById(state.categoryId);
    const entries = (category && category.entries) || [];
    const nextIndex = Math.max(0, Math.min(Math.max(entries.length - 1, 0), entryIndex));
    const next = { ...state, entryIndex: nextIndex };
    history.replaceState(next, "");
    render(next);
  }

  function applyScaleQuery(state) {
    const api = scaleApi();
    const input = document.getElementById("scale-parse-input");
    const query = input && input.value ? input.value.trim() : state.query || "";
    if (!query) {
      navigate({ ...state, query: "", notice: "Enter a size, like 6 ft 8 or 203 cm.", noticeKind: "error" }, { push: false });
      return;
    }
    if (!api) {
      navigate({ ...state, query, notice: "Converter is unavailable.", noticeKind: "error" }, { push: false });
      return;
    }
    const parsed = api.parseLength(query);
    if (!parsed.ok) {
      navigate({ ...state, query, notice: parsed.message, noticeKind: "error" }, { push: false });
      return;
    }
    navigate({ ...state, cm: parsed.cm, query, notice: "", noticeKind: "" }, { push: false });
  }

  function updateConverter(state, patch) {
    const next = { ...state, ...patch };
    history.replaceState(next, "");
    render(next);
  }

  function nudgeConverterValue(state, direction) {
    const api = scaleApi();
    if (!api) return;
    const step = api.stepByIndex(api.stepIndex(state.stepId));
    const cm = api.addCm(state.cm, direction * step.cm);
    updateConverter(state, { cm, notice: "", noticeKind: "" });
  }

  function nudgeConverterStep(state, direction) {
    const api = scaleApi();
    if (!api) return;
    const step = api.stepByIndex(api.stepIndex(state.stepId) + direction);
    updateConverter(state, { stepId: step.id, notice: "", noticeKind: "" });
  }

  function renderScaleConvert(state) {
    const api = scaleApi();
    const cm = Number(state.cm) > 0 ? Number(state.cm) : mannyHeightCm();
    const step = api ? api.stepByIndex(api.stepIndex(state.stepId || "1in")) : { id: "1in", label: "1 in" };
    const all = scaleReadout(cm);
    const query = state.query || "";
    const notice = state.notice || "";
    const panel = el(
      "article",
      {
        className: "step-card scale-readout",
        tabIndex: 0,
        id: "scale-value-panel",
        attrs: { "aria-label": "Converted size" },
      },
      [
        el("p", { className: "step-index", text: "Converted size" }),
        el("p", { className: "scale-main", text: all.feetInches }),
        el("p", { className: "scale-lines", text: `${all.cm}  ·  ${all.uu}` }),
        el("p", { className: "scale-lines", text: all.meters }),
        el("p", { className: "scale-note", text: all.mannyPercent }),
        el("p", { className: "hint", text: `Step ${step.label} · Up/Down change the value · Left/Right change the step` }),
      ]
    );
    return screen(
      [
        header("Scale Check", "Converter", "1 uu = 1 cm"),
        el("div", { className: "content stack" }, [
          panel,
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "scale-parse-input", text: "Type or dictate a size" }),
            el("input", {
              id: "scale-parse-input",
              type: "search",
              name: "scale-size",
              autocomplete: "off",
              placeholder: "6 ft 8 or 203 cm",
              value: query,
              attrs: { enterkeyhint: "done", spellcheck: "false" },
            }),
            el("p", {
              className: "hint",
              text: "On glasses, activate this field to dictate. A bare number is read as centimeters, which are also uu.",
            }),
          ]),
          notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
        ]),
        el("div", { className: "footer" }, [
          el(
            "button",
            { type: "button", className: "secondary primary", id: "apply-scale-parse", onClick: () => applyScaleQuery(currentState()) },
            "Apply"
          ),
          backButton(),
          homeButton(),
        ]),
      ],
      "scale-screen"
    );
  }

  function updatePace(state, patch) {
    const next = { ...state, ...patch };
    history.replaceState(next, "");
    render(next);
  }

  function addPaceStep() {
    const state = currentState();
    if (!state || state.screen !== "scale-pace") return;
    const nextSteps = Math.max(0, (state.steps || 0) + 1);
    updatePace(state, { steps: nextSteps, notice: "", noticeKind: "" });
  }

  function resetPace() {
    const state = currentState();
    if (!state || state.screen !== "scale-pace") return;
    updatePace(state, { steps: 0, notice: "Count cleared.", noticeKind: "ok" });
  }

  function saveStrideFromForm() {
    const api = scaleApi();
    const state = currentState();
    const input = document.getElementById("scale-stride-input");
    const query = input && input.value ? input.value.trim() : "";
    if (!api) return;
    const parsed = query ? api.parseLength(query) : { ok: true, cm: state.strideCm, message: "" };
    if (!parsed.ok) {
      updatePace(state, { notice: parsed.message, noticeKind: "error" });
      return;
    }
    const saved = api.saveStride(parsed.cm);
    updatePace(state, {
      strideCm: saved.ok ? saved.cm : state.strideCm,
      notice: saved.message,
      noticeKind: saved.ok ? "ok" : "error",
    });
  }

  function renderScalePace(state) {
    const api = scaleApi();
    const strideCm = Number(state.strideCm) > 0 ? Number(state.strideCm) : api ? api.loadStride() : 75;
    const steps = Math.max(0, state.steps || 0);
    const distance = api ? api.paceDistance(steps, strideCm) : { cm: steps * strideCm, steps, strideCm };
    const all = scaleReadout(distance.cm);
    const strideLabel = scaleReadout(strideCm);
    const notice = state.notice || "";
    return screen(
      [
        header("Scale Check", "Pace measure", "Enter counts a step"),
        el("div", { className: "content stack" }, [
          el("article", { className: "step-card scale-readout", id: "scale-pace-panel" }, [
            el("p", { className: "step-index", text: `${steps} step${steps === 1 ? "" : "s"}` }),
            el("p", { className: "scale-main", text: all.uu }),
            el("p", { className: "scale-lines", text: `${all.feetInches}  ·  ${all.cm}` }),
            el("p", { className: "scale-lines", text: all.meters }),
            el("p", { className: "scale-note", text: `Stride ${strideLabel.cm}  ·  ${strideLabel.feetInches}` }),
          ]),
          el("div", { className: "field-wrap stack" }, [
            el("label", { htmlFor: "scale-stride-input", text: "Your stride" }),
            el("input", {
              id: "scale-stride-input",
              type: "search",
              name: "scale-stride",
              autocomplete: "off",
              placeholder: "75 cm or 2 ft 6 in",
              value: "",
              attrs: { enterkeyhint: "done", spellcheck: "false" },
            }),
            el("p", {
              className: "hint",
              text: "Default is 75 cm. Save once, then keep Enter on Step while you walk. This stays on the device.",
            }),
          ]),
          notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
        ]),
        el("div", { className: "footer" }, [
          el("button", { type: "button", className: "secondary primary", id: "scale-step", onClick: addPaceStep }, "Step"),
          el("button", { type: "button", className: "secondary", id: "scale-reset", onClick: resetPace }, "Reset"),
          el("button", { type: "button", className: "secondary", id: "save-stride", onClick: saveStrideFromForm }, "Save stride"),
          backButton(),
        ]),
      ],
      "scale-screen"
    );
  }

  function renderScaleMine() {
    const api = scaleApi();
    const items = api ? api.loadMeasurements() : [];
    const body = items.length
      ? el(
          "ul",
          { className: "list" },
          items.map((item) => {
            const all = scaleReadout(item.cm);
            return el("li", null, [
              el(
                "button",
                {
                  type: "button",
                  className: "tile",
                  onClick: () => navigate({ screen: "scale-detail", id: item.id }),
                },
                [
                  el("span", { className: "tile-title", text: item.name }),
                  el("span", { className: "tile-sub", text: `${all.feetInches}  ·  ${all.cm}  ·  ${all.uu}` }),
                ]
              ),
            ]);
          })
        )
      : el("p", { className: "muted", text: "Nothing saved yet. Add a name and a size; it stays on this device." });
    return screen([
      header("Scale Check", "My measurements", "Saved on this device only"),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile primary",
            id: "open-scale-edit",
            onClick: () => navigate({ screen: "scale-edit", id: null, name: "", size: "", notice: "" }),
          },
          [
            el("span", { className: "tile-title", text: "New measurement" }),
            el("span", { className: "tile-sub", text: "Name a door, counter, or other size you see" }),
          ]
        ),
        body,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "open-scale-backup",
            onClick: () => navigate({ screen: "scale-backup" }),
          },
          "Export / Import"
        ),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function renderScaleDetail(state) {
    const api = scaleApi();
    const item = api ? api.getMeasurement(state.id) : null;
    if (!item) {
      return screen([
        header("Scale Check", "My measurements", "Not found"),
        el("div", { className: "content" }, [
          el("p", { className: "status", dataset: { kind: "error" }, text: "That measurement is not on this device." }),
        ]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ]);
    }
    const all = scaleReadout(item.cm);
    return screen([
      header("Scale Check", item.name, "Saved on this device"),
      el("div", { className: "content" }, [
        el("article", { className: "step-card scale-readout" }, [
          el("p", { className: "scale-main", text: all.feetInches }),
          el("p", { className: "scale-lines", text: `${all.cm}  ·  ${all.uu}` }),
          el("p", { className: "scale-lines", text: all.meters }),
          el("p", { className: "scale-note", text: all.mannyPercent }),
        ]),
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "open-scale-in-converter",
            onClick: () =>
              navigate({ screen: "scale-convert", cm: item.cm, stepId: "1in", query: "", notice: "" }),
          },
          "Converter"
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "edit-measurement",
            onClick: () =>
              navigate({
                screen: "scale-edit",
                id: item.id,
                name: item.name,
                size: api.formatCm(item.cm),
                notice: "",
              }),
          },
          "Edit"
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "delete-measurement",
            onClick: () => navigate({ screen: "scale-delete", id: item.id, name: item.name }),
          },
          "Delete"
        ),
        backButton(),
      ]),
    ]);
  }

  function saveMeasurementFromForm() {
    const api = scaleApi();
    const state = currentState();
    const nameInput = document.getElementById("scale-measure-name");
    const sizeInput = document.getElementById("scale-measure-size");
    const name = nameInput && nameInput.value ? nameInput.value.trim() : "";
    const size = sizeInput && sizeInput.value ? sizeInput.value.trim() : "";
    if (!api) return;
    if (!name) {
      navigate(
        { ...state, name, size, notice: "Add a name first.", noticeKind: "error" },
        { push: false }
      );
      return;
    }
    const parsed = api.parseLength(size);
    if (!parsed.ok) {
      navigate({ ...state, name, size, notice: parsed.message, noticeKind: "error" }, { push: false });
      return;
    }
    const result = api.upsertMeasurement({ id: state.id || undefined, name, cm: parsed.cm });
    if (!result.ok) {
      const message =
        result.reason === "full"
          ? "You already have the maximum number of measurements on this device."
          : "Could not save on this device.";
      navigate({ ...state, name, size, notice: message, noticeKind: "error" }, { push: false });
      return;
    }
    navigate({ screen: "scale-detail", id: result.item.id }, { push: false });
  }

  function renderScaleEdit(state) {
    const isEdit = Boolean(state.id);
    const name = state.name || "";
    const size = state.size || "";
    const notice = state.notice || "";
    const api = scaleApi();
    const preview = size && api ? api.parseLength(size) : null;
    const previewText =
      preview && preview.ok
        ? (() => {
            const all = scaleReadout(preview.cm);
            return `${all.feetInches}  ·  ${all.cm}  ·  ${all.uu}`;
          })()
        : "";
    return screen([
      header("Scale Check", isEdit ? "Edit measurement" : "New measurement", "Saved on this device only"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "scale-measure-name", text: "Name" }),
          el("input", {
            id: "scale-measure-name",
            type: "search",
            name: "scale-measure-name",
            autocomplete: "off",
            placeholder: "Write or speak a name",
            value: name,
            attrs: { enterkeyhint: "next", maxlength: String(api ? api.NAME_MAX : 80), spellcheck: "true" },
          }),
          el("label", { htmlFor: "scale-measure-size", text: "Size" }),
          el("input", {
            id: "scale-measure-size",
            type: "search",
            name: "scale-measure-size",
            autocomplete: "off",
            placeholder: "6 ft 8 or 203 cm",
            value: size,
            attrs: { enterkeyhint: "done", spellcheck: "false" },
          }),
          el("p", {
            className: "hint",
            text: "On glasses, activate a field to dictate. A bare number is read as centimeters, which are also uu.",
          }),
          previewText ? el("p", { className: "scale-note", text: previewText }) : null,
        ]),
        notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          { type: "button", className: "secondary primary", id: "save-measurement", onClick: saveMeasurementFromForm },
          "Save"
        ),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function confirmDeleteMeasurement() {
    const api = scaleApi();
    const state = currentState();
    if (!api || !state.id) return;
    const ok = api.deleteMeasurement(state.id);
    if (!ok) {
      navigate({ ...state, notice: "Could not delete that measurement.", noticeKind: "error" }, { push: false });
      return;
    }
    navigate({ screen: "scale-mine" }, { push: false });
  }

  function renderScaleDelete(state) {
    const name = state.name || "this measurement";
    return screen([
      header("Scale Check", "Delete measurement", "This cannot be undone on this device"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", { className: "step-body", text: `Remove "${name}" from this device?` }),
        ]),
        state.notice
          ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } })
          : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "confirm-delete-measurement",
            onClick: confirmDeleteMeasurement,
          },
          "Delete"
        ),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function importMeasurementsFromForm() {
    const api = scaleApi();
    const area = document.getElementById("scale-backup-blob");
    const textValue = area && area.value ? area.value : "";
    if (!api) return;
    const result = api.importMeasurementsBlob(textValue);
    navigate(
      {
        screen: "scale-backup",
        blob: result.ok ? api.exportMeasurementsBlob() : textValue,
        notice: result.message,
        noticeKind: result.ok ? "ok" : "error",
      },
      { push: false }
    );
  }

  function renderScaleBackup(state) {
    const api = scaleApi();
    const blob = state.blob != null ? state.blob : api ? api.exportMeasurementsBlob() : "{\n  \"version\": 1,\n  \"items\": []\n}";
    const notice = state.notice || "";
    return screen([
      header("Scale Check", "Export / Import", "Backup stays on this device until you copy it"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "scale-backup-blob", text: "JSON text blob" }),
          el("textarea", {
            id: "scale-backup-blob",
            className: "field-area",
            name: "scale-backup",
            value: blob,
            attrs: { spellcheck: "false", rows: "8", autocomplete: "off" },
          }),
          el("p", {
            className: "hint",
            text: "Copy this to back up your measurements, or paste a backup and choose Import. Nothing is uploaded.",
          }),
        ]),
        notice ? el("p", { className: "status", text: notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "refresh-scale-backup",
            onClick: () =>
              navigate(
                {
                  screen: "scale-backup",
                  blob: scaleApi() ? scaleApi().exportMeasurementsBlob() : "",
                  notice: "",
                  noticeKind: "",
                },
                { push: false }
              ),
          },
          "Refresh export"
        ),
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "import-measurements",
            onClick: importMeasurementsFromForm,
          },
          "Import"
        ),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function tasksApi() {
    return window.WorldStaticTasks || null;
  }

  function prompterApi() {
    return window.WorldStaticPrompter || null;
  }

  function loadTaskData() {
    const api = tasksApi();
    return api ? api.loadAndPersist() : { version: 1, lists: [] };
  }

  function persistTasks(data) {
    const api = tasksApi();
    if (!api) return false;
    return Boolean(api.save(data).ok);
  }

  function loadPrompterData() {
    const api = prompterApi();
    return api ? api.loadAndPersist() : { version: 1, fontSize: 36, speed: 28, scripts: [] };
  }

  function persistPrompter(data) {
    const api = prompterApi();
    if (!api) return false;
    return Boolean(api.save(data).ok);
  }

  function svgNode(tag, attrs, children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value != null && value !== false) node.setAttribute(key, String(value));
      }
    }
    if (children) {
      for (const child of children) {
        if (child) node.append(child);
      }
    }
    return node;
  }

  function strokeIcon(name) {
    const shapes = TILE_ICON_SHAPES[name] || TILE_ICON_SHAPES.tasks;
    const children = shapes.map((shape) => {
      if (typeof shape === "string") {
        return svgNode("path", {
          d: shape,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.5",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        });
      }
      return svgNode(shape.tag, {
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...shape,
        tag: undefined,
      });
    });
    return svgNode(
      "svg",
      {
        class: "tile-icon",
        viewBox: "0 0 24 24",
        width: "20",
        height: "20",
        "aria-hidden": "true",
        focusable: "false",
      },
      children
    );
  }

  const TILE_ICON_SHAPES = {
    tasks: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.2 6.1l1.3 1.4 2.4-2.6", "M5 12h.01", "M5 18h.01"],
    prompter: ["M5 5h14", "M5 10h14", "M5 15h10", "M8 19h8"],
    blueprint: [
      { tag: "circle", cx: "6.5", cy: "7.5", r: "2" },
      { tag: "circle", cx: "17.5", cy: "7.5", r: "2" },
      { tag: "circle", cx: "12", cy: "17", r: "2" },
      "M8.3 8.8l2.4 6",
      "M15.7 8.8l-2.4 6",
    ],
    scale: ["M4 8h16v8H4z", "M8 8v3", "M12 8v5", "M16 8v3", "M6 16v-2"],
    talk: [
      { tag: "circle", cx: "8", cy: "12", r: "3.2" },
      { tag: "circle", cx: "16", cy: "12", r: "3.2" },
      "M11.2 12h1.6",
    ],
    major: [
      "M5 7.5c0-1.4 1.3-2.5 3-2.5h8c1.7 0 3 1.1 3 2.5v5c0 1.4-1.3 2.5-3 2.5H11l-3.5 2.5V15H8c-1.7 0-3-1.1-3-2.5z",
    ],
    scan: ["M12 4l8 4.5v7L12 20l-8-4.5v-7z", "M12 20v-7.5", "M4 8.5l8 4 8-4"],
    overlock: ["M8 11V8.5a4 4 0 0 1 8 0V11", "M7 11h10v9H7z"],
    funds: [
      "M5 9.5l2-3h10l2 3",
      "M4.5 9.5h15v9.2A1.8 1.8 0 0 1 17.7 20.5H6.3A1.8 1.8 0 0 1 4.5 18.7z",
      { tag: "circle", cx: "16", cy: "14.8", r: "1.35" },
    ],
  };

  function resolveTaskSelection(state) {
    const api = tasksApi();
    const data = loadTaskData();
    const lists = data.lists || [];
    if (!lists.length) return { data, lists, list: null, listIndex: 0, taskIndex: 0, tasks: [] };
    let listIndex = lists.findIndex((list) => list.id === state.listId);
    if (listIndex < 0) listIndex = 0;
    const list = lists[listIndex];
    const tasks = list.tasks || [];
    let taskIndex = 0;
    if (state.taskId) {
      const found = tasks.findIndex((task) => task.id === state.taskId);
      taskIndex = found >= 0 ? found : 0;
    } else if (Number.isFinite(state.taskIndex)) {
      taskIndex = state.taskIndex;
    }
    if (tasks.length) taskIndex = Math.max(0, Math.min(tasks.length - 1, taskIndex));
    else taskIndex = 0;
    return { api, data, lists, list, listIndex, taskIndex, tasks };
  }

  function showTasks(state, extra, { push = false } = {}) {
    navigate(
      {
        screen: "tasks",
        listId: state && state.listId,
        taskIndex: state && state.taskIndex,
        taskId: state && state.taskId,
        notice: "",
        noticeKind: "",
        ...(extra || {}),
      },
      { push }
    );
  }

  function shiftTaskList(state, direction) {
    const sel = resolveTaskSelection(state);
    if (sel.lists.length < 2) return;
    const nextIndex = (sel.listIndex + direction + sel.lists.length) % sel.lists.length;
    showTasks(state, { listId: sel.lists[nextIndex].id, taskIndex: 0, taskId: null });
  }

  function shiftTaskIndex(state, direction) {
    const sel = resolveTaskSelection(state);
    if (!sel.tasks.length) return;
    const next = Math.max(0, Math.min(sel.tasks.length - 1, sel.taskIndex + direction));
    if (next === sel.taskIndex) return;
    showTasks(state, { listId: sel.list.id, taskIndex: next, taskId: sel.tasks[next].id });
  }

  function selectedTask(state) {
    const sel = resolveTaskSelection(state);
    return sel.tasks[sel.taskIndex] || null;
  }

  function toggleSelectedTask(state) {
    const api = tasksApi();
    const sel = resolveTaskSelection(state);
    const task = sel.tasks[sel.taskIndex];
    if (!api || !task) return;
    api.toggleTask(sel.data, task.id);
    persistTasks(sel.data);
    showTasks(state, { listId: sel.list.id, taskId: task.id, taskIndex: sel.taskIndex });
  }

  function renderTasks(state) {
    const api = tasksApi();
    const sel = resolveTaskSelection(state);
    const progress = sel.list && api ? api.progress(sel.list) : { done: 0, total: 0 };
    const items = sel.tasks.length
      ? sel.tasks.map((task, index) => {
          const dueLabel = task.due && api ? api.formatDue(task.due) : "";
          const overdue = Boolean(dueLabel && dueLabel.indexOf("Overdue") === 0);
          return el(
            "button",
            {
              type: "button",
              className: "tile task-item" + (index === sel.taskIndex ? " is-selected" : "") + (task.done ? " is-done" : ""),
              id: index === sel.taskIndex ? "selected-task" : undefined,
              dataset: { taskId: task.id },
              onClick: () => {
                if (index === sel.taskIndex) toggleSelectedTask({ ...state, listId: sel.list.id, taskId: task.id, taskIndex: index });
                else showTasks(state, { listId: sel.list.id, taskId: task.id, taskIndex: index });
              },
            },
            [
              el("span", { className: "tile-title" }, [
                el("span", { className: "task-mark", text: task.done ? "✓" : "○" }),
                task.title,
              ]),
              task.note ? el("span", { className: "tile-sub", text: task.note }) : null,
              dueLabel
                ? el("span", { className: "task-due" + (overdue ? " is-overdue" : ""), text: dueLabel })
                : null,
            ]
          );
        })
      : [
          el("article", { className: "card" }, [
            el("p", { className: "step-body", text: "No tasks in this list yet. Choose New task to add one." }),
          ]),
        ];

    return screen([
      header("Task Cards", sel.list ? sel.list.name : "Tasks", progress.total ? `${progress.done} of ${progress.total} done` : "No tasks yet"),
      el("div", { className: "content stack" }, [
        el("p", { className: "task-switcher" }, [
          el("span", { className: "task-switcher-hint", text: "Left / Right to change lists" }),
        ]),
        el("div", { className: "stack", attrs: { role: "list" } }, items),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "open-new-task", onClick: () => openTaskEditor(sel.list && sel.list.id) }, "New task"),
        el("button", { type: "button", className: "secondary", id: "open-task-actions", onClick: () => openTaskActions(state) }, "Actions"),
        el("button", { type: "button", className: "secondary", id: "open-task-lists", onClick: () => openTaskListMenu(state) }, "Lists"),
        homeButton(),
      ]),
    ]);
  }

  function openTaskActions(state) {
    const sel = resolveTaskSelection(state);
    if (!sel.tasks.length) {
      showTasks(state, { notice: "Add a task first.", noticeKind: "error" });
      return;
    }
    navigate(
      {
        screen: "tasks-actions",
        listId: sel.list.id,
        taskId: sel.tasks[sel.taskIndex].id,
        taskIndex: sel.taskIndex,
      },
      { push: true }
    );
  }

  function openTaskListMenu(state) {
    const sel = resolveTaskSelection(state);
    navigate(
      { screen: "tasks-list-menu", listId: sel.list ? sel.list.id : null, taskIndex: sel.taskIndex, taskId: state.taskId },
      { push: true }
    );
  }

  function openTaskEditor(listId, task) {
    navigate(
      {
        screen: "tasks-edit",
        listId,
        taskId: task ? task.id : "",
        title: task ? task.title : "",
        note: task ? task.note : "",
        due: task ? task.due || "" : "",
        notice: "",
      },
      { push: true }
    );
  }

  function renderTaskActions(state) {
    const api = tasksApi();
    const sel = resolveTaskSelection(state);
    const task = sel.tasks[sel.taskIndex];
    if (!task) {
      return screen([
        header("Task Cards", "Actions", "No task selected"),
        el("div", { className: "content" }, [el("p", { className: "status", text: "That task is gone." })]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ]);
    }
    return screen([
      header("Task Cards", "Actions", task.title),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile primary",
            id: "toggle-task-done",
            onClick: () => {
              api.toggleTask(sel.data, task.id);
              persistTasks(sel.data);
              showTasks(state, { listId: sel.list.id, taskId: task.id });
            },
          },
          [el("span", { className: "tile-title", text: task.done ? "Mark not done" : "Mark done" })]
        ),
        el("button", { type: "button", className: "tile", id: "edit-task", onClick: () => openTaskEditor(sel.list.id, task) }, [
          el("span", { className: "tile-title", text: "Edit" }),
          el("span", { className: "tile-sub", text: "Title, note, or due day" }),
        ]),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "move-task-up",
            onClick: () => {
              api.moveTaskBy(sel.data, task.id, -1);
              persistTasks(sel.data);
              showTasks(state, { listId: sel.list.id, taskId: task.id });
            },
          },
          [el("span", { className: "tile-title", text: "Move up" })]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "move-task-down",
            onClick: () => {
              api.moveTaskBy(sel.data, task.id, 1);
              persistTasks(sel.data);
              showTasks(state, { listId: sel.list.id, taskId: task.id });
            },
          },
          [el("span", { className: "tile-title", text: "Move down" })]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "move-task-list",
            onClick: () =>
              navigate({ screen: "tasks-move", listId: sel.list.id, taskId: task.id, taskIndex: sel.taskIndex }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "Move to another list" })]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "delete-task",
            onClick: () =>
              navigate({ screen: "tasks-delete", listId: sel.list.id, taskId: task.id, kind: "task" }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "Delete" })]
        ),
      ]),
      el("div", { className: "footer" }, [backButton(), homeButton()]),
    ]);
  }

  function renderTaskMove(state) {
    const api = tasksApi();
    const sel = resolveTaskSelection(state);
    const task = sel.tasks[sel.taskIndex];
    const targets = sel.lists.filter((list) => !sel.list || list.id !== sel.list.id);
    return screen([
      header("Task Cards", "Move", task ? task.title : "Task"),
      el("div", { className: "content stack" }, [
        ...(targets.length
          ? targets.map((list) =>
              el(
                "button",
                {
                  type: "button",
                  className: "tile",
                  onClick: () => {
                    api.moveTask(sel.data, task.id, list.id);
                    persistTasks(sel.data);
                    showTasks(state, { listId: list.id, taskId: task.id, notice: `Moved to ${list.name}.`, noticeKind: "ok" });
                  },
                },
                [el("span", { className: "tile-title", text: list.name })]
              )
            )
          : [el("p", { className: "status", text: "There is no other list to move this to." })]),
      ]),
      el("div", { className: "footer" }, [backButton(), homeButton()]),
    ]);
  }

  function renderTaskListMenu(state) {
    const sel = resolveTaskSelection(state);
    const doneCount = sel.list ? sel.list.tasks.filter((task) => task.done).length : 0;
    return screen([
      header("Task Cards", "Lists", sel.list ? sel.list.name : ""),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "rename-task-list",
            onClick: () =>
              navigate({ screen: "tasks-list-name", mode: "rename", listId: sel.list && sel.list.id, name: sel.list ? sel.list.name : "" }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "Rename list" })]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "new-task-list",
            onClick: () => navigate({ screen: "tasks-list-name", mode: "create", listId: sel.list && sel.list.id, name: "" }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "New list" })]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "clear-done-tasks",
            onClick: () => {
              const api = tasksApi();
              const result = api.clearDone(sel.data, sel.list.id);
              persistTasks(sel.data);
              showTasks(state, {
                listId: sel.list.id,
                taskIndex: 0,
                notice: result.removed ? `Cleared ${result.removed} done ${result.removed === 1 ? "task" : "tasks"}.` : "No done tasks to clear.",
                noticeKind: "ok",
              });
            },
          },
          [
            el("span", { className: "tile-title", text: "Clear done" }),
            el("span", { className: "tile-sub", text: doneCount ? `${doneCount} can be cleared` : "None done in this list" }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "open-task-backup",
            onClick: () => navigate({ screen: "tasks-backup" }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "Export / Import" }), el("span", { className: "tile-sub", text: "JSON backup of your lists" })]
        ),
        sel.lists.length > 1
          ? el(
              "button",
              {
                type: "button",
                className: "tile",
                id: "delete-task-list",
                onClick: () =>
                  navigate({ screen: "tasks-delete", kind: "list", listId: sel.list.id }, { push: false }),
              },
              [el("span", { className: "tile-title", text: "Delete list" })]
            )
          : null,
      ]),
      el("div", { className: "footer" }, [backButton(), homeButton()]),
    ]);
  }

  function renderTaskListName(state) {
    const mode = state.mode === "rename" ? "rename" : "create";
    const value = state.name != null ? state.name : "";
    return screen([
      header("Task Cards", mode === "rename" ? "Rename list" : "New list", "Saved on this device only"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "task-list-name", text: "List name" }),
          el("input", {
            id: "task-list-name",
            type: "search",
            name: "task-list-name",
            autocomplete: "off",
            placeholder: "Work, Home, or a project name",
            value,
            attrs: { enterkeyhint: "done", maxlength: "40", spellcheck: "true" },
          }),
        ]),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-task-list-name", onClick: saveTaskListName }, "Save"),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function saveTaskListName() {
    const api = tasksApi();
    const state = currentState();
    const input = document.getElementById("task-list-name");
    const name = input && input.value ? input.value : "";
    const data = loadTaskData();
    const result = state.mode === "rename" ? api.renameList(data, state.listId, name) : api.addList(data, name);
    if (!result.ok) {
      navigate({ ...state, name, notice: result.message, noticeKind: "error" }, { push: false });
      return;
    }
    persistTasks(data);
    showTasks(state, { listId: result.list.id, taskIndex: 0, notice: "Saved on this device.", noticeKind: "ok" });
  }

  function renderTaskEditor(state) {
    return screen([
      header("Task Cards", state.taskId ? "Edit task" : "New task", "Dictate or type, then save"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "task-title", text: "Title" }),
          el("input", {
            id: "task-title",
            type: "search",
            name: "task-title",
            autocomplete: "off",
            placeholder: "What needs doing?",
            value: state.title || "",
            attrs: { enterkeyhint: "next", maxlength: "80", spellcheck: "true" },
          }),
          el("label", { htmlFor: "task-note", text: "Note (optional)" }),
          el("input", {
            id: "task-note",
            type: "search",
            name: "task-note",
            autocomplete: "off",
            placeholder: "A short note",
            value: state.note || "",
            attrs: { enterkeyhint: "next", maxlength: "240", spellcheck: "true" },
          }),
          el("label", { htmlFor: "task-due", text: "Due day (optional)" }),
          el("input", {
            id: "task-due",
            type: "search",
            name: "task-due",
            autocomplete: "off",
            placeholder: "Today, Friday, or Nov 25",
            value: state.due || "",
            attrs: { enterkeyhint: "done", maxlength: "40", spellcheck: "false" },
          }),
        ]),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-task", onClick: saveTaskFromForm }, "Save"),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function readTaskForm() {
    const title = document.getElementById("task-title");
    const note = document.getElementById("task-note");
    const due = document.getElementById("task-due");
    return {
      title: title && title.value ? title.value : "",
      note: note && note.value ? note.value : "",
      due: due && due.value ? due.value : "",
    };
  }

  function saveTaskFromForm() {
    const api = tasksApi();
    const state = currentState();
    const fields = readTaskForm();
    const data = loadTaskData();
    let dueValue = fields.due;
    if (fields.due) {
      const parsed = api.parseDue(fields.due);
      if (!parsed.ok) {
        navigate({ ...state, ...fields, notice: parsed.message, noticeKind: "error" }, { push: false });
        return;
      }
      dueValue = parsed.due;
    } else {
      dueValue = null;
    }
    const result = state.taskId
      ? api.updateTask(data, state.taskId, { title: fields.title, note: fields.note, due: dueValue })
      : api.addTask(data, state.listId, { title: fields.title, note: fields.note, due: dueValue });
    if (!result.ok) {
      navigate({ ...state, ...fields, notice: result.message, noticeKind: "error" }, { push: false });
      return;
    }
    persistTasks(data);
    showTasks(state, { listId: result.list.id, taskId: result.task.id, notice: "Saved on this device.", noticeKind: "ok" });
  }

  function renderTaskDelete(state) {
    const api = tasksApi();
    const data = loadTaskData();
    const kind = state.kind === "list" ? "list" : "task";
    const list = api.listById(data, state.listId);
    const found = state.taskId ? api.taskById(data, state.taskId) : null;
    const label = kind === "list" ? (list ? list.name : "this list") : found ? found.task.title : "this task";
    return screen([
      header("Task Cards", kind === "list" ? "Delete list" : "Delete task", "This stays on this device"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", {
            className: "step-body",
            text: kind === "list" ? `Delete ${label} and its tasks from this device?` : `Delete “${label}”?`,
          }),
        ]),
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary primary",
            id: "confirm-delete-task",
            onClick: () => {
              if (kind === "list") api.deleteList(data, state.listId);
              else api.deleteTask(data, state.taskId);
              persistTasks(data);
              const next = loadTaskData();
              const listId = kind === "list" ? (next.lists[0] && next.lists[0].id) : state.listId;
              showTasks(state, { listId, taskIndex: 0, taskId: null, notice: "Deleted.", noticeKind: "ok" });
            },
          },
          "Delete"
        ),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function renderTaskBackup(state) {
    const api = tasksApi();
    const blob = state.blob != null ? state.blob : api.exportBlob(loadTaskData());
    return screen([
      header("Task Cards", "Export / Import", "Backup stays on this device until you copy it"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "task-backup-blob", text: "JSON text blob" }),
          el("textarea", {
            id: "task-backup-blob",
            className: "field-area",
            name: "task-backup",
            value: blob,
            attrs: { spellcheck: "false", rows: "8", autocomplete: "off" },
          }),
          el("p", { className: "hint", text: "Copy this to back up your lists, or paste a backup and choose Import. Nothing is uploaded." }),
        ]),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "refresh-task-backup",
            onClick: () => navigate({ screen: "tasks-backup", blob: api.exportBlob(loadTaskData()) }, { push: false }),
          },
          "Refresh export"
        ),
        el("button", { type: "button", className: "secondary primary", id: "import-tasks", onClick: importTasksFromForm }, "Import"),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function importTasksFromForm() {
    const api = tasksApi();
    const area = document.getElementById("task-backup-blob");
    const textValue = area && area.value ? area.value : "";
    const result = api.importBlob(textValue, loadTaskData());
    if (result.ok) persistTasks(result.data);
    navigate(
      {
        screen: "tasks-backup",
        blob: result.ok ? api.exportBlob(result.data) : textValue,
        notice: result.message,
        noticeKind: result.ok ? "ok" : "error",
      },
      { push: false }
    );
  }

  function renderPrompter() {
    const data = loadPrompterData();
    const scripts = data.scripts || [];
    const tiles = scripts.length
      ? scripts.map((script) => {
          const api = prompterApi();
          const segments = api.parseSegments(script.body);
          return el(
            "button",
            {
              type: "button",
              className: "tile",
              onClick: () => navigate({ screen: "prompter-detail", scriptId: script.id }),
            },
            [
              el("span", { className: "tile-title", text: script.title }),
              el("span", {
                className: "tile-sub",
                text: segments.length ? `${segments.length} ${segments.length === 1 ? "segment" : "segments"}` : "Empty script",
              }),
            ]
          );
        })
      : [el("article", { className: "card" }, [el("p", { className: "step-body", text: "No scripts yet. Choose New script to add one." })])];
    return screen([
      header("Teleprompter", "Scripts", "For streaming notes and talking points"),
      el("div", { className: "content stack" }, tiles),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "open-new-script", onClick: () => openScriptEditor() }, "New script"),
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "open-prompter-backup",
            onClick: () => navigate({ screen: "prompter-backup" }),
          },
          "Export / Import"
        ),
        homeButton(),
      ]),
    ]);
  }

  function openScriptEditor(script) {
    navigate(
      {
        screen: "prompter-edit",
        scriptId: script ? script.id : "",
        title: script ? script.title : "",
        body: script ? script.body : "",
        notice: "",
      },
      { push: true }
    );
  }

  function renderPrompterDetail(state) {
    const api = prompterApi();
    const data = loadPrompterData();
    const script = api.scriptById(data, state.scriptId);
    if (!script) {
      return screen([
        header("Teleprompter", "Script", "Not found"),
        el("div", { className: "content" }, [el("p", { className: "status", text: "That script is gone." })]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ]);
    }
    const segments = api.parseSegments(script.body);
    return screen([
      header("Teleprompter", script.title, segments.length ? `${segments.length} ${segments.length === 1 ? "segment" : "segments"}` : "No segments yet"),
      el("div", { className: "content stack" }, [
        el(
          "button",
          {
            type: "button",
            className: "tile primary",
            id: "start-prompter",
            onClick: () => startPrompterPlay(script.id),
          },
          [el("span", { className: "tile-title", text: "Play" }), el("span", { className: "tile-sub", text: "Enter pauses · Up/Down speed" })]
        ),
        el("button", { type: "button", className: "tile", id: "edit-script", onClick: () => openScriptEditor(script) }, [
          el("span", { className: "tile-title", text: "Edit" }),
        ]),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "cycle-prompter-size",
            onClick: () => {
              api.nudgeFontSize(data, 1);
              persistPrompter(data);
              navigate({ screen: "prompter-detail", scriptId: script.id }, { push: false });
            },
          },
          [
            el("span", { className: "tile-title", text: "Text size" }),
            el("span", { className: "tile-sub", text: `${data.fontSize} px` }),
          ]
        ),
        el(
          "button",
          {
            type: "button",
            className: "tile",
            id: "delete-script",
            onClick: () => navigate({ screen: "prompter-delete", scriptId: script.id }, { push: false }),
          },
          [el("span", { className: "tile-title", text: "Delete" })]
        ),
      ]),
      el("div", { className: "footer" }, [backButton(), homeButton()]),
    ]);
  }

  function renderPrompterEditor(state) {
    return screen([
      header("Teleprompter", state.scriptId ? "Edit script" : "New script", "Dictate a line or paste the full script"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "script-title", text: "Title" }),
          el("input", {
            id: "script-title",
            type: "search",
            name: "script-title",
            autocomplete: "off",
            placeholder: "Stream intro",
            value: state.title || "",
            attrs: { enterkeyhint: "next", maxlength: "80", spellcheck: "true" },
          }),
          el("label", { htmlFor: "script-line", text: "Add a dictated line" }),
          el("input", {
            id: "script-line",
            type: "search",
            name: "script-line",
            autocomplete: "off",
            placeholder: "Dictate a line, then Enter",
            value: "",
            attrs: { enterkeyhint: "done", maxlength: "400", spellcheck: "true" },
          }),
          el("label", { htmlFor: "script-body", text: "Script body" }),
          el("textarea", {
            id: "script-body",
            className: "field-area",
            name: "script-body",
            value: state.body || "",
            attrs: { spellcheck: "true", rows: "8", autocomplete: "off" },
          }),
          el("p", { className: "hint", text: "Lines that start with ## become segments. Add a time like ## Intro 2m." }),
        ]),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el("button", { type: "button", className: "secondary primary", id: "save-script", onClick: saveScriptFromForm }, "Save"),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function appendPrompterLine() {
    const line = document.getElementById("script-line");
    const body = document.getElementById("script-body");
    if (!line || !body) return;
    const text = line.value.trim();
    if (!text) return;
    body.value = body.value ? String(body.value).replace(/\s+$/, "") + "\n" + text : text;
    line.value = "";
  }

  function saveScriptFromForm() {
    const api = prompterApi();
    const state = currentState();
    const titleInput = document.getElementById("script-title");
    const bodyInput = document.getElementById("script-body");
    const title = titleInput && titleInput.value ? titleInput.value : "";
    const body = bodyInput && bodyInput.value ? bodyInput.value : "";
    const data = loadPrompterData();
    const result = state.scriptId
      ? api.updateScript(data, state.scriptId, { title, body })
      : api.addScript(data, { title, body });
    if (!result.ok) {
      navigate({ ...state, title, body, notice: result.message, noticeKind: "error" }, { push: false });
      return;
    }
    persistPrompter(data);
    navigate({ screen: "prompter-detail", scriptId: result.script.id }, { push: false });
  }

  function renderPrompterDelete(state) {
    const api = prompterApi();
    const data = loadPrompterData();
    const script = api.scriptById(data, state.scriptId);
    return screen([
      header("Teleprompter", "Delete script", "This stays on this device"),
      el("div", { className: "content stack" }, [
        el("article", { className: "card" }, [
          el("p", { className: "step-body", text: script ? `Delete “${script.title}”?` : "That script is gone." }),
        ]),
      ]),
      el("div", { className: "footer" }, [
        script
          ? el(
              "button",
              {
                type: "button",
                className: "secondary primary",
                id: "confirm-delete-script",
                onClick: () => {
                  api.deleteScript(data, script.id);
                  persistPrompter(data);
                  navigate({ screen: "prompter" }, { push: false });
                },
              },
              "Delete"
            )
          : null,
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function renderPrompterBackup(state) {
    const api = prompterApi();
    const blob = state.blob != null ? state.blob : api.exportBlob(loadPrompterData());
    return screen([
      header("Teleprompter", "Export / Import", "Paste JSON or a plain-text script"),
      el("div", { className: "content stack" }, [
        el("div", { className: "field-wrap stack" }, [
          el("label", { htmlFor: "prompter-backup-blob", text: "JSON or plain text" }),
          el("textarea", {
            id: "prompter-backup-blob",
            className: "field-area",
            name: "prompter-backup",
            value: blob,
            attrs: { spellcheck: "false", rows: "8", autocomplete: "off" },
          }),
          el("p", { className: "hint", text: "Copy a JSON backup, or paste JSON or a .txt script and choose Import. Nothing is uploaded." }),
        ]),
        state.notice ? el("p", { className: "status", text: state.notice, dataset: { kind: state.noticeKind || "" } }) : null,
      ]),
      el("div", { className: "footer" }, [
        el(
          "button",
          {
            type: "button",
            className: "secondary",
            id: "refresh-prompter-backup",
            onClick: () => navigate({ screen: "prompter-backup", blob: api.exportBlob(loadPrompterData()) }, { push: false }),
          },
          "Refresh export"
        ),
        el("button", { type: "button", className: "secondary primary", id: "import-scripts", onClick: importScriptsFromForm }, "Import"),
        backButton(),
        homeButton(),
      ]),
    ]);
  }

  function importScriptsFromForm() {
    const api = prompterApi();
    const area = document.getElementById("prompter-backup-blob");
    const textValue = area && area.value ? area.value : "";
    const result = api.importBlob(textValue, loadPrompterData());
    if (result.ok) persistPrompter(result.data);
    navigate(
      {
        screen: "prompter-backup",
        blob: result.ok ? api.exportBlob(result.data) : textValue,
        notice: result.message,
        noticeKind: result.ok ? "ok" : "error",
      },
      { push: false }
    );
  }

  function startPrompterPlay(scriptId) {
    prompterPlay = null;
    navigate({ screen: "prompter-play", scriptId }, { push: true });
  }

  function stopPrompterAnim() {
    if (prompterRaf) {
      cancelAnimationFrame(prompterRaf);
      prompterRaf = null;
    }
  }

  function updatePrompterChrome(play) {
    if (!play) return;
    const api = prompterApi();
    const scroller = document.getElementById("prompter-scroll");
    const timer = document.getElementById("prompter-timer");
    const segLabel = document.getElementById("prompter-segment");
    const status = document.getElementById("prompter-status");
    if (scroller) scroller.style.transform = "translateY(" + -Math.round(play.offset) + "px)";
    const blocks = document.querySelectorAll(".prompter-block");
    let segmentIndex = play.segmentIndex || 0;
    if (blocks.length && scroller) {
      const stage = document.getElementById("prompter-stage");
      const stageTop = stage ? stage.getBoundingClientRect().top + 24 : 0;
      for (let index = 0; index < blocks.length; index += 1) {
        const rect = blocks[index].getBoundingClientRect();
        if (rect.bottom > stageTop) {
          segmentIndex = index;
          break;
        }
        segmentIndex = index;
      }
      play.segmentIndex = segmentIndex;
    }
    const segment = play.segments && play.segments[segmentIndex];
    const elapsed = Math.floor((play.elapsedMs || 0) / 1000);
    if (segLabel) segLabel.textContent = segment ? segment.title : "Script";
    if (timer) {
      const target = segment && segment.targetSeconds ? api.formatTimer(segment.targetSeconds) : "";
      timer.textContent = target ? api.formatTimer(elapsed) + " / " + target : api.formatTimer(elapsed);
    }
    if (status) {
      status.textContent = (play.paused ? "Paused" : "Playing") + " · Speed " + play.speed;
    }
  }

  function startPrompterAnim() {
    stopPrompterAnim();
    if (!prompterPlay || prompterPlay.paused) {
      updatePrompterChrome(prompterPlay);
      return;
    }
    let last = performance.now();
    function tick(now) {
      const play = prompterPlay;
      if (!play || play.paused) {
        prompterRaf = null;
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      play.offset += play.speed * dt;
      play.elapsedMs += dt * 1000;
      const scroller = document.getElementById("prompter-scroll");
      const stage = document.getElementById("prompter-stage");
      if (scroller && stage) {
        const max = Math.max(0, scroller.scrollHeight - stage.clientHeight + 80);
        if (play.offset > max) {
          play.offset = max;
          play.paused = true;
          updatePrompterChrome(play);
          prompterRaf = null;
          return;
        }
      }
      updatePrompterChrome(play);
      prompterRaf = requestAnimationFrame(tick);
    }
    prompterRaf = requestAnimationFrame(tick);
  }

  function nudgePrompterSpeed(direction) {
    const api = prompterApi();
    if (!prompterPlay || !api) return;
    const data = loadPrompterData();
    data.speed = prompterPlay.speed;
    api.nudgeSpeed(data, direction);
    persistPrompter(data);
    prompterPlay.speed = data.speed;
    updatePrompterChrome(prompterPlay);
  }

  function togglePrompterPause() {
    if (!prompterPlay) return;
    prompterPlay.paused = !prompterPlay.paused;
    updatePrompterChrome(prompterPlay);
    if (prompterPlay.paused) stopPrompterAnim();
    else startPrompterAnim();
  }

  function jumpPrompterSegment(direction) {
    if (!prompterPlay) return;
    const blocks = document.querySelectorAll(".prompter-block");
    if (!blocks.length) return;
    const next = Math.max(0, Math.min(blocks.length - 1, (prompterPlay.segmentIndex || 0) + direction));
    const scroller = document.getElementById("prompter-scroll");
    if (!scroller) return;
    const target = blocks[next];
    prompterPlay.segmentIndex = next;
    prompterPlay.offset = Math.max(0, target.offsetTop);
    updatePrompterChrome(prompterPlay);
  }

  function renderPrompterPlay(state) {
    const api = prompterApi();
    const data = loadPrompterData();
    const script = api.scriptById(data, state.scriptId);
    if (!script) {
      return screen([
        header("Teleprompter", "Play", "Not found"),
        el("div", { className: "content" }, [el("p", { className: "status", text: "That script is gone." })]),
        el("div", { className: "footer" }, [backButton(), homeButton()]),
      ]);
    }
    const segments = api.parseSegments(script.body);
    const blocks = (segments.length ? segments : [{ title: script.title, targetSeconds: null, text: script.body || "" }]).map(
      (segment, index) =>
        el("article", { className: "prompter-block", dataset: { index: String(index) } }, [
          el("p", { className: "prompter-block-title", text: segment.title }),
          el("p", { className: "prompter-block-text", text: segment.text || segment.body || "" }),
        ])
    );
    if (!prompterPlay || prompterPlay.scriptId !== script.id) {
      prompterPlay = {
        scriptId: script.id,
        offset: 0,
        speed: data.speed,
        paused: false,
        elapsedMs: 0,
        fontSize: data.fontSize,
        segmentIndex: 0,
        segments,
      };
    } else {
      prompterPlay.segments = segments;
      prompterPlay.fontSize = data.fontSize;
    }

    const view = screen(
      [
        el("div", { className: "prompter-meta" }, [
          el("p", { className: "prompter-segment", id: "prompter-segment", text: segments[0] ? segments[0].title : script.title }),
          el("p", { className: "prompter-timer", id: "prompter-timer", text: "0:00" }),
        ]),
        el("div", { className: "content prompter-stage", id: "prompter-stage" }, [
          el("div", { className: "prompter-scroll", id: "prompter-scroll" }, blocks),
        ]),
        el("div", { className: "footer prompter-footer" }, [
          el("p", { className: "prompter-status", id: "prompter-status", text: "Playing · Speed " + data.speed }),
          backButton(),
        ]),
      ],
      "prompter-play"
    );
    return view;
  }


  function render(state) {
    const screenName = state && state.screen ? state.screen : "home";
    if (screenName !== "home") stopClock();
    if (screenName !== "prompter-play") {
      stopPrompterAnim();
      prompterPlay = null;
    }
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
      case "coming-soon":
        view = renderComingSoon(state);
        lastFocusSelector = "#go-home";
        break;
      case "talk-setup":
        view = renderTalkSetup(state);
        lastFocusSelector = "#talk-setup-open";
        break;
      case "talk-picker":
        view = renderTalkPicker();
        lastFocusSelector = "#talk-pick-major";
        break;
      case "talk":
      case "major":
        view = renderMajor(state);
        if (state.pending) lastFocusSelector = "#talk-typing";
        else if (view.querySelector("#talk-retry")) lastFocusSelector = "#talk-retry";
        else lastFocusSelector = "#major-message";
        break;
      case "major-settings":
        view = renderMajorSettings(state);
        lastFocusSelector = state && state.notice
          ? "#save-major-settings"
          : "#major-kind-preview";
        if (!state || !state.notice) {
          const selectedKind = view.querySelector("button.kind-toggle.selected");
          if (selectedKind && selectedKind.id) lastFocusSelector = "#" + selectedKind.id;
        }
        break;
      case "scale":
        view = renderScale();
        lastFocusSelector = "#open-scale-library";
        break;
      case "scale-library":
        view = renderScaleLibrary();
        lastFocusSelector = "button.tile";
        break;
      case "scale-category":
        view = renderScaleCategory(state);
        lastFocusSelector = "#scale-entry-panel";
        break;
      case "scale-convert":
        view = renderScaleConvert(state);
        lastFocusSelector = "#scale-value-panel";
        break;
      case "scale-pace":
        view = renderScalePace(state);
        lastFocusSelector = "#scale-step";
        break;
      case "scale-mine":
        view = renderScaleMine();
        lastFocusSelector = "#open-scale-edit";
        break;
      case "scale-detail":
        view = renderScaleDetail(state);
        lastFocusSelector = "#open-scale-in-converter";
        break;
      case "scale-edit":
        view = renderScaleEdit(state);
        lastFocusSelector = "#scale-measure-name";
        break;
      case "scale-delete":
        view = renderScaleDelete(state);
        lastFocusSelector = "#confirm-delete-measurement";
        break;
      case "scale-backup":
        view = renderScaleBackup(state);
        lastFocusSelector = "#scale-backup-blob";
        break;
      case "tasks":
        view = renderTasks(state);
        lastFocusSelector = "#selected-task, #open-new-task";
        break;
      case "tasks-actions":
        view = renderTaskActions(state);
        lastFocusSelector = "#toggle-task-done";
        break;
      case "tasks-edit":
        view = renderTaskEditor(state);
        lastFocusSelector = "#task-title";
        break;
      case "tasks-move":
        view = renderTaskMove(state);
        lastFocusSelector = "button.tile";
        break;
      case "tasks-list-menu":
        view = renderTaskListMenu(state);
        lastFocusSelector = "#rename-task-list";
        break;
      case "tasks-list-name":
        view = renderTaskListName(state);
        lastFocusSelector = "#task-list-name";
        break;
      case "tasks-delete":
        view = renderTaskDelete(state);
        lastFocusSelector = "#confirm-delete-task";
        break;
      case "tasks-backup":
        view = renderTaskBackup(state);
        lastFocusSelector = "#task-backup-blob";
        break;
      case "prompter":
        view = renderPrompter();
        lastFocusSelector = "button.tile, #open-new-script";
        break;
      case "prompter-detail":
        view = renderPrompterDetail(state);
        lastFocusSelector = "#start-prompter";
        break;
      case "prompter-edit":
        view = renderPrompterEditor(state);
        lastFocusSelector = "#script-title";
        break;
      case "prompter-delete":
        view = renderPrompterDelete(state);
        lastFocusSelector = "#confirm-delete-script";
        break;
      case "prompter-backup":
        view = renderPrompterBackup(state);
        lastFocusSelector = "#prompter-backup-blob";
        break;
      case "prompter-play":
        view = renderPrompterPlay(state);
        lastFocusSelector = "#go-back";
        break;
      case "apps":
        view = renderApps();
        lastFocusSelector = "#open-add-spend";
        break;
      case "funds-entry":
        view = renderFundsEntry(state);
        lastFocusSelector = "#funds-amount";
        break;
      case "funds-budget":
        view = renderFundsBudget(state);
        lastFocusSelector = "#funds-budget";
        break;
      case "next-up":
        view = renderNextUpEditor(state);
        lastFocusSelector = "#next-up-text";
        break;
      default:
        view = renderHome();
        lastFocusSelector = "#open-apps";
    }
    app.append(view);
    if (screenName === "home") startClock();
    if (screenName === "prompter-play" && prompterPlay) {
      const scroll = document.getElementById("prompter-scroll");
      if (scroll) scroll.style.fontSize = prompterPlay.fontSize + "px";
      window.requestAnimationFrame(() => {
        updatePrompterChrome(prompterPlay);
        startPrompterAnim();
      });
    }
    window.requestAnimationFrame(() => {
      if (screenName === "talk" || screenName === "major") scrollTalkThread();
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
    if (event.key === "Enter" && event.target && event.target.id === "funds-amount") {
      event.preventDefault();
      submitAddSpend();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "funds-label") {
      event.preventDefault();
      submitAddSpend();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "funds-budget") {
      event.preventDefault();
      submitFundsBudget();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "next-up-text") {
      event.preventDefault();
      saveNextUpFromForm();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "task-title") {
      event.preventDefault();
      const note = document.getElementById("task-note");
      if (note && typeof note.focus === "function") note.focus();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "task-note") {
      event.preventDefault();
      const due = document.getElementById("task-due");
      if (due && typeof due.focus === "function") due.focus();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "task-due") {
      event.preventDefault();
      saveTaskFromForm();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "task-list-name") {
      event.preventDefault();
      saveTaskListName();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "script-title") {
      event.preventDefault();
      const line = document.getElementById("script-line");
      if (line && typeof line.focus === "function") line.focus();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "script-line") {
      event.preventDefault();
      appendPrompterLine();
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
    if (event.key === "Enter" && event.target && event.target.id === "scale-parse-input") {
      event.preventDefault();
      applyScaleQuery(currentState());
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "scale-stride-input") {
      event.preventDefault();
      saveStrideFromForm();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "scale-measure-name") {
      event.preventDefault();
      const size = document.getElementById("scale-measure-size");
      if (size && typeof size.focus === "function") size.focus();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "scale-measure-size") {
      event.preventDefault();
      saveMeasurementFromForm();
      return;
    }
    if (event.key === "Enter" && event.target && event.target.id === "scale-value-panel") {
      event.preventDefault();
      const input = document.getElementById("scale-parse-input");
      if (input && typeof input.focus === "function") input.focus();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (state && state.screen === "prompter-play") {
      if (event.key === "Enter") {
        event.preventDefault();
        togglePrompterPause();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgePrompterSpeed(1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgePrompterSpeed(-1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        jumpPrompterSegment(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        jumpPrompterSegment(1);
        return;
      }
    }
    if (state && state.screen === "tasks") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        shiftTaskList(state, -1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        shiftTaskList(state, 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        shiftTaskIndex(state, -1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        shiftTaskIndex(state, 1);
        return;
      }
    }
    if (state && state.screen === "scale-pace") {
      const id = event.target && event.target.id;
      if (event.key === "Enter" && id !== "scale-reset" && id !== "go-back" && id !== "go-home" && id !== "save-stride") {
        event.preventDefault();
        addPaceStep();
        return;
      }
    }
    if (state && state.screen === "scale-convert") {
      const onPanel = event.target && event.target.id === "scale-value-panel";
      if (onPanel) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          nudgeConverterValue(state, 1);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          nudgeConverterValue(state, -1);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudgeConverterStep(state, -1);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          nudgeConverterStep(state, 1);
          return;
        }
      }
    }
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
    if (state && state.screen === "scale-category") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateScaleCategory(state, (state.entryIndex || 0) - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        updateScaleCategory(state, (state.entryIndex || 0) + 1);
      }
      return;
    }
    if (state && (state.screen === "talk" || state.screen === "major")) {
      const thread = document.getElementById("talk-thread");
      const onThread = event.target && (event.target.id === "talk-thread" || event.target.id === "talk-typing" || event.target.id === "talk-retry");
      if (thread && onThread && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        thread.scrollTop += event.key === "ArrowDown" ? 80 : -80;
      }
    }
  }

  async function loadLibrary() {
    const response = await fetch("./library.json");
    const data = await response.json();
    if (!data || !Array.isArray(data.recipes)) throw new Error("invalid library");
    library = data;
  }

  async function loadScaleLibrary() {
    try {
      const response = await fetch("./scale-library.json");
      const data = await response.json();
      if (!data || !Array.isArray(data.categories)) throw new Error("invalid scale library");
      scaleLibrary = data;
    } catch (err) {
      console.warn("Could not load the Scale Check library:", err);
      scaleLibrary = { version: 1, mannyHeightCm: 180, categories: [] };
    }
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
    let setup = null;
    const talk = majorApi();
    if (talk && typeof talk.consumeTalkSetup === "function") {
      try {
        setup = talk.consumeTalkSetup();
      } catch (_err) {
        setup = { ok: false, attempted: true, error: "invalid" };
        try {
          const path = (location.pathname || "/") + (location.search || "");
          history.replaceState(history.state || {}, "", path);
        } catch (_ignored) {}
      }
    }
    const initial = setup && setup.attempted
      ? { screen: "talk-setup", error: setup.ok ? "" : "invalid" }
      : HOME_STATE;
    history.replaceState(initial, "");
    try {
      await loadLibrary();
    } catch (err) {
      console.warn(err);
      app.replaceChildren(
        screen([
          header("World Static", "Could not load", "The recipe library is missing."),
          el("div", { className: "content" }, [
            el("p", { className: "status", dataset: { kind: "error" }, text: "Refresh, or check that library.json is next to this page." }),
          ]),
        ])
      );
      return;
    }
    await checkHealth();
    await loadScaleLibrary();
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
