/* Linear Arrow Up/Down focus helpers for the World Static glasses UI.
   Meta Display input is Arrow keys and Enter only. type=search fields must
   not trap Arrow Up/Down, and scroll regions must not trap focus.
*/
(function (root) {
  "use strict";

  const TASK_FOOTER_IDS = ["open-new-task", "open-task-actions", "open-task-lists", "go-home"];

  function isDisabled(el) {
    return Boolean(el && (el.disabled || el.getAttribute("aria-disabled") === "true"));
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
    if (el.closest && el.closest("[hidden]")) return true;
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
      list.push(el);
    }
    return list;
  }

  function stepIds(ids, currentId, dir) {
    if (!ids || !ids.length) return currentId || "";
    const step = dir < 0 ? -1 : 1;
    const i = ids.indexOf(currentId);
    const start = i < 0 ? (step > 0 ? -1 : ids.length) : i;
    const next = start + step;
    if (next < 0) return ids[0];
    if (next >= ids.length) return ids[ids.length - 1];
    return ids[next];
  }

  function step(list, current, dir) {
    if (!list || !list.length) return null;
    const stepDir = dir < 0 ? -1 : 1;
    const i = list.indexOf(current);
    const start = i < 0 ? (stepDir > 0 ? -1 : list.length) : i;
    const next = start + stepDir;
    if (next < 0) return list[0];
    if (next >= list.length) return list[list.length - 1];
    return list[next];
  }

  function fundsEnter(fieldId) {
    if (fieldId === "funds-amount") return { action: "focus", id: "funds-label" };
    if (fieldId === "funds-label" || fieldId === "save-funds-spend") return { action: "save" };
    return { action: "none" };
  }

  function taskArrow(model, key) {
    const footerIds = (model && model.footerIds) || TASK_FOOTER_IDS;
    const taskCount = model && Number(model.taskCount) ? Number(model.taskCount) : 0;
    const taskIndex = model && Number.isFinite(model.taskIndex) ? model.taskIndex : 0;
    const footerIndex = model && Number.isFinite(model.footerIndex) ? model.footerIndex : 0;
    const focus = model && model.focus === "footer" ? "footer" : "list";
    if (key !== "ArrowUp" && key !== "ArrowDown") return { ...(model || {}), focus, taskIndex, taskCount, footerIndex, footerId: footerIds[footerIndex] };
    if (key === "ArrowDown") {
      if (focus === "list") {
        if (taskCount <= 0 || taskIndex >= taskCount - 1) {
          return { focus: "footer", taskIndex: Math.max(0, taskCount - 1), taskCount, footerIndex: 0, footerId: footerIds[0] };
        }
        return { focus: "list", taskIndex: taskIndex + 1, taskCount, footerIndex: 0, footerId: footerIds[0] };
      }
      const next = Math.min(footerIds.length - 1, footerIndex + 1);
      return { focus: "footer", taskIndex, taskCount, footerIndex: next, footerId: footerIds[next] };
    }
    if (focus === "footer") {
      if (footerIndex <= 0) {
        const last = Math.max(0, taskCount - 1);
        return { focus: taskCount ? "list" : "footer", taskIndex: last, taskCount, footerIndex: 0, footerId: footerIds[0] };
      }
      const prev = footerIndex - 1;
      return { focus: "footer", taskIndex, taskCount, footerIndex: prev, footerId: footerIds[prev] };
    }
    return { focus: "list", taskIndex: Math.max(0, taskIndex - 1), taskCount, footerIndex: 0, footerId: footerIds[0] };
  }

  function talkDefaultFocus() {
    return "major-message";
  }

  const api = {
    TASK_FOOTER_IDS,
    collectFocusables,
    step,
    stepIds,
    fundsEnter,
    taskArrow,
    talkDefaultFocus,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WorldStaticFocusNav = api;
})(typeof window !== "undefined" ? window : globalThis);
