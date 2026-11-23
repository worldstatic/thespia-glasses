#!/usr/bin/env node
/* Daily funds tests. Uses made-up amounts only. No personal data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const funds = require(join(dirname(fileURLToPath(import.meta.url)), "..", "funds.js"));

function day(year, month, date, hour = 10) {
  return new Date(year, month - 1, date, hour, 0, 0);
}

test("5 + 2 = 7 spent today, remaining updates", () => {
  const now = day(2026, 11, 22);
  let data = funds.blank(now);
  data = funds.setBudget(data, 40, now).data;
  data = funds.addSpend(data, "5", "", now).data;
  data = funds.addSpend(data, "2", "snack", now).data;
  assert.equal(data.spent, 7);
  assert.equal(data.entries.length, 2);
  assert.equal(funds.remaining(data), 33);
  assert.equal(funds.formatMoney(data.spent), "$7");
  assert.equal(funds.formatMoney(funds.remaining(data)), "$33");
});

test("add spend rejects an empty or zero amount and keeps the total", () => {
  const now = day(2026, 11, 22);
  let data = funds.setBudget(funds.blank(now), 20, now).data;
  data = funds.addSpend(data, 5, "", now).data;
  const failed = funds.addSpend(data, "", "", now);
  assert.equal(failed.ok, false);
  assert.equal(failed.data.spent, 5);
  const zero = funds.addSpend(data, "0", "", now);
  assert.equal(zero.ok, false);
  assert.equal(data.spent, 5);
});

test("midnight rollover resets spent, keeps the budget, and stores a short history", () => {
  const monday = day(2026, 11, 22, 21);
  let data = funds.setBudget(funds.blank(monday), 40, monday).data;
  data = funds.addSpend(data, "5", "", monday).data;
  data = funds.addSpend(data, "2", "", monday).data;
  assert.equal(data.day, "2026-11-22");
  assert.equal(data.spent, 7);

  const tuesday = day(2026, 11, 23, 0);
  const rolled = funds.rollover(data, tuesday);
  assert.equal(rolled.day, "2026-11-23");
  assert.equal(rolled.spent, 0);
  assert.equal(rolled.entries.length, 0);
  assert.equal(rolled.budget, 40);
  assert.equal(funds.remaining(rolled), 40);
  assert.equal(rolled.history.length, 1);
  assert.equal(rolled.history[0].day, "2026-11-22");
  assert.equal(rolled.history[0].spent, 7);
  assert.equal(rolled.history[0].budget, 40);
});

test("loadAndPersist rolls over when the stored day is in the past", () => {
  const store = new Map();
  const storage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
  const monday = day(2026, 11, 22, 18);
  const start = funds.addSpend(funds.setBudget(funds.blank(monday), 15, monday).data, 4, "", monday);
  funds.save(start.data, storage, monday);
  const tuesday = day(2026, 11, 23, 8);
  const loaded = funds.loadAndPersist(storage, tuesday);
  assert.equal(loaded.day, "2026-11-23");
  assert.equal(loaded.spent, 0);
  assert.equal(loaded.budget, 15);
  assert.equal(loaded.history[0].spent, 4);
});

test("parseAmount accepts $ and commas", () => {
  assert.equal(funds.parseAmount("$5.50"), 5.5);
  assert.equal(funds.parseAmount("1,000"), 1000);
  assert.equal(funds.parseAmount(-2), null);
});
