#!/usr/bin/env node
/* Headless Chromium 600x600 walk of Home, Task Cards, Talk, and Add spend.
   Presses only arrow keys. Enables Chromium spatial navigation, the same
   path Meta Ray-Ban Display uses for Neural Band swipes. No personal data.
*/
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadPuppeteer() {
  const candidates = [
    "/tmp/ws-puppeteer/node_modules/puppeteer-core",
    path.join(root, "node_modules/puppeteer-core"),
    "puppeteer-core",
    "playwright",
  ];
  for (const name of candidates) {
    try {
      return { mod: require(name), name };
    } catch (_err) {
      /* try next */
    }
  }
  throw new Error("Install puppeteer-core to run the 600x600 arrow-key walk (npm install puppeteer-core)");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, origin: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

async function currentId(page) {
  return page.evaluate(() => (document.activeElement && document.activeElement.id) || "");
}

async function press(page, key) {
  await page.keyboard.press(key);
  await new Promise((r) => setTimeout(r, 40));
}

async function reachableByArrows(page) {
  const seen = new Set();
  const start = await currentId(page);
  const queue = start ? [start] : [];
  const explored = new Set();
  if (start) seen.add(start);
  while (queue.length) {
    const id = queue.shift();
    if (!id || explored.has(id)) continue;
    explored.add(id);
    await page.evaluate((target) => {
      const el = document.getElementById(target);
      if (el && typeof el.focus === "function") el.focus();
    }, id);
    for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
      await page.evaluate((target) => {
        const el = document.getElementById(target);
        if (el && typeof el.focus === "function") el.focus();
      }, id);
      await press(page, key);
      const next = await currentId(page);
      if (next) seen.add(next);
      if (next && !explored.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

function missing(seen, required) {
  return required.filter((id) => !seen.includes(id));
}

async function seedTalk(page) {
  await page.evaluate(() => {
    const threads = {
      major: [
        { id: "m1", role: "user", text: "Hello", ts: 1, status: "sent" },
        { id: "m2", role: "assistant", text: "Preview reply", ts: 2, status: "sent" },
      ],
      c2: [],
    };
    localStorage.setItem("thespia.hud.talk.threads", JSON.stringify(threads));
  });
}

async function openTalk(page) {
  await page.click("#open-apps");
  await page.waitForSelector("#open-talk");
  await page.click("#open-talk");
  await page.waitForSelector("#talk-pick-major");
  await page.click("#talk-pick-major");
  await page.waitForSelector("#major-message");
}

async function main() {
  const { mod: puppeteer } = loadPuppeteer();
  const chrome = process.env.CHROME || process.env.CHROMIUM_PATH || "/usr/bin/google-chrome-stable";
  const { server, origin } = await startServer();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--enable-spatial-navigation",
      "--window-size=600,600",
    ],
    defaultViewport: { width: 600, height: 600, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const failures = [];
  try {
    await page.goto(origin + "/?no-sw=1", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("#open-apps", { timeout: 15000 });

    const version = await page.$eval("#app-version", (el) => el.textContent.trim());
    if (version !== "v15") failures.push("Home version label should read v15, got " + version);

    const homeIds = await reachableByArrows(page);
    const homeMissing = missing(homeIds, ["open-funds", "open-next-up", "open-current-task", "open-talk-preview", "open-apps"]);
    if (homeMissing.length) failures.push("Home arrows missed " + homeMissing.join(", ") + " (reached " + homeIds.join(", ") + ")");

    await page.click("#open-apps");
    await page.waitForSelector("#open-task-cards");
    const appsVersion = await page.$eval("#app-version", (el) => el.textContent.trim());
    if (appsVersion !== "v15") failures.push("Apps version label should read v15, got " + appsVersion);

    await page.click("#open-task-cards");
    await page.waitForSelector("#open-new-task");
    const taskIds = await reachableByArrows(page);
    const hasCard = taskIds.some((id) => id === "selected-task" || id.startsWith("task-item-"));
    const taskMissing = missing(taskIds, ["open-new-task", "open-task-actions", "open-task-lists", "go-home"]);
    if (!hasCard) failures.push("Task Cards arrows never reached a task card (reached " + taskIds.join(", ") + ")");
    if (taskMissing.length) failures.push("Task Cards arrows missed " + taskMissing.join(", ") + " (reached " + taskIds.join(", ") + ")");

    await page.click("#go-home");
    await page.waitForSelector("#open-apps");
    await page.click("#open-apps");
    await page.waitForSelector("#open-add-spend");
    await page.click("#open-add-spend");
    await page.waitForSelector("#funds-amount");
    const amountCount = await page.$$eval('input[type="search"]', (els) => els.length);
    if (amountCount !== 1) failures.push("Add spend Amount step must have exactly one search field, found " + amountCount);
    if (await page.$("#funds-label")) failures.push("Label must not be in the DOM on the Amount step");
    const fundsAmountIds = await reachableByArrows(page);
    const fundsAmountMissing = missing(fundsAmountIds, ["funds-amount", "funds-next", "go-home"]);
    if (fundsAmountMissing.length) failures.push("Add spend Amount arrows missed " + fundsAmountMissing.join(", ") + " (reached " + fundsAmountIds.join(", ") + ")");
    await page.click("#funds-next");
    await page.waitForSelector("#funds-label");
    if (await page.$("#funds-amount")) failures.push("Amount must not be in the DOM on the Label step");
    await page.focus("#funds-label");
    await page.evaluate(() => {
      const el = document.getElementById("funds-label");
      el.focus();
      el.value = "coffee";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "coffee", inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const labelLanded = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      label: (document.getElementById("funds-label") || {}).value,
      amount: document.getElementById("funds-amount") && document.getElementById("funds-amount").value,
    }));
    if (labelLanded.active !== "funds-label" || labelLanded.label !== "coffee") {
      failures.push("Add spend: input on Label landed in " + JSON.stringify(labelLanded));
    }
    if (labelLanded.amount != null) failures.push("Add spend: Amount field was present while dictating the label");
    const fundsLabelIds = await reachableByArrows(page);
    const fundsLabelMissing = missing(fundsLabelIds, ["funds-label", "save-funds-spend", "go-home"]);
    if (fundsLabelMissing.length) failures.push("Add spend Label arrows missed " + fundsLabelMissing.join(", ") + " (reached " + fundsLabelIds.join(", ") + ")");

    await page.click("#go-home");
    await page.waitForSelector("#open-apps");
    await page.click("#open-apps");
    await page.waitForSelector("#open-task-cards");
    await page.click("#open-task-cards");
    await page.waitForSelector("#open-new-task");
    await page.click("#open-new-task");
    await page.waitForSelector("#task-title");
    if (await page.$("#task-note") || await page.$("#task-due")) failures.push("New task Title step must not include Note or Due fields");
    await page.click("#task-step-next");
    await page.waitForSelector("#task-note");
    if (await page.$("#task-title")) failures.push("Title must not be in the DOM on the Note step");
    await page.focus("#task-note");
    await page.evaluate(() => {
      const el = document.getElementById("task-note");
      el.focus();
      el.value = "Bring bag";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Bring bag", inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const noteLanded = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      note: (document.getElementById("task-note") || {}).value,
      title: document.getElementById("task-title") && document.getElementById("task-title").value,
    }));
    if (noteLanded.active !== "task-note" || noteLanded.note !== "Bring bag") {
      failures.push("New task: input on Note landed in " + JSON.stringify(noteLanded));
    }
    if (noteLanded.title != null) failures.push("New task: Title field was present while dictating the note");

    await page.click("#go-home");
    await page.waitForSelector("#open-apps");
    await seedTalk(page);
    await openTalk(page);
    const composer = await currentId(page);
    if (composer !== "major-message") {
      failures.push("Talk should open on the composer, focus was " + composer);
    }
    const talkSearch = await page.$$eval('input[type="search"]', (els) => els.map((el) => el.id));
    if (talkSearch.length !== 1 || talkSearch[0] !== "major-message") {
      failures.push("Talk must have exactly one search field (the composer), found " + talkSearch.join(","));
    }
    await page.evaluate(() => {
      const el = document.getElementById("major-message");
      el.focus();
      el.value = "Hello there";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Hello there", inputType: "insertText" }));
    });
    const talkLanded = await page.evaluate(() => ({
      active: document.activeElement && document.activeElement.id,
      value: (document.getElementById("major-message") || {}).value,
    }));
    if (talkLanded.active !== "major-message" || talkLanded.value !== "Hello there") {
      failures.push("Talk composer input landed in " + JSON.stringify(talkLanded));
    }
    const talkIds = await reachableByArrows(page);
    const talkRequired = ["talk-msg-0", "talk-msg-1", "major-message", "major-send", "talk-people", "major-settings", "go-home"];
    if (await page.$("#major-speak")) talkRequired.push("major-speak");
    const talkMissing = missing(talkIds, talkRequired);
    if (talkMissing.length) failures.push("Talk arrows missed " + talkMissing.join(", ") + " (reached " + talkIds.join(", ") + ")");

    await page.evaluate(() => {
      const api = window.ThespiaMajor;
      if (!api || typeof api.awaitReply !== "function") return;
      const orig = api.awaitReply.bind(api);
      api.awaitReply = async (id, opts) => {
        await new Promise((resolve) => setTimeout(resolve, 11000));
        return orig(id, opts);
      };
    });
    await page.focus("#major-message");
    await page.evaluate(() => {
      const input = document.getElementById("major-message");
      if (input) input.value = "Ping";
    });
    await page.click("#major-send");
    await page.waitForSelector("#talk-typing", { timeout: 5000 });
    await page.focus("#talk-people");
    const started = Date.now();
    while (Date.now() - started < 10500) {
      await page.evaluate(() => {
        const state = history.state;
        history.replaceState(state, "");
        window.dispatchEvent(new PopStateEvent("popstate", { state }));
      });
      await new Promise((r) => setTimeout(r, 2000));
      const id = await currentId(page);
      if (id !== "talk-people") {
        failures.push("Talk poll refresh stole focus to " + id + " after " + (Date.now() - started) + "ms");
        break;
      }
    }
    const afterPoll = await reachableByArrows(page);
    const afterMissing = missing(afterPoll, ["major-message", "major-send", "talk-people", "major-settings", "go-home"]);
    if (afterMissing.length) {
      failures.push("Talk after 10s poll missed " + afterMissing.join(", ") + " (reached " + afterPoll.join(", ") + ")");
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    for (const line of failures) console.error("FAIL:", line);
    process.exit(1);
  }
  console.log("PASS 600x600 arrow-key walk reached Home, Task Cards, Add spend, and Talk controls, including a 10s Talk poll.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
