/* Talk — pluggable transport for Major and C 2
   Meta Ray-Ban Display Web App helper. This file ships with no endpoint
   URLs, tokens, or secrets. A live relay URL and device token are
   entered on the device and stored only in localStorage.
*/
(function (global) {
  "use strict";

  const CONFIG_KEY = "thespia.hud.major.transport";
  const THREADS_KEY = "thespia.hud.talk.threads";
  const KINDS = ["mock", "relay", "http"];
  const RECIPIENTS = ["major", "c2"];
  const DEFAULT_CONFIG = { kind: "mock", relayUrl: "", token: "", endpoint: "", pollUrl: "" };
  const POLL_MS = 3000;
  const POLL_ATTEMPTS = 60;
  const MAX_CARDS = 6;
  const MAX_CARD_CHARS = 240;
  const MAX_THREAD = 20;

  function blankConfig() {
    return { ...DEFAULT_CONFIG };
  }

  function normalizeTo(value) {
    const v = String(value || "").trim().toLowerCase();
    if (v === "c2" || v === "c 2") return "c2";
    return "major";
  }

  function recipientName(to) {
    return normalizeTo(to) === "c2" ? "C 2" : "Major";
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return blankConfig();
      const parsed = JSON.parse(raw);
      const kind = KINDS.includes(parsed.kind) ? parsed.kind : "mock";
      const relayUrl = typeof parsed.relayUrl === "string" ? parsed.relayUrl.trim() : "";
      const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint.trim() : "";
      return {
        kind,
        relayUrl: relayUrl || (kind === "relay" ? endpoint : ""),
        endpoint,
        pollUrl: typeof parsed.pollUrl === "string" ? parsed.pollUrl.trim() : "",
        token: typeof parsed.token === "string" ? parsed.token : "",
      };
    } catch (err) {
      try {
        localStorage.removeItem(CONFIG_KEY);
      } catch (_ignored) {}
      return blankConfig();
    }
  }

  function saveConfig(next) {
    const config = {
      kind: KINDS.includes(next.kind) ? next.kind : "mock",
      relayUrl: String(next.relayUrl || next.endpoint || "").trim(),
      endpoint: String(next.endpoint || next.relayUrl || "").trim(),
      pollUrl: String(next.pollUrl || "").trim(),
      token: String(next.token || ""),
    };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      return config;
    } catch (err) {
      console.warn("Could not save Talk settings on this device.");
      return config;
    }
  }

  function clearConfig() {
    try {
      localStorage.removeItem(CONFIG_KEY);
    } catch (_ignored) {}
    return blankConfig();
  }

  function blankThreads() {
    return { major: [], c2: [] };
  }

  function loadThreads() {
    try {
      const raw = localStorage.getItem(THREADS_KEY);
      if (!raw) return blankThreads();
      const parsed = JSON.parse(raw);
      return {
        major: Array.isArray(parsed.major) ? parsed.major : [],
        c2: Array.isArray(parsed.c2) ? parsed.c2 : [],
      };
    } catch (err) {
      try {
        localStorage.removeItem(THREADS_KEY);
      } catch (_ignored) {}
      return blankThreads();
    }
  }

  function saveThreads(threads) {
    const next = {
      major: Array.isArray(threads.major) ? threads.major.slice(-MAX_THREAD) : [],
      c2: Array.isArray(threads.c2) ? threads.c2.slice(-MAX_THREAD) : [],
    };
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(next));
      return next;
    } catch (err) {
      console.warn("Could not save Talk threads on this device.");
      return next;
    }
  }

  function loadThread(to) {
    const key = normalizeTo(to);
    return loadThreads()[key] || [];
  }

  function lastExchange(to) {
    const list = loadThread(to);
    return list.length ? list[list.length - 1] : null;
  }

  function appendThread(to, entry) {
    const key = normalizeTo(to);
    const all = loadThreads();
    const item = {
      id: entry.id || "",
      to: key,
      from: normalizeTo(entry.from || key),
      text: String(entry.text || "").slice(0, 1000),
      reply: String(entry.reply || "").slice(0, 4000),
      cards: Array.isArray(entry.cards) ? entry.cards : [],
      ts: entry.ts || Date.now(),
    };
    all[key] = (all[key] || []).concat(item).slice(-MAX_THREAD);
    saveThreads(all);
    return item;
  }

  function requestId() {
    const cryptoObj = global.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cardsFromText(text, title) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const heading = title || "Reply";
    if (!clean) return [{ title: heading, body: "No reply text." }];
    const pieces = [];
    const sentences = clean.split(/(?<=[.!?])\s+/);
    let bucket = "";
    const pushBucket = () => {
      if (!bucket) return;
      pieces.push(bucket);
      bucket = "";
    };
    for (const sentence of sentences) {
      if (!sentence) continue;
      if (sentence.length > MAX_CARD_CHARS) {
        pushBucket();
        for (let i = 0; i < sentence.length; i += MAX_CARD_CHARS) {
          pieces.push(sentence.slice(i, i + MAX_CARD_CHARS));
        }
        continue;
      }
      const next = bucket ? `${bucket} ${sentence}` : sentence;
      if (next.length > MAX_CARD_CHARS) pushBucket();
      bucket = bucket ? `${bucket} ${sentence}` : sentence;
    }
    pushBucket();
    const limited = pieces.slice(0, MAX_CARDS);
    return limited.map((body, index) => ({
      title: limited.length > 1 ? `${heading} ${index + 1}` : heading,
      body,
    }));
  }

  function normalizeCards(data, fallbackTitle) {
    if (!data) return null;
    if (Array.isArray(data.cards) && data.cards.length) {
      return data.cards.slice(0, MAX_CARDS).map((card, index) => ({
        title: String((card && card.title) || `${fallbackTitle || "Reply"} ${index + 1}`),
        body: String((card && (card.body || card.text)) || "").slice(0, 400),
      })).filter((card) => card.body);
    }
    if (typeof data.reply === "string" && data.reply.trim()) {
      return cardsFromText(data.reply, fallbackTitle || "Reply");
    }
    if (typeof data.message === "string" && data.status === "done") {
      return cardsFromText(data.message, fallbackTitle || "Reply");
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isConfigured(config) {
    const cfg = config || loadConfig();
    if (cfg.kind === "mock") return true;
    if (cfg.kind === "relay") return Boolean(cfg.relayUrl && cfg.token);
    if (cfg.kind === "http") return Boolean(cfg.endpoint);
    return false;
  }

  function statusLabel(config) {
    const cfg = config || loadConfig();
    if (cfg.kind === "relay" && cfg.relayUrl && cfg.token) {
      return "Live relay on this device";
    }
    if (cfg.kind === "http" && cfg.endpoint) {
      return "Live bridge on this device";
    }
    return "Preview replies — nothing leaves this device";
  }

  function buildHeaders(config) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const token = String(config.token || "").trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function fillUrl(template, id) {
    if (!template) return "";
    return template.split("{id}").join(encodeURIComponent(id));
  }

  function baseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("The bridge sent a reply this app could not read.");
    }
  }

  async function pollRelay(config, pollUrl, id) {
    const url = fillUrl(pollUrl, id);
    if (!url) return null;
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(POLL_MS);
      const response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(config),
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new Error("The bridge could not be checked for a reply.");
      }
      const data = await readJson(response);
      const who = recipientName(data.from || data.to);
      const cards = normalizeCards(data, who);
      if (cards && cards.length) {
        return { cards, from: normalizeTo(data.from || data.to), reply: data.reply || "", id: data.id || id };
      }
      const status = data && data.status;
      if (status === "error") {
        throw new Error(String(data.error || "The bridge reported an error."));
      }
      if (status && status !== "pending" && status !== "accepted" && status !== "running") {
        break;
      }
    }
    return null;
  }

  async function sendRelay(config, text, to) {
    if (!config.relayUrl || !config.token) {
      throw new Error("Add the relay URL and device token in Settings before sending a live message.");
    }
    const base = baseUrl(config.relayUrl);
    const response = await fetch(`${base}/ask`, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({ text, to }),
    });
    if (response.status === 401) {
      throw new Error("The device token was not accepted. Check Settings.");
    }
    if (response.status === 429) {
      throw new Error("Too many messages. Wait a moment and try again.");
    }
    if (!response.ok) {
      throw new Error("The relay did not accept the message. Check the URL in Settings.");
    }
    const data = await readJson(response);
    const id = data.id;
    if (!id) throw new Error("The relay did not return a message id.");
    const polled = await pollRelay(config, `${base}/poll?id={id}`, id);
    if (polled && polled.cards && polled.cards.length) {
      return { ...polled, requestId: id, source: "relay", to };
    }
    throw new Error("No reply in time. Try again in a moment.");
  }

  async function sendHttp(config, text, to) {
    if (!config.endpoint) {
      throw new Error("Add a bridge URL in Settings before sending a live message.");
    }
    const id = requestId();
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({ message: text, text, requestId: id, to }),
    });
    if (!response.ok) {
      throw new Error("The bridge did not accept the message. Check the URL in Settings.");
    }
    const data = await readJson(response);
    const immediate = normalizeCards(data, recipientName(to));
    if (immediate && immediate.length) return { cards: immediate, requestId: id, source: "http", to };
    if (config.pollUrl) {
      const polled = await pollRelay(config, config.pollUrl, (data && data.requestId) || data.id || id);
      if (polled && polled.cards.length) return { ...polled, requestId: id, source: "http", to };
      throw new Error("No reply in time. Try again in a moment.");
    }
    throw new Error("The bridge accepted the message but returned no reply.");
  }

  async function sendMock(text, to) {
    await sleep(350);
    const name = recipientName(to);
    const quoted = String(text || "").trim().slice(0, 200) || "(empty)";
    const cards = [
      {
        title: "Preview only",
        body: `This is a practice reply from ${name}. Nothing was sent off this device.`,
      },
      {
        title: "Your message",
        body: quoted,
      },
      {
        title: "Live replies later",
        body: "When the relay is live, open Settings and paste the Worker URL and device token. This app never ships with a hidden address or key.",
      },
    ];
    return { source: "mock", cards, from: to, to, reply: cards.map((c) => c.body).join(" ") };
  }

  async function send(text, opts) {
    const message = String(text || "").trim();
    const to = normalizeTo(opts && opts.to);
    if (!message) {
      return { error: "Type or dictate a message first.", cards: [], to };
    }
    const config = loadConfig();
    try {
      let result;
      if (config.kind === "relay") {
        result = await sendRelay(config, message, to);
      } else if (config.kind === "http") {
        result = await sendHttp(config, message, to);
      } else {
        result = await sendMock(message, to);
      }
      const from = normalizeTo(result.from || to);
      const cards = result.cards || [];
      const reply = result.reply || cards.map((card) => card.body).join(" ");
      appendThread(to, {
        id: result.requestId || result.id || "",
        to,
        from,
        text: message,
        reply,
        cards,
        ts: Date.now(),
      });
      return { ...result, cards, from, to };
    } catch (err) {
      const safe = err && err.message ? String(err.message) : "Could not send the message.";
      return { error: safe, cards: [], to };
    }
  }


  function decodeBase64Url(input) {
    const trimmed = String(input || "").split("&")[0].split("#")[0];
    let s = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const missing = s.length % 4;
    if (missing) s += "=".repeat(4 - missing);
    const binary = atob(s);
    let out = "";
    for (let i = 0; i < binary.length; i += 1) {
      out += "%" + binary.charCodeAt(i).toString(16).padStart(2, "0");
    }
    try {
      return decodeURIComponent(out);
    } catch (_err) {
      return binary;
    }
  }

  function isHttpsRelayUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.protocol === "https:" && Boolean(url.host);
    } catch (_err) {
      return false;
    }
  }

  function parseTalkSetupFragment(hash) {
    // Only the URL fragment is accepted. Query strings are ignored.
    const raw = String(hash || "");
    const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw.startsWith("talk-setup=") ? raw : "";
    const marker = "talk-setup=";
    if (!fragment.startsWith(marker)) return { ok: false, attempted: false };
    const encoded = fragment.slice(marker.length).split("&")[0];
    if (!encoded) return { ok: false, attempted: true, error: "invalid" };
    let parsed;
    try {
      parsed = JSON.parse(decodeBase64Url(encoded));
    } catch (_err) {
      return { ok: false, attempted: true, error: "invalid" };
    }
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, attempted: true, error: "invalid" };
    }
    const relayUrl = typeof parsed.relayUrl === "string" ? parsed.relayUrl.trim() : "";
    const token = typeof parsed.token === "string" ? parsed.token : "";
    if (!isHttpsRelayUrl(relayUrl) || !String(token).trim()) {
      return { ok: false, attempted: true, error: "invalid" };
    }
    return { ok: true, attempted: true, relayUrl, token };
  }

  function clearTalkSetupFragment(loc, hist) {
    const place = loc || global.location;
    const historyApi = hist || global.history;
    if (!place || !historyApi || typeof historyApi.replaceState !== "function") return;
    const path = (place.pathname || "/") + (place.search || "");
    try {
      historyApi.replaceState(historyApi.state || {}, "", path);
    } catch (_err) {
      try {
        place.hash = "";
      } catch (_ignored) {}
    }
    if (place.hash && place.hash !== "#" && place.hash !== "") {
      try {
        place.hash = "";
      } catch (_ignored) {}
    }
  }

  function consumeTalkSetup(loc, hist) {
    const place = loc || global.location;
    const hash = place && place.hash ? place.hash : "";
    const parsed = parseTalkSetupFragment(hash);
    if (parsed.attempted) {
      clearTalkSetupFragment(place, hist || global.history);
    }
    if (parsed.ok) {
      saveConfig({
        kind: "relay",
        relayUrl: parsed.relayUrl,
        token: parsed.token,
        endpoint: parsed.relayUrl,
        pollUrl: "",
      });
      // Do not return or log the token.
      return { ok: true, attempted: true };
    }
    return { ok: false, attempted: parsed.attempted, error: parsed.error };
  }

  const api = {
    CONFIG_KEY,
    THREADS_KEY,
    KINDS,
    RECIPIENTS,
    loadConfig,
    saveConfig,
    clearConfig,
    isConfigured,
    statusLabel,
    cardsFromText,
    send,
    normalizeTo,
    recipientName,
    loadThread,
    lastExchange,
    appendThread,
    parseTalkSetupFragment,
    consumeTalkSetup,
    isHttpsRelayUrl,
  };

  global.ThespiaMajor = api;
})(window);
