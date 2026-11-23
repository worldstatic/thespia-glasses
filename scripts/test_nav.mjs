#!/usr/bin/env node
/* Key-sequence tests for Talk, Task Cards, and Add spend glasses navigation.
   Arrow keys and Enter only. No personal data.
*/
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nav = require(join(dirname(fileURLToPath(import.meta.url)), "..", "focus-nav.js"));

function press(ids, start, keys) {
  let focus = start;
  const path = [focus];
  for (const key of keys) {
    if (key === "ArrowDown") focus = nav.stepIds(ids, focus, 1);
    else if (key === "ArrowUp") focus = nav.stepIds(ids, focus, -1);
    path.push(focus);
  }
  return { focus, path };
}

function fakeEl(id, opts = {}) {
  return {
    id,
    tagName: (opts.tag || "button").toUpperCase(),
    disabled: Boolean(opts.disabled),
    attributes: {
      tabindex: opts.tabindex != null ? String(opts.tabindex) : "0",
      ...(opts.hidden ? { hidden: "" } : {}),
      ...(opts.ariaHidden ? { "aria-hidden": "true" } : {}),
      ...(opts.ariaDisabled ? { "aria-disabled": "true" } : {}),
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? String(this.attributes[name]) : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    },
    closest() {
      return null;
    },
  };
}

function rootOf(nodes) {
  return {
    querySelectorAll() {
      return nodes;
    },
  };
}

const TALK_IDS = [
  "talk-msg-0",
  "talk-msg-1",
  "major-message",
  "major-send",
  "talk-speak",
  "talk-people",
  "major-settings",
  "go-home",
];

const TALK_PENDING_IDS = [
  "talk-msg-0",
  "talk-msg-1",
  "talk-typing",
  "major-message",
  "major-send",
  "talk-people",
  "major-settings",
  "go-home",
];

const FUNDS_IDS = ["funds-amount", "funds-label", "save-funds-spend", "go-home"];

test("Talk opens on the composer; Arrow Up enters history; Arrow Down from any bubble reaches the input", () => {
  assert.equal(nav.talkDefaultFocus(), "major-message");

  const upFromInput = press(TALK_IDS, "major-message", ["ArrowUp"]);
  assert.equal(upFromInput.focus, "talk-msg-1");

  const backToInput = press(TALK_IDS, "talk-msg-1", ["ArrowDown"]);
  assert.equal(backToInput.focus, "major-message");

  const fromFirst = press(TALK_IDS, "talk-msg-0", ["ArrowDown", "ArrowDown"]);
  assert.equal(fromFirst.focus, "major-message");
  assert.deepEqual(fromFirst.path, ["talk-msg-0", "talk-msg-1", "major-message"]);

  for (const start of ["talk-msg-0", "talk-msg-1"]) {
    let cur = start;
    for (let i = 0; i < 8; i += 1) {
      const next = nav.stepIds(TALK_IDS, cur, 1);
      if (next === cur) break;
      cur = next;
      if (cur === "major-message") break;
    }
    assert.equal(cur, "major-message");
  }

  const pastThread = press(TALK_PENDING_IDS, "talk-typing", ["ArrowDown"]);
  assert.equal(pastThread.focus, "major-message");
});

test("the Talk thread scroller itself is not a focus trap", () => {
  const nodes = [
    fakeEl("talk-thread", { tag: "div" }),
    fakeEl("talk-msg-0", { tag: "div" }),
    fakeEl("talk-msg-1", { tag: "div" }),
    fakeEl("major-message", { tag: "input" }),
    fakeEl("major-send"),
    fakeEl("go-home"),
  ];
  const ids = nav.collectFocusables(rootOf(nodes)).map((el) => el.id);
  assert.ok(!ids.includes("talk-thread"));
  assert.deepEqual(ids, ["talk-msg-0", "talk-msg-1", "major-message", "major-send", "go-home"]);
  assert.equal(press(ids, "talk-msg-1", ["ArrowDown"]).focus, "major-message");
});

test("Task Cards: Arrow Down from the last card reaches the bottom bar", () => {
  let model = { focus: "list", taskIndex: 0, taskCount: 3 };
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.focus, "list");
  assert.equal(model.taskIndex, 1);
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.taskIndex, 2);
  assert.equal(model.focus, "list");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.focus, "footer");
  assert.equal(model.footerId, "open-new-task");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.footerId, "open-task-actions");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.footerId, "open-task-lists");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.footerId, "go-home");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.footerId, "go-home");
  model = nav.taskArrow(model, "ArrowUp");
  assert.equal(model.footerId, "open-task-lists");
  while (model.focus === "footer" && model.footerId !== "open-new-task") {
    model = nav.taskArrow(model, "ArrowUp");
  }
  model = nav.taskArrow(model, "ArrowUp");
  assert.equal(model.focus, "list");
  assert.equal(model.taskIndex, 2);
});

test("Task Cards: Arrow Up on the first card stays on the list, empty lists stay on the bar", () => {
  let model = nav.taskArrow({ focus: "list", taskIndex: 0, taskCount: 4 }, "ArrowUp");
  assert.equal(model.focus, "list");
  assert.equal(model.taskIndex, 0);

  let empty = nav.taskArrow({ focus: "list", taskIndex: 0, taskCount: 0 }, "ArrowDown");
  assert.equal(empty.focus, "footer");
  assert.equal(empty.footerId, "open-new-task");
  empty = nav.taskArrow(empty, "ArrowUp");
  assert.equal(empty.focus, "footer");
});

test("Add spend: arrows leave type=search fields; Enter in Amount moves to Label; Enter in Label or Save saves", () => {
  const down = press(FUNDS_IDS, "funds-amount", ["ArrowDown"]);
  assert.equal(down.focus, "funds-label");
  const toSave = press(FUNDS_IDS, "funds-label", ["ArrowDown"]);
  assert.equal(toSave.focus, "save-funds-spend");
  const toHome = press(FUNDS_IDS, "save-funds-spend", ["ArrowDown"]);
  assert.equal(toHome.focus, "go-home");
  const back = press(FUNDS_IDS, "go-home", ["ArrowUp", "ArrowUp", "ArrowUp"]);
  assert.equal(back.focus, "funds-amount");

  assert.deepEqual(nav.fundsEnter("funds-amount"), { action: "focus", id: "funds-label" });
  assert.deepEqual(nav.fundsEnter("funds-label"), { action: "save" });
  assert.deepEqual(nav.fundsEnter("save-funds-spend"), { action: "save" });
  assert.equal(nav.fundsEnter("funds-amount").action !== "save", true);
});

test("collectFocusables skips hidden, disabled, and tabindex=-1 controls so focus can leave a region", () => {
  const nodes = [
    fakeEl("visible-one"),
    fakeEl("disabled-btn", { disabled: true }),
    fakeEl("aria-off", { ariaDisabled: true }),
    fakeEl("hidden-btn", { hidden: true }),
    fakeEl("neg-tab", { tabindex: "-1" }),
    fakeEl("search-field", { tag: "input" }),
    fakeEl("visible-two"),
  ];
  const ids = nav.collectFocusables(rootOf(nodes)).map((el) => el.id);
  assert.deepEqual(ids, ["visible-one", "search-field", "visible-two"]);
  assert.equal(press(ids, "search-field", ["ArrowDown"]).focus, "visible-two");
  assert.equal(press(ids, "search-field", ["ArrowUp"]).focus, "visible-one");
});

test("linear step clamps at the ends of a screen chain", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nav.stepIds(ids, "a", -1), "a");
  assert.equal(nav.stepIds(ids, "c", 1), "c");
  assert.equal(nav.stepIds(ids, "missing", 1), "a");
  assert.equal(nav.stepIds(ids, "missing", -1), "c");
});
