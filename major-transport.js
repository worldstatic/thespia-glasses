/* Talk to Major — pluggable transport
   Meta Ray-Ban Display Web App helper. This file ships with no endpoint
   URLs, tokens, or secrets. A live bridge URL and optional token are
   entered on the device and stored only in localStorage.
*/
(function (global) {
  "use strict";

  const CONFIG_KEY = "thespia.hud.major.transport";
  const KINDS = ["mock", "http"];
  const DEFAULT_CONFIG = { kind: "mock", endpoint: "", pollUrl: "", token: "" };
  const POLL_MS = 2500;
  const POLL_ATTEMPTS = 36;
  const MAX_CARDS = 6;
  const MAX_CARD_CHARS = 240;

  function blankConfig() {
    return { ...DEFAULT_CONFIG };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return blankConfig();
      const parsed = JSON.parse(raw);
      const kind = KINDS.includes(parsed.kind) ? parsed.kind : "mock";
      return {
        kind,
        endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint.trim() : "",
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
      endpoint: String(next.endpoint || "").trim(),
      pollUrl: String(next.pollUrl || "").trim(),
      token: String(next.token || ""),
    };
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      return config;
    } catch (err) {
      console.warn("Could not save Talk to Major settings on this device.");
      return config;
    }
  }

  function clearConfig() {
    try {
      localStorage.removeItem(CONFIG_KEY);
    } catch (_ignored) {}
    return blankConfig();
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
    if (cfg.kind === "http") return Boolean(cfg.endpoint);
    return false;
  }

  function statusLabel(config) {
    const cfg = config || loadConfig();
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

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error("The bridge sent a reply this app could not read.");
    }
  }

  async function pollForReply(config, id) {
    const url = fillUrl(config.pollUrl, id);
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
      const cards = normalizeCards(data, "Major");
      if (cards && cards.length) return cards;
      const status = data && data.status;
      if (status === "error") {
        throw new Error(String(data.message || "The bridge reported an error."));
      }
      if (status && status !== "pending" && status !== "accepted" && status !== "running") {
        break;
      }
    }
    return null;
  }

  async function sendHttp(config, text) {
    if (!config.endpoint) {
      throw new Error("Add a bridge URL in Settings before sending a live message.");
    }
    const id = requestId();
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify({ message: text, requestId: id }),
    });
    if (!response.ok) {
      throw new Error("The bridge did not accept the message. Check the URL in Settings.");
    }
    const data = await readJson(response);
    const immediate = normalizeCards(data, "Major");
    if (immediate && immediate.length) return { cards: immediate, requestId: id, source: "http" };
    if (config.pollUrl) {
      const polled = await pollForReply(config, (data && data.requestId) || id);
      if (polled && polled.length) return { cards: polled, requestId: id, source: "http" };
      throw new Error("No reply yet. Try again in a moment, or check that the bridge can post a reply back.");
    }
    throw new Error("The bridge accepted the message but returned no reply. Add a poll URL in Settings if replies arrive later.");
  }

  async function sendMock(text) {
    await sleep(350);
    const quoted = String(text || "").trim().slice(0, 200) || "(empty)";
    return {
      source: "mock",
      cards: [
        {
          title: "Preview only",
          body: "This is a practice reply. Nothing was sent to Major or to any server.",
        },
        {
          title: "Your message",
          body: quoted,
        },
        {
          title: "Live replies later",
          body: "When you are ready, open Settings and paste a bridge URL you control. This app never ships with a hidden address or key.",
        },
      ],
    };
  }

  async function send(text) {
    const message = String(text || "").trim();
    if (!message) {
      return { error: "Type or dictate a message first.", cards: [] };
    }
    const config = loadConfig();
    try {
      if (config.kind === "http") {
        return await sendHttp(config, message);
      }
      return await sendMock(message);
    } catch (err) {
      const safe = err && err.message ? String(err.message) : "Could not send the message.";
      return { error: safe, cards: [] };
    }
  }

  const api = {
    CONFIG_KEY,
    KINDS,
    loadConfig,
    saveConfig,
    clearConfig,
    isConfigured,
    statusLabel,
    cardsFromText,
    send,
  };

  global.ThespiaMajor = api;
})(window);
