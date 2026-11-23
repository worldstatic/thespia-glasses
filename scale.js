/* World Static Scale Check helpers.
   Pure conversion, parsing, and localStorage helpers for the glasses app.
   1 Unreal unit (uu) = 1 cm. Manny reference height defaults to 180 cm.
*/
(function (root) {
  "use strict";

  const MANNY_HEIGHT_CM = 180;
  const DEFAULT_STRIDE_CM = 75;
  const CM_PER_INCH = 2.54;
  const CM_PER_FOOT = 30.48;
  const MIN_CM = 0.1;
  const MAX_CM = 100000;
  const NAME_MAX = 80;
  const MAX_CUSTOM = 50;
  const MIN_STRIDE_CM = 20;
  const MAX_STRIDE_CM = 200;
  const MEASUREMENTS_KEY = "thespia.hud.scale.measurements";
  const STRIDE_KEY = "thespia.hud.scale.stride";

  const CONVERTER_STEPS = [
    { id: "1cm", label: "1 cm", cm: 1 },
    { id: "1in", label: "1 in", cm: CM_PER_INCH },
    { id: "5cm", label: "5 cm", cm: 5 },
    { id: "10cm", label: "10 cm", cm: 10 },
    { id: "1ft", label: "1 ft", cm: CM_PER_FOOT },
    { id: "1m", label: "1 m", cm: 100 },
  ];

  const ONES = {
    zero: 0,
    oh: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  };
  const TENS = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };

  function clampCm(cm) {
    const value = Number(cm);
    if (!Number.isFinite(value) || value < 0) return null;
    if (value < MIN_CM && value !== 0) return MIN_CM;
    if (value > MAX_CM) return MAX_CM;
    return value;
  }

  function spokenToDigits(text) {
    const words = String(text || "")
      .toLowerCase()
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const out = [];
    let acc = null;
    for (const word of words) {
      if (word === "and") continue;
      if (Object.prototype.hasOwnProperty.call(ONES, word)) {
        acc = (acc == null ? 0 : acc) + ONES[word];
      } else if (Object.prototype.hasOwnProperty.call(TENS, word)) {
        acc = (acc == null ? 0 : acc) + TENS[word];
      } else if (word === "hundred") {
        acc = (acc == null ? 1 : acc) * 100;
      } else if (word === "thousand") {
        acc = (acc == null ? 1 : acc) * 1000;
      } else {
        if (acc != null) {
          out.push(String(acc));
          acc = null;
        }
        out.push(word);
      }
    }
    if (acc != null) out.push(String(acc));
    return out.join(" ");
  }

  function parseFraction(token) {
    const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(token);
    if (mixed) {
      const whole = Number(mixed[1]);
      const num = Number(mixed[2]);
      const den = Number(mixed[3]);
      if (den) return whole + num / den;
    }
    const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(token);
    if (frac) {
      const den = Number(frac[2]);
      if (den) return Number(frac[1]) / den;
    }
    const plain = Number(token);
    return Number.isFinite(plain) ? plain : null;
  }

  function parseLength(text) {
    let raw = String(text || "").trim();
    if (!raw) return { ok: false, cm: null, message: "Enter a size, like 6 ft 8 or 203 cm." };

    raw = raw
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/′/g, "'")
      .replace(/″/g, "\"");
    raw = spokenToDigits(raw);
    raw = raw
      .toLowerCase()
      .replace(/\bcentimetres?\b|\bcentimeters?\b/g, "cm")
      .replace(/\bmillimetres?\b|\bmillimeters?\b/g, "mm")
      .replace(/\bmetres?\b|\bmeters?\b/g, "m")
      .replace(/\binches\b|\binch\b/g, "in")
      .replace(/\bfeet\b|\bfoot\b/g, "ft")
      .replace(/\bunits?\b/g, "uu")
      .replace(/(\d+(?:\.\d+)?)\s*'\s*(\d)/g, "$1 ft $2")
      .replace(/(\d+(?:\.\d+)?)\s*'$/g, "$1 ft")
      .replace(/(\d+(?:\.\d+)?)\s*"$/g, "$1 in")
      .replace(/(\d+(?:\.\d+)?)\s*"\s/g, "$1 in ")
      .replace(/\s+/g, " ")
      .trim();

    // 6ft8in or 6ft8
    raw = raw.replace(/(\d+(?:\.\d+)?)\s*ft\s*(\d+(?:\.\d+)?)(?:\s*in)?/g, "$1 ft $2 in");

    let cm = null;

    const pair = raw.match(
      /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?)\s*ft\s+(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?)\s*(?:in)?/
    );
    if (pair) {
      const feet = parseFraction(pair[1].replace(/\s+/g, " ").trim());
      const inches = parseFraction(pair[2].replace(/\s+/g, " ").trim());
      if (feet != null && inches != null) cm = feet * CM_PER_FOOT + inches * CM_PER_INCH;
    }

    if (cm == null) {
      const feetOnly = raw.match(/^(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?)\s*ft$/);
      if (feetOnly) {
        const feet = parseFraction(feetOnly[1].replace(/\s+/g, " ").trim());
        if (feet != null) cm = feet * CM_PER_FOOT;
      }
    }

    if (cm == null) {
      const inchesOnly = raw.match(/^(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?)\s*in$/);
      if (inchesOnly) {
        const inches = parseFraction(inchesOnly[1].replace(/\s+/g, " ").trim());
        if (inches != null) cm = inches * CM_PER_INCH;
      }
    }

    if (cm == null) {
      const meters = raw.match(/^(\d+(?:\.\d+)?)\s*m$/);
      if (meters) cm = Number(meters[1]) * 100;
    }

    if (cm == null) {
      const mm = raw.match(/^(\d+(?:\.\d+)?)\s*mm$/);
      if (mm) cm = Number(mm[1]) / 10;
    }

    if (cm == null) {
      const cmMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(?:cm|uu)$/);
      if (cmMatch) cm = Number(cmMatch[1]);
    }

    if (cm == null) {
      const bare = raw.match(/^(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?)$/);
      if (bare) {
        const value = parseFraction(bare[1].replace(/\s+/g, " ").trim());
        if (value != null) cm = value;
      }
    }

    if (cm == null || !Number.isFinite(cm) || cm < 0) {
      return { ok: false, cm: null, message: "Could not read that size. Try 6 ft 8, 80 in, or 203 cm." };
    }
    cm = Number(cm.toFixed(4));
    if (cm === 0) {
      return { ok: false, cm: null, message: "Enter a size greater than zero." };
    }
    const clamped = clampCm(cm);
    if (clamped == null) {
      return { ok: false, cm: null, message: "Could not read that size. Try 6 ft 8, 80 in, or 203 cm." };
    }
    return { ok: true, cm: clamped, message: "" };
  }

  function formatNumber(value, digits) {
    if (!Number.isFinite(value)) return "";
    const fixed = value.toFixed(digits);
    return fixed.replace(/\.?0+$/, "");
  }

  function formatInchesPart(inches) {
    const eighths = Math.round(inches * 8);
    if (eighths === 0) return "0 in";
    const whole = Math.floor(eighths / 8);
    const frac = eighths % 8;
    const labels = { 1: "1/8", 2: "1/4", 3: "3/8", 4: "1/2", 5: "5/8", 6: "3/4", 7: "7/8" };
    if (frac === 0) return `${whole} in`;
    if (whole === 0) return `${labels[frac]} in`;
    return `${whole} ${labels[frac]} in`;
  }

  function formatFeetInches(cm) {
    if (!Number.isFinite(cm)) return "";
    const totalInches = cm / CM_PER_INCH;
    let eighths = Math.round(totalInches * 8);
    if (eighths < 0) eighths = 0;
    let feet = Math.floor(eighths / (12 * 8));
    let remain = eighths - feet * 12 * 8;
    if (remain === 12 * 8) {
      feet += 1;
      remain = 0;
    }
    const inches = remain / 8;
    if (feet === 0) return formatInchesPart(inches);
    if (remain === 0) return `${feet} ft`;
    return `${feet} ft ${formatInchesPart(inches)}`;
  }

  function formatCm(cm) {
    if (!Number.isFinite(cm)) return "";
    return `${formatNumber(cm, 2)} cm`;
  }

  function formatUu(cm) {
    if (!Number.isFinite(cm)) return "";
    return `${formatNumber(cm, 2)} uu`;
  }

  function formatMeters(cm) {
    if (!Number.isFinite(cm)) return "";
    return `${formatNumber(cm / 100, 3)} m`;
  }

  function mannyPercent(cm, mannyHeightCm) {
    const manny = Number(mannyHeightCm) > 0 ? Number(mannyHeightCm) : MANNY_HEIGHT_CM;
    if (!Number.isFinite(cm)) return null;
    return (cm / manny) * 100;
  }

  function formatMannyPercent(cm, mannyHeightCm) {
    const manny = Number(mannyHeightCm) > 0 ? Number(mannyHeightCm) : MANNY_HEIGHT_CM;
    const percent = mannyPercent(cm, manny);
    if (percent == null) return "";
    return `${formatNumber(percent, 1)}% of Manny (${formatNumber(manny, 1)} cm)`;
  }

  function formatAll(cm, mannyHeightCm) {
    return {
      feetInches: formatFeetInches(cm),
      cm: formatCm(cm),
      uu: formatUu(cm),
      meters: formatMeters(cm),
      mannyPercent: formatMannyPercent(cm, mannyHeightCm),
      percent: mannyPercent(cm, mannyHeightCm),
    };
  }

  function addCm(cm, delta) {
    const next = (Number(cm) || 0) + (Number(delta) || 0);
    const clamped = clampCm(next);
    return clamped == null ? MIN_CM : Math.max(MIN_CM, clamped);
  }

  function stepIndex(id) {
    const index = CONVERTER_STEPS.findIndex((step) => step.id === id);
    return index >= 0 ? index : 0;
  }

  function stepByIndex(index) {
    const len = CONVERTER_STEPS.length;
    const wrapped = ((index % len) + len) % len;
    return CONVERTER_STEPS[wrapped];
  }

  function newCustomId() {
    return `meas-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  function normalizeMeasurement(item) {
    if (!item || typeof item !== "object") return null;
    const name = String(item.name || "").trim().slice(0, NAME_MAX);
    if (!name) return null;
    let cm = Number(item.cm);
    if (!Number.isFinite(cm) || cm <= 0) {
      if (item.size) {
        const parsed = parseLength(item.size);
        if (!parsed.ok) return null;
        cm = parsed.cm;
      } else {
        return null;
      }
    }
    const clamped = clampCm(cm);
    if (clamped == null || clamped <= 0) return null;
    const rawId = String(item.id || "").trim();
    return { id: rawId || newCustomId(), name, cm: clamped };
  }

  function storageOf(storage) {
    return storage || (typeof localStorage !== "undefined" ? localStorage : null);
  }

  function loadMeasurements(storage) {
    const store = storageOf(storage);
    try {
      const raw = store ? store.getItem(MEASUREMENTS_KEY) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.items)
          ? parsed.items
          : [];
      return list.map(normalizeMeasurement).filter(Boolean);
    } catch (_err) {
      try {
        if (store) store.removeItem(MEASUREMENTS_KEY);
      } catch (_ignored) {}
      return [];
    }
  }

  function saveMeasurements(list, storage) {
    const store = storageOf(storage);
    if (!store) return false;
    try {
      store.setItem(MEASUREMENTS_KEY, JSON.stringify({ version: 1, items: list }));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function getMeasurement(id, storage) {
    return loadMeasurements(storage).find((item) => item.id === id) || null;
  }

  function upsertMeasurement(item, storage) {
    const normalized = normalizeMeasurement(item);
    if (!normalized) return { ok: false, reason: "invalid", item: null };
    const list = loadMeasurements(storage);
    const index = list.findIndex((row) => row.id === normalized.id);
    if (index >= 0) list[index] = normalized;
    else {
      if (list.length >= MAX_CUSTOM) return { ok: false, reason: "full", item: null };
      list.unshift(normalized);
    }
    const ok = saveMeasurements(list, storage);
    return { ok, reason: ok ? "" : "storage", item: normalized };
  }

  function deleteMeasurement(id, storage) {
    const list = loadMeasurements(storage);
    const next = list.filter((item) => item.id !== id);
    if (next.length === list.length) return false;
    return saveMeasurements(next, storage);
  }

  function exportMeasurementsBlob(storage) {
    return JSON.stringify({ version: 1, items: loadMeasurements(storage) }, null, 2);
  }

  function importMeasurementsBlob(text, storage) {
    let data;
    try {
      data = JSON.parse(String(text || "").trim());
    } catch (_err) {
      return { ok: false, imported: 0, message: "That backup is not valid JSON." };
    }
    const list = Array.isArray(data)
      ? data
      : data && Array.isArray(data.items)
        ? data.items
        : data && Array.isArray(data.measurements)
          ? data.measurements
          : null;
    if (!list) return { ok: false, imported: 0, message: "No measurements found in that backup." };
    const current = loadMeasurements(storage);
    let imported = 0;
    for (const item of list) {
      const normalized = normalizeMeasurement(item);
      if (!normalized) continue;
      const index = current.findIndex((row) => row.id === normalized.id);
      if (index >= 0) current[index] = normalized;
      else {
        if (current.length >= MAX_CUSTOM) break;
        current.unshift(normalized);
      }
      imported += 1;
    }
    if (!imported) return { ok: false, imported: 0, message: "No usable measurements in that backup." };
    const ok = saveMeasurements(current, storage);
    return {
      ok,
      imported,
      message: ok
        ? `Imported ${imported} measurement${imported === 1 ? "" : "s"}.`
        : "Could not save on this device.",
    };
  }

  function loadStride(storage) {
    const store = storageOf(storage);
    try {
      const raw = store ? store.getItem(STRIDE_KEY) : null;
      if (!raw) return DEFAULT_STRIDE_CM;
      const parsed = parseLength(raw);
      const cm = parsed.ok ? parsed.cm : Number(raw);
      if (!Number.isFinite(cm) || cm < MIN_STRIDE_CM || cm > MAX_STRIDE_CM) return DEFAULT_STRIDE_CM;
      return cm;
    } catch (_err) {
      return DEFAULT_STRIDE_CM;
    }
  }

  function saveStride(cm, storage) {
    const store = storageOf(storage);
    const value = Number(cm);
    if (!Number.isFinite(value) || value < MIN_STRIDE_CM || value > MAX_STRIDE_CM) {
      return { ok: false, cm: loadStride(storage), message: `Stride must be between ${MIN_STRIDE_CM} and ${MAX_STRIDE_CM} cm.` };
    }
    try {
      if (store) store.setItem(STRIDE_KEY, String(value));
      return { ok: true, cm: value, message: "Stride saved on this device." };
    } catch (_err) {
      return { ok: false, cm: value, message: "Could not save on this device." };
    }
  }

  function paceDistance(steps, strideCm) {
    const count = Math.max(0, Math.floor(Number(steps) || 0));
    const stride = Number(strideCm);
    const safeStride = Number.isFinite(stride) && stride > 0 ? stride : DEFAULT_STRIDE_CM;
    return { steps: count, strideCm: safeStride, cm: count * safeStride };
  }

  function kindLabel(kind) {
    if (kind === "engine") return "UE 5.6 default";
    if (kind === "standard") return "Standard";
    if (kind === "code") return "Code";
    if (kind === "typical") return "Typical";
    if (kind === "convention") return "Convention, not a measurement";
    return "Reference";
  }

  const ThespiaScale = {
    MANNY_HEIGHT_CM,
    DEFAULT_STRIDE_CM,
    CM_PER_INCH,
    CM_PER_FOOT,
    MIN_CM,
    MAX_CM,
    NAME_MAX,
    MAX_CUSTOM,
    MIN_STRIDE_CM,
    MAX_STRIDE_CM,
    MEASUREMENTS_KEY,
    STRIDE_KEY,
    CONVERTER_STEPS,
    parseLength,
    clampCm,
    spokenToDigits,
    formatNumber,
    formatFeetInches,
    formatCm,
    formatUu,
    formatMeters,
    formatMannyPercent,
    mannyPercent,
    formatAll,
    addCm,
    stepIndex,
    stepByIndex,
    normalizeMeasurement,
    loadMeasurements,
    saveMeasurements,
    getMeasurement,
    upsertMeasurement,
    deleteMeasurement,
    exportMeasurementsBlob,
    importMeasurementsBlob,
    loadStride,
    saveStride,
    paceDistance,
    kindLabel,
  };

  root.ThespiaScale = ThespiaScale;
  if (typeof module !== "undefined" && module.exports) module.exports = ThespiaScale;
})(typeof window !== "undefined" ? window : globalThis);
