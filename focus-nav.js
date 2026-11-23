/* Focus helpers for World Static on Meta Ray-Ban Display.
   Neural Band / Cap Touch arrive as Arrow/Enter keydown. Chromium spatial
   navigation then moves focus by on-screen position, or scrolls if nothing
   is in that direction. This module:
   - normalizes key, code, keyCode, Tab, and wheel variants
   - finds the nearest focusable neighbor geometrically (and wraps)
   - lists eligible controls, skipping hidden/disabled/inert nodes
   Callers should let the browser move focus between buttons, and only
   intercept arrows when a text field would otherwise trap them.
*/
(function (root) {
  "use strict";

  const TASK_FOOTER_IDS = ["open-new-task", "open-task-actions", "open-task-lists", "go-home"];
  const APP_VERSION = "v15";

  function isDisabled(el) {
    return Boolean(el && (el.disabled || el.getAttribute("aria-disabled") === "true"));
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.inert) return true;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
    if (el.closest && (el.closest("[hidden]") || el.closest("[inert]"))) return true;
    if (typeof el.getClientRects === "function") {
      try {
        if (el.getClientRects().length === 0) {
          const style = root.getComputedStyle ? root.getComputedStyle(el) : null;
          if (style && (style.display === "none" || style.visibility === "hidden")) return true;
        }
      } catch (_err) {
        /* jsdom or detached node */
      }
    }
    return false;
  }

  function collectFocusables(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return [];
    const nodes = rootEl.querySelectorAll("button, input, textarea, select, a[href], [tabindex]");
    const list = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isDisabled(el) || isHidden(el)) continue;
      if (el.getAttribute("tabindex") === "-1") continue;
      if (el.id === "talk-thread" || el.id === "talk-thread-end") continue;
      if (el.id === "input-debug" || (el.closest && el.closest("#input-debug"))) continue;
      list.push(el);
    }
    return list;
  }

  function stepIds(ids, currentId, dir, wrap) {
    if (!ids || !ids.length) return currentId || "";
    const step = dir < 0 ? -1 : 1;
    const i = ids.indexOf(currentId);
    const start = i < 0 ? (step > 0 ? -1 : ids.length) : i;
    let next = start + step;
    if (wrap !== false) {
      if (next < 0) return ids[ids.length - 1];
      if (next >= ids.length) return ids[0];
      return ids[next];
    }
    if (next < 0) return ids[0];
    if (next >= ids.length) return ids[ids.length - 1];
    return ids[next];
  }

  function step(list, current, dir, wrap) {
    if (!list || !list.length) return null;
    const ids = list.map((el, i) => (el && el.id ? el.id : "#" + i));
    const currentId = current && current.id ? current.id : ids[list.indexOf(current)];
    const nextId = stepIds(ids, currentId, dir, wrap);
    const idx = ids.indexOf(nextId);
    return idx >= 0 ? list[idx] : list[0];
  }

  function axisRect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, cx: 0, cy: 0 };
    }
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
    };
  }

  function hasSize(rect) {
    return rect.width > 0 && rect.height > 0;
  }

  function isInDirection(a, b, dir) {
    const slop = 4;
    if (dir === 1 || dir === "down") return b.bottom > a.bottom + slop || b.cy > a.cy + slop;
    if (dir === -1 || dir === "up") return b.top < a.top - slop || b.cy < a.cy - slop;
    if (dir === "right") return b.right > a.right + slop || b.cx > a.cx + slop;
    if (dir === "left") return b.left < a.left - slop || b.cx < a.cx - slop;
    return false;
  }

  function spatialScore(a, b, dir) {
    const down = dir === 1 || dir === "down";
    const up = dir === -1 || dir === "up";
    const vertical = down || up;
    const overlap = vertical
      ? Math.min(a.right, b.right) - Math.max(a.left, b.left)
      : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const overlapAmt = overlap > 0 ? overlap : 0;
    const primary = vertical ? Math.abs((down ? b.top - a.bottom : a.top - b.bottom)) : Math.abs((dir === "right" ? b.left - a.right : a.left - b.right));
    const cross = vertical ? Math.abs(a.cx - b.cx) : Math.abs(a.cy - b.cy);
    const overlapBonus = overlapAmt > 0 ? 0 : 10000 + Math.abs(overlap);
    return primary * 10 + cross + overlapBonus;
  }

  function dirName(dir) {
    if (dir === 1 || dir === "down") return "down";
    if (dir === -1 || dir === "up") return "up";
    if (dir === "left" || dir === "right") return dir;
    return "down";
  }

  function spatialNext(list, current, dir, wrap) {
    if (!list || !list.length) return null;
    const name = dirName(dir);
    const from = current && list.indexOf(current) >= 0 ? current : null;
    if (!from) return list[0];
    const a = axisRect(from);
    if (!hasSize(a)) return step(list, current, name === "up" || name === "left" ? -1 : 1, wrap !== false);
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const el = list[i];
      if (el === from) continue;
      const b = axisRect(el);
      if (!hasSize(b) || !isInDirection(a, b, name)) continue;
      const score = spatialScore(a, b, name);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) return best;
    if (wrap === false) return from;
    let wrapped = null;
    let wrappedScore = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const el = list[i];
      if (el === from) continue;
      const b = axisRect(el);
      if (!hasSize(b)) continue;
      let score;
      if (name === "down") score = b.top * 1000 + b.left;
      else if (name === "up") score = -b.bottom * 1000 + b.left;
      else if (name === "right") score = b.left * 1000 + b.top;
      else score = -b.right * 1000 + b.top;
      if (score < wrappedScore) {
        wrappedScore = score;
        wrapped = el;
      }
    }
    return wrapped || from;
  }

  function keyCodeOf(event) {
    if (!event) return 0;
    const code = event.keyCode || event.which || 0;
    return Number(code) || 0;
  }

  function normalizeNav(event) {
    if (!event) return { dir: 0, activate: false, kind: "", name: "", fromTab: false };
    const type = event.type || "";
    if (type === "wheel" || type === "mousewheel") {
      const dy = event.deltaY || 0;
      const dx = event.deltaX || 0;
      let dir = 0;
      let name = "";
      if (Math.abs(dy) >= Math.abs(dx) && dy) {
        dir = dy > 0 ? 1 : -1;
        name = dy > 0 ? "down" : "up";
      } else if (dx) {
        dir = dx > 0 ? 1 : -1;
        name = dx > 0 ? "right" : "left";
      }
      return { dir: name === "left" || name === "up" ? -1 : dir ? 1 : 0, activate: false, kind: "wheel", name: name, fromTab: false, spatial: name };
    }
    const key = String(event.key || "");
    const code = String(event.code || "");
    const keyCode = keyCodeOf(event);
    const shift = Boolean(event.shiftKey);
    const isTab = key === "Tab" || code === "Tab" || keyCode === 9;
    const isEnter = key === "Enter" || code === "Enter" || code === "NumpadEnter" || keyCode === 13;
    if (isEnter) return { dir: 0, activate: true, kind: "enter", name: "enter", fromTab: false, spatial: "" };
    if (isTab) {
      const name = shift ? "up" : "down";
      return { dir: shift ? -1 : 1, activate: false, kind: "tab", name: name, fromTab: true, spatial: name };
    }
    const raw = (key || code).toLowerCase();
    const down = key === "ArrowDown" || key === "Down" || code === "ArrowDown" || raw === "arrowdown" || raw === "down" || keyCode === 40;
    const up = key === "ArrowUp" || key === "Up" || code === "ArrowUp" || raw === "arrowup" || raw === "up" || keyCode === 38;
    const right = key === "ArrowRight" || key === "Right" || code === "ArrowRight" || raw === "arrowright" || raw === "right" || keyCode === 39;
    const left = key === "ArrowLeft" || key === "Left" || code === "ArrowLeft" || raw === "arrowleft" || raw === "left" || keyCode === 37;
    if (down) return { dir: 1, activate: false, kind: "arrow", name: "down", fromTab: false, spatial: "down" };
    if (up) return { dir: -1, activate: false, kind: "arrow", name: "up", fromTab: false, spatial: "up" };
    if (right) return { dir: 1, activate: false, kind: "arrow", name: "right", fromTab: false, spatial: "right" };
    if (left) return { dir: -1, activate: false, kind: "arrow", name: "left", fromTab: false, spatial: "left" };
    return { dir: 0, activate: false, kind: "", name: "", fromTab: false, spatial: "" };
  }

  function describeEvent(event) {
    if (!event) return { type: "", key: "", code: "", keyCode: 0, deltaY: 0 };
    return {
      type: event.type || "",
      key: event.key == null ? "" : String(event.key),
      code: event.code == null ? "" : String(event.code),
      keyCode: keyCodeOf(event),
      deltaY: event.deltaY == null ? 0 : Number(event.deltaY) || 0,
    };
  }

  const FUNDS_STEPS = ["amount", "label"];
  const TASK_STEPS = ["title", "note", "due"];

  function formSteps(kind) {
    return kind === "task" ? TASK_STEPS : FUNDS_STEPS;
  }

  function formFieldId(kind, step) {
    if (kind === "task") {
      if (step === "note") return "task-note";
      if (step === "due") return "task-due";
      return "task-title";
    }
    return step === "label" ? "funds-label" : "funds-amount";
  }

  function nextFormStep(kind, step) {
    const steps = formSteps(kind);
    const i = steps.indexOf(step);
    const index = i < 0 ? 0 : i;
    if (index >= steps.length - 1) {
      return { step: steps[steps.length - 1], done: true, fieldId: formFieldId(kind, steps[steps.length - 1]) };
    }
    const next = steps[index + 1];
    return { step: next, done: false, fieldId: formFieldId(kind, next) };
  }

  function prevFormStep(kind, step) {
    const steps = formSteps(kind);
    const i = Math.max(0, steps.indexOf(step));
    const prev = steps[Math.max(0, i - 1)];
    return { step: prev, done: false, fieldId: formFieldId(kind, prev) };
  }

  function fundsEnter(fieldId) {
    if (fieldId === "funds-amount") return { action: "step", step: "label", id: "funds-label" };
    if (fieldId === "funds-label" || fieldId === "save-funds-spend") return { action: "save" };
    return { action: "none" };
  }

  function taskArrow(model, key) {
    /* Linear walk used by tests: cards then the bottom bar, wrapping at the ends. */
    const footerIds = (model && model.footerIds) || TASK_FOOTER_IDS;
    const taskCount = model && Number(model.taskCount) ? Number(model.taskCount) : 0;
    const nav = typeof key === "string" ? normalizeNav({ key: key }) : normalizeNav(key);
    const ids = [];
    for (let i = 0; i < taskCount; i += 1) ids.push("task-" + i);
    for (let i = 0; i < footerIds.length; i += 1) ids.push(footerIds[i]);
    let currentId;
    if (model && model.focus === "footer") currentId = model.footerId || footerIds[model.footerIndex || 0];
    else currentId = "task-" + (model && Number.isFinite(model.taskIndex) ? model.taskIndex : 0);
    if (!nav.dir) {
      return {
        focus: model && model.focus === "footer" ? "footer" : "list",
        taskIndex: model && Number.isFinite(model.taskIndex) ? model.taskIndex : 0,
        taskCount: taskCount,
        footerIndex: model && Number.isFinite(model.footerIndex) ? model.footerIndex : 0,
        footerId: footerIds[model && Number.isFinite(model.footerIndex) ? model.footerIndex : 0],
      };
    }
    const nextId = stepIds(ids, currentId, nav.dir, true);
    const footerIndex = footerIds.indexOf(nextId);
    if (footerIndex >= 0) {
      return { focus: "footer", taskIndex: Math.max(0, taskCount - 1), taskCount: taskCount, footerIndex: footerIndex, footerId: footerIds[footerIndex] };
    }
    const taskIndex = Number(String(nextId).replace("task-", "")) || 0;
    return { focus: "list", taskIndex: taskIndex, taskCount: taskCount, footerIndex: 0, footerId: footerIds[0] };
  }

  function talkDefaultFocus() {
    return "major-message";
  }

  const api = {
    APP_VERSION: APP_VERSION,
    TASK_FOOTER_IDS: TASK_FOOTER_IDS,
    collectFocusables: collectFocusables,
    step: step,
    stepIds: stepIds,
    spatialNext: spatialNext,
    normalizeNav: normalizeNav,
    describeEvent: describeEvent,
    formSteps: formSteps,
    formFieldId: formFieldId,
    nextFormStep: nextFormStep,
    prevFormStep: prevFormStep,
    fundsEnter: fundsEnter,
    taskArrow: taskArrow,
    talkDefaultFocus: talkDefaultFocus,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticFocusNav = api;
})(typeof window !== "undefined" ? window : globalThis);
