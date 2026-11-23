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
  const MAX_THREAD = 50;

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

  function isTalkMessage(entry) {
    return Boolean(entry && (entry.role === "user" || entry.role === "assistant" || entry.role === "system"));
  }

  function normalizeMessage(entry, fallbackTo) {
    const role = entry && entry.role === "assistant" ? "assistant" : entry && entry.role === "system" ? "system" : "user";
    const requestId = String((entry && (entry.requestId || entry.id)) || "");
    const id = String((entry && entry.id) || (requestId ? requestId + "-" + role : "msg-" + Date.now()));
    const status = entry && entry.status ? String(entry.status) : role === "system" ? "timeout" : "sent";
    return {
      id,
      role,
      text: String((entry && entry.text) || "").slice(0, role === "user" ? 1000 : 4000),
      ts: (entry && entry.ts) || Date.now(),
      requestId,
      status,
      from: entry && entry.from ? normalizeTo(entry.from) : fallbackTo ? normalizeTo(fallbackTo) : "",
    };
  }

  function expandEntry(entry, fallbackTo) {
    if (!entry) return [];
    if (isTalkMessage(entry)) return [normalizeMessage(entry, fallbackTo)];
    const ts = (entry && entry.ts) || Date.now();
    const requestId = String((entry && entry.id) || "");
    const out = [];
    if (entry.text) {
      out.push(
        normalizeMessage(
          {
            id: requestId ? requestId + "-user" : "legacy-u-" + ts,
            role: "user",
            text: entry.text,
            ts,
            requestId,
            status: "sent",
          },
          fallbackTo
        )
      );
    }
    if (entry.reply) {
      out.push(
        normalizeMessage(
          {
            id: requestId ? requestId + "-assistant" : "legacy-a-" + ts,
            role: "assistant",
            text: entry.reply,
            ts,
            requestId,
            status: "sent",
            from: entry.from || fallbackTo,
          },
          fallbackTo
        )
      );
    } else if (entry.status === "timeout" || (entry.cards && entry.timeout)) {
      out.push(
        normalizeMessage(
          {
            id: requestId ? requestId + "-system" : "legacy-t-" + ts,
            role: "system",
            text: "No reply yet. Tap to check again.",
            ts,
            requestId,
            status: "timeout",
          },
          fallbackTo
        )
      );
    }
    return out;
  }

  function expandList(list, fallbackTo) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const entry of list) {
      const pieces = expandEntry(entry, fallbackTo);
      for (const item of pieces) out.push(item);
    }
    return out.slice(-MAX_THREAD);
  }

  function loadThreads() {
    try {
      const raw = localStorage.getItem(THREADS_KEY);
      if (!raw) return blankThreads();
      const parsed = JSON.parse(raw);
      return {
        major: expandList(parsed.major, "major"),
        c2: expandList(parsed.c2, "c2"),
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
      major: expandList(threads && threads.major, "major"),
      c2: expandList(threads && threads.c2, "c2"),
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

  function saveThreadList(to, list) {
    const key = normalizeTo(to);
    const all = loadThreads();
    all[key] = (Array.isArray(list) ? list : []).slice(-MAX_THREAD);
    saveThreads(all);
    return all[key];
  }

  function lastExchange(to) {
    const list = loadThread(to);
    let user = null;
    let assistant = null;
    for (const item of list) {
      if (item.role === "user") {
        user = item;
        assistant = null;
      } else if (item.role === "assistant") {
        assistant = item;
      }
    }
    if (!user && !assistant) return null;
    const reply = assistant ? assistant.text : "";
    return {
      id: (assistant || user).requestId || "",
      to: normalizeTo(to),
      from: (assistant && assistant.from) || normalizeTo(to),
      text: user ? user.text : "",
      reply,
      cards: reply ? cardsFromText(reply, recipientName(to)) : [],
      ts: (assistant || user).ts,
    };
  }

  function appendMessage(to, entry) {
    const key = normalizeTo(to);
    const item = normalizeMessage(entry, key);
    saveThreadList(key, loadThread(key).concat(item));
    return item;
  }

  function replaceMessage(to, id, patch) {
    const key = normalizeTo(to);
    const list = loadThread(key).map((item) =>
      item.id === id ? normalizeMessage({ ...item, ...(patch || {}) }, key) : item
    );
    saveThreadList(key, list);
    return list.find((item) => item.id === id) || null;
  }

  function removeMessages(to, test) {
    const key = normalizeTo(to);
    const list = loadThread(key).filter((item) => !(typeof test === "function" && test(item)));
    saveThreadList(key, list);
    return list;
  }

  function appendThread(to, entry) {
    if (isTalkMessage(entry)) return appendMessage(to, entry);
    let last = null;
    if (entry && entry.text) {
      last = appendMessage(to, {
        role: "user",
        text: entry.text,
        requestId: entry.id || "",
        ts: entry.ts,
      });
    }
    if (entry && entry.reply) {
      last = appendMessage(to, {
        role: "assistant",
        text: entry.reply,
        requestId: entry.id || "",
        ts: entry.ts,
        from: entry.from,
      });
    }
    return last;
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

  async function postRelayAsk(config, text, to) {
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
    return id;
  }

  async function sendRelay(config, text, to) {
    const id = await postRelayAsk(config, text, to);
    const polled = await pollRelay(config, `${baseUrl(config.relayUrl)}/poll?id={id}`, id);
    if (polled && polled.cards && polled.cards.length) {
      return { ...polled, requestId: id, source: "relay", to, timeout: false };
    }
    return { timeout: true, requestId: id, source: "relay", to, cards: [], reply: "" };
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
      return { timeout: true, requestId: id, source: "http", to, cards: [], reply: "" };
    }
    throw new Error("The bridge accepted the message but returned no reply.");
  }

  function mockReply(text, to, id) {
    const name = recipientName(to);
    const quoted = String(text || "").trim().slice(0, 140);
    const body = quoted
      ? `This is a practice reply from ${name}. Nothing left this device. You said: ${quoted}`
      : `This is a practice reply from ${name}. Nothing left this device.`;
    const cards = [{ title: "Preview only", body }];
    return {
      source: "mock",
      cards,
      from: to,
      to,
      requestId: id,
      reply: body,
      timeout: false,
    };
  }

  async function sendMock(text, to) {
    const id = requestId();
    await sleep(350);
    return mockReply(text, to, id);
  }

  async function postText(text, opts) {
    const message = String(text || "").trim();
    const to = normalizeTo(opts && opts.to);
    if (!message) {
      return { error: "Type or dictate a message first.", cards: [], to };
    }
    const config = loadConfig();
    try {
      if (config.kind === "relay") {
        const id = await postRelayAsk(config, message, to);
        return { requestId: id, source: "relay", to, text: message };
      }
      if (config.kind === "http") {
        if (!config.endpoint) {
          throw new Error("Add a bridge URL in Settings before sending a live message.");
        }
        const id = requestId();
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: buildHeaders(config),
          body: JSON.stringify({ message, text: message, requestId: id, to }),
        });
        if (!response.ok) {
          throw new Error("The bridge did not accept the message. Check the URL in Settings.");
        }
        const data = await readJson(response);
        const immediate = normalizeCards(data, recipientName(to));
        const serverId = (data && (data.requestId || data.id)) || id;
        return {
          requestId: serverId,
          source: "http",
          to,
          text: message,
          immediate: immediate && immediate.length ? { cards: immediate, reply: immediate.map((card) => card.body).join(" "), from: to } : null,
        };
      }
      return { requestId: requestId(), source: "mock", to, text: message };
    } catch (err) {
      const safe = err && err.message ? String(err.message) : "Could not send the message.";
      return { error: safe, cards: [], to };
    }
  }

  async function awaitReply(id, opts) {
    const to = normalizeTo(opts && opts.to);
    const source = (opts && opts.source) || loadConfig().kind;
    const requestKey = String(id || "");
    if (!requestKey) {
      return { error: "Missing message id.", cards: [], to, timeout: false };
    }
    const config = loadConfig();
    try {
      if (source === "mock") {
        await sleep(350);
        return mockReply((opts && opts.text) || "", to, requestKey);
      }
      if (source === "http") {
        if (opts && opts.immediate && opts.immediate.cards) {
          return { ...opts.immediate, requestId: requestKey, source: "http", to, timeout: false };
        }
        if (config.pollUrl) {
          const polled = await pollRelay(config, config.pollUrl, requestKey);
          if (polled && polled.cards && polled.cards.length) {
            return { ...polled, requestId: requestKey, source: "http", to, timeout: false };
          }
          return { timeout: true, requestId: requestKey, source: "http", to, cards: [], reply: "" };
        }
        throw new Error("The bridge accepted the message but returned no reply.");
      }
      const polled = await pollRelay(config, `${baseUrl(config.relayUrl)}/poll?id={id}`, requestKey);
      if (polled && polled.cards && polled.cards.length) {
        return { ...polled, requestId: requestKey, source: "relay", to, timeout: false };
      }
      return { timeout: true, requestId: requestKey, source: "relay", to, cards: [], reply: "" };
    } catch (err) {
      const safe = err && err.message ? String(err.message) : "Could not check for a reply.";
      return { error: safe, cards: [], to, requestId: requestKey, timeout: false };
    }
  }

  function persistSendResult(to, message, result) {
    const requestKey = (result && (result.requestId || result.id)) || "";
    appendMessage(to, { role: "user", text: message, requestId: requestKey, ts: Date.now() });
    if (result && result.timeout) {
      appendMessage(to, {
        role: "system",
        text: "No reply yet. Tap to check again.",
        requestId: requestKey,
        status: "timeout",
      });
      return;
    }
    if (result && !result.error) {
      const cards = result.cards || [];
      const reply = result.reply || cards.map((card) => card.body).join(" ");
      if (reply) {
        appendMessage(to, {
          role: "assistant",
          text: reply,
          requestId: requestKey,
          from: result.from || to,
        });
      }
    }
  }

  async function send(text, opts) {
    const message = String(text || "").trim();
    const to = normalizeTo(opts && opts.to);
    if (!message) {
      return { error: "Type or dictate a message first.", cards: [], to };
    }
    const posted = await postText(message, { to });
    if (posted.error) return { error: posted.error, cards: [], to };
    const result = await awaitReply(posted.requestId, {
      to,
      source: posted.source,
      text: message,
      immediate: posted.immediate || null,
    });
    const persist = !opts || opts.persist !== false;
    if (persist) persistSendResult(to, message, { ...result, requestId: posted.requestId });
    if (result && result.error) return { ...result, cards: result.cards || [], to, requestId: posted.requestId };
    const from = normalizeTo((result && result.from) || to);
    const cards = (result && result.cards) || [];
    return { ...result, cards, from, to, requestId: posted.requestId, source: posted.source };
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
    MAX_THREAD,
    loadConfig,
    saveConfig,
    clearConfig,
    isConfigured,
    statusLabel,
    cardsFromText,
    send,
    postText,
    awaitReply,
    normalizeTo,
    recipientName,
    loadThread,
    lastExchange,
    appendThread,
    appendMessage,
    replaceMessage,
    removeMessages,
    parseTalkSetupFragment,
    consumeTalkSetup,
    isHttpsRelayUrl,
  };

  global.ThespiaMajor = api;
})(window);
