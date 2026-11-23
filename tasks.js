/* World Static Task Cards helpers.
   Lists, tasks, due-day parsing, and localStorage export/import.
*/
(function (root) {
  "use strict";

  const STORAGE_KEY = "thespia.hud.tasks";
  const TITLE_MAX = 80;
  const NOTE_MAX = 240;
  const NAME_MAX = 40;
  const ITEM_MAX = 80;
  const MAX_ITEMS = 20;
  const MAX_LISTS = 20;
  const MAX_TASKS_PER_LIST = 50;

  const DEFAULT_LIST_SPECS = [
    { id: "work", name: "Work" },
    { id: "home", name: "Home" },
    { id: "projects", name: "Projects" },
  ];

  const SEED_TASKS = {
    work: [{
      title: "Review today's checklist",
      items: [
        { text: "Check open cards" },
        { text: "Clear finished ones" },
        { text: "Set tomorrow's first task" },
        { text: "Pack the stream bag" },
      ],
    }],
    home: [{ title: "Take out the recycling" }],
    projects: [{ title: "Sketch the next layout" }],
  };

  let idSeq = 0;

  function newId(prefix) {
    idSeq += 1;
    return prefix + "-" + Date.now() + "-" + idSeq;
  }

  function ymd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function parseYmd(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WEEKDAY_ALIAS = {
    sun: 0,
    mon: 1,
    tue: 2,
    tues: 2,
    wed: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    fri: 5,
    sat: 6,
  };
  const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function parseDue(text, now) {
    now = now || new Date();
    const raw = String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw || raw === "none" || raw === "clear" || raw === "no due" || raw === "no date") {
      return { ok: true, due: null, message: "" };
    }
    if (raw === "today") return { ok: true, due: ymd(now), message: "" };
    if (raw === "tomorrow") return { ok: true, due: ymd(addDays(now, 1)), message: "" };
    if (raw === "yesterday") return { ok: true, due: ymd(addDays(now, -1)), message: "" };

    const iso = parseYmd(raw);
    if (iso) return { ok: true, due: ymd(iso), message: "" };

    let weekday = WEEKDAYS.indexOf(raw);
    if (weekday < 0 && Object.prototype.hasOwnProperty.call(WEEKDAY_ALIAS, raw)) {
      weekday = WEEKDAY_ALIAS[raw];
    }
    if (weekday >= 0) {
      const today = now.getDay();
      const delta = weekday === today ? 0 : ((weekday - today + 7) % 7);
      return { ok: true, due: ymd(addDays(now, delta)), message: "" };
    }

    const monthDay = raw.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
    const dayMonth = raw.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
    let monthName = null;
    let dayNum = null;
    let yearNum = null;
    let yearGiven = false;
    if (monthDay && Object.prototype.hasOwnProperty.call(MONTHS, monthDay[1])) {
      monthName = monthDay[1];
      dayNum = Number(monthDay[2]);
      yearGiven = Boolean(monthDay[3]);
      yearNum = yearGiven ? Number(monthDay[3]) : now.getFullYear();
    } else if (dayMonth && Object.prototype.hasOwnProperty.call(MONTHS, dayMonth[2])) {
      monthName = dayMonth[2];
      dayNum = Number(dayMonth[1]);
      yearGiven = Boolean(dayMonth[3]);
      yearNum = yearGiven ? Number(dayMonth[3]) : now.getFullYear();
    }
    if (monthName != null) {
      const month = MONTHS[monthName];
      let date = new Date(yearNum, month, dayNum);
      if (date.getMonth() !== month || date.getDate() !== dayNum) {
        return { ok: false, due: null, message: "Could not read that day. Try today, Friday, or Nov 25." };
      }
      if (!yearGiven && startOfDay(date) < startOfDay(now)) {
        date = new Date(yearNum + 1, month, dayNum);
      }
      return { ok: true, due: ymd(date), message: "" };
    }

    return { ok: false, due: null, message: "Could not read that day. Try today, Friday, or Nov 25." };
  }

  function formatShortDate(date) {
    return MONTH_LABELS[date.getMonth()] + " " + date.getDate();
  }

  function formatDue(due, now) {
    now = now || new Date();
    const date = parseYmd(due);
    if (!date) return "";
    const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    if (diff < 0) return "Overdue · " + formatShortDate(date);
    if (diff <= 6) return WEEKDAY_LABELS[date.getDay()];
    return formatShortDate(date);
  }

  function normalizeItem(item) {
    const text = String((item && (item.text || item.title)) || "").trim().slice(0, ITEM_MAX);
    if (!text) return null;
    return {
      id: String((item && item.id) || newId("item")),
      text,
      done: Boolean(item && item.done),
    };
  }

  function itemFromLine(line) {
    let text = String(line || "").trim();
    if (!text) return null;
    text = text.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    let done = false;
    const box = text.match(/^\[(x|X| )\]\s*(.*)$/);
    if (box) {
      done = box[1].toLowerCase() === "x";
      text = box[2];
    }
    text = text.trim();
    if (!text) return null;
    return { text: text.slice(0, ITEM_MAX), done };
  }

  function itemsFromNote(note) {
    const lines = String(note || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const looksLikeList = lines.length > 1 || /^(?:[-*•]|\d+[.)]|\[[ xX]\])/i.test(lines[0]);
    if (!looksLikeList) return [];
    return lines.map(itemFromLine).filter(Boolean).slice(0, MAX_ITEMS);
  }

  function normalizeTask(item) {
    if (!item) return null;
    const title = String(item.title || "").trim().slice(0, TITLE_MAX);
    if (!title) return null;
    let due = null;
    if (item.due) {
      const direct = parseYmd(item.due);
      if (direct) due = ymd(direct);
      else {
        const parsed = parseDue(String(item.due), new Date());
        if (parsed.ok && parsed.due) due = parsed.due;
      }
    }
    const rawItems = Array.isArray(item.items)
      ? item.items
      : Array.isArray(item.checklist)
        ? item.checklist
        : [];
    let items = rawItems.map(normalizeItem).filter(Boolean);
    if (!items.length) items = itemsFromNote(item.note).map(normalizeItem).filter(Boolean);
    return {
      id: String(item.id || newId("task")),
      title,
      note: String(item.note || "").trim().slice(0, NOTE_MAX),
      done: Boolean(item.done),
      due,
      items: items.slice(0, MAX_ITEMS),
    };
  }

  function openChecklistItems(task) {
    if (!task || !Array.isArray(task.items)) return [];
    return task.items.filter((item) => item && item.text && !item.done);
  }

  function normalizeList(item) {
    const name = String((item && item.name) || "List").trim().slice(0, NAME_MAX) || "List";
    const id = String((item && item.id) || newId("list"));
    const tasks = Array.isArray(item && item.tasks)
      ? item.tasks.map(normalizeTask).filter(Boolean).slice(0, MAX_TASKS_PER_LIST)
      : [];
    return { id, name, tasks };
  }

  function emptyData() {
    return {
      version: 1,
      lists: DEFAULT_LIST_SPECS.map((spec) => ({ id: spec.id, name: spec.name, tasks: [] })),
    };
  }

  function seedData() {
    const data = emptyData();
    for (const list of data.lists) {
      const seeds = SEED_TASKS[list.id] || [];
      list.tasks = seeds.map((item) => normalizeTask({ ...item, id: newId("task") }));
    }
    return data;
  }

  function normalizeData(parsed) {
    if (!parsed || typeof parsed !== "object") return emptyData();
    let lists = Array.isArray(parsed.lists) ? parsed.lists.map(normalizeList) : [];
    if (!lists.length) lists = emptyData().lists;
    const seen = new Set();
    for (const list of lists) {
      if (seen.has(list.id)) list.id = newId("list");
      seen.add(list.id);
    }
    return { version: 1, lists: lists.slice(0, MAX_LISTS) };
  }

  function load(storage) {
    storage = storage || root.localStorage;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { data: seedData(), seeded: true };
      return { data: normalizeData(JSON.parse(raw)), seeded: false };
    } catch (err) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (_ignored) {}
      return { data: seedData(), seeded: true };
    }
  }

  function save(data, storage) {
    storage = storage || root.localStorage;
    const normalized = normalizeData(data);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { ok: true, data: normalized };
    } catch (err) {
      return { ok: false, data: normalized, message: "Could not save on this device." };
    }
  }

  function loadAndPersist(storage) {
    storage = storage || root.localStorage;
    const result = load(storage);
    if (result.seeded) save(result.data, storage);
    return result.data;
  }

  function listById(data, id) {
    return ((data && data.lists) || []).find((list) => list.id === id) || null;
  }

  function taskById(data, taskId) {
    for (const list of (data && data.lists) || []) {
      const task = list.tasks.find((item) => item.id === taskId);
      if (task) return { list, task };
    }
    return null;
  }

  function progress(list) {
    const tasks = (list && list.tasks) || [];
    const total = tasks.length;
    const done = tasks.filter((task) => task.done).length;
    return { done, total, open: total - done };
  }

  function topUnfinished(data) {
    if (!data || !Array.isArray(data.lists)) return null;
    const open = [];
    for (const list of data.lists) {
      for (const task of list.tasks) {
        if (!task.done) open.push({ list, task });
      }
    }
    if (!open.length) return null;
    open.sort((a, b) => {
      const aDue = a.task.due || "9999-99-99";
      const bDue = b.task.due || "9999-99-99";
      if (aDue !== bDue) return aDue < bDue ? -1 : 1;
      const aList = data.lists.indexOf(a.list);
      const bList = data.lists.indexOf(b.list);
      if (aList !== bList) return aList - bList;
      return a.list.tasks.indexOf(a.task) - b.list.tasks.indexOf(b.task);
    });
    return open[0];
  }

  function addList(data, name) {
    const trimmed = String(name || "").trim().slice(0, NAME_MAX);
    if (!trimmed) return { ok: false, message: "Enter a list name." };
    if (data.lists.length >= MAX_LISTS) return { ok: false, message: "List limit reached." };
    const list = { id: newId("list"), name: trimmed, tasks: [] };
    data.lists.push(list);
    return { ok: true, list, data };
  }

  function renameList(data, listId, name) {
    const list = listById(data, listId);
    if (!list) return { ok: false, message: "List not found." };
    const trimmed = String(name || "").trim().slice(0, NAME_MAX);
    if (!trimmed) return { ok: false, message: "Enter a list name." };
    list.name = trimmed;
    return { ok: true, list, data };
  }

  function deleteList(data, listId) {
    if (!data.lists || data.lists.length <= 1) return { ok: false, message: "Keep at least one list." };
    const index = data.lists.findIndex((list) => list.id === listId);
    if (index < 0) return { ok: false, message: "List not found." };
    const removed = data.lists.splice(index, 1)[0];
    return { ok: true, list: removed, data };
  }

  function addTask(data, listId, fields) {
    const list = listById(data, listId);
    if (!list) return { ok: false, message: "List not found." };
    if (list.tasks.length >= MAX_TASKS_PER_LIST) return { ok: false, message: "Task limit reached for this list." };
    const task = normalizeTask({
      id: newId("task"),
      title: fields && fields.title,
      note: fields && fields.note,
      due: fields && fields.due,
      done: false,
    });
    if (!task) return { ok: false, message: "Enter a task title." };
    list.tasks.push(task);
    return { ok: true, task, list, data };
  }

  function updateTask(data, taskId, patch) {
    const found = taskById(data, taskId);
    if (!found) return { ok: false, message: "Task not found." };
    const next = normalizeTask({ ...found.task, ...(patch || {}), id: found.task.id });
    if (!next) return { ok: false, message: "Enter a task title." };
    const index = found.list.tasks.findIndex((task) => task.id === taskId);
    found.list.tasks[index] = next;
    return { ok: true, task: next, list: found.list, data };
  }

  function toggleTask(data, taskId) {
    const found = taskById(data, taskId);
    if (!found) return { ok: false, message: "Task not found." };
    found.task.done = !found.task.done;
    return { ok: true, task: found.task, list: found.list, data };
  }

  function deleteTask(data, taskId) {
    const found = taskById(data, taskId);
    if (!found) return { ok: false, message: "Task not found." };
    found.list.tasks = found.list.tasks.filter((task) => task.id !== taskId);
    return { ok: true, list: found.list, data };
  }

  function moveTask(data, taskId, targetListId) {
    const found = taskById(data, taskId);
    const target = listById(data, targetListId);
    if (!found || !target) return { ok: false, message: "Could not move that task." };
    if (found.list.id === target.id) return { ok: true, list: found.list, task: found.task, data };
    if (target.tasks.length >= MAX_TASKS_PER_LIST) return { ok: false, message: "Task limit reached for that list." };
    found.list.tasks = found.list.tasks.filter((task) => task.id !== taskId);
    target.tasks.push(found.task);
    return { ok: true, list: target, task: found.task, data };
  }

  function moveTaskBy(data, taskId, delta) {
    const found = taskById(data, taskId);
    if (!found) return { ok: false, message: "Task not found." };
    const index = found.list.tasks.findIndex((task) => task.id === taskId);
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= found.list.tasks.length) {
      return { ok: true, list: found.list, task: found.task, index, data };
    }
    const copy = found.list.tasks.slice();
    const moved = copy.splice(index, 1)[0];
    copy.splice(nextIndex, 0, moved);
    found.list.tasks = copy;
    return { ok: true, list: found.list, task: found.task, index: nextIndex, data };
  }

  function clearDone(data, listId) {
    const list = listById(data, listId);
    if (!list) return { ok: false, message: "List not found.", removed: 0 };
    const before = list.tasks.length;
    list.tasks = list.tasks.filter((task) => !task.done);
    return { ok: true, list, removed: before - list.tasks.length, data };
  }

  function exportBlob(data) {
    return JSON.stringify({ version: 1, lists: normalizeData(data).lists }, null, 2);
  }

  function importBlob(text, data) {
    const raw = String(text || "").trim();
    if (!raw) return { ok: false, message: "Paste a JSON backup first.", data };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ok: false, message: "That was not valid JSON.", data };
    }
    const incoming = normalizeData(parsed);
    if (!incoming.lists.length) return { ok: false, message: "No lists found in that backup.", data };
    const current = normalizeData(data);
    const byId = new Map(current.lists.map((list) => [list.id, list]));
    const byName = new Map(current.lists.map((list) => [list.name.toLowerCase(), list]));
    let imported = 0;
    for (const list of incoming.lists) {
      if (byId.has(list.id)) {
        const existing = byId.get(list.id);
        existing.name = list.name;
        existing.tasks = list.tasks;
        imported += 1;
      } else if (byName.has(list.name.toLowerCase())) {
        byName.get(list.name.toLowerCase()).tasks = list.tasks;
        imported += 1;
      } else if (current.lists.length < MAX_LISTS) {
        current.lists.push(list);
        byId.set(list.id, list);
        imported += 1;
      }
    }
    return { ok: true, message: "Imported lists and tasks on this device.", data: current, imported };
  }

  const api = {
    STORAGE_KEY,
    TITLE_MAX,
    NOTE_MAX,
    NAME_MAX,
    ITEM_MAX,
    normalizeItem,
    itemsFromNote,
    openChecklistItems,
    DEFAULT_LIST_SPECS,
    parseDue,
    formatDue,
    ymd,
    parseYmd,
    normalizeTask,
    normalizeData,
    emptyData,
    seedData,
    load,
    save,
    loadAndPersist,
    listById,
    taskById,
    progress,
    topUnfinished,
    addList,
    renameList,
    deleteList,
    addTask,
    updateTask,
    toggleTask,
    deleteTask,
    moveTask,
    moveTaskBy,
    clearDone,
    exportBlob,
    importBlob,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticTasks = api;
})(typeof window !== "undefined" ? window : globalThis);
