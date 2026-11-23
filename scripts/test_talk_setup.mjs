#!/usr/bin/env node
/* Fragment setup tests. Uses a FAKE token only. Never logs real secrets. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "major-transport.js"), "utf8");

function encodePayload(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

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
  const location = {
    pathname: "/thespia-glasses/",
    search: "",
    hash: "",
  };
  const history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      if (url == null || url === "") return;
      const text = String(url);
      const hashAt = text.indexOf("#");
      location.hash = hashAt >= 0 ? text.slice(hashAt) : "";
      if (text.startsWith("/")) {
        const noHash = hashAt >= 0 ? text.slice(0, hashAt) : text;
        const q = noHash.indexOf("?");
        location.pathname = q >= 0 ? noHash.slice(0, q) : noHash;
        location.search = q >= 0 ? noHash.slice(q) : "";
      }
    },
  };
  const logs = [];
  const window = { location, history, localStorage };
  const sandbox = {
    window,
    localStorage,
    atob,
    btoa,
    URL,
    console: {
      log: (...args) => logs.push(args.map(String).join(" ")),
      warn: (...args) => logs.push(args.map(String).join(" ")),
      error: (...args) => logs.push(args.map(String).join(" ")),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.window.ThespiaMajor, location, history, localStorage, store, logs };
}

const FAKE = {
  relayUrl: "https://example.com/relay",
  token: "fake-token-for-tests-only",
};

test("valid fragment saves relay config and clears the hash", () => {
  const world = makeWorld();
  world.location.hash = `#talk-setup=${encodePayload(FAKE)}`;
  const result = world.api.consumeTalkSetup(world.location, world.history);
  assert.equal(result.ok, true);
  assert.equal(world.location.hash, "");
  const saved = JSON.parse(world.localStorage.getItem("thespia.hud.major.transport"));
  assert.equal(saved.kind, "relay");
  assert.equal(saved.relayUrl, FAKE.relayUrl);
  assert.equal(saved.token, FAKE.token);
  const dumped = world.logs.join("\n");
  assert.equal(dumped.includes(FAKE.token), false);
  assert.equal("token" in result, false);
});

test("http relayUrl is rejected and existing config is left alone", () => {
  const world = makeWorld();
  world.localStorage.setItem(
    "thespia.hud.major.transport",
    JSON.stringify({ kind: "mock", relayUrl: "", token: "" })
  );
  world.location.hash = `#talk-setup=${encodePayload({
    relayUrl: "http://example.com/relay",
    token: "fake-token-for-tests-only",
  })}`;
  const result = world.api.consumeTalkSetup(world.location, world.history);
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.equal(world.location.hash, "");
  const saved = JSON.parse(world.localStorage.getItem("thespia.hud.major.transport"));
  assert.equal(saved.kind, "mock");
  assert.equal(saved.token || "", "");
});

test("query string is ignored; only the fragment is read", () => {
  const world = makeWorld();
  world.location.search = `?talk-setup=${encodePayload(FAKE)}`;
  world.location.hash = "";
  const result = world.api.consumeTalkSetup(world.location, world.history);
  assert.equal(result.ok, false);
  assert.equal(result.attempted, false);
  assert.equal(world.localStorage.getItem("thespia.hud.major.transport"), null);
});

test("invalid payload still clears the fragment", () => {
  const world = makeWorld();
  world.location.hash = "#talk-setup=not-valid-base64";
  const result = world.api.consumeTalkSetup(world.location, world.history);
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.equal(world.location.hash, "");
});
