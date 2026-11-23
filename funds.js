/* World Static daily funds helpers.
   Budget, spend, and a short history stay in localStorage on this device.
   Nothing here is sent to a server.
*/
(function (root) {
  "use strict";

  const STORAGE_KEY = "thespia.hud.funds";
  const HISTORY_MAX = 14;
  const LABEL_MAX = 40;

  function ymd(date) {
    const value = date || new Date();
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function blank(now) {
    return {
      budget: 0,
      day: ymd(now || new Date()),
      spent: 0,
      entries: [],
      history: [],
    };
  }

  function parseAmount(text) {
    if (typeof text === "number") {
      if (!Number.isFinite(text) || text < 0) return null;
      return Math.round(text * 100) / 100;
    }
    const raw = String(text || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "");
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  function formatMoney(value) {
    const n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n)) return "$0";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (Math.round(abs * 100) % 100 === 0) return sign + "$" + String(Math.round(abs));
    return sign + "$" + abs.toFixed(2);
  }

  function remaining(data) {
    const budget = data && Number.isFinite(Number(data.budget)) ? Number(data.budget) : 0;
    const spent = data && Number.isFinite(Number(data.spent)) ? Number(data.spent) : 0;
    return Math.round((budget - spent) * 100) / 100;
  }

  function spentRatio(data) {
    const budget = data && Number(data.budget);
    const spent = data && Number(data.spent);
    if (!budget || budget <= 0 || !Number.isFinite(spent)) return 0;
    return Math.max(0, Math.min(1, spent / budget));
  }

  function normalizeEntry(item) {
    if (!item || typeof item !== "object") return null;
    const amount = parseAmount(item.amount);
    if (amount == null || amount <= 0) return null;
    const ts = Number(item.ts) || 0;
    return {
      id: String(item.id || ("entry-" + ts + "-" + amount)),
      amount,
      label: String(item.label || "").trim().slice(0, LABEL_MAX),
      ts,
    };
  }

  function normalize(parsed, now) {
    if (!parsed || typeof parsed !== "object") return blank(now);
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map(normalizeEntry).filter(Boolean)
      : [];
    const history = Array.isArray(parsed.history)
      ? parsed.history
          .map((row) => {
            if (!row || !row.day) return null;
            const budget = parseAmount(row.budget);
            const spent = parseAmount(row.spent);
            return {
              day: String(row.day),
              budget: budget == null ? 0 : budget,
              spent: spent == null ? 0 : spent,
            };
          })
          .filter(Boolean)
          .slice(-HISTORY_MAX)
      : [];
    const budget = parseAmount(parsed.budget);
    let spent = parseAmount(parsed.spent);
    if (spent == null) {
      spent = entries.reduce((sum, row) => sum + row.amount, 0);
      spent = Math.round(spent * 100) / 100;
    }
    return {
      budget: budget == null ? 0 : budget,
      day: typeof parsed.day === "string" && parsed.day ? parsed.day : ymd(now || new Date()),
      spent,
      entries,
      history,
    };
  }

  function rollover(data, now) {
    const current = normalize(data, now);
    const today = ymd(now || new Date());
    if (current.day === today) return current;
    const history = current.history.slice();
    if (current.day && (current.spent || current.budget || current.entries.length)) {
      history.push({ day: current.day, budget: current.budget, spent: current.spent });
    }
    return {
      budget: current.budget,
      day: today,
      spent: 0,
      entries: [],
      history: history.slice(-HISTORY_MAX),
    };
  }

  function addSpend(data, amount, label, now) {
    const current = rollover(data, now);
    const value = parseAmount(amount);
    if (value == null || value <= 0) {
      return { ok: false, message: "Enter an amount.", data: current };
    }
    const ts = (now || new Date()).getTime();
    const entry = {
      id: "entry-" + ts + "-" + value,
      amount: value,
      label: String(label || "").trim().slice(0, LABEL_MAX),
      ts,
    };
    const spent = Math.round((current.spent + value) * 100) / 100;
    return {
      ok: true,
      data: {
        ...current,
        spent,
        entries: current.entries.concat(entry),
      },
    };
  }

  function setBudget(data, amount, now) {
    const current = rollover(data, now);
    const value = parseAmount(amount);
    if (value == null) {
      return { ok: false, message: "Enter a daily amount.", data: current };
    }
    return { ok: true, data: { ...current, budget: value } };
  }

  function spentFromEntries(entries) {
    const sum = (entries || []).reduce((total, row) => total + (Number(row.amount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  function transactions(data) {
    const current = normalize(data);
    return current.entries.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }

  function formatTime(ts) {
    const date = new Date(Number(ts) || 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return hours + ":" + minutes + " " + suffix;
  }

  function deleteEntry(data, entryId, now) {
    const current = rollover(data, now);
    const id = String(entryId || "");
    const nextEntries = current.entries.filter((row) => row.id !== id);
    if (nextEntries.length === current.entries.length) {
      return { ok: false, message: "That transaction is gone.", data: current };
    }
    return { ok: true, data: { ...current, entries: nextEntries, spent: spentFromEntries(nextEntries) } };
  }

  function resetDay(data, now) {
    const current = rollover(data, now);
    return { ok: true, data: { ...current, spent: 0, entries: [] } };
  }

  function resetBudget(data, now) {
    const current = rollover(data, now);
    return { ok: true, data: { ...current, budget: 0 } };
  }

  function load(storage, now) {
    const store = storage || root.localStorage;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return blank(now);
      return normalize(JSON.parse(raw), now);
    } catch (err) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch (_ignored) {}
      return blank(now);
    }
  }

  function save(data, storage, now) {
    const next = normalize(data, now);
    const store = storage || root.localStorage;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Could not save daily funds on this device.");
    }
    return next;
  }

  function loadAndPersist(storage, now) {
    const store = storage || root.localStorage;
    const loaded = load(store, now);
    const next = rollover(loaded, now);
    if (next.day !== loaded.day || next.spent !== loaded.spent) {
      save(next, store, now);
    }
    return next;
  }

  const api = {
    STORAGE_KEY,
    HISTORY_MAX,
    LABEL_MAX,
    ymd,
    blank,
    parseAmount,
    formatMoney,
    remaining,
    spentRatio,
    normalize,
    rollover,
    addSpend,
    setBudget,
    transactions,
    formatTime,
    deleteEntry,
    resetDay,
    resetBudget,
    load,
    save,
    loadAndPersist,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticFunds = api;
})(typeof window !== "undefined" ? window : globalThis);
