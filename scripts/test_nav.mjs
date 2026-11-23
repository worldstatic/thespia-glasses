#!/usr/bin/env node
/* Key-sequence and spatial-neighbor tests for Talk, Task Cards, and Add spend.
   Arrow keys, Tab, keyCode, and wheel variants. No personal data.
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
    const parsed = nav.normalizeNav({ key });
    if (parsed.dir) focus = nav.stepIds(ids, focus, parsed.dir, true);
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
  "major-speak",
  "talk-people",
  "major-settings",
  "go-home",
];

const FUNDS_AMOUNT_IDS = ["funds-amount", "funds-next", "go-home"];
const FUNDS_LABEL_IDS = ["funds-label", "save-funds-spend", "funds-back", "go-home"];

test("Talk opens on the composer; Arrow Up enters history; Arrow Down from any bubble reaches the input", () => {
  assert.equal(nav.talkDefaultFocus(), "major-message");
  assert.equal(press(TALK_IDS, "major-message", ["ArrowUp"]).focus, "talk-msg-1");
  assert.equal(press(TALK_IDS, "talk-msg-1", ["ArrowDown"]).focus, "major-message");
  const fromFirst = press(TALK_IDS, "talk-msg-0", ["ArrowDown", "ArrowDown"]);
  assert.equal(fromFirst.focus, "major-message");
  assert.equal(press(TALK_IDS, "talk-msg-0", ["ArrowRight", "ArrowRight"]).focus, "major-message");
});

test("the Talk thread scroller itself is not a focus trap", () => {
  const nodes = [
    fakeEl("talk-thread", { tag: "div" }),
    fakeEl("talk-msg-0", { tag: "div" }),
    fakeEl("talk-msg-1", { tag: "div" }),
    fakeEl("major-message", { tag: "input" }),
    fakeEl("major-send"),
    fakeEl("major-speak"),
    fakeEl("talk-people"),
    fakeEl("major-settings"),
    fakeEl("go-home"),
  ];
  const ids = nav.collectFocusables(rootOf(nodes)).map((el) => el.id);
  assert.ok(!ids.includes("talk-thread"));
  assert.ok(ids.includes("major-speak"));
  assert.ok(ids.includes("talk-people"));
  assert.ok(ids.includes("major-settings"));
  assert.equal(press(ids, "talk-msg-1", ["ArrowDown"]).focus, "major-message");
});

test("Task Cards: Arrow Down/Right from the last card reaches New task, Actions, Lists, and Home", () => {
  let model = { focus: "list", taskIndex: 0, taskCount: 3 };
  model = nav.taskArrow(model, "ArrowDown");
  model = nav.taskArrow(model, "ArrowRight");
  assert.equal(model.focus, "list");
  assert.equal(model.taskIndex, 2);
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.focus, "footer");
  assert.equal(model.footerId, "open-new-task");
  model = nav.taskArrow(model, "ArrowDown");
  assert.equal(model.footerId, "open-task-actions");
  model = nav.taskArrow(model, "ArrowRight");
  assert.equal(model.footerId, "open-task-lists");
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

test("Add spend and New task are one-field wizards", () => {
  assert.deepEqual(nav.nextFormStep("funds", "amount"), { step: "label", done: false, fieldId: "funds-label" });
  assert.equal(nav.nextFormStep("funds", "label").done, true);
  assert.equal(nav.prevFormStep("funds", "label").step, "amount");
  assert.equal(nav.formFieldId("funds", "amount"), "funds-amount");
  assert.equal(nav.nextFormStep("task", "title").fieldId, "task-note");
  assert.equal(nav.nextFormStep("task", "note").fieldId, "task-due");
  assert.equal(nav.nextFormStep("task", "due").done, true);
  assert.equal(press(FUNDS_AMOUNT_IDS, "funds-amount", ["ArrowDown"]).focus, "funds-next");
  assert.equal(press(FUNDS_LABEL_IDS, "funds-label", ["ArrowDown"]).focus, "save-funds-spend");
});

test("normalizeNav accepts key, code, keyCode, Down aliases, Tab, and wheel", () => {
  assert.equal(nav.normalizeNav({ key: "ArrowDown" }).name, "down");
  assert.equal(nav.normalizeNav({ key: "Down" }).name, "down");
  assert.equal(nav.normalizeNav({ key: "", code: "ArrowDown" }).name, "down");
  assert.equal(nav.normalizeNav({ key: "Unidentified", keyCode: 40 }).name, "down");
  assert.equal(nav.normalizeNav({ key: "ArrowRight", keyCode: 39 }).name, "right");
  assert.equal(nav.normalizeNav({ key: "ArrowUp" }).dir, -1);
  assert.equal(nav.normalizeNav({ key: "Tab" }).fromTab, true);
  assert.equal(nav.normalizeNav({ key: "Tab" }).dir, 1);
  assert.equal(nav.normalizeNav({ key: "Tab", shiftKey: true }).dir, -1);
  assert.equal(nav.normalizeNav({ type: "wheel", deltaY: 80 }).name, "down");
  assert.equal(nav.normalizeNav({ type: "wheel", deltaY: -20 }).name, "up");
  assert.equal(nav.normalizeNav({ key: "Enter", keyCode: 13 }).activate, true);
});

test("spatialNext picks the geometrically nearest neighbor and wraps", () => {
  function box(id, left, top) {
    return {
      id,
      getBoundingClientRect() {
        return { left, top, right: left + 80, bottom: top + 40, width: 80, height: 40 };
      },
    };
  }
  const cardA = box("card-a", 10, 10);
  const cardB = box("card-b", 10, 70);
  const newTask = box("open-new-task", 10, 200);
  const actions = box("open-task-actions", 120, 200);
  const list = [cardA, cardB, newTask, actions];
  assert.equal(nav.spatialNext(list, cardA, "down").id, "card-b");
  assert.equal(nav.spatialNext(list, cardB, "down").id, "open-new-task");
  assert.equal(nav.spatialNext(list, newTask, "right").id, "open-task-actions");
  assert.equal(nav.spatialNext(list, actions, "left").id, "open-new-task");
  assert.equal(nav.spatialNext(list, actions, "down", true).id, "card-a");
});

test("collectFocusables skips hidden, disabled, and tabindex=-1 controls", () => {
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
});

test("linear step wraps at the ends of a screen chain", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nav.stepIds(ids, "a", -1, true), "c");
  assert.equal(nav.stepIds(ids, "c", 1, true), "a");
  assert.equal(nav.stepIds(ids, "a", -1, false), "a");
  assert.equal(nav.stepIds(ids, "c", 1, false), "c");
});
