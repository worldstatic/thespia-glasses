#!/usr/bin/env node
/* Talk thread storage tests. No live tokens or personal data. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "major-transport.js"), "utf8");

function makeWorld() {
  const store = new Map();
  const localStorage = {
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
  const logs = [];
  const window = { localStorage, crypto: { randomUUID: () => "11111111-1111-1111-1111-111111111111" } };
  const sandbox = {
    window,
    localStorage,
    setTimeout,
    atob,
    btoa,
    URL,
    fetch: async () => {
      throw new Error("fetch should not run in thread tests");
    },
    console: {
      log: (...args) => logs.push(args.map(String).join(" ")),
      warn: (...args) => logs.push(args.map(String).join(" ")),
      error: (...args) => logs.push(args.map(String).join(" ")),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.window.ThespiaMajor, localStorage, store, logs };
}

test("legacy exchanges expand into user and assistant messages", () => {
  const world = makeWorld();
  world.localStorage.setItem(
    "thespia.hud.talk.threads",
    JSON.stringify({
      major: [{ id: "abc", text: "Hello Major", reply: "I am here.", ts: 1000, from: "major" }],
      c2: [],
    })
  );
  const list = world.api.loadThread("major");
  assert.equal(list.length, 2);
  assert.equal(list[0].role, "user");
  assert.equal(list[0].text, "Hello Major");
  assert.equal(list[1].role, "assistant");
  assert.equal(list[1].text, "I am here.");
  assert.equal(list[1].requestId, "abc");
});

test("threads keep the newest 50 messages per person", () => {
  const world = makeWorld();
  assert.equal(world.api.MAX_THREAD, 50);
  for (let i = 0; i < 60; i += 1) {
    world.api.appendMessage("c2", { role: "user", text: "m" + i, ts: i + 1 });
  }
  const list = world.api.loadThread("c2");
  assert.equal(list.length, 50);
  assert.equal(list[0].text, "m10");
  assert.equal(list[49].text, "m59");
  assert.equal(world.api.loadThread("major").length, 0);
});

test("mock send persists a user bubble and a reply", async () => {
  const world = makeWorld();
  const result = await world.api.send("Can you hear me?", { to: "major" });
  assert.equal(result.source, "mock");
  assert.equal(result.timeout, false);
  assert.match(result.reply, /practice reply from Major/);
  const list = world.api.loadThread("major");
  assert.equal(list.length, 2);
  assert.equal(list[0].role, "user");
  assert.equal(list[0].text, "Can you hear me?");
  assert.equal(list[1].role, "assistant");
  assert.match(list[1].text, /practice reply from Major/);
});

test("timeout system messages can be removed for a retry of the same id", () => {
  const world = makeWorld();
  world.api.appendMessage("major", { role: "user", text: "Ping", requestId: "req-1", ts: 1 });
  world.api.appendMessage("major", {
    role: "system",
    text: "No reply yet. Tap to check again.",
    requestId: "req-1",
    status: "timeout",
    ts: 2,
  });
  world.api.removeMessages("major", (item) => item.requestId === "req-1" && item.status === "timeout");
  const list = world.api.loadThread("major");
  assert.equal(list.length, 1);
  assert.equal(list[0].role, "user");
  world.api.appendMessage("major", { role: "assistant", text: "Here.", requestId: "req-1", ts: 3 });
  assert.equal(world.api.loadThread("major").length, 2);
});
