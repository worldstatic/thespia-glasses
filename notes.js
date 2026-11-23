/* World Static quick notes.
   Dictated scratch notes stay in localStorage on this device. Nothing is uploaded.
*/
(function (root) {
  "use strict";

  const STORAGE_KEY = "thespia.hud.notes";
  const TEXT_MAX = 240;
  const MAX_NOTES = 40;

  let idSeq = 0;

  function newId() {
    idSeq += 1;
    return "note-" + Date.now() + "-" + idSeq;
  }

  function normalizeNote(item) {
    if (!item || typeof item !== "object") return null;
    const text = String(item.text || "").trim().slice(0, TEXT_MAX);
    if (!text) return null;
    const ts = Number(item.ts) || 0;
    return { id: String(item.id || newId()), text, ts };
  }

  function emptyData() {
    return { version: 1, notes: [] };
  }

  function normalize(parsed) {
    if (!parsed || typeof parsed !== "object") return emptyData();
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote).filter(Boolean) : [];
    notes.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return { version: 1, notes: notes.slice(0, MAX_NOTES) };
  }

  function load(storage) {
    const store = storage || root.localStorage;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      return normalize(JSON.parse(raw));
    } catch (_err) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch (_ignored) {}
      return emptyData();
    }
  }

  function save(data, storage) {
    const next = normalize(data);
    const store = storage || root.localStorage;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (_err) {
      console.warn("Could not save notes on this device.");
    }
    return next;
  }

  function list(data) {
    return normalize(data).notes.slice();
  }

  function addNote(data, text, now) {
    const current = normalize(data);
    const value = String(text || "").trim().slice(0, TEXT_MAX);
    if (!value) return { ok: false, message: "Say or type a note first.", data: current };
    const note = { id: newId(), text: value, ts: (now || new Date()).getTime() };
    return { ok: true, note, data: { version: 1, notes: [note].concat(current.notes).slice(0, MAX_NOTES) } };
  }

  function noteById(data, id) {
    return normalize(data).notes.find((note) => note.id === id) || null;
  }

  function deleteNote(data, id) {
    const current = normalize(data);
    const notes = current.notes.filter((note) => note.id !== id);
    if (notes.length === current.notes.length) return { ok: false, message: "That note is gone.", data: current };
    return { ok: true, data: { version: 1, notes } };
  }

  const api = {
    STORAGE_KEY,
    TEXT_MAX,
    MAX_NOTES,
    emptyData,
    normalize,
    load,
    save,
    list,
    addNote,
    noteById,
    deleteNote,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticNotes = api;
})(typeof window !== "undefined" ? window : globalThis);
