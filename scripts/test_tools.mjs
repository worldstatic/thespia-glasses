#!/usr/bin/env node
/* Timer, notes, and teleprompter slide helpers. No personal data. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const timer = require(join(root, "timer.js"));
const notes = require(join(root, "notes.js"));
const prompter = require(join(root, "prompter.js"));
const nav = require(join(root, "focus-nav.js"));
const tasks = require(join(root, "tasks.js"));

test("stopwatch counts up and can be paused", () => {
  const t0 = new Date(2026, 10, 23, 8, 0, 0);
  let data = timer.setMode(timer.blank(t0), "stopwatch", t0);
  data = timer.start(data, t0);
  const t1 = new Date(t0.getTime() + 5000);
  data = timer.snapshot(data, t1);
  assert.equal(timer.displayMs(data, t1), 5000);
  data = timer.pause(data, t1);
  const t2 = new Date(t1.getTime() + 9000);
  assert.equal(timer.displayMs(data, t2), 5000);
});

test("countdown reaches zero and stays there", () => {
  const t0 = new Date(2026, 10, 23, 8, 0, 0);
  const started = timer.setCountdown(timer.blank(t0), 1, t0);
  assert.equal(started.ok, true);
  let data = timer.start(started.data, t0);
  const t1 = new Date(t0.getTime() + 60 * 1000);
  assert.equal(timer.isDone(data, t1), true);
  assert.equal(timer.formatClock(timer.displayMs(data, t1)), "0:00");
});

test("focus sessions move to a break and tally the day", () => {
  const t0 = new Date(2026, 10, 23, 8, 0, 0);
  let data = timer.setMode(timer.blank(t0), "focus", t0);
  data = timer.start(data, t0);
  const end = new Date(t0.getTime() + timer.FOCUS_MINUTES * 60 * 1000);
  data = timer.completeFocus(data, end);
  assert.equal(data.focusPhase, "break");
  assert.equal(data.focusSessions, 1);
  assert.equal(data.durationMs, timer.BREAK_MINUTES * 60 * 1000);
});

test("notes are newest first and can be deleted", () => {
  const t0 = new Date(2026, 10, 23, 8, 0, 0);
  let data = notes.emptyData();
  data = notes.addNote(data, "Unit 214 walk-through", t0).data;
  data = notes.addNote(data, "BRB overlay idea", new Date(t0.getTime() + 1000)).data;
  const list = notes.list(data);
  assert.equal(list[0].text, "BRB overlay idea");
  const gone = notes.deleteNote(data, list[0].id);
  assert.equal(gone.ok, true);
  assert.equal(gone.data.notes.length, 1);
  assert.equal(gone.data.notes[0].text, "Unit 214 walk-through");
});

test("empty notes are rejected and nothing is uploaded in the API", () => {
  const failed = notes.addNote(notes.emptyData(), "  ");
  assert.equal(failed.ok, false);
  assert.equal(notes.STORAGE_KEY, "thespia.hud.notes");
});

test("slides split paragraphs and long text, and mode defaults to scroll", () => {
  const body = [
    "## Intro",
    "Welcome back to the stream.",
    "",
    "This second thought is its own paragraph.",
    "",
    "## Long",
    Array(80).fill("word").join(" "),
  ].join("\n");
  const slides = prompter.splitSlides(body, 36);
  assert.ok(slides.length >= 3);
  assert.equal(slides[0].title, "Intro");
  assert.match(slides[0].text, /Welcome back/);
  assert.match(slides[1].text, /second thought/);
  const longOnes = slides.filter((slide) => slide.text && slide.text.split(" ").length > 8);
  assert.ok(longOnes.length >= 1);
  assert.ok(longOnes.every((slide) => slide.text.length <= prompter.slideCapacity(36).maxChars + 20));
  assert.equal(prompter.normalizePlayMode("slides"), "slides");
  assert.equal(prompter.normalizePlayMode("nope"), "scroll");
  const data = prompter.normalizeData({ scripts: [] });
  assert.equal(data.playMode, "scroll");
});

test("task screen order is cards then the 2x2 footer, with no skipped ids", () => {
  assert.equal(nav.APP_VERSION, "v16");
  const start = "task-item-0";
  const path = [start];
  let id = start;
  for (let i = 0; i < 6; i += 1) {
    id = nav.taskScreenNext(id, "down", 3);
    path.push(id);
  }
  assert.deepEqual(path, [
    "task-item-0",
    "task-item-1",
    "task-item-2",
    "open-new-task",
    "open-task-lists",
    "task-item-0",
    "task-item-1",
  ]);
  assert.equal(nav.taskScreenNext("open-new-task", "right", 3), "open-task-actions");
  assert.equal(nav.taskScreenNext("open-task-actions", "down", 3), "go-home");
  assert.equal(nav.taskScreenNext("go-home", "left", 3), "open-task-lists");
  assert.equal(nav.taskScreenNext("open-new-task", "up", 3), "task-item-2");
});

test("toggleItem flips one checklist bullet and marks the task done when all are checked", () => {
  const now = new Date(2026, 10, 23);
  const data = tasks.seedData();
  const list = data.lists[0];
  const task = list.tasks[0];
  assert.ok(task.items.length >= 2);
  const first = tasks.toggleItem(data, task.id, task.items[0].id);
  assert.equal(first.ok, true);
  assert.equal(first.item.done, true);
  assert.equal(first.task.done, false);
  for (const item of task.items) {
    if (!item.done) tasks.toggleItem(data, task.id, item.id);
  }
  assert.equal(task.done, true);
});
