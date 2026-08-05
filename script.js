"use strict";

const APP_VERSION = "0.1.1";
const REPOSITORY_URL = "https://github.com/danamlewis/ScIGPilot";
const REPOSITORY_LABEL = "github.com/danamlewis/ScIGPilot";

function cleanDoseNumber(value, digits = 1) {
  const rounded = Number(Number(value).toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function doseName(volumeMl) {
  return `${cleanDoseNumber(volumeMl, Number(volumeMl) >= 100 ? 0 : 1)} mL`;
}

function roundedVolume(value) {
  return Number(Number(value).toFixed(1));
}

function wholeCycleDays(value, fallback = 7) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return Math.max(1, Math.round(Number(fallback) || 7));
  return Math.max(1, Math.round(numericValue));
}

const defaultProductPresetId = "hizentra";
const amplitudeSeriesColors = ["#4d2d96", "#0f8b8d", "#b95f89", "#3266a8", "#7a6f21"];

const productPresets = {
  hizentra: {
    name: "Hizentra 20%",
    concentrationGPerMl: 0.2,
    cartridgeSizesMl: [50, 20, 10, 5],
  },
  cuvitru: {
    name: "Cuvitru 20%",
    concentrationGPerMl: 0.2,
    cartridgeSizesMl: [50, 40, 20, 10, 5],
  },
  xembify: {
    name: "Xembify 20%",
    concentrationGPerMl: 0.2,
    cartridgeSizesMl: [50, 20, 10, 5],
  },
};

function inventoryTextFromInventory(inventory) {
  return inventory
    .filter((entry) => Number(entry.count) > 0)
    .map((entry) => `${cleanDoseNumber(Number(entry.volumeMl), Number(entry.volumeMl) >= 10 ? 0 : 1)}x${Number(entry.count)}`)
    .join(", ");
}

function inventoryFromCounts(countsByVolume) {
  return Object.entries(countsByVolume)
    .map(([volumeMl, count]) => ({ volumeMl: Number(volumeMl), count: Math.max(0, Math.round(Number(count))) }))
    .filter((entry) => entry.volumeMl > 0)
    .sort((a, b) => b.volumeMl - a.volumeMl);
}

function inventoryUnits(inventory) {
  return inventory.flatMap((entry) => (
    Array.from({ length: Math.max(0, Number(entry.count)) }, () => roundedVolume(Number(entry.volumeMl)))
  ));
}

function closestFeasibleVolume(targetVolumeMl, inventory) {
  const target = roundedVolume(Math.max(0, Number(targetVolumeMl)));
  if (target <= 0) return 0;
  const units = inventoryUnits(inventory);
  if (!units.length) return target;

  const subsetCount = 2 ** units.length;
  if (subsetCount > 4096) return roundedVolume(target);

  let best = null;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    let sum = 0;
    for (let index = 0; index < units.length; index += 1) {
      if (mask & (1 << index)) sum += units[index];
    }
    const volumeMl = roundedVolume(sum);
    const distance = Math.abs(volumeMl - target);
    const roundsUp = volumeMl >= target ? 0 : 1;
    const score = [distance, roundsUp, volumeMl];
    if (
      !best
      || score[0] < best.score[0]
      || (score[0] === best.score[0] && score[1] < best.score[1])
      || (score[0] === best.score[0] && score[1] === best.score[1] && score[2] < best.score[2])
    ) {
      best = { volumeMl, score };
    }
  }

  return best ? best.volumeMl : target;
}

function autoAllocateProductCartridges(targetVolumeMl, cartridgeSizesMl) {
  const sizes = [...new Set(cartridgeSizesMl.map((size) => roundedVolume(Number(size))).filter((size) => size > 0))]
    .sort((a, b) => b - a);
  const target = Math.round(Math.max(0, Number(targetVolumeMl)) * 10);
  if (!target || !sizes.length) return { volumeMl: 0, inventory: sizes.map((volumeMl) => ({ volumeMl, count: 0 })) };

  const unitSizes = sizes.map((size) => Math.round(size * 10));
  const maxUnit = Math.max(...unitSizes);
  const searchMax = target + maxUnit;
  const dp = Array(searchMax + 1).fill(null);
  dp[0] = { count: 0, previous: null, unit: null };

  for (let sum = 0; sum <= searchMax; sum += 1) {
    if (!dp[sum]) continue;
    unitSizes.forEach((unit) => {
      const next = sum + unit;
      if (next > searchMax) return;
      const candidateCount = dp[sum].count + 1;
      if (!dp[next] || candidateCount < dp[next].count) {
        dp[next] = { count: candidateCount, previous: sum, unit };
      }
    });
  }

  let bestSum = null;
  for (let sum = 1; sum <= searchMax; sum += 1) {
    if (!dp[sum]) continue;
    if (
      bestSum === null
      || Math.abs(sum - target) < Math.abs(bestSum - target)
      || (Math.abs(sum - target) === Math.abs(bestSum - target) && sum >= target && bestSum < target)
      || (Math.abs(sum - target) === Math.abs(bestSum - target) && sum >= target && bestSum >= target && sum < bestSum)
    ) {
      bestSum = sum;
    }
  }

  const counts = Object.fromEntries(sizes.map((size) => [String(size), 0]));
  for (let sum = bestSum; sum > 0;) {
    const entry = dp[sum];
    const volumeMl = entry.unit / 10;
    counts[String(volumeMl)] += 1;
    sum = entry.previous;
  }

  return { volumeMl: bestSum / 10, inventory: inventoryFromCounts(counts) };
}

function feasibleSplitForInventory(totalVolumeMl, inventory) {
  const total = roundedVolume(totalVolumeMl);
  const units = inventoryUnits(inventory);
  if (!units.length) return null;

  const target = total * 0.625;
  const candidates = [];
  const subsetCount = 2 ** units.length;
  if (subsetCount > 4096) return null;
  const subsets = [];

  for (let mask = 1; mask < subsetCount - 1; mask += 1) {
    let sum = 0;
    for (let index = 0; index < units.length; index += 1) {
      if (mask & (1 << index)) sum += units[index];
    }
    subsets.push({ mask, sum: roundedVolume(sum) });
  }

  subsets.forEach((firstSubset) => {
    subsets.forEach((secondSubset) => {
      if (firstSubset.mask & secondSubset.mask) return;
      const first = firstSubset.sum;
      const second = secondSubset.sum;
      if (first <= 0 || second <= 0 || Math.abs(roundedVolume(first + second) - total) > 0.01) return;
      const large = Math.max(first, second);
      const small = Math.min(first, second);
      candidates.push({ large, small, score: Math.abs(large - target) });
    });
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score || a.large - b.large);
  return candidates[0];
}

function buildPresets(weeklyVolumeMl = 160, inventory = parseCartridgeInventory("50x3, 10x1")) {
  const total = Math.max(0, Number(weeklyVolumeMl));
  const feasibleSplit = feasibleSplitForInventory(total, inventory);
  const largeSplit = feasibleSplit ? feasibleSplit.large : roundedVolume(total * 0.625);
  const smallSplit = feasibleSplit ? feasibleSplit.small : roundedVolume(total - largeSplit);
  return [
    {
      id: "q7",
      presetId: "q7",
      name: `${doseName(total)} every 7 days`,
      cycleLengthDays: 7,
      events: [{ day: 0, volumeMl: roundedVolume(total), sites: 4 }],
    },
    {
      id: "q9",
      presetId: "q9",
      name: `${doseName(total)} every 9 days`,
      cycleLengthDays: 9,
      events: [{ day: 0, volumeMl: roundedVolume(total), sites: 4 }],
    },
    {
      id: "q14",
      presetId: "q14",
      name: `${doseName(total)} every 14 days`,
      cycleLengthDays: 14,
      events: [{ day: 0, volumeMl: roundedVolume(total), sites: 4 }],
    },
    {
      id: "split-large-small",
      presetId: "split-large-small",
      name: `${doseName(largeSplit)} then ${doseName(smallSplit)} over 16 days`,
      cycleLengthDays: 16,
      events: [
        { day: 0, volumeMl: largeSplit, sites: 3 },
        { day: 9, volumeMl: smallSplit, sites: 2 },
      ],
    },
    {
      id: "split-small-large",
      presetId: "split-small-large",
      name: `${doseName(smallSplit)} then ${doseName(largeSplit)} over 16 days`,
      cycleLengthDays: 16,
      events: [
        { day: 0, volumeMl: smallSplit, sites: 2 },
        { day: 7, volumeMl: largeSplit, sites: 3 },
      ],
    },
  ];
}

let presets = buildPresets(35, autoAllocateProductCartridges(35, productPresets[defaultProductPresetId].cartridgeSizesMl).inventory);

const exampleScigFlowTable26G = {
  source: "Example 26G needle set with precision tubing, average flow rate per site",
  tubing: {
    F120: [8.2, 4.6, 3.2, 2.4, 2.0, 1.6, 1.4, 1.2],
    F180: [10.2, 5.8, 4.1, 3.1, 2.6, 2.2, 1.9, 1.6],
    F275: [13.7, 8.3, 5.9, 4.6, 3.8, 3.2, 2.8, 2.4],
    F420: [18.1, 11.7, 8.6, 6.9, 5.7, 4.8, 4.2, 3.7],
    F500: [20.6, 13.8, 10.4, 8.4, 7.0, 6.0, 5.2, 4.7],
    F600: [22.2, 15.3, 11.7, 9.5, 8.0, 6.9, 6.0, 5.4],
    F900: [26.7, 20.0, 16.0, 13.3, 11.4, 9.9, 8.8, 8.0],
    F1200: [28.0, 21.4, 17.4, 14.6, 12.6, 11.1, 9.9, 8.9],
    F2400: [34.6, 30.3, 27.0, 24.3, 22.2, 20.3, 18.8, 17.4],
  },
};

const iggScenarioPresets = {
  replacement: {
    label: "Replacement / PI-style default",
    protocolDoseGKgWeek: 0.1,
    baselinePreScigIggMgDl: 1000,
    steadyStateTroughIggMgDl: 1500,
    weeklyPeakIggMgDl: 1650,
    tmaxDaysAfterWeeklyInfusion: 3,
    peakToTroughRatio: 1.10,
    highIggWarningThresholdMgDl: 2600,
  },
  neurologic: {
    label: "High-dose neurologic default",
    protocolDoseGKgWeek: 0.4,
    baselinePreScigIggMgDl: 1400,
    steadyStateTroughIggMgDl: 2100,
    weeklyPeakIggMgDl: 2350,
    tmaxDaysAfterWeeklyInfusion: 3,
    peakToTroughRatio: 1.12,
    highIggWarningThresholdMgDl: 2800,
  },
  custom: {
    label: "Custom model patient",
    protocolDoseGKgWeek: 0.1,
    baselinePreScigIggMgDl: 1000,
    steadyStateTroughIggMgDl: 1500,
    weeklyPeakIggMgDl: 1650,
    tmaxDaysAfterWeeklyInfusion: 3,
    peakToTroughRatio: 1.10,
    highIggWarningThresholdMgDl: 2600,
  },
};

function createComparatorFromPreset(preset, id = `comp-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  return { ...structuredClone(preset), id };
}

const state = {
  product: {
    presetId: defaultProductPresetId,
    name: productPresets[defaultProductPresetId].name,
    concentrationGPerMl: 0.2,
    needleType: "highFlo26G",
    tubing: "F2400",
    cartridgeSizesMl: productPresets[defaultProductPresetId].cartridgeSizesMl,
    cartridgeInventoryText: inventoryTextFromInventory(autoAllocateProductCartridges(35, productPresets[defaultProductPresetId].cartridgeSizesMl).inventory),
    cartridgeInventory: autoAllocateProductCartridges(35, productPresets[defaultProductPresetId].cartridgeSizesMl).inventory,
    cartridgeSelectionMode: "auto",
    cartridgeSelectionValid: true,
    cartridgeSelectionMessage: "",
    referenceRunMinutes: 46,
  },
  params: {
    absorptionHalfTimeDays: 1.4,
    eliminationHalfLifeDays: 30,
    simulationHorizonDays: 180,
    timestepDays: 0.25,
    steadyWindowDays: 28,
    switchPreconditionDays: 140,
    switchHorizonDays: 180,
  },
  dosing: {
    entryMode: "protocol",
    protocolDoseGKgWeek: 0.1,
    totalDoseUnit: "mL",
    totalDoseMl: 35,
    totalDoseG: 7,
    weeklyDoseMl: 35,
    weeklyDoseG: 7,
    requestedWeeklyDoseMl: 32.5,
    requestedWeeklyDoseG: 6.5,
  },
  calibration: {
    mode: "replacement",
    bodyWeightKg: 65,
    baselinePreScigIggMgDl: 1000,
    doseSlopeMgDlPer01GKgWeek: 500,
    peakToTroughRatio: 1.10,
    tmaxDaysAfterWeeklyInfusion: 3,
    labReferenceLowMgDl: 586,
    labReferenceHighMgDl: 1602,
    highIggWarningThresholdMgDl: 2600,
    baselineUncertaintyMgDl: 100,
    slopeUncertaintyPercent: 20,
    absorptionHalfTimeLowDays: 1,
    absorptionHalfTimeHighDays: 3,
    eliminationHalfLifeLowDays: 21,
    eliminationHalfLifeHighDays: 35,
  },
  reference: structuredClone(presets[0]),
  comparators: [
    createComparatorFromPreset(presets[1], "comp-1"),
    createComparatorFromPreset(presets[2], "comp-2"),
  ],
  activeComparatorId: "comp-1",
  switchComparatorId: "comp-1",
  chartWindow: "all",
  chartMode: "igg",
  interval: {
    regimenId: "reference",
    horizonDays: 180,
    checkpointDay: 7,
    upperThresholdMgDl: 1602,
    lowerThresholdMgDl: 586,
  },
};

let exposureChart;
let switchChart;
let intervalExplorerActive = false;
let pendingReferencePresetId = "";
let pendingComparatorPresetId = "";
let shareQrTimer = null;
let simulationInputTimer = null;
let editingComparatorId = null;
let amplitudeSummaryCache = new WeakMap();
let calibrationScenarioCache = null;
let scenarioScaleCache = new Map();
let exposurePrintConfig = null;
let switchPrintConfig = null;
let originalDocumentTitle = null;
const bandCanvasPrintConfigs = new Map();
const editedRegimens = new WeakSet();

const $ = (id) => document.getElementById(id);
const round = (value, digits = 1) => Number.isFinite(value) ? Number(value).toFixed(digits) : "n/a";
const clonePreset = (preset) => structuredClone(preset);
const formatNumber = (value, digits = 1) => {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Number(value.toFixed(digits));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};
const formatPercent = (value, digits = 1) => `${formatNumber(value, Number.isInteger(value) ? 0 : digits)}%`;
const formatDose = (value) => `${formatNumber(value, 1)} g`;
const formatDays = (value) => `${formatNumber(value, Number.isInteger(value) ? 0 : 1)} days`;
const formatMgDl = (value) => `${formatNumber(value, 0)} mg/dL`;
const formatInteger = (value) => formatNumber(value, 0);
const SHARE_PAYLOAD_VERSION = 2;
const MAX_SHARE_TOKEN_LENGTH = 24000;
const MAX_SHARE_STATE_BYTES = 24000;
const SHARE_COMPRESSION_PREFIX = "z1.";
const MAX_SHARED_COMPARATORS = 4;
const MAX_SHARED_EVENTS_PER_REGIMEN = 6;
const MAX_SHARED_EVENT_OCCURRENCES_PER_YEAR = 800;

function boundedNumber(value, fallback, min, max, integer = false) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  const bounded = Math.min(max, Math.max(min, numericValue));
  return integer ? Math.round(bounded) : bounded;
}

function allowedValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function safeLabel(value, fallback, maxLength = 80) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function utf8Bytes(value) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "utf8"));
  }
  return new TextEncoder().encode(value);
}

function utf8String(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("utf8");
  }
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const encoded = String(value);
  if (!encoded || encoded.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(encoded)) {
    throw new Error("Simulator share link is invalid.");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function compressShareBytes(bytes) {
  if (typeof fflate === "undefined") throw new Error("Share compression is unavailable.");
  return fflate.gzipSync(bytes, { level: 9, mtime: 0 });
}

function decompressShareBytes(bytes) {
  if (typeof fflate === "undefined") throw new Error("Share compression is unavailable.");
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error("Simulator share link is invalid.");
  }
  const sizeOffset = bytes.length - 4;
  const declaredSize = bytes[sizeOffset]
    + bytes[sizeOffset + 1] * 256
    + bytes[sizeOffset + 2] * 65536
    + bytes[sizeOffset + 3] * 16777216;
  if (!declaredSize || declaredSize > MAX_SHARE_STATE_BYTES) {
    throw new Error("Simulator share state is too large.");
  }
  const output = fflate.gunzipSync(bytes, { out: new Uint8Array(declaredSize) });
  if (output.length !== declaredSize) throw new Error("Simulator share link is invalid.");
  return output;
}

function compactInventory(inventory) {
  return inventory.map((entry) => [roundedVolume(Number(entry.volumeMl)), Math.max(0, Math.round(Number(entry.count)))]);
}

function expandInventory(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 12)
    .map((entry) => ({
      volumeMl: boundedNumber(entry?.[0], 0, 0, 1000),
      count: boundedNumber(entry?.[1], 0, 0, 100, true),
    }))
    .filter((entry) => Number.isFinite(entry.volumeMl) && entry.volumeMl > 0)
    .sort((a, b) => b.volumeMl - a.volumeMl);
}

function compactEvents(events) {
  return events.map((event) => [Number(event.day), Number(event.volumeMl), Number(event.sites)]);
}

function expandEvents(events, cycleLengthDays = 7) {
  if (!Array.isArray(events)) return [];
  const latestEventDay = Math.max(0, Number(cycleLengthDays) - 0.25);
  const frequencyBound = Math.max(1, Math.floor(MAX_SHARED_EVENT_OCCURRENCES_PER_YEAR * Number(cycleLengthDays) / 365));
  const eventLimit = Math.min(MAX_SHARED_EVENTS_PER_REGIMEN, frequencyBound);
  return events.slice(0, eventLimit)
    .filter((event) => Array.isArray(event))
    .map((event) => ({
      day: boundedNumber(event[0], 0, 0, latestEventDay),
      volumeMl: boundedNumber(event[1], 0, 0, 5000),
      sites: boundedNumber(event[2], 1, 1, 8, true),
    }));
}

function compactRegimen(regimen) {
  return {
    i: regimen.id,
    p: regimen.presetId || "custom",
    n: regimen.name,
    c: wholeCycleDays(regimen.cycleLengthDays),
    e: compactEvents(regimen.events),
  };
}

function expandRegimen(regimen, fallbackId) {
  const cycleLengthDays = boundedNumber(regimen?.c, 7, 1, 365, true);
  const events = expandEvents(regimen?.e, cycleLengthDays);
  return {
    id: fallbackId,
    presetId: safeLabel(regimen?.p, "custom", 40),
    name: safeLabel(regimen?.n, "Untitled regimen"),
    cycleLengthDays,
    events: events.length ? events : [{ day: 0, volumeMl: 5, sites: 1 }],
  };
}

function serializeFullSimulatorState() {
  return {
    v: SHARE_PAYLOAD_VERSION,
    p: {
      i: state.product.presetId,
      n: state.product.name,
      c: Number(state.product.concentrationGPerMl),
      nt: state.product.needleType,
      t: state.product.tubing,
      s: state.product.cartridgeSizesMl.map(Number),
      cm: state.product.cartridgeSelectionMode,
      ci: compactInventory(state.product.cartridgeInventory),
      rr: Number(state.product.referenceRunMinutes),
    },
    d: {
      e: state.dosing.entryMode,
      pd: Number(state.dosing.protocolDoseGKgWeek),
      tu: state.dosing.totalDoseUnit,
      tm: Number(state.dosing.totalDoseMl),
      tg: Number(state.dosing.totalDoseG),
    },
    m: {
      a: Number(state.params.absorptionHalfTimeDays),
      e: Number(state.params.eliminationHalfLifeDays),
      h: Number(state.params.simulationHorizonDays),
      ts: Number(state.params.timestepDays),
      sp: Number(state.params.switchPreconditionDays),
      sh: Number(state.params.switchHorizonDays),
    },
    g: {
      m: state.calibration.mode,
      w: Number(state.calibration.bodyWeightKg),
      b: Number(state.calibration.baselinePreScigIggMgDl),
      s: Number(state.calibration.doseSlopeMgDlPer01GKgWeek),
      pr: Number(state.calibration.peakToTroughRatio),
      tx: Number(state.calibration.tmaxDaysAfterWeeklyInfusion),
      ll: Number(state.calibration.labReferenceLowMgDl),
      lh: Number(state.calibration.labReferenceHighMgDl),
      hw: Number(state.calibration.highIggWarningThresholdMgDl),
      bu: Number(state.calibration.baselineUncertaintyMgDl),
      su: Number(state.calibration.slopeUncertaintyPercent),
      al: Number(state.calibration.absorptionHalfTimeLowDays),
      ah: Number(state.calibration.absorptionHalfTimeHighDays),
      el: Number(state.calibration.eliminationHalfLifeLowDays),
      eh: Number(state.calibration.eliminationHalfLifeHighDays),
    },
    r: { ...compactRegimen(state.reference), i: "reference" },
    cs: state.comparators.map(compactRegimen),
    a: state.activeComparatorId,
    sw: state.switchComparatorId,
    cw: state.chartWindow,
    cm: state.chartMode,
    x: {
      r: state.interval.regimenId,
      h: Number(state.interval.horizonDays),
      d: Number(state.interval.checkpointDay),
      u: Number(state.interval.upperThresholdMgDl),
      l: Number(state.interval.lowerThresholdMgDl),
    },
  };
}

function normalizedShareBasis(basis = {}) {
  const scenarioMode = allowedValue(basis.m, Object.keys(iggScenarioPresets), "replacement");
  const productPresetId = allowedValue(basis.p, [...Object.keys(productPresets), "custom"], defaultProductPresetId);
  const entryMode = basis.e === "total" ? "total" : "protocol";
  const productCartridgeSizes = productPresetId === "custom" && Array.isArray(basis.k)
    ? [...new Set(basis.k.slice(0, 12)
      .map((size) => boundedNumber(size, 0, 0, 1000))
      .filter((size) => size > 0))].sort((a, b) => b - a)
    : null;
  return {
    scenarioMode,
    bodyWeightKg: boundedNumber(basis.w, 65, 1, 300),
    productPresetId,
    productCartridgeSizes: productCartridgeSizes?.length ? productCartridgeSizes : null,
    entryMode,
    protocolDoseGKgWeek: boundedNumber(
      basis.d,
      iggScenarioPresets[scenarioMode].protocolDoseGKgWeek,
      0,
      5,
    ),
    totalDoseUnit: basis.u === "g" ? "g" : "mL",
    requestedTotalDose: boundedNumber(basis.q, 0, 0, basis.u === "g" ? 1000 : 5000),
  };
}

function buildCanonicalShareState(basis = {}) {
  const normalized = normalizedShareBasis(basis);
  const scenario = iggScenarioPresets[normalized.scenarioMode];
  const presetProduct = productPresets[normalized.productPresetId] || productPresets[defaultProductPresetId];
  const cartridgeSizesMl = normalized.productCartridgeSizes || presetProduct.cartridgeSizesMl;
  const concentrationGPerMl = presetProduct.concentrationGPerMl;
  let requestedWeeklyDoseG;
  let requestedWeeklyDoseMl;

  if (normalized.entryMode === "protocol") {
    requestedWeeklyDoseG = normalized.protocolDoseGKgWeek * normalized.bodyWeightKg;
    requestedWeeklyDoseMl = requestedWeeklyDoseG / concentrationGPerMl;
  } else if (normalized.totalDoseUnit === "g") {
    requestedWeeklyDoseG = normalized.requestedTotalDose;
    requestedWeeklyDoseMl = requestedWeeklyDoseG / concentrationGPerMl;
  } else {
    requestedWeeklyDoseMl = normalized.requestedTotalDose;
    requestedWeeklyDoseG = requestedWeeklyDoseMl * concentrationGPerMl;
  }

  const allocation = autoAllocateProductCartridges(requestedWeeklyDoseMl, cartridgeSizesMl);
  const weeklyDoseMl = allocation.volumeMl;
  const weeklyDoseG = weeklyDoseMl * concentrationGPerMl;
  const generatedPresets = buildPresets(weeklyDoseMl, allocation.inventory);
  const reference = { ...compactRegimen(generatedPresets[0]), i: "reference" };
  const comparators = [
    compactRegimen(createComparatorFromPreset(generatedPresets[1], "comp-1")),
    compactRegimen(createComparatorFromPreset(generatedPresets[2], "comp-2")),
  ];

  return {
    v: SHARE_PAYLOAD_VERSION,
    p: {
      i: normalized.productPresetId,
      n: presetProduct.name,
      c: concentrationGPerMl,
      nt: "highFlo26G",
      t: "F2400",
      s: cartridgeSizesMl.map(Number),
      cm: "auto",
      ci: compactInventory(allocation.inventory),
      rr: 46,
    },
    d: {
      e: normalized.entryMode,
      pd: normalized.protocolDoseGKgWeek,
      tu: normalized.totalDoseUnit,
      tm: weeklyDoseMl,
      tg: weeklyDoseG,
    },
    m: { a: 1.4, e: 30, h: 180, ts: 0.25, sp: 140, sh: 180 },
    g: {
      m: normalized.scenarioMode,
      w: normalized.bodyWeightKg,
      b: scenario.baselinePreScigIggMgDl,
      s: slopeFromPreset(scenario, normalized.bodyWeightKg),
      pr: scenario.peakToTroughRatio,
      tx: scenario.tmaxDaysAfterWeeklyInfusion,
      ll: 586,
      lh: 1602,
      hw: scenario.highIggWarningThresholdMgDl,
      bu: 100,
      su: 20,
      al: 1,
      ah: 3,
      el: 21,
      eh: 35,
    },
    r: reference,
    cs: comparators,
    a: "comp-1",
    sw: "comp-1",
    cw: "all",
    cm: "igg",
    x: { r: "reference", h: 180, d: 7, u: 1602, l: 586 },
  };
}

function currentShareBasis() {
  const basis = {};
  const scenarioMode = allowedValue(state.calibration.mode, Object.keys(iggScenarioPresets), "replacement");
  const scenario = iggScenarioPresets[scenarioMode];
  const bodyWeightKg = Number(state.calibration.bodyWeightKg);
  const productPresetId = allowedValue(state.product.presetId, [...Object.keys(productPresets), "custom"], defaultProductPresetId);
  const requestedProtocolDose = Number(state.dosing.requestedProtocolDoseGKgWeek ?? state.dosing.protocolDoseGKgWeek);

  if (scenarioMode !== "replacement") basis.m = scenarioMode;
  if (bodyWeightKg !== 65) basis.w = bodyWeightKg;
  if (productPresetId !== defaultProductPresetId) basis.p = productPresetId;
  if (productPresetId === "custom") basis.k = state.product.cartridgeSizesMl.map(Number);
  if (state.dosing.entryMode === "total") {
    basis.e = "total";
    if (state.dosing.totalDoseUnit === "g") basis.u = "g";
    basis.q = Number(state.dosing.totalDoseUnit === "g"
      ? state.dosing.requestedWeeklyDoseG
      : state.dosing.requestedWeeklyDoseMl);
  } else if (requestedProtocolDose !== Number(scenario.protocolDoseGKgWeek)) {
    basis.d = requestedProtocolDose;
  }
  return basis;
}

function sameJsonValue(first, second) {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first)
      && Array.isArray(second)
      && first.length === second.length
      && first.every((value, index) => sameJsonValue(value, second[index]));
  }
  if (!first || !second || typeof first !== "object" || typeof second !== "object") return false;
  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return firstKeys.length === secondKeys.length
    && firstKeys.every((key) => Object.hasOwn(second, key) && sameJsonValue(first[key], second[key]));
}

function sparseShareDiff(actual, baseline) {
  if (sameJsonValue(actual, baseline)) return undefined;
  if (Array.isArray(actual) || !actual || typeof actual !== "object") return structuredClone(actual);
  const difference = {};
  Object.keys(actual).forEach((key) => {
    const valueDifference = sparseShareDiff(actual[key], baseline?.[key]);
    if (valueDifference !== undefined) difference[key] = valueDifference;
  });
  return Object.keys(difference).length ? difference : undefined;
}

function mergeShareOverrides(baseline, overrides) {
  if (Array.isArray(baseline)) return Array.isArray(overrides) ? structuredClone(overrides) : structuredClone(baseline);
  if (!baseline || typeof baseline !== "object") return overrides === undefined ? baseline : overrides;
  const merged = {};
  Object.keys(baseline).forEach((key) => {
    merged[key] = Object.hasOwn(overrides || {}, key)
      ? mergeShareOverrides(baseline[key], overrides[key])
      : structuredClone(baseline[key]);
  });
  return merged;
}

function materializeShareState(payload) {
  if (!payload || payload.v !== SHARE_PAYLOAD_VERSION) return null;
  const baseline = buildCanonicalShareState(payload.b || {});
  return mergeShareOverrides(baseline, payload.o || {});
}

function serializeSimulatorState() {
  const basis = currentShareBasis();
  const fullState = serializeFullSimulatorState();
  const baseline = buildCanonicalShareState(basis);
  const overrides = sparseShareDiff(fullState, baseline);
  const payload = { v: SHARE_PAYLOAD_VERSION };
  if (Object.keys(basis).length) payload.b = basis;
  if (overrides && Object.keys(overrides).length) payload.o = overrides;
  return payload;
}

function encodeSharePayload(payload) {
  const sourceBytes = utf8Bytes(JSON.stringify(payload));
  if (sourceBytes.length > MAX_SHARE_STATE_BYTES) throw new Error("Simulator share state is too large.");
  return `${SHARE_COMPRESSION_PREFIX}${bytesToBase64Url(compressShareBytes(sourceBytes))}`;
}

function decodeSharePayload(value) {
  if (typeof value !== "string" || value.length > MAX_SHARE_TOKEN_LENGTH) {
    throw new Error("Simulator share link is too large.");
  }
  if (!value.startsWith(SHARE_COMPRESSION_PREFIX)) throw new Error("Unsupported simulator share link format.");
  const compressed = base64UrlToBytes(value.slice(SHARE_COMPRESSION_PREFIX.length));
  const decoded = utf8String(decompressShareBytes(compressed));
  const payload = JSON.parse(decoded);
  if (!payload || payload.v !== SHARE_PAYLOAD_VERSION) {
    throw new Error("Unsupported simulator share link version.");
  }
  return payload;
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  const section = currentSectionFromUrl();
  url.search = "";
  url.searchParams.set("s", encodeSharePayload(serializeSimulatorState()));
  url.hash = section || "";
  return url.toString();
}

function readShareTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("s");
}

function currentSectionFromUrl() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return "";
  const hashParams = new URLSearchParams(hash);
  const encodedSection = hashParams.get("section");
  if (encodedSection) return safeLabel(encodedSection, "", 80);
  return hash.includes("=") ? "" : safeLabel(hash, "", 80);
}

function navigateToSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });

  const url = new URL(window.location.href);
  if (readShareTokenFromUrl()) {
    url.search = "";
    url.searchParams.set("s", encodeSharePayload(serializeSimulatorState()));
  }
  url.hash = sectionId;
  window.history.replaceState(null, "", url.toString());
  return true;
}

function applySimulatorState(payload) {
  payload = materializeShareState(payload);
  if (!payload) return false;
  const product = payload.p || {};
  const dosing = payload.d || {};
  const params = payload.m || {};
  const calibration = payload.g || {};

  state.product.presetId = allowedValue(product.i, [...Object.keys(productPresets), "custom"], defaultProductPresetId);
  state.product.name = safeLabel(product.n, state.product.name);
  state.product.concentrationGPerMl = boundedNumber(product.c, state.product.concentrationGPerMl, 0.01, 1);
  state.product.needleType = allowedValue(product.nt, ["highFlo26G"], state.product.needleType);
  state.product.tubing = allowedValue(product.t, Object.keys(exampleScigFlowTable26G.tubing), state.product.tubing);
  state.product.referenceRunMinutes = boundedNumber(product.rr, state.product.referenceRunMinutes, 1, 1440);
  state.product.cartridgeSelectionMode = product.cm === "manual" ? "manual" : "auto";
  if (productPresets[state.product.presetId]) {
    state.product.cartridgeSizesMl = productPresets[state.product.presetId].cartridgeSizesMl;
  } else if (Array.isArray(product.s)) {
    const sharedSizes = [...new Set(product.s.slice(0, 12)
      .map((size) => boundedNumber(size, 0, 0, 1000))
      .filter((size) => size > 0))].sort((a, b) => b - a);
    if (sharedSizes.length) state.product.cartridgeSizesMl = sharedSizes;
  }
  const inventory = expandInventory(product.ci);
  if (inventory.length) {
    state.product.cartridgeInventory = inventory;
    state.product.cartridgeInventoryText = inventoryTextFromInventory(inventory);
  }

  state.dosing.entryMode = dosing.e === "total" ? "total" : "protocol";
  state.dosing.protocolDoseGKgWeek = boundedNumber(dosing.pd, state.dosing.protocolDoseGKgWeek, 0, 5);
  state.dosing.totalDoseUnit = dosing.tu === "g" ? "g" : "mL";
  state.dosing.totalDoseMl = boundedNumber(dosing.tm, state.dosing.totalDoseMl, 0, 5000);
  state.dosing.totalDoseG = boundedNumber(dosing.tg, state.dosing.totalDoseG, 0, 1000);

  state.params.absorptionHalfTimeDays = boundedNumber(params.a, state.params.absorptionHalfTimeDays, 0.1, 30);
  state.params.eliminationHalfLifeDays = boundedNumber(params.e, state.params.eliminationHalfLifeDays, 1, 365);
  state.params.simulationHorizonDays = allowedValue(Number(params.h), [90, 180, 365], state.params.simulationHorizonDays);
  state.params.timestepDays = allowedValue(Number(params.ts), [0.25, 0.5], state.params.timestepDays);
  state.params.switchPreconditionDays = boundedNumber(params.sp, state.params.switchPreconditionDays, 0, 3650);
  state.params.switchHorizonDays = boundedNumber(params.sh, state.params.switchHorizonDays, 14, 730);

  state.calibration.mode = allowedValue(calibration.m, Object.keys(iggScenarioPresets), state.calibration.mode);
  state.calibration.bodyWeightKg = boundedNumber(calibration.w, state.calibration.bodyWeightKg, 1, 300);
  state.calibration.baselinePreScigIggMgDl = boundedNumber(calibration.b, state.calibration.baselinePreScigIggMgDl, 0, 10000);
  state.calibration.doseSlopeMgDlPer01GKgWeek = boundedNumber(calibration.s, state.calibration.doseSlopeMgDlPer01GKgWeek, 0, 5000);
  state.calibration.peakToTroughRatio = boundedNumber(calibration.pr, state.calibration.peakToTroughRatio, 1, 5);
  state.calibration.tmaxDaysAfterWeeklyInfusion = boundedNumber(calibration.tx, state.calibration.tmaxDaysAfterWeeklyInfusion, 0, 60);
  state.calibration.labReferenceLowMgDl = boundedNumber(calibration.ll, state.calibration.labReferenceLowMgDl, 0, 10000);
  state.calibration.labReferenceHighMgDl = boundedNumber(calibration.lh, state.calibration.labReferenceHighMgDl, 0, 10000);
  state.calibration.highIggWarningThresholdMgDl = boundedNumber(calibration.hw, state.calibration.highIggWarningThresholdMgDl, 0, 10000);
  state.calibration.baselineUncertaintyMgDl = boundedNumber(calibration.bu, state.calibration.baselineUncertaintyMgDl, 0, 5000);
  state.calibration.slopeUncertaintyPercent = boundedNumber(calibration.su, state.calibration.slopeUncertaintyPercent, 0, 500);
  state.calibration.absorptionHalfTimeLowDays = boundedNumber(calibration.al, state.calibration.absorptionHalfTimeLowDays, 0.1, 30);
  state.calibration.absorptionHalfTimeHighDays = boundedNumber(calibration.ah, state.calibration.absorptionHalfTimeHighDays, 0.1, 30);
  state.calibration.eliminationHalfLifeLowDays = boundedNumber(calibration.el, state.calibration.eliminationHalfLifeLowDays, 1, 365);
  state.calibration.eliminationHalfLifeHighDays = boundedNumber(calibration.eh, state.calibration.eliminationHalfLifeHighDays, 1, 365);

  if (payload.r) state.reference = expandRegimen(payload.r, "reference");
  const sharedComparators = Array.isArray(payload.cs) ? payload.cs.slice(0, MAX_SHARED_COMPARATORS) : [];
  if (sharedComparators.length) {
    state.comparators = sharedComparators.map((comparator, index) => expandRegimen(comparator, `comp-${index + 1}`));
  }
  const comparatorIndexForSharedId = (sharedId) => sharedComparators.findIndex((comparator) => comparator?.i === sharedId);
  const activeIndex = comparatorIndexForSharedId(payload.a);
  const switchIndex = comparatorIndexForSharedId(payload.sw);
  state.activeComparatorId = state.comparators[Math.max(0, activeIndex)]?.id || "comp-1";
  state.switchComparatorId = state.comparators[Math.max(0, switchIndex)]?.id || state.activeComparatorId;
  state.chartWindow = allowedValue(String(payload.cw), ["all", "60", "90", "180"], state.chartWindow);
  state.chartMode = allowedValue(payload.cm, ["igg", "relative", "switch", "dose"], state.chartMode);
  const interval = payload.x || {};
  const intervalComparatorIndex = comparatorIndexForSharedId(interval.r);
  state.interval.regimenId = interval.r === "reference"
    ? "reference"
    : (state.comparators[intervalComparatorIndex]?.id || "reference");
  state.interval.horizonDays = allowedValue(Number(interval.h), [60, 90, 120, 180, 365], state.interval.horizonDays);
  state.interval.checkpointDay = allowedValue(Number(interval.d), [7, 14, 21, 28], state.interval.checkpointDay);
  state.interval.upperThresholdMgDl = boundedNumber(interval.u, state.interval.upperThresholdMgDl, 0, 10000);
  state.interval.lowerThresholdMgDl = boundedNumber(interval.l, state.interval.lowerThresholdMgDl, 0, 10000);
  return true;
}

function volumeToGrams(volumeMl, concentrationGPerMl) {
  return volumeMl * concentrationGPerMl;
}

function doseContribution(t, doseG, ka, ke) {
  if (t < 0) return 0;
  if (Math.abs(ka - ke) < 1e-9) return doseG * ka * t * Math.exp(-ke * t);
  return doseG * (ka / (ka - ke)) * (Math.exp(-ke * t) - Math.exp(-ka * t));
}

function expandRegimenEvents(regimen, horizonDays, concentrationGPerMl) {
  const expanded = [];
  const cycleLength = Math.max(Number(regimen.cycleLengthDays), 0.1);
  for (let cycleStart = 0; cycleStart <= horizonDays; cycleStart += cycleLength) {
    regimen.events.forEach((event) => {
      const day = cycleStart + Number(event.day);
      if (day <= horizonDays) {
        expanded.push({
          ...event,
          absoluteDay: day,
          doseG: volumeToGrams(Number(event.volumeMl), concentrationGPerMl),
        });
      }
    });
  }
  return expanded.sort((a, b) => a.absoluteDay - b.absoluteDay);
}

function simulateRegimen(regimen, params, product) {
  const ka = Math.log(2) / params.absorptionHalfTimeDays;
  const ke = Math.log(2) / params.eliminationHalfLifeDays;
  const expandedEvents = expandRegimenEvents(regimen, params.simulationHorizonDays, product.concentrationGPerMl);
  const points = [];

  for (let day = 0; day <= params.simulationHorizonDays + 1e-9; day += params.timestepDays) {
    let exposure = 0;
    for (const event of expandedEvents) {
      if (event.absoluteDay > day) break;
      exposure += doseContribution(day - event.absoluteDay, event.doseG, ka, ke);
    }
    points.push({ day: Number(day.toFixed(4)), exposure });
  }

  return { regimen, expandedEvents, points };
}

function expandRelativeEvents(regimen, startDay, endDay, concentrationGPerMl) {
  const expanded = [];
  const cycleLength = Math.max(Number(regimen.cycleLengthDays), 0.1);
  const firstCycle = Math.floor(startDay / cycleLength) - 1;
  const lastCycle = Math.ceil(endDay / cycleLength) + 1;

  for (let cycleIndex = firstCycle; cycleIndex <= lastCycle; cycleIndex += 1) {
    const cycleStart = cycleIndex * cycleLength;
    regimen.events.forEach((event) => {
      const absoluteDay = cycleStart + Number(event.day);
      if (absoluteDay >= startDay && absoluteDay <= endDay) {
        expanded.push({
          ...event,
          absoluteDay,
          doseG: volumeToGrams(Number(event.volumeMl), concentrationGPerMl),
        });
      }
    });
  }

  return expanded.sort((a, b) => a.absoluteDay - b.absoluteDay);
}

function simulateSwitchScenario(referenceRegimen, comparatorRegimen, params, product, referenceSteadyAverage) {
  const ka = Math.log(2) / params.absorptionHalfTimeDays;
  const ke = Math.log(2) / params.eliminationHalfLifeDays;
  const preconditionDays = Math.max(0, Number(params.switchPreconditionDays));
  const horizonDays = Math.max(params.timestepDays, Number(params.switchHorizonDays));
  const pastReferenceEvents = expandRelativeEvents(referenceRegimen, -preconditionDays, -params.timestepDays, product.concentrationGPerMl);
  const futureReferenceEvents = expandRelativeEvents(referenceRegimen, 0, horizonDays, product.concentrationGPerMl);
  const futureComparatorEvents = expandRelativeEvents(comparatorRegimen, 0, horizonDays, product.concentrationGPerMl);

  const continueReferenceEvents = [...pastReferenceEvents, ...futureReferenceEvents].sort((a, b) => a.absoluteDay - b.absoluteDay);
  const switchEvents = [...pastReferenceEvents, ...futureComparatorEvents].sort((a, b) => a.absoluteDay - b.absoluteDay);

  return {
    continueReference: {
      regimen: referenceRegimen,
      points: simulateFromAbsoluteEvents(continueReferenceEvents, horizonDays, params.timestepDays, ka, ke, referenceSteadyAverage),
    },
    switchComparator: {
      regimen: comparatorRegimen,
      points: simulateFromAbsoluteEvents(switchEvents, horizonDays, params.timestepDays, ka, ke, referenceSteadyAverage),
    },
  };
}

function simulateFromAbsoluteEvents(events, horizonDays, timestepDays, ka, ke, referenceSteadyAverage) {
  const points = [];
  for (let day = 0; day <= horizonDays + 1e-9; day += timestepDays) {
    let exposure = 0;
    for (const event of events) {
      if (event.absoluteDay > day) break;
      exposure += doseContribution(day - event.absoluteDay, event.doseG, ka, ke);
    }
    points.push({
      day: Number(day.toFixed(4)),
      exposure: referenceSteadyAverage ? (exposure / referenceSteadyAverage) * 100 : 0,
    });
  }
  return points;
}

function simulateRawFromAbsoluteEvents(events, horizonDays, timestepDays, ka, ke) {
  const points = [];
  for (let day = 0; day <= horizonDays + 1e-9; day += timestepDays) {
    let exposure = 0;
    for (const event of events) {
      if (event.absoluteDay > day) break;
      exposure += doseContribution(day - event.absoluteDay, event.doseG, ka, ke);
    }
    points.push({ day: Number(day.toFixed(4)), exposure });
  }
  return points;
}

function computeSteadyWindowStats(simulation, windowDays) {
  const lastDay = simulation.points.at(-1).day;
  const startDay = Math.max(0, lastDay - windowDays);
  const windowPoints = simulation.points.filter((point) => point.day >= startDay);
  const values = windowPoints.map((point) => point.exposure);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const peak = Math.max(...values);
  const trough = Math.min(...values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1);
  const sd = Math.sqrt(variance);
  const firstHalf = values.slice(0, Math.max(1, Math.floor(values.length / 2)));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const firstAvg = firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length;

  return {
    average,
    peak,
    trough,
    range: peak - trough,
    cv: average ? sd / average : 0,
    driftFraction: average ? Math.abs(secondAvg - firstAvg) / average : 0,
  };
}

function normalizeSimulation(simulation, referenceSteadyAverage) {
  return {
    ...simulation,
    points: simulation.points.map((point) => ({
      day: point.day,
      exposure: referenceSteadyAverage ? (point.exposure / referenceSteadyAverage) * 100 : 0,
    })),
  };
}

function computeLongestGap(events, cycleLengthDays) {
  if (!events.length) return 0;
  const days = [...new Set(events.map((event) => Number(event.day)))].sort((a, b) => a - b);
  if (days.length === 1) return cycleLengthDays;
  let longest = 0;
  for (let index = 0; index < days.length; index += 1) {
    const current = days[index];
    const next = index === days.length - 1 ? days[0] + cycleLengthDays : days[index + 1];
    longest = Math.max(longest, next - current);
  }
  return longest;
}

function groupEventsByCycleDay(events) {
  return events.reduce((groups, event) => {
    const key = String(Number(event.day));
    groups[key] ||= { day: Number(event.day), volumeMl: 0, sites: 0, events: [] };
    groups[key].volumeMl += Number(event.volumeMl);
    groups[key].sites += Number(event.sites);
    groups[key].events.push(event);
    return groups;
  }, {});
}

function getFlowRatePerSite(sites, tubing) {
  const siteCount = Math.max(1, Math.min(8, Math.round(Number(sites))));
  return exampleScigFlowTable26G.tubing[tubing][siteCount - 1];
}

function parseCartridgeInventory(text) {
  const entries = String(text)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(\d+(?:\.\d+)?)\s*(?:mL|ml)?\s*(?:x|\*)\s*(\d+)$/i)
        || part.match(/^(\d+)\s*(?:x|\*)\s*(\d+(?:\.\d+)?)\s*(?:mL|ml)?$/i);
      if (!match) return null;
      const first = Number(match[1]);
      const second = Number(match[2]);
      return part.toLowerCase().includes("x") && Number.isInteger(second)
        ? { volumeMl: first, count: second }
        : { volumeMl: second, count: first };
    })
    .filter((entry) => entry && entry.volumeMl > 0 && entry.count > 0);

  return entries.length ? entries.sort((a, b) => b.volumeMl - a.volumeMl) : [{ volumeMl: 50, count: 3 }, { volumeMl: 10, count: 1 }];
}

function cloneInventory(inventory) {
  return inventory.map((entry) => ({ ...entry }));
}

function allocateCartridges(volumeMl, inventory) {
  const target = Math.round(Number(volumeMl) * 100);
  const units = [];
  inventory.forEach((entry) => {
    for (let index = 0; index < entry.count; index += 1) {
      units.push(Math.round(entry.volumeMl * 100));
    }
  });

  const memo = new Map();
  function search(index, remaining) {
    const key = `${index}:${remaining}`;
    if (memo.has(key)) return memo.get(key);
    if (remaining === 0) return [];
    if (remaining < 0 || index >= units.length) return null;

    const useIt = search(index + 1, remaining - units[index]);
    if (useIt) {
      const result = [units[index], ...useIt];
      memo.set(key, result);
      return result;
    }

    const skipIt = search(index + 1, remaining);
    memo.set(key, skipIt);
    return skipIt;
  }

  const allocation = search(0, target);
  if (!allocation) return null;

  allocation.forEach((unit) => {
    const entry = inventory.find((item) => Math.round(item.volumeMl * 100) === unit && item.count > 0);
    if (entry) entry.count -= 1;
  });

  return allocation.map((unit) => unit / 100).sort((a, b) => b - a);
}

function allocateProductCartridges(volumeMl, cartridgeSizesMl) {
  const allocation = autoAllocateProductCartridges(volumeMl, cartridgeSizesMl);
  if (Math.abs(Number(allocation.volumeMl) - Number(volumeMl)) > 0.01) return null;
  return inventoryUnits(allocation.inventory).sort((a, b) => b - a);
}

function calibrationFactor(product) {
  const referenceSites = 4;
  const referenceVolumeMl = 50;
  const referenceTableFlow = getFlowRatePerSite(referenceSites, "F2400") * referenceSites;
  const referenceFlow = referenceVolumeMl / (Number(product.referenceRunMinutes) / 60);
  return referenceFlow / referenceTableFlow;
}

function estimateInfusionTime(volumeMl, sites, product, allocatedCartridges) {
  const flowRatePerSite = getFlowRatePerSite(sites, product.tubing);
  const tableTotalFlowMlPerHour = flowRatePerSite * sites;
  const totalFlowMlPerHour = tableTotalFlowMlPerHour * calibrationFactor(product);
  let totalHours = 0;
  const runs = [];
  const cartridges = allocatedCartridges || [Number(volumeMl)];

  cartridges.forEach((runVolume) => {
    const hours = runVolume / totalFlowMlPerHour;
    runs.push({ volumeMl: runVolume, hours });
    totalHours += hours;
  });

  return {
    hours: totalHours,
    minutes: totalHours * 60,
    flowRatePerSite,
    runs,
    feasible: Boolean(allocatedCartridges),
  };
}

function computeRegimenMetrics(regimen, simulation, normalizedSimulation, referenceMetrics, product, params) {
  const totalMl = regimen.events.reduce((sum, event) => sum + Number(event.volumeMl), 0);
  const totalG = volumeToGrams(totalMl, product.concentrationGPerMl);
  const cycleLength = Number(regimen.cycleLengthDays);
  const eventGroups = Object.values(groupEventsByCycleDay(regimen.events));
  const siteMlValues = regimen.events.flatMap((event) => {
    const perSite = Number(event.volumeMl) / Number(event.sites);
    return Array(Math.max(1, Number(event.sites))).fill(perSite);
  });
  const totalSites = regimen.events.reduce((sum, event) => sum + Number(event.sites), 0);
  const isReferenceRegimen = referenceMetrics === null;
  const remainingReferenceInventory = isReferenceRegimen ? cloneInventory(product.cartridgeInventory) : null;
  const infusionTimes = eventGroups
    .sort((a, b) => a.day - b.day)
    .map((group) => {
      const allocation = isReferenceRegimen
        ? allocateCartridges(group.volumeMl, remainingReferenceInventory)
        : allocateProductCartridges(group.volumeMl, product.cartridgeSizesMl);
      return {
        day: group.day,
        volumeMl: group.volumeMl,
        sites: group.sites,
        cartridgeAllocation: allocation,
        ...estimateInfusionTime(group.volumeMl, group.sites, product, allocation),
      };
    });
  const stats = computeSteadyWindowStats(normalizedSimulation, params.steadyWindowDays);
  const rawStats = computeSteadyWindowStats(simulation, params.steadyWindowDays);
  const mlPerWeek = totalMl / cycleLength * 7;
  const percentReferenceDoseIntensity = referenceMetrics ? (mlPerWeek / referenceMetrics.mlPerWeek) * 100 : 100;

  return {
    name: regimen.name,
    cycleLengthDays: cycleLength,
    totalMlPerCycle: totalMl,
    totalGPerCycle: totalG,
    mlPerDay: totalMl / cycleLength,
    gPerDay: totalG / cycleLength,
    mlPerWeek,
    gPerWeek: totalG / cycleLength * 7,
    percentReferenceDoseIntensity,
    totalSitesPerCycle: totalSites,
    sitesPer14Days: totalSites / cycleLength * 14,
    sitesPer28Days: totalSites / cycleLength * 28,
    sitesPer365Days: totalSites / cycleLength * 365,
    infusionDaysPer28Days: eventGroups.length / cycleLength * 28,
    maxMlPerInfusionDay: Math.max(...eventGroups.map((group) => group.volumeMl)),
    maxSitesPerInfusionDay: Math.max(...eventGroups.map((group) => group.sites)),
    maxMlPerSite: Math.max(...regimen.events.map((event) => Number(event.volumeMl) / Number(event.sites))),
    averageMlPerSite: siteMlValues.reduce((sum, value) => sum + value, 0) / Math.max(siteMlValues.length, 1),
    longestGapDays: computeLongestGap(regimen.events, cycleLength),
    infusionTimes,
    maxInfusionMinutes: Math.max(...infusionTimes.map((time) => time.minutes)),
    cartridgeFeasible: infusionTimes.every((time) => time.feasible),
    normalizedAverageExposure: stats.average,
    normalizedPeakExposure: stats.peak,
    normalizedTroughExposure: stats.trough,
    peakTroughRange: stats.range,
    coefficientOfVariation: stats.cv,
    driftFraction: rawStats.driftFraction,
  };
}

function readDosingSettings() {
  state.dosing.entryMode = allowedValue($("doseEntryMode").value, ["protocol", "total"], state.dosing.entryMode);
  state.calibration.bodyWeightKg = boundedNumber($("bodyWeightKg").value, state.calibration.bodyWeightKg, 1, 300);
  state.dosing.protocolDoseGKgWeek = boundedNumber($("protocolDoseGKgWeek").value, state.dosing.protocolDoseGKgWeek, 0, 5);
  state.dosing.requestedProtocolDoseGKgWeek = state.dosing.protocolDoseGKgWeek;
  state.dosing.totalDoseUnit = allowedValue($("totalDoseUnit").value, ["mL", "g"], state.dosing.totalDoseUnit);
  state.dosing.totalDoseMl = boundedNumber($("totalDoseMl").value, state.dosing.totalDoseMl, 0, 5000);
  state.dosing.totalDoseG = boundedNumber($("totalDoseG").value, state.dosing.totalDoseG, 0, 1000);

  const concentration = Math.max(Number(state.product.concentrationGPerMl), 0.0001);
  const weightKg = Math.max(Number(state.calibration.bodyWeightKg), 1);
  let requestedDoseG = 0;
  let requestedDoseMl = 0;
  if (state.dosing.entryMode === "protocol") {
    requestedDoseG = Math.max(0, state.dosing.protocolDoseGKgWeek * weightKg);
    requestedDoseMl = requestedDoseG / concentration;
  } else if (state.dosing.totalDoseUnit === "g") {
    requestedDoseG = Math.max(0, state.dosing.totalDoseG);
    requestedDoseMl = requestedDoseG / concentration;
  } else {
    requestedDoseMl = Math.max(0, state.dosing.totalDoseMl);
    requestedDoseG = requestedDoseMl * concentration;
  }

  state.dosing.requestedWeeklyDoseMl = requestedDoseMl;
  state.dosing.requestedWeeklyDoseG = requestedDoseG;
  const autoAllocation = autoAllocateProductCartridges(requestedDoseMl, state.product.cartridgeSizesMl);
  const targetDoseMl = autoAllocation.volumeMl;
  const hasRenderedCartridgeControls = Boolean($("cartridgePicker").querySelector("[data-cartridge-volume]"));
  if (state.product.cartridgeSelectionMode === "auto") {
    state.product.cartridgeInventory = autoAllocation.inventory;
  } else if (hasRenderedCartridgeControls) {
    state.product.cartridgeInventory = readCartridgeSelection();
  }
  state.product.cartridgeInventoryText = inventoryTextFromInventory(state.product.cartridgeInventory);
  const selectedVolumeMl = selectedCartridgeVolume(state.product.cartridgeInventory);
  state.product.cartridgeSelectionValid = Math.abs(selectedVolumeMl - targetDoseMl) < 0.01;
  state.product.cartridgeSelectionMessage = state.product.cartridgeSelectionValid
    ? `${formatNumber(selectedVolumeMl, 1)} mL selected.`
    : `Selected cartridges add up to ${formatNumber(selectedVolumeMl, 1)} mL, but this dose needs ${formatNumber(targetDoseMl, 1)} mL. Adjust counts or use Auto-fill.`;
  state.dosing.weeklyDoseMl = targetDoseMl;
  state.dosing.weeklyDoseG = state.dosing.weeklyDoseMl * concentration;
  state.dosing.totalDoseMl = state.dosing.weeklyDoseMl;
  state.dosing.totalDoseG = state.dosing.weeklyDoseG;
  state.dosing.exactProtocolDoseGKgWeek = state.dosing.weeklyDoseG / weightKg;

  setCalculatedInputValue("protocolDoseGKgWeek", state.dosing.entryMode === "protocol"
    ? state.dosing.requestedProtocolDoseGKgWeek
    : state.dosing.exactProtocolDoseGKgWeek, state.dosing.entryMode === "protocol" ? 2 : 3);
  setCalculatedInputValue("totalDoseMl", state.dosing.weeklyDoseMl, 1);
  setCalculatedInputValue("totalDoseG", state.dosing.weeklyDoseG, 1);
}

function setCalculatedInputValue(id, value, digits) {
  const input = $(id);
  if (document.activeElement === input) return;
  input.value = formatNumber(value, digits);
}

function generatedPresetById(presetId) {
  return presets.find((preset) => preset.presetId === presetId || preset.id === presetId);
}

function syncRegimenToGeneratedPreset(regimen, previousPresets = []) {
  if (!regimen.presetId || regimen.presetId === "custom") return;
  const generated = generatedPresetById(regimen.presetId);
  if (!generated) return;
  const previousGenerated = previousPresets.find((preset) => preset.presetId === regimen.presetId || preset.id === regimen.presetId);
  const customName = previousGenerated && regimen.name !== previousGenerated.name ? regimen.name : null;
  const id = regimen.id;
  Object.assign(regimen, structuredClone(generated), { id, presetId: generated.presetId });
  if (customName) regimen.name = customName;
}

function refreshDoseGeneratedPresets() {
  const previousPresets = presets;
  presets = buildPresets(state.dosing.weeklyDoseMl, state.product.cartridgeInventory);
  syncRegimenToGeneratedPreset(state.reference, previousPresets);
  state.comparators.forEach((comparator) => syncRegimenToGeneratedPreset(comparator, previousPresets));
}

function readSettings() {
  state.product.presetId = allowedValue($("productPreset").value, [...Object.keys(productPresets), "custom"], state.product.presetId);
  state.product.name = safeLabel($("productName").value, state.product.name || "SCIG example");
  state.product.concentrationGPerMl = boundedNumber($("concentration").value, state.product.concentrationGPerMl, 0.01, 1);
  state.product.needleType = allowedValue($("needleType").value, ["highFlo26G"], state.product.needleType);
  state.product.tubing = allowedValue($("tubing").value, Object.keys(exampleScigFlowTable26G.tubing), state.product.tubing);
  if (productPresets[state.product.presetId]) {
    state.product.cartridgeSizesMl = productPresets[state.product.presetId].cartridgeSizesMl;
  }
  state.product.referenceRunMinutes = boundedNumber($("referenceRunMinutes").value, state.product.referenceRunMinutes, 1, 1440);
  readDosingSettings();
  refreshDoseGeneratedPresets();
  state.params.absorptionHalfTimeDays = boundedNumber($("absorptionHalfTime").value, state.params.absorptionHalfTimeDays, 0.1, 30);
  state.params.eliminationHalfLifeDays = boundedNumber($("eliminationHalfLife").value, state.params.eliminationHalfLifeDays, 1, 365);
  state.params.simulationHorizonDays = allowedValue(Number($("simulationHorizon").value), [90, 180, 365], state.params.simulationHorizonDays);
  state.params.timestepDays = allowedValue(Number($("timestep").value), [0.25, 0.5], state.params.timestepDays);
  state.params.switchPreconditionDays = boundedNumber($("switchPreconditionDays").value, state.params.switchPreconditionDays, 0, 3650);
  state.params.switchHorizonDays = boundedNumber($("switchHorizonDays").value, state.params.switchHorizonDays, 14, 730);
  state.calibration.mode = allowedValue($("iggScenarioMode").value, Object.keys(iggScenarioPresets), state.calibration.mode);
  state.calibration.baselinePreScigIggMgDl = boundedNumber($("baselinePreScigIgg").value, state.calibration.baselinePreScigIggMgDl, 0, 10000);
  state.calibration.doseSlopeMgDlPer01GKgWeek = boundedNumber($("doseSlope").value, state.calibration.doseSlopeMgDlPer01GKgWeek, 0, 5000);
  state.calibration.peakToTroughRatio = boundedNumber($("peakToTroughRatio").value, state.calibration.peakToTroughRatio, 1, 5);
  state.calibration.tmaxDaysAfterWeeklyInfusion = boundedNumber($("modelTmaxDays").value, state.calibration.tmaxDaysAfterWeeklyInfusion, 0, 60);
  state.calibration.labReferenceLowMgDl = boundedNumber($("labReferenceLow").value, state.calibration.labReferenceLowMgDl, 0, 10000);
  state.calibration.labReferenceHighMgDl = boundedNumber($("labReferenceHigh").value, state.calibration.labReferenceHighMgDl, 0, 10000);
  state.calibration.highIggWarningThresholdMgDl = boundedNumber($("highIggWarningThreshold").value, state.calibration.highIggWarningThresholdMgDl, 0, 10000);
  state.calibration.baselineUncertaintyMgDl = boundedNumber($("baselineUncertainty").value, state.calibration.baselineUncertaintyMgDl, 0, 5000);
  state.calibration.slopeUncertaintyPercent = boundedNumber($("slopeUncertaintyPercent").value, state.calibration.slopeUncertaintyPercent, 0, 500);
  state.calibration.absorptionHalfTimeLowDays = boundedNumber($("absorptionHalfTimeLow").value, state.calibration.absorptionHalfTimeLowDays, 0.1, 30);
  state.calibration.absorptionHalfTimeHighDays = boundedNumber($("absorptionHalfTimeHigh").value, state.calibration.absorptionHalfTimeHighDays, 0.1, 30);
  state.calibration.eliminationHalfLifeLowDays = boundedNumber($("eliminationHalfLifeLow").value, state.calibration.eliminationHalfLifeLowDays, 1, 365);
  state.calibration.eliminationHalfLifeHighDays = boundedNumber($("eliminationHalfLifeHigh").value, state.calibration.eliminationHalfLifeHighDays, 1, 365);
  if ($("switchComparator")) {
    state.switchComparatorId = allowedValue($("switchComparator").value, state.comparators.map((comparator) => comparator.id), state.switchComparatorId);
  }
  if ($("intervalRegimen")) {
    state.interval.regimenId = allowedValue($("intervalRegimen").value, ["reference", ...state.comparators.map((comparator) => comparator.id)], state.interval.regimenId);
    state.interval.horizonDays = allowedValue(Number($("intervalHorizonDays").value), [60, 90, 120, 180, 365], state.interval.horizonDays);
    state.interval.upperThresholdMgDl = boundedNumber($("intervalUpperThreshold").value, state.interval.upperThresholdMgDl, 0, 10000);
    state.interval.lowerThresholdMgDl = boundedNumber($("intervalLowerThreshold").value, state.interval.lowerThresholdMgDl, 0, 10000);
  }
  state.chartWindow = allowedValue($("chartWindow").value, ["all", "60", "90", "180"], state.chartWindow);
}

function selectedCartridgeVolume(inventory) {
  return inventory.reduce((sum, entry) => sum + Number(entry.volumeMl) * Number(entry.count), 0);
}

function countForVolume(inventory, volumeMl) {
  const entry = inventory.find((item) => Math.abs(Number(item.volumeMl) - Number(volumeMl)) < 0.01);
  return entry ? Number(entry.count) : 0;
}

function readCartridgeSelection() {
  const counts = {};
  $("cartridgePicker").querySelectorAll("input[data-cartridge-volume]").forEach((input) => {
    counts[input.dataset.cartridgeVolume] = Number(input.value);
  });
  return inventoryFromCounts(counts);
}

function setControlValue(id, value) {
  const control = $(id);
  if (control) control.value = value;
}

function syncFormControlsFromState() {
  setControlValue("productPreset", state.product.presetId);
  setControlValue("productName", state.product.name);
  setControlValue("concentration", formatNumber(state.product.concentrationGPerMl, 2));
  setControlValue("needleType", state.product.needleType);
  setControlValue("tubing", state.product.tubing);
  setControlValue("referenceRunMinutes", formatNumber(state.product.referenceRunMinutes, 0));
  setControlValue("doseEntryMode", state.dosing.entryMode);
  setControlValue("bodyWeightKg", formatNumber(state.calibration.bodyWeightKg, 0));
  setControlValue("protocolDoseGKgWeek", formatNumber(state.dosing.protocolDoseGKgWeek, 3));
  setControlValue("totalDoseUnit", state.dosing.totalDoseUnit);
  setControlValue("totalDoseMl", formatNumber(state.dosing.totalDoseMl, 1));
  setControlValue("totalDoseG", formatNumber(state.dosing.totalDoseG, 1));
  setControlValue("absorptionHalfTime", formatNumber(state.params.absorptionHalfTimeDays, 1));
  setControlValue("eliminationHalfLife", formatNumber(state.params.eliminationHalfLifeDays, 0));
  setControlValue("simulationHorizon", String(state.params.simulationHorizonDays));
  setControlValue("timestep", String(state.params.timestepDays));
  setControlValue("iggScenarioMode", state.calibration.mode);
  setControlValue("baselinePreScigIgg", formatNumber(state.calibration.baselinePreScigIggMgDl, 0));
  setControlValue("doseSlope", formatNumber(state.calibration.doseSlopeMgDlPer01GKgWeek, 0));
  setControlValue("peakToTroughRatio", formatNumber(state.calibration.peakToTroughRatio, 2));
  setControlValue("modelTmaxDays", formatNumber(state.calibration.tmaxDaysAfterWeeklyInfusion, 2));
  setControlValue("labReferenceLow", formatNumber(state.calibration.labReferenceLowMgDl, 0));
  setControlValue("labReferenceHigh", formatNumber(state.calibration.labReferenceHighMgDl, 0));
  setControlValue("highIggWarningThreshold", formatNumber(state.calibration.highIggWarningThresholdMgDl, 0));
  setControlValue("baselineUncertainty", formatNumber(state.calibration.baselineUncertaintyMgDl, 0));
  setControlValue("slopeUncertaintyPercent", formatNumber(state.calibration.slopeUncertaintyPercent, 0));
  setControlValue("absorptionHalfTimeLow", formatNumber(state.calibration.absorptionHalfTimeLowDays, 1));
  setControlValue("absorptionHalfTimeHigh", formatNumber(state.calibration.absorptionHalfTimeHighDays, 1));
  setControlValue("eliminationHalfLifeLow", formatNumber(state.calibration.eliminationHalfLifeLowDays, 0));
  setControlValue("eliminationHalfLifeHigh", formatNumber(state.calibration.eliminationHalfLifeHighDays, 0));
  setControlValue("switchPreconditionDays", formatNumber(state.params.switchPreconditionDays, 0));
  setControlValue("switchHorizonDays", formatNumber(state.params.switchHorizonDays, 0));
  setControlValue("intervalRegimen", state.interval.regimenId);
  setControlValue("intervalHorizonDays", String(state.interval.horizonDays));
  setControlValue("intervalUpperThreshold", formatNumber(state.interval.upperThresholdMgDl, 0));
  setControlValue("intervalLowerThreshold", formatNumber(state.interval.lowerThresholdMgDl, 0));
  setControlValue("chartWindow", state.chartWindow);
}

function renderCartridgePicker() {
  const activeCartridgeInput = document.activeElement?.matches?.("input[data-cartridge-volume]");
  if (activeCartridgeInput) {
    $("cartridgeValidation").className = `field-message ${state.product.cartridgeSelectionValid ? "valid" : "invalid"}`;
    $("cartridgeValidation").textContent = state.product.cartridgeSelectionMessage;
    return;
  }
  const sizes = [...state.product.cartridgeSizesMl].sort((a, b) => b - a);
  const selectedVolume = selectedCartridgeVolume(state.product.cartridgeInventory);
  $("cartridgePicker").innerHTML = `
    <table class="cartridge-table">
      <thead>
        <tr>
          <th>Size</th>
          <th>Count</th>
          <th>Volume</th>
        </tr>
      </thead>
      <tbody>
        ${sizes.map((volumeMl) => {
          const count = countForVolume(state.product.cartridgeInventory, volumeMl);
          return `
            <tr>
              <td>${formatNumber(volumeMl, Number.isInteger(volumeMl) ? 0 : 1)} mL</td>
              <td>
                <div class="stepper">
                  <button class="icon-button" data-action="cartridge-step" data-cartridge-volume="${volumeMl}" data-step="-1" type="button">-</button>
                  <input
                    data-cartridge-volume="${volumeMl}"
                    type="number"
                    min="0"
                    step="1"
                    value="${count}"
                    aria-label="${formatNumber(volumeMl, Number.isInteger(volumeMl) ? 0 : 1)} mL cartridge count"
                  >
                  <button class="icon-button" data-action="cartridge-step" data-cartridge-volume="${volumeMl}" data-step="1" type="button">+</button>
                </div>
              </td>
              <td>${formatNumber(volumeMl * count, 1)} mL</td>
            </tr>
          `;
        }).join("")}
      </tbody>
      <tfoot>
        <tr>
          <th colspan="2">Selected total</th>
          <th>${formatNumber(selectedVolume, 1)} mL</th>
        </tr>
      </tfoot>
    </table>
  `;
  $("cartridgeValidation").className = `field-message ${state.product.cartridgeSelectionValid ? "valid" : "invalid"}`;
  $("cartridgeValidation").textContent = state.product.cartridgeSelectionMessage;
}

function renderRegimenCards(comparatorSims) {
  $("referenceCard").innerHTML = regimenCard("Reference", state.reference, null);
  const active = comparatorSims.find((sim) => sim.regimen.id === state.activeComparatorId) || comparatorSims[0];
  $("candidateCard").innerHTML = regimenCard("Selected comparator", active.regimen, active.metrics);
}

function regimenCard(role, regimen, metrics) {
  const totalMl = regimen.events.reduce((sum, event) => sum + Number(event.volumeMl), 0);
  const totalG = volumeToGrams(totalMl, state.product.concentrationGPerMl);
  const eventText = regimen.events
    .map((event) => `Day ${formatNumber(event.day, 0)}: ${formatNumber(event.volumeMl, 0)} mL / ${formatNumber(event.sites, 0)} sites`)
    .join(" · ");
  const metricsText = metrics
    ? `${formatNumber(metrics.percentReferenceDoseIntensity, 1)}% of reference · max ${formatNumber(metrics.maxMlPerSite, 1)} mL/site`
    : `${formatNumber(regimen.cycleLengthDays, 0)} day cycle`;
  return `
    <div class="regimen-card">
      <div>
        <span>${escapeHtml(role)}</span>
        <strong>${escapeHtml(regimen.name)}</strong>
      </div>
      <div class="regimen-card-metrics">
        <b>${formatNumber(totalMl, 0)} mL</b>
        <b>${formatDose(totalG)}</b>
        <b>${formatNumber(regimen.cycleLengthDays, 0)} days</b>
      </div>
      <p>${escapeHtml(eventText)}</p>
      <small>${escapeHtml(metricsText)}</small>
    </div>
  `;
}

function applyProductPreset(presetId) {
  const preset = productPresets[presetId];
  if (!preset) return;
  $("productPreset").value = presetId;
  $("productName").value = preset.name;
  $("concentration").value = formatNumber(preset.concentrationGPerMl, 2);
  state.product.cartridgeSizesMl = preset.cartridgeSizesMl;
  state.product.cartridgeSelectionMode = "auto";
}

function defaultReferenceDoseGPerKgPerWeek(weightKg = 65) {
  return Math.max(Number(state.dosing.weeklyDoseG), 0) / Math.max(Number(weightKg), 1);
}

function slopeFromPreset(preset, weightKg) {
  const doseUnits = Number(preset.protocolDoseGKgWeek) / 0.1;
  if (doseUnits <= 0) return 0;
  return Math.max(0, (preset.steadyStateTroughIggMgDl - preset.baselinePreScigIggMgDl) / doseUnits);
}

function applyIggScenarioPreset(mode) {
  const preset = iggScenarioPresets[mode] || iggScenarioPresets.replacement;
  const weightKg = Number($("bodyWeightKg").value) || 65;
  $("iggScenarioMode").value = mode;
  $("doseEntryMode").value = "protocol";
  $("protocolDoseGKgWeek").value = formatNumber(preset.protocolDoseGKgWeek, 3);
  $("baselinePreScigIgg").value = preset.baselinePreScigIggMgDl;
  $("doseSlope").value = formatNumber(slopeFromPreset(preset, weightKg), 1);
  $("peakToTroughRatio").value = formatNumber(preset.peakToTroughRatio, 2);
  $("modelTmaxDays").value = preset.tmaxDaysAfterWeeklyInfusion;
  $("highIggWarningThreshold").value = preset.highIggWarningThresholdMgDl;
}

function renderDoseSetupSummary() {
  const requestedChanged = Math.abs(state.dosing.weeklyDoseMl - state.dosing.requestedWeeklyDoseMl) > 0.01;
  const doseBasis = state.dosing.entryMode === "protocol"
    ? state.dosing.requestedProtocolDoseGKgWeek
    : state.dosing.exactProtocolDoseGKgWeek;
  const roundingNote = requestedChanged
    ? ` Requested ${formatDose(state.dosing.requestedWeeklyDoseG)} / ${formatNumber(state.dosing.requestedWeeklyDoseMl, 1)} mL; rounded to the nearest feasible product amount from ${escapeHtml(state.product.cartridgeInventoryText)}.`
    : ` Requested dose already matches the available product amount list.`;
  $("doseSetupSummary").innerHTML = `
    <strong>Generated reference q7 dose:</strong>
    ${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL,
    from ${formatNumber(doseBasis, 2)} g/kg/week at ${formatNumber(state.calibration.bodyWeightKg, 0)} kg.
    Built-in presets use this amount as the per-cycle product dose for q7, q9, q14, and split-cycle comparisons.${roundingNote}
  `;
}

function renderSetupSnapshot() {
  const scenario = iggScenarioPresets[state.calibration.mode] || iggScenarioPresets.replacement;
  $("snapshotPrimary").textContent = `${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL weekly reference`;
  $("setupSnapshot").innerHTML = `
    <div class="snapshot-item">
      <span>Dose basis</span>
      <strong>${formatNumber(state.dosing.entryMode === "protocol" ? state.dosing.requestedProtocolDoseGKgWeek : state.dosing.exactProtocolDoseGKgWeek, 2)} g/kg/week</strong>
      <small>${formatNumber(state.calibration.bodyWeightKg, 0)} kg model patient</small>
    </div>
    <div class="snapshot-item">
      <span>Product</span>
      <strong>${escapeHtml(state.product.name)}</strong>
      <small>${formatNumber(state.product.concentrationGPerMl, 2)} g/mL, ${escapeHtml(state.product.cartridgeInventoryText || "no cartridges")}</small>
    </div>
    <div class="snapshot-item">
      <span>IgG scenario</span>
      <strong>${escapeHtml(scenario.label)}</strong>
      <small>Peak-trough ratio ${formatNumber(state.calibration.peakToTroughRatio, 2)}</small>
    </div>
    <div class="snapshot-item">
      <span>Simulation</span>
      <strong>${formatNumber(state.params.simulationHorizonDays, 0)} days</strong>
      <small>Absorption ${formatNumber(state.params.absorptionHalfTimeDays, 1)} d, elimination ${formatNumber(state.params.eliminationHalfLifeDays, 0)} d</small>
    </div>
  `;
}

function activeComparator() {
  return state.comparators.find((comparator) => comparator.id === state.activeComparatorId) || state.comparators[0];
}

function editingComparator() {
  return state.comparators.find((comparator) => comparator.id === editingComparatorId) || null;
}

function switchComparator() {
  return state.comparators.find((comparator) => comparator.id === state.switchComparatorId) || activeComparator();
}

function intervalRegimen() {
  if (state.interval.regimenId === "reference") return state.reference;
  return state.comparators.find((comparator) => comparator.id === state.interval.regimenId) || state.reference;
}

function renderPresetSelect(select, includeLabel = true) {
  select.innerHTML = `${includeLabel ? '<option value="">Choose a generated schedule...</option>' : ""}${presets.map((preset) => (
    `<option value="${preset.id}">${escapeHtml(preset.name)}</option>`
  )).join("")}`;
}

function renderGeneratedPresetControls() {
  renderPresetSelect($("referencePreset"));
  renderPresetSelect($("candidatePreset"));
  if (presets.some((preset) => preset.id === pendingReferencePresetId)) {
    $("referencePreset").value = pendingReferencePresetId;
  } else {
    pendingReferencePresetId = "";
  }
  if (presets.some((preset) => preset.id === pendingComparatorPresetId)) {
    $("candidatePreset").value = pendingComparatorPresetId;
  } else {
    pendingComparatorPresetId = "";
  }
  const selectedReferencePreset = presets.find((preset) => preset.id === pendingReferencePresetId);
  $("applyReferencePreset").disabled = !selectedReferencePreset;
  $("applyReferencePreset").textContent = selectedReferencePreset
    ? "Apply preset"
    : "Choose a preset";
  $("referencePresetTarget").innerHTML = selectedReferencePreset
    ? `Ready to replace <strong>${escapeHtml(state.reference.name)}</strong> with <strong>${escapeHtml(selectedReferencePreset.name)}</strong>.`
    : "Choose a generated schedule, then click Apply.";
  const target = editingComparator() || activeComparator();
  const selectedPreset = presets.find((preset) => preset.id === pendingComparatorPresetId);
  $("applyCandidatePreset").disabled = !selectedPreset;
  $("applyCandidatePreset").textContent = selectedPreset
    ? `Apply to ${target.name}`
    : "Choose a preset";
  $("candidatePresetTarget").innerHTML = selectedPreset
    ? `Ready to replace <strong>${escapeHtml(target.name)}</strong> with <strong>${escapeHtml(selectedPreset.name)}</strong>.`
    : `Choose a generated schedule for <strong>${escapeHtml(target.name)}</strong>, then click Apply.`;
}

function renderEditingGuidance() {
  const entryMode = state.dosing.entryMode;
  const totalUnit = state.dosing.totalDoseUnit;
  const isCustomPatient = state.calibration.mode === "custom";
  $("doseSetupPanel").hidden = !isCustomPatient;
  document.querySelectorAll("[data-dose-entry]").forEach((label) => {
    const visibleForMode = label.dataset.doseEntry === entryMode;
    const visibleForUnit = !label.dataset.totalDoseUnit || label.dataset.totalDoseUnit === totalUnit;
    label.hidden = !(visibleForMode && visibleForUnit);
  });

  const scenario = iggScenarioPresets[state.calibration.mode] || iggScenarioPresets.replacement;
  $("scenarioDoseEffect").innerHTML = isCustomPatient
    ? `Custom dose controls are open below. Current product-rounded reference: <strong>${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL every 7 days</strong>.`
    : `<strong>${formatNumber(scenario.protocolDoseGKgWeek, 2)} g/kg/week</strong> at ${formatNumber(state.calibration.bodyWeightKg, 0)} kg generates a product-rounded reference of <strong>${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL every 7 days</strong>.`;
  $("iggAdvancedHint").textContent = `Baseline ${formatMgDl(state.calibration.baselinePreScigIggMgDl)} · peak/trough ${formatNumber(state.calibration.peakToTroughRatio, 2)} · warning ${formatMgDl(state.calibration.highIggWarningThresholdMgDl)}`;
  $("referenceRegimenHelp").innerHTML = `Generated from the current <strong>${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL</strong> dose. Every comparator is measured against this schedule.`;
  $("selectedComparatorName").textContent = (editingComparator() || activeComparator()).name;
}

function renderComparatorSelect() {
  if (!state.comparators.some((comparator) => comparator.id === state.switchComparatorId)) {
    state.switchComparatorId = activeComparator().id;
  }
  $("comparatorManager").innerHTML = state.comparators.map((comparator, index) => {
    const totalMl = comparator.events.reduce((sum, event) => sum + Number(event.volumeMl), 0);
    const active = comparator.id === editingComparatorId;
    return `
    <div class="comparator-row ${active ? "active" : ""}">
      <span class="comparator-index">${index + 1}</span>
      <div class="comparator-summary">
        <strong>${escapeHtml(comparator.name)}</strong>
        <small>${formatNumber(totalMl, 1)} mL over ${formatNumber(comparator.cycleLengthDays, 0)} days · ${comparator.events.length} dose event${comparator.events.length === 1 ? "" : "s"}</small>
      </div>
      <div class="comparator-row-actions">
        <button class="${active ? "selected-control" : "secondary"}" data-action="select-comparator" data-comparator-id="${comparator.id}" ${active ? "disabled" : ""} type="button">${active ? "Editing now" : "Edit this"}</button>
        <button class="icon-button" aria-label="Move comparator ${index + 1} up" data-action="move-comparator-up" data-comparator-id="${comparator.id}" ${index === 0 ? "disabled" : ""} type="button">↑</button>
        <button class="icon-button" aria-label="Move comparator ${index + 1} down" data-action="move-comparator-down" data-comparator-id="${comparator.id}" ${index === state.comparators.length - 1 ? "disabled" : ""} type="button">↓</button>
        <button class="icon-button danger-button" aria-label="Remove comparator ${index + 1}" data-action="remove-comparator" data-comparator-id="${comparator.id}" ${state.comparators.length === 1 ? "disabled" : ""} type="button">Remove</button>
      </div>
    </div>
  `;
  }).join("");

  $("switchComparator").innerHTML = state.comparators.map((comparator, index) => (
    `<option value="${comparator.id}">Comparator ${index + 1}: ${escapeHtml(comparator.name)}</option>`
  )).join("");
  $("switchComparator").value = state.switchComparatorId;

  const intervalIds = ["reference", ...state.comparators.map((comparator) => comparator.id)];
  if (!intervalIds.includes(state.interval.regimenId)) state.interval.regimenId = "reference";
  $("intervalRegimen").innerHTML = [
    `<option value="reference">Reference: ${escapeHtml(state.reference.name)}</option>`,
    ...state.comparators.map((comparator, index) => (
      `<option value="${comparator.id}">Comparator ${index + 1}: ${escapeHtml(comparator.name)}</option>`
    )),
  ].join("");
  $("intervalRegimen").value = state.interval.regimenId;
  const editorOpen = Boolean(editingComparator());
  $("comparatorPresetStep").hidden = !editorOpen;
  $("comparatorEditorStep").hidden = !editorOpen;
}

function renderRegimenEditor(container, regimen, type) {
  const eventCount = regimen.events.length;
  const eventLabel = eventCount === 1 ? "dose day" : "dose days";
  const appliedNotice = editedRegimens.has(regimen) ? `
    <div class="auto-apply-note" role="status">
      <span class="auto-apply-check" aria-hidden="true">✓</span>
      <div><strong>Changes applied automatically</strong><small>This schedule and its results are up to date.</small></div>
    </div>
  ` : "";
  container.innerHTML = `
    ${appliedNotice}
    <div class="regimen-fields">
      <label>
        Regimen name
        <input data-type="${type}" data-field="name" type="text" value="${escapeHtml(regimen.name)}">
      </label>
      <label>
        Cycle length (days)
        <input data-type="${type}" data-field="cycleLengthDays" type="number" min="1" step="1" inputmode="numeric" value="${wholeCycleDays(regimen.cycleLengthDays)}">
      </label>
    </div>
    <div class="event-table-wrap">
    <table class="event-table" aria-label="${type === "reference" ? "Reference" : "Selected comparator"} dose events">
      <thead>
        <tr>
          <th>Day</th>
          <th>Volume</th>
          <th>Sites</th>
          <th>Dose</th>
          <th>mL/site</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${regimen.events.map((event, index) => eventRow(regimen, event, index, type)).join("")}
      </tbody>
    </table>
    </div>
    <div class="event-actions">
      <div class="event-actions-summary">
        <span class="pill">${round(regimen.events.reduce((sum, event) => sum + Number(event.volumeMl), 0), 0)} mL per cycle</span>
        <small>${eventCount} ${eventLabel} already shown above</small>
      </div>
      <div class="add-dose-day-control">
        <button class="secondary" data-type="${type}" data-action="add-event" type="button">+ Add another dose day</button>
        <small>Use for split schedules with more than one infusion day per cycle.</small>
      </div>
    </div>
  `;
}

function eventRow(regimen, event, index, type) {
  const dose = volumeToGrams(Number(event.volumeMl), state.product.concentrationGPerMl);
  const mlPerSite = Number(event.volumeMl) / Number(event.sites);
  const disableRemove = regimen.events.length === 1 ? "disabled" : "";
  return `
    <tr>
      <td data-label="Day"><input aria-label="Dose event ${index + 1} day" data-type="${type}" data-event-index="${index}" data-field="day" type="number" min="0" step="0.25" value="${event.day}"></td>
      <td data-label="Volume (mL)"><input aria-label="Dose event ${index + 1} volume in mL" data-type="${type}" data-event-index="${index}" data-field="volumeMl" type="number" min="0" step="1" value="${event.volumeMl}"></td>
      <td data-label="Sites"><input aria-label="Dose event ${index + 1} sites" data-type="${type}" data-event-index="${index}" data-field="sites" type="number" min="1" max="8" step="1" value="${event.sites}"></td>
      <td data-label="Dose">${formatDose(dose)}</td>
      <td data-label="mL/site">${formatNumber(mlPerSite, 1)}</td>
      <td data-label="Action"><button class="icon-button" data-type="${type}" data-event-index="${index}" data-action="remove-event" ${disableRemove} type="button">Remove</button></td>
    </tr>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function simpleGeneratedRegimenName(regimen) {
  if (regimen.events.length !== 1 || Number(regimen.events[0].day) !== 0) return null;
  const totalVolumeMl = Number(regimen.events[0].volumeMl);
  if (!Number.isFinite(totalVolumeMl)) return null;
  return `${doseName(totalVolumeMl)} every ${wholeCycleDays(regimen.cycleLengthDays)} days`;
}

function updateRegimenFromInput(input, { commit = true } = {}) {
  const regimen = input.dataset.type === "reference" ? state.reference : (editingComparator() || activeComparator());
  editedRegimens.add(regimen);
  const field = input.dataset.field;
  const eventIndex = input.dataset.eventIndex;
  const rawValue = input.type === "number" ? Number(input.value) : input.value;
  if (input.type === "number" && !Number.isFinite(rawValue)) return;
  const generatedNameBeforeEdit = simpleGeneratedRegimenName(regimen);
  const shouldRefreshGeneratedName = regimen.name === generatedNameBeforeEdit;
  const value = field === "cycleLengthDays" && commit
    ? wholeCycleDays(rawValue, regimen.cycleLengthDays)
    : rawValue;

  if (field === "cycleLengthDays" && commit) input.value = String(value);

  if (eventIndex === undefined) {
    regimen[field] = value;
    if (field !== "name") regimen.presetId = "custom";
  } else {
    regimen.events[Number(eventIndex)][field] = value;
    regimen.presetId = "custom";
  }

  if (shouldRefreshGeneratedName && ["cycleLengthDays", "volumeMl"].includes(field)) {
    regimen.name = simpleGeneratedRegimenName(regimen) || regimen.name;
  }
}

function addEvent(type) {
  const regimen = type === "reference" ? state.reference : (editingComparator() || activeComparator());
  editedRegimens.add(regimen);
  const cycleEnd = Math.max(0, Number(regimen.cycleLengthDays) - 0.25);
  const latestDay = Math.max(...regimen.events.map((event) => Number(event.day)));
  const nextDay = Math.min(cycleEnd, latestDay + 1);
  regimen.events.push({ day: nextDay, volumeMl: 10, sites: 1 });
  regimen.presetId = "custom";
}

function removeEvent(type, index) {
  const regimen = type === "reference" ? state.reference : (editingComparator() || activeComparator());
  editedRegimens.add(regimen);
  if (regimen.events.length > 1) regimen.events.splice(index, 1);
  regimen.presetId = "custom";
}

function comparatorById(id) {
  return state.comparators.find((comparator) => comparator.id === id);
}

function comparatorIndexById(id) {
  return state.comparators.findIndex((comparator) => comparator.id === id);
}

function moveComparator(id, direction) {
  const index = comparatorIndexById(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.comparators.length) return;
  const [item] = state.comparators.splice(index, 1);
  state.comparators.splice(nextIndex, 0, item);
}

function removeComparator(id) {
  if (state.comparators.length === 1) return;
  const index = comparatorIndexById(id);
  if (index < 0) return;
  state.comparators.splice(index, 1);
  if (state.activeComparatorId === id) {
    const fallback = state.comparators[Math.min(index, state.comparators.length - 1)];
    state.activeComparatorId = fallback.id;
  }
  if (editingComparatorId === id) editingComparatorId = null;
  if (state.switchComparatorId === id) {
    const fallback = state.comparators[Math.min(index, state.comparators.length - 1)];
    state.switchComparatorId = fallback.id;
  }
  if (state.interval.regimenId === id) state.interval.regimenId = "reference";
}

function runSimulation() {
  const activeEditorId = document.activeElement?.closest?.("#referenceEditor, #candidateEditor")?.id || null;
  readSettings();
  state.reference.cycleLengthDays = wholeCycleDays(state.reference.cycleLengthDays, 7);
  state.comparators.forEach((comparator) => {
    comparator.cycleLengthDays = wholeCycleDays(comparator.cycleLengthDays, 7);
  });
  amplitudeSummaryCache = new WeakMap();
  calibrationScenarioCache = null;
  scenarioScaleCache = new Map();
  renderCartridgePicker();
  renderDoseSetupSummary();
  renderSetupSnapshot();
  renderComparatorSelect();
  renderGeneratedPresetControls();
  renderEditingGuidance();
  renderSharePanel();
  if (!state.product.cartridgeSelectionValid) {
    renderBlockedSimulation();
    return;
  }
  const referenceSimRaw = simulateRegimen(state.reference, state.params, state.product);
  const referenceRawStats = computeSteadyWindowStats(referenceSimRaw, state.params.steadyWindowDays);
  const referenceSim = normalizeSimulation(referenceSimRaw, referenceRawStats.average);
  const referenceMetrics = computeRegimenMetrics(state.reference, referenceSimRaw, referenceSim, null, state.product, state.params);

  const comparatorSims = state.comparators.map((comparator) => {
    const raw = simulateRegimen(comparator, state.params, state.product);
    const normalized = normalizeSimulation(raw, referenceRawStats.average);
    const metrics = computeRegimenMetrics(comparator, raw, normalized, referenceMetrics, state.product, state.params);
    return { regimen: comparator, raw, normalized, metrics };
  });

  if (activeEditorId !== "referenceEditor") {
    renderRegimenEditor($("referenceEditor"), state.reference, "reference");
  }
  const comparatorBeingEdited = editingComparator();
  if (comparatorBeingEdited) {
    if (activeEditorId !== "candidateEditor") {
      renderRegimenEditor($("candidateEditor"), comparatorBeingEdited, "candidate");
    }
  } else {
    $("candidateEditor").innerHTML = "";
  }
  renderRegimenCards(comparatorSims);
  renderResults(referenceMetrics, comparatorSims);
  renderAssumptionAudit();
  renderIggScenarioSummary();
  renderAmplitudeEstimate(comparatorSims);
  if (intervalExplorerActive) renderExtendedInterval();
  renderChart(referenceSim, comparatorSims);
  renderSwitchScenario(referenceRawStats.average);
  renderTimeline(state.reference, comparatorSims);
  renderChartMode();
  renderPrintReport();
}

function renderBlockedSimulation() {
  const selectedVolume = selectedCartridgeVolume(state.product.cartridgeInventory);
  const message = `
    <div class="correction-card">
      <strong>Cartridge total needs correction.</strong>
      <p>${escapeHtml(state.product.cartridgeSelectionMessage)}</p>
      <div class="correction-grid">
        <span><b>Target</b>${formatNumber(state.dosing.weeklyDoseMl, 1)} mL</span>
        <span><b>Selected</b>${formatNumber(selectedVolume, 1)} mL</span>
        <span><b>Difference</b>${formatNumber(selectedVolume - state.dosing.weeklyDoseMl, 1)} mL</span>
      </div>
      <button class="secondary" data-action="auto-fill-cartridges" type="button">Auto-fill to target</button>
    </div>
  `;
  $("resultsTable").innerHTML = message;
  $("assumptionAudit").innerHTML = "";
  $("amplitudeSummary").innerHTML = `<div class="analysis-block"><p>${message}</p></div>`;
  $("intervalSummary").innerHTML = `<div class="summary-tile"><strong>Resolve the cartridge total to model an extended interval.</strong></div>`;
  $("intervalCrossings").innerHTML = "";
  $("intervalCheckpoints").innerHTML = "";
  $("timeline").innerHTML = "";
  $("iggScenarioSummary").innerHTML = "";
  renderPrintReport();
  if (exposureChart) {
    exposureChart.destroy();
    exposureChart = null;
  }
  if (switchChart) {
    switchChart.destroy();
    switchChart = null;
  }
}

function generateShareQr(shareUrl) {
  if (typeof qrcode !== "function") {
    $("shareQr").innerHTML = '<span class="qr-fallback">QR unavailable</span>';
    return false;
  }
  const qr = qrcode(0, "M");
  qr.addData(shareUrl);
  qr.make();
  $("shareQr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $("shareQr").dataset.shareUrl = shareUrl;
  return true;
}

function renderSharePanel({ forceQr = false } = {}) {
  if (!$("shareUrl")) return;
  let shareUrl = "";
  let status = "Share link ready.";
  try {
    shareUrl = buildShareUrl();
    const token = readShareTokenFromUrl() || encodeSharePayload(serializeSimulatorState());
    status = `Share link ready · ${token.length} encoded characters.`;
  } catch (error) {
    status = `Could not generate share link: ${error.message}`;
  }

  $("shareUrl").value = shareUrl;
  $("shareStatus").textContent = status;
  if (!shareUrl) return;

  if (shareQrTimer) {
    window.clearTimeout(shareQrTimer);
    shareQrTimer = null;
  }
  const sharePanel = document.querySelector(".share-panel");
  if (!forceQr && sharePanel?.tagName === "DETAILS" && !sharePanel.open) return;
  const hasQr = Boolean($("shareQr").querySelector("svg"));
  if (forceQr || !hasQr) {
    generateShareQr(shareUrl);
    return;
  }
  if ($("shareQr").dataset.shareUrl === shareUrl) return;
  $("shareStatus").textContent = `${status} QR updating...`;
  shareQrTimer = window.setTimeout(() => {
    if ($("shareUrl").value !== shareUrl) return;
    generateShareQr(shareUrl);
    $("shareStatus").textContent = status;
    shareQrTimer = null;
  }, 220);
}

function formatExportDate(date = new Date()) {
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${month}-${date.getDate()}-${date.getFullYear()}`;
}

function formatReportDate(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function printPageFooter(sectionLabel) {
  return `
    <footer class="print-page-footer">
      <span>SCIG Schedule Simulator v${APP_VERSION}</span>
      <a href="${REPOSITORY_URL}">${REPOSITORY_LABEL}</a>
      <span>${escapeHtml(sectionLabel)}</span>
    </footer>
  `;
}

function printRegimenRows() {
  return [
    { role: "Reference", regimen: state.reference },
    ...state.comparators.map((regimen, index) => ({ role: `Comparator ${index + 1}`, regimen })),
  ].map(({ role, regimen }) => {
    const totalVolumeMl = regimen.events.reduce((sum, event) => sum + Number(event.volumeMl), 0);
    const totalDoseG = volumeToGrams(totalVolumeMl, state.product.concentrationGPerMl);
    const events = regimen.events.map((event) => (
      `Day ${formatNumber(event.day, Number.isInteger(Number(event.day)) ? 0 : 1)}: ${formatNumber(Number(event.volumeMl), 1)} mL across ${formatNumber(Number(event.sites), 0)} site${Number(event.sites) === 1 ? "" : "s"}`
    )).join("; ");
    return `
      <tr>
        <td><span class="print-role">${role}</span><strong>${escapeHtml(regimen.name)}</strong></td>
        <td>${formatNumber(regimen.cycleLengthDays, 0)} days</td>
        <td>${formatNumber(totalVolumeMl, 1)} mL<br><small>${formatDose(totalDoseG)}</small></td>
        <td>${escapeHtml(events)}</td>
      </tr>
    `;
  }).join("");
}

function renderPrintCharts() {
  const chartSize = { renderWidth: 1000, renderHeight: 410 };
  const chartPairs = [
    ["amplitudeBandChart", "printAmplitudeBandChart"],
    ["amplitudeSwitchChart", "printAmplitudeSwitchChart"],
    ["intervalChart", "printIntervalChart"],
  ];
  chartPairs.forEach(([sourceId, targetId]) => {
    const config = bandCanvasPrintConfigs.get(sourceId);
    if (!config || !$(targetId)) return;
    const legendOptions = sourceId === "intervalChart"
      ? {}
      : { hideCanvasLegend: false, legendPosition: "top" };
    renderBandCanvas(targetId, config.series, { ...config.options, ...chartSize, ...legendOptions });
  });

  if (exposurePrintConfig && $("printExposureChart")) {
    renderCanvasFallbackFor(
      "printExposureChart",
      exposurePrintConfig.datasets,
      exposurePrintConfig.minX,
      exposurePrintConfig.maxX,
      exposurePrintConfig.yAxisLabel,
      { ...chartSize, xAxisLabel: exposurePrintConfig.xAxisLabel, hideLegend: false },
    );
  }
  if (switchPrintConfig && $("printSwitchChart")) {
    renderCanvasFallbackFor(
      "printSwitchChart",
      switchPrintConfig.datasets,
      switchPrintConfig.minX,
      switchPrintConfig.maxX,
      switchPrintConfig.yAxisLabel,
      { ...chartSize, xAxisLabel: switchPrintConfig.xAxisLabel, hideLegend: false },
    );
  }
}

function renderPrintReport({ includeCharts = false } = {}) {
  if (!$("printReportSummary")) return;
  const shareUrl = $("shareUrl")?.value || buildShareUrl();
  const qrMarkup = $("shareQr")?.innerHTML || "";
  const scenario = iggScenarioPresets[state.calibration.mode] || iggScenarioPresets.replacement;
  const reportDate = formatReportDate();
  $("printReportSummary").innerHTML = `
    <section class="print-page print-overview-page">
      <header class="print-report-heading">
        <div>
          <p class="print-kicker">Schedule comparison report</p>
          <h1>SCIG Schedule Simulator</h1>
          <p class="print-subtitle">Modeled IgG patterns, relative exposure, infusion burden, and an extended dose interval.</p>
        </div>
        <div class="print-date"><span>Generated</span><strong>${reportDate}</strong></div>
      </header>
      <div class="print-report-grid">
        <div><span>Patient profile</span><strong>${escapeHtml(scenario.label)}</strong><small>${formatNumber(state.calibration.bodyWeightKg, 0)} kg model patient</small></div>
        <div><span>Product</span><strong>${escapeHtml(state.product.name)}</strong><small>${formatNumber(state.product.concentrationGPerMl, 2)} g/mL · ${escapeHtml(state.product.cartridgeInventoryText || "no cartridges")}</small></div>
        <div><span>Reference dose</span><strong>${formatDose(state.dosing.weeklyDoseG)} / ${formatNumber(state.dosing.weeklyDoseMl, 1)} mL</strong><small>${formatNumber(state.dosing.exactProtocolDoseGKgWeek, 3)} g/kg/week after product rounding</small></div>
        <div><span>Model horizon</span><strong>${formatNumber(state.params.simulationHorizonDays, 0)} days</strong><small>Absorption ${formatNumber(state.params.absorptionHalfTimeDays, 1)} d · elimination ${formatNumber(state.params.eliminationHalfLifeDays, 0)} d</small></div>
      </div>
      <div class="print-section-heading">
        <div><span>Schedules</span><h2>Reference and comparators</h2></div>
        <p>Each comparator is evaluated against the reference schedule.</p>
      </div>
      <table class="print-schedule-table">
        <thead><tr><th>Schedule</th><th>Cycle</th><th>Dose per cycle</th><th>Dose events</th></tr></thead>
        <tbody>${printRegimenRows()}</tbody>
      </table>
      <div class="print-assumption-strip">
        <div><span>IgG baseline</span><strong>${formatMgDl(state.calibration.baselinePreScigIggMgDl)}</strong></div>
        <div><span>Lab orientation range</span><strong>${formatMgDl(state.calibration.labReferenceLowMgDl)}–${formatMgDl(state.calibration.labReferenceHighMgDl)}</strong></div>
        <div><span>High-value warning</span><strong>${formatMgDl(state.calibration.highIggWarningThresholdMgDl)}</strong></div>
      </div>
      <aside class="print-disclaimer"><strong>Comparative model only.</strong> This report is not an individualized IgG prediction or dose recommendation. Model profiles, reference lines, and uncertainty bands are editable assumptions.</aside>
      ${printPageFooter("Overview")}
    </section>

    <section class="print-page print-results-page">
      <div class="print-section-heading print-page-heading">
        <div><span>Results</span><h2>Schedule metrics</h2></div>
        <p>Feasibility, infusion burden, and normalized model outputs.</p>
      </div>
      <div class="print-results-table">${$("resultsTable")?.innerHTML || ""}</div>
      ${printPageFooter("Results")}
    </section>

    <section class="print-page print-chart-page">
      <div class="print-section-heading print-page-heading">
        <div><span>Estimated IgG</span><h2>Modeled IgG bands</h2></div>
        <p>Shaded regions reflect the editable uncertainty range.</p>
      </div>
      <figure class="print-figure">
        <figcaption><strong>Estimated IgG bands by schedule</strong><span>Final 42 days of each schedule.</span></figcaption>
        <canvas id="printAmplitudeBandChart" role="img" aria-label="Printable estimated IgG bands by schedule"></canvas>
      </figure>
      <figure class="print-figure">
        <figcaption><strong>Estimated IgG bands after switch</strong><span>Reference schedule before day 0, then each comparator begins.</span></figcaption>
        <canvas id="printAmplitudeSwitchChart" role="img" aria-label="Printable estimated IgG bands after switching"></canvas>
      </figure>
      <p class="print-chart-note">Dotted lines are the selected lab reference range for orientation; vertical markers are modeled dose events.</p>
      ${printPageFooter("Estimated IgG")}
    </section>

    <section class="print-page print-chart-page">
      <div class="print-section-heading print-page-heading">
        <div><span>Relative exposure</span><h2>Normalized schedule comparisons</h2></div>
        <p>Values are relative to the reference average, not measured serum concentrations.</p>
      </div>
      <figure class="print-figure">
        <figcaption><strong>Relative exposure across the simulation</strong><span>Includes model ramp-up from the zero-start assumption.</span></figcaption>
        <canvas id="printExposureChart" role="img" aria-label="Printable relative exposure graph"></canvas>
      </figure>
      <figure class="print-figure">
        <figcaption><strong>Relative exposure after switch</strong><span>Continue the reference or switch to ${escapeHtml(switchComparator().name)} at day 0.</span></figcaption>
        <canvas id="printSwitchChart" role="img" aria-label="Printable relative exposure after switch graph"></canvas>
      </figure>
      ${printPageFooter("Relative exposure")}
    </section>

    <section class="print-page print-interval-page">
      <div class="print-section-heading print-page-heading">
        <div><span>Extended interval</span><h2>Tail after the final dose</h2></div>
        <p>Models a completed dose followed by no subsequent doses.</p>
      </div>
      <div class="print-interval-summary">${$("intervalSummary")?.innerHTML || ""}</div>
      <figure class="print-figure print-interval-figure">
        <figcaption><strong>${escapeHtml(intervalRegimen().name)}</strong><span>${$("intervalContext")?.innerHTML || ""}</span></figcaption>
        <canvas id="printIntervalChart" role="img" aria-label="Printable extended interval graph"></canvas>
      </figure>
      <div class="print-interval-details">
        <div><h3>Threshold crossings</h3>${$("intervalCrossings")?.innerHTML || ""}</div>
        <div><h3>Common checkpoints</h3>${$("intervalCheckpoints")?.innerHTML || ""}</div>
      </div>
      <div class="print-share-card">
        <div class="print-report-qr">${qrMarkup}</div>
        <div><span>Reopen this setup</span><strong>Scan the QR code or use the embedded PDF link.</strong><a href="${escapeHtml(shareUrl)}">Open this simulator setup</a></div>
      </div>
      <p class="print-chart-note">The curve approaches the editable pre-SCIG baseline rather than zero. Pair the model with observed symptoms and measured labs.</p>
      ${printPageFooter("Extended interval")}
    </section>
  `;
  if (includeCharts) renderPrintCharts();
}

function preparePrintReport() {
  intervalExplorerActive = true;
  renderExtendedInterval();
  renderSharePanel({ forceQr: true });
  renderPrintReport({ includeCharts: true });
  if (originalDocumentTitle === null) originalDocumentTitle = document.title;
  document.title = `SCIG Schedule Simulator - ${formatExportDate()}`;
}

function finishPrintReport() {
  if (originalDocumentTitle !== null) {
    document.title = originalDocumentTitle;
    originalDocumentTitle = null;
  }
}

function renderResults(referenceMetrics, comparatorSims) {
  $("resultsTable").className = "results-table";
  $("resultsTable").innerHTML = metricTable(referenceMetrics, comparatorSims);
}

function renderAssumptionAudit() {
  const scenario = iggScenarioPresets[state.calibration.mode] || iggScenarioPresets.replacement;
  const rows = [
    ["IgG scenario", scenario.label],
    ["Baseline pre-SCIG IgG", formatMgDl(state.calibration.baselinePreScigIggMgDl)],
    ["Dose slope", `${formatNumber(state.calibration.doseSlopeMgDlPer01GKgWeek, 1)} mg/dL per 0.1 g/kg/week`],
    ["Peak-to-trough ratio", formatNumber(state.calibration.peakToTroughRatio, 2)],
    ["Peak timing", `${formatNumber(state.calibration.tmaxDaysAfterWeeklyInfusion, 1)} days after weekly infusion`],
    ["Absorption half-time", `${formatNumber(state.params.absorptionHalfTimeDays, 1)} days`],
    ["Elimination half-life", `${formatNumber(state.params.eliminationHalfLifeDays, 0)} days`],
    ["Uncertainty range", `absorption ${formatNumber(state.calibration.absorptionHalfTimeLowDays, 1)}-${formatNumber(state.calibration.absorptionHalfTimeHighDays, 1)} days; elimination ${formatNumber(state.calibration.eliminationHalfLifeLowDays, 0)}-${formatNumber(state.calibration.eliminationHalfLifeHighDays, 0)} days`],
    ["Product", `${state.product.name}, ${formatNumber(state.product.concentrationGPerMl, 2)} g/mL`],
    ["Cartridges", state.product.cartridgeInventoryText || "none selected"],
  ];
  $("assumptionAudit").innerHTML = rows.map(([label, value]) => `
    <div class="audit-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderChartMode() {
  const availableModes = new Set(Array.from(document.querySelectorAll("[data-chart-mode]")).map((button) => button.dataset.chartMode));
  if (!availableModes.has(state.chartMode)) state.chartMode = "igg";
  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    const active = button.dataset.chartMode === state.chartMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-chart-panel]").forEach((panel) => {
    const active = panel.dataset.chartPanel === state.chartMode;
    panel.classList.toggle("hidden", !active);
    panel.setAttribute("aria-hidden", String(!active));
  });
  window.setTimeout(() => {
    if (exposureChart) exposureChart.resize();
    if (switchChart) switchChart.resize();
  }, 0);
}

function referenceDoseGPerKgPerWeek() {
  const totalG = volumeToGrams(
    state.reference.events.reduce((sum, event) => sum + Number(event.volumeMl), 0),
    state.product.concentrationGPerMl,
  );
  const cycleLength = Math.max(Number(state.reference.cycleLengthDays), 0.1);
  const gPerWeek = totalG / cycleLength * 7;
  const weightKg = Math.max(Number(state.calibration.bodyWeightKg), 1);
  return gPerWeek / weightKg;
}

function expectedTroughMgDl(scenario = state.calibration) {
  return scenario.baselinePreScigIggMgDl
    + scenario.doseSlopeMgDlPer01GKgWeek * (referenceDoseGPerKgPerWeek() / 0.1);
}

function expectedPeakMgDl(scenario = state.calibration) {
  return expectedTroughMgDl(scenario) * scenario.peakToTroughRatio;
}

function renderIggScenarioSummary() {
  const doseGKgWeek = referenceDoseGPerKgPerWeek();
  const trough = expectedTroughMgDl();
  const peak = expectedPeakMgDl();
  const preset = iggScenarioPresets[state.calibration.mode] || iggScenarioPresets.replacement;
  const warning = peak >= state.calibration.highIggWarningThresholdMgDl
    ? ` This scenario is above the high-value review threshold of ${formatMgDl(state.calibration.highIggWarningThresholdMgDl)}.`
    : "";

  $("iggScenarioSummary").innerHTML = `
    <strong>${escapeHtml(preset.label)}.</strong>
    Reference regimen dose intensity is ${formatNumber(doseGKgWeek, 2)} g/kg/week.
    The dose-driven estimate anchors the reference trough near ${formatMgDl(trough)} and the day-${formatNumber(state.calibration.tmaxDaysAfterWeeklyInfusion, 1)} peak near ${formatMgDl(peak)}.${warning}
    Lab reference lines are shown for orientation only; they are not a treatment target for someone receiving ScIG.
  `;
}

function renderAmplitudeEstimate(comparatorSims) {
  const rows = [
    { label: "Reference", regimen: state.reference },
    ...comparatorSims.map((sim, index) => ({ label: `Comparator ${index + 1}`, regimen: sim.regimen })),
  ].map((row) => ({
    ...row,
    summary: labAnchoredAmplitudeSummary(row.regimen),
  }));
  const waning = labAnchoredWaningSummary(state.reference);
  const scenarioSamples = calibrationScenarios();
  const troughBand = minMax(scenarioSamples.map((scenario) => expectedTroughMgDl(scenario)));
  const peakBand = minMax(scenarioSamples.map((scenario) => scenarioCalibrationPeakMgDl(scenario)));
  const treatmentBand = minMax(scenarioSamples.map((scenario) => scenarioCalibrationPeakMgDl(scenario) - scenario.baselinePreScigIggMgDl));

  $("amplitudeSummary").innerHTML = `
    <div class="analysis-block">
      <h3>Scenario anchor</h3>
      <p>
        The model scales the reference regimen so its modeled exogenous exposure at ${formatDays(state.calibration.tmaxDaysAfterWeeklyInfusion)}
        after the reference cycle's first infusion matches the selected scenario. The reference trough anchor is
        ${formatRange(troughBand.min, troughBand.max, formatMgDl)}, the peak anchor is ${formatRange(peakBand.min, peakBand.max, formatMgDl)},
        and the treatment-derived peak contribution is ${formatRange(treatmentBand.min, treatmentBand.max, formatMgDl)}.
      </p>
    </div>
    <div class="analysis-block">
      <h3>Estimated steady peak-trough swing</h3>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Regimen</th>
            <th>Average IgG<br><span class="unit-label">mg/dL</span></th>
            <th>Peak<br><span class="unit-label">mg/dL</span></th>
            <th>Trough<br><span class="unit-label">mg/dL</span></th>
            <th>Peak-trough swing<br><span class="unit-label">mg/dL</span></th>
            <th>Swing / average<br><span class="unit-label">%</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => amplitudeRow(row)).join("")}
        </tbody>
      </table>
    </div>
    <div class="analysis-block">
      <h3>Reference schedule waning if the next dose is delayed</h3>
      <p>
        This holds future doses after the reference infusion and estimates how far the modeled IgG level may fall by selected days after that infusion.
      </p>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Day after infusion<br><span class="unit-label">days</span></th>
            <th>Estimated IgG<br><span class="unit-label">mg/dL</span></th>
            <th>Drop from calibration day<br><span class="unit-label">mg/dL</span></th>
            <th>Drop from calibration day<br><span class="unit-label">%</span></th>
          </tr>
        </thead>
        <tbody>
          ${waning.map((row) => `
            <tr>
              <td>${formatNumber(row.day, Number.isInteger(row.day) ? 0 : 1)}</td>
              <td>${formatRange(row.total.min, row.total.max, formatInteger)}</td>
              <td>${formatRange(row.drop.min, row.drop.max, formatInteger)}</td>
              <td>${formatRange(row.dropPercent.min, row.dropPercent.max, (value) => formatNumber(value, 1))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  renderAmplitudeBandChart([
    { label: `Reference: ${state.reference.name}`, regimen: state.reference },
    ...comparatorSims.map((sim, index) => ({ label: `Comparator ${index + 1}: ${sim.regimen.name}`, regimen: sim.regimen })),
  ]);
  renderAmplitudeSwitchBandChart(comparatorSims);
}

function amplitudeRow(row) {
  const summary = row.summary;
  if (!summary.valid) {
    return `
      <tr>
        <td>${escapeHtml(row.label)}: ${escapeHtml(row.regimen.name)}</td>
        <td colspan="5">Unable to calibrate with the current lab/baseline settings.</td>
      </tr>
    `;
  }
  return `
      <tr>
        <td>${escapeHtml(row.label)}: ${escapeHtml(row.regimen.name)}</td>
      <td>${formatRange(summary.average.min, summary.average.max, formatInteger)}</td>
      <td>${formatRange(summary.peak.min, summary.peak.max, formatInteger)}</td>
      <td>${formatRange(summary.trough.min, summary.trough.max, formatInteger)}</td>
      <td>${formatRange(summary.amplitude.min, summary.amplitude.max, formatInteger)}</td>
      <td>${formatRange(summary.amplitudePercent.min, summary.amplitudePercent.max, (value) => formatNumber(value, 1))}</td>
    </tr>
  `;
}

function labAnchoredAmplitudeSummary(regimen) {
  if (amplitudeSummaryCache.has(regimen)) return amplitudeSummaryCache.get(regimen);
  const samples = calibrationScenarios().map((scenario) => {
    const scale = scenarioScale(scenario);
    if (!Number.isFinite(scale)) return null;
    const scenarioParams = { ...state.params, absorptionHalfTimeDays: scenario.absorptionHalfTimeDays, eliminationHalfLifeDays: scenario.eliminationHalfLifeDays };
    const raw = simulateRegimen(regimen, scenarioParams, state.product);
    const stats = computeSteadyWindowStats(raw, state.params.steadyWindowDays);
    const peak = scenario.baselinePreScigIggMgDl + scale * stats.peak;
    const trough = scenario.baselinePreScigIggMgDl + scale * stats.trough;
    const average = scenario.baselinePreScigIggMgDl + scale * stats.average;
    const amplitude = peak - trough;
    return {
      average,
      peak,
      trough,
      amplitude,
      amplitudePercent: average > 0 ? amplitude / average * 100 : null,
    };
  }).filter(Boolean);

  const summary = summarizeSampleObjects(samples, ["average", "peak", "trough", "amplitude", "amplitudePercent"]);
  amplitudeSummaryCache.set(regimen, summary);
  return summary;
}

function labAnchoredWaningSummary(referenceRegimen) {
  const firstEventDay = firstReferenceEventDay(referenceRegimen);
  const requestedDays = uniqueSortedNumbers([
    state.calibration.tmaxDaysAfterWeeklyInfusion,
    Number(referenceRegimen.cycleLengthDays),
    9,
    14,
  ].filter((day) => day >= state.calibration.tmaxDaysAfterWeeklyInfusion));

  const rows = requestedDays.map((day) => ({ day, total: [], drop: [], dropPercent: [] }));
  calibrationScenarios().forEach((scenario) => {
    const scale = scenarioScale(scenario);
    if (!Number.isFinite(scale)) return;
    const ka = Math.log(2) / scenario.absorptionHalfTimeDays;
    const ke = Math.log(2) / scenario.eliminationHalfLifeDays;
    const calibrationHistoryDays = calibrationAbsoluteDay(referenceRegimen, state.calibration.tmaxDaysAfterWeeklyInfusion);
    const events = expandRelativeEvents(
      referenceRegimen,
      -Math.max(30, calibrationHistoryDays),
      firstEventDay,
      state.product.concentrationGPerMl,
    );
    const rawPoints = simulateRawFromAbsoluteEvents(events, Math.max(...requestedDays), state.params.timestepDays, ka, ke);
    const anchorExposure = valueAtDay(rawPoints, state.calibration.tmaxDaysAfterWeeklyInfusion);
    const anchorTotal = scenario.baselinePreScigIggMgDl + scale * anchorExposure;

    rows.forEach((row) => {
      const exposure = valueAtDay(rawPoints, row.day);
      const total = scenario.baselinePreScigIggMgDl + scale * exposure;
      const drop = Math.max(0, anchorTotal - total);
      row.total.push(total);
      row.drop.push(drop);
      row.dropPercent.push(anchorTotal > 0 ? drop / anchorTotal * 100 : 0);
    });
  });

  return rows.map((row) => ({
    day: row.day,
    total: minMax(row.total),
    drop: minMax(row.drop),
    dropPercent: minMax(row.dropPercent),
  }));
}

function renderAmplitudeBandChart(rows) {
  const startDay = Math.max(0, state.params.simulationHorizonDays - 42);
  const series = rows.map((row, index) => ({
    label: row.label,
    color: amplitudeSeriesColors[index % amplitudeSeriesColors.length],
    bands: labAnchoredRegimenBand(row.regimen, startDay, state.params.simulationHorizonDays, startDay),
    markers: regimenDoseMarkers(row.regimen, startDay, state.params.simulationHorizonDays, startDay),
  })).filter((row) => row.bands.length);

  $("amplitudeBandSeriesLegend").innerHTML = series.map((item) => `
    <span><b style="--series-color: ${item.color}"></b>${escapeHtml(item.label)}</span>
  `).join("");

  renderBandCanvas("amplitudeBandChart", series, {
    xLabel: "Days within final 42-day window",
    yLabel: "Estimated IgG (mg/dL)",
    minX: 0,
    maxX: state.params.simulationHorizonDays - startDay,
    hideCanvasLegend: true,
  });
}

function renderAmplitudeSwitchBandChart(comparatorSims) {
  const horizon = state.params.switchHorizonDays;
  const series = comparatorSims.map((sim, index) => ({
    label: `Comparator ${index + 1}: ${sim.regimen.name}`,
    color: amplitudeSeriesColors[(index + 1) % amplitudeSeriesColors.length],
    bands: labAnchoredSwitchBand(sim.regimen, horizon),
    markers: regimenDoseMarkers(sim.regimen, 0, horizon, 0),
  })).filter((row) => row.bands.length);

  $("amplitudeSwitchSeriesLegend").innerHTML = series.map((item) => `
    <span><b style="--series-color: ${item.color}"></b>${escapeHtml(item.label)}</span>
  `).join("");

  renderBandCanvas("amplitudeSwitchChart", series, {
    xLabel: "Days after switch",
    yLabel: "Estimated IgG (mg/dL)",
    minX: 0,
    maxX: horizon,
    hideCanvasLegend: true,
  });
}

function labAnchoredRegimenBand(regimen, startDay, endDay, xOffset) {
  const byDay = new Map();
  calibrationScenarios().forEach((scenario) => {
    const scale = scenarioScale(scenario);
    if (!Number.isFinite(scale)) return;
    const scenarioParams = { ...state.params, absorptionHalfTimeDays: scenario.absorptionHalfTimeDays, eliminationHalfLifeDays: scenario.eliminationHalfLifeDays };
    const raw = simulateRegimen(regimen, scenarioParams, state.product);
    raw.points
      .filter((point) => point.day >= startDay && point.day <= endDay)
      .forEach((point) => {
        const key = point.day.toFixed(4);
        const total = scenario.baselinePreScigIggMgDl + scale * point.exposure;
        byDay.set(key, [...(byDay.get(key) || []), total]);
      });
  });

  return [...byDay.entries()]
    .map(([day, values]) => ({
      x: Number(day) - xOffset,
      min: Math.min(...values),
      max: Math.max(...values),
      mid: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .sort((a, b) => a.x - b.x);
}

function labAnchoredSwitchBand(comparator, horizon) {
  const byDay = new Map();
  calibrationScenarios().forEach((scenario) => {
    const scale = scenarioScale(scenario);
    if (!Number.isFinite(scale)) return;
    const ka = Math.log(2) / scenario.absorptionHalfTimeDays;
    const ke = Math.log(2) / scenario.eliminationHalfLifeDays;
    const pastReferenceEvents = expandRelativeEvents(
      state.reference,
      -Math.max(30, state.params.switchPreconditionDays),
      -state.params.timestepDays,
      state.product.concentrationGPerMl,
    );
    const futureComparatorEvents = expandRelativeEvents(comparator, 0, horizon, state.product.concentrationGPerMl);
    const events = [...pastReferenceEvents, ...futureComparatorEvents].sort((a, b) => a.absoluteDay - b.absoluteDay);
    simulateRawFromAbsoluteEvents(events, horizon, state.params.timestepDays, ka, ke).forEach((point) => {
      const key = point.day.toFixed(4);
      const total = scenario.baselinePreScigIggMgDl + scale * point.exposure;
      byDay.set(key, [...(byDay.get(key) || []), total]);
    });
  });

  return [...byDay.entries()]
    .map(([day, values]) => ({
      x: Number(day),
      min: Math.min(...values),
      max: Math.max(...values),
      mid: values.reduce((sum, value) => sum + value, 0) / values.length,
    }))
    .sort((a, b) => a.x - b.x);
}

function regimenAnchoredAtLastDose(regimen) {
  const firstEventDay = Math.min(...regimen.events.map((event) => Number(event.day)));
  return {
    ...regimen,
    events: regimen.events.map((event) => ({ ...event, day: Number(event.day) - firstEventDay })),
  };
}

function intervalCalibrationScenarios() {
  return calibrationScenarios();
}

function intervalScenarioCurves(regimen, horizonDays) {
  const anchored = regimenAnchoredAtLastDose(regimen);
  return intervalCalibrationScenarios().map((scenario) => {
    const scale = scenarioScale(scenario);
    if (!Number.isFinite(scale)) return null;
    const ka = Math.log(2) / scenario.absorptionHalfTimeDays;
    const ke = Math.log(2) / scenario.eliminationHalfLifeDays;
    const preconditionDays = Math.max(
      210,
      scenario.eliminationHalfLifeDays * 6,
      Number(anchored.cycleLengthDays) * 10,
    );
    const completedDoseHistory = expandRelativeEvents(
      anchored,
      -preconditionDays,
      0,
      state.product.concentrationGPerMl,
    );
    const points = simulateRawFromAbsoluteEvents(
      completedDoseHistory,
      horizonDays,
      state.params.timestepDays,
      ka,
      ke,
    ).map((point) => ({
      day: point.day,
      value: scenario.baselinePreScigIggMgDl + scale * point.exposure,
    }));
    return { scenario, points };
  }).filter(Boolean);
}

function intervalBandFromCurves(curves) {
  if (!curves.length) return [];
  return curves[0].points.map((point, index) => {
    const values = curves.map((curve) => curve.points[index].value).filter(Number.isFinite);
    return {
      x: point.day,
      min: Math.min(...values),
      max: Math.max(...values),
      mid: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  });
}

function firstWaningCrossing(points, threshold) {
  if (!points.length || !Number.isFinite(threshold)) return { kind: "unavailable", day: null };
  let peakIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].value > points[peakIndex].value) peakIndex = index;
  }
  if (points[peakIndex].value < threshold) return { kind: "never-above", day: null };
  for (let index = peakIndex + 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.value >= threshold && current.value < threshold) {
      const fraction = (previous.value - threshold) / Math.max(previous.value - current.value, 1e-9);
      return { kind: "crosses", day: previous.day + fraction * (current.day - previous.day) };
    }
  }
  return { kind: "after-horizon", day: null };
}

function intervalCrossingSummary(curves, threshold, horizonDays) {
  const results = curves.map((curve) => firstWaningCrossing(curve.points, threshold));
  const crossingDays = results.filter((result) => result.kind === "crosses").map((result) => result.day);
  const neverAboveCount = results.filter((result) => result.kind === "never-above").length;
  const afterHorizonCount = results.filter((result) => result.kind === "after-horizon").length;
  if (!crossingDays.length && neverAboveCount === results.length) {
    return { display: "Not above", note: "Below this threshold throughout the post-dose view" };
  }
  if (!crossingDays.length && afterHorizonCount === results.length) {
    return { display: `After day ${formatNumber(horizonDays, 0)}`, note: "Still above at the end of this view" };
  }
  if (!crossingDays.length) {
    return { display: "Model-dependent", note: "Assumptions disagree on whether a crossing occurs" };
  }
  const range = minMax(crossingDays);
  const display = Math.abs(range.max - range.min) < 0.5
    ? `Day ${formatNumber((range.min + range.max) / 2, 0)}`
    : `Day ${formatNumber(range.min, 0)}-${formatNumber(range.max, 0)}`;
  const exceptions = [];
  if (neverAboveCount) exceptions.push(`${neverAboveCount} never above`);
  if (afterHorizonCount) exceptions.push(`${afterHorizonCount} remain above`);
  return {
    display,
    note: exceptions.length
      ? `${crossingDays.length}/${results.length} assumptions cross; ${exceptions.join(", ")}`
      : "Earliest-latest across uncertainty assumptions",
  };
}

function intervalBandAtDay(band, day) {
  return band.reduce((closest, point) => (
    Math.abs(point.x - day) < Math.abs(closest.x - day) ? point : closest
  ), band[0]);
}

function nextScheduledDoseDay(regimen) {
  const anchored = regimenAnchoredAtLastDose(regimen);
  const events = expandRelativeEvents(
    anchored,
    state.params.timestepDays,
    Math.max(Number(anchored.cycleLengthDays) * 2, 2),
    state.product.concentrationGPerMl,
  );
  return events.length ? events[0].absoluteDay : Number(anchored.cycleLengthDays);
}

function renderExtendedInterval() {
  const regimen = intervalRegimen();
  const horizonDays = Math.max(30, Number(state.interval.horizonDays));
  const checkpointDay = Math.min(horizonDays, Math.max(0, Number(state.interval.checkpointDay)));
  const curves = intervalScenarioCurves(regimen, horizonDays);
  const band = intervalBandFromCurves(curves);
  if (!band.length) {
    $("intervalSummary").innerHTML = '<div class="summary-tile"><strong>Unable to model this interval</strong></div>';
    $("intervalCrossings").innerHTML = "";
    $("intervalCheckpoints").innerHTML = "";
    return;
  }

  const checkpoint = intervalBandAtDay(band, checkpointDay);
  const peakPoints = curves.map((curve) => curve.points.reduce((peak, point) => point.value > peak.value ? point : peak, curve.points[0]));
  const peakValues = minMax(peakPoints.map((point) => point.value));
  const peakDays = minMax(peakPoints.map((point) => point.day));
  const endogenousFloor = minMax(curves.map((curve) => curve.scenario.baselinePreScigIggMgDl));
  const nextDoseDay = nextScheduledDoseDay(regimen);
  const delayDays = checkpointDay - nextDoseDay;

  $("intervalSummary").innerHTML = `
    <div class="summary-tile featured">
      <span>Still no dose on day ${formatNumber(checkpointDay, 0)}</span>
      <strong>${formatRange(checkpoint.min, checkpoint.max, formatInteger)} mg/dL</strong>
    </div>
    <div class="summary-tile">
      <span>Post-dose peak</span>
      <strong>${formatRange(peakValues.min, peakValues.max, formatInteger)} mg/dL</strong>
      <small>around day ${formatRange(peakDays.min, peakDays.max, (value) => formatNumber(value, 0))}</small>
    </div>
    <div class="summary-tile">
      <span>Endogenous floor</span>
      <strong>${formatRange(endogenousFloor.min, endogenousFloor.max, formatInteger)} mg/dL</strong>
      <small>the tail approaches this band, not zero</small>
    </div>
  `;

  $("intervalContext").innerHTML = `
    The usual next event is around <strong>day ${formatNumber(nextDoseDay, 1)}</strong>.
    Day ${formatNumber(checkpointDay, 0)} is ${delayDays >= 0
      ? `<strong>${formatNumber(delayDays, 1)} days beyond</strong> that event`
      : `<strong>${formatNumber(Math.abs(delayDays), 1)} days before</strong> that event`}.
    The chart assumes every subsequent event remains withheld.
  `;

  document.querySelectorAll("[data-interval-day]").forEach((button) => {
    const selected = Number(button.dataset.intervalDay) === Number(state.interval.checkpointDay);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  const thresholds = [
    { label: "High-value warning", value: Number(state.calibration.highIggWarningThresholdMgDl) },
    { label: "Tracking high", value: Number(state.interval.upperThresholdMgDl) },
    { label: "Tracking low", value: Number(state.interval.lowerThresholdMgDl) },
  ];
  $("intervalCrossings").innerHTML = `
    <table class="interval-table">
      <thead><tr><th>Threshold</th><th>Downward crossing</th></tr></thead>
      <tbody>${thresholds.map((threshold) => {
        const summary = intervalCrossingSummary(curves, threshold.value, horizonDays);
        return `<tr>
          <td><strong>${escapeHtml(threshold.label)}</strong><small>${formatMgDl(threshold.value)}</small></td>
          <td><strong>${summary.display}</strong><small>${escapeHtml(summary.note)}</small></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  `;

  const checkpointDays = [7, 14, 21, 28].filter((day) => day <= horizonDays);
  $("intervalCheckpoints").innerHTML = `
    <table class="interval-table">
      <thead><tr><th>Still holding at</th><th>Modeled band</th></tr></thead>
      <tbody>${checkpointDays.map((day) => {
        const point = intervalBandAtDay(band, day);
        return `<tr class="${day === checkpointDay ? "selected" : ""}">
          <td><strong>Day ${day}</strong><small>${day >= nextDoseDay ? `${formatNumber(day - nextDoseDay, 1)} days past usual event` : "before usual event"}</small></td>
          <td><strong>${formatRange(point.min, point.max, formatInteger)} mg/dL</strong><small>uncertainty band</small></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  `;

  renderBandCanvas("intervalChart", [{
    label: "No subsequent doses",
    color: "#0f7f82",
    bands: band,
    markers: [{ x: 0, label: "last dose" }],
  }], {
    xLabel: "Days since the final dose",
    yLabel: "Estimated IgG (mg/dL)",
    minX: 0,
    maxX: horizonDays,
    checkpointDay,
    zeroBaseline: false,
    referenceLines: [
      { value: Number(state.interval.upperThresholdMgDl), label: "tracking high", color: "#b4692f" },
      { value: Number(state.interval.lowerThresholdMgDl), label: "tracking low", color: "#3266a8" },
    ],
  });
}

function regimenDoseMarkers(regimen, startDay, endDay, xOffset) {
  const markers = [];
  const cycleLength = Math.max(Number(regimen.cycleLengthDays), 0.1);
  const firstCycle = Math.floor(startDay / cycleLength) - 1;
  const lastCycle = Math.ceil(endDay / cycleLength) + 1;
  for (let cycleIndex = firstCycle; cycleIndex <= lastCycle; cycleIndex += 1) {
    const cycleStart = cycleIndex * cycleLength;
    regimen.events.forEach((event) => {
      const day = cycleStart + Number(event.day);
      if (day >= startDay && day <= endDay) {
        markers.push({
          x: day - xOffset,
          label: `${formatNumber(volumeToGrams(Number(event.volumeMl), state.product.concentrationGPerMl), 0)} g`,
        });
      }
    });
  }
  return markers.sort((a, b) => a.x - b.x);
}

function renderBandCanvas(canvasId, series, options) {
  const targetCanvas = $(canvasId);
  if (!targetCanvas) return;
  if (!canvasId.startsWith("print")) bandCanvasPrintConfigs.set(canvasId, { series, options });
  const rect = targetCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(options.renderWidth || rect.width || targetCanvas.clientWidth || 700));
  const height = Math.max(320, Math.floor(options.renderHeight || rect.height || targetCanvas.clientHeight || 360));
  const ratio = window.devicePixelRatio || 1;
  targetCanvas.width = width * ratio;
  targetCanvas.height = height * ratio;
  targetCanvas.style.width = canvasId.startsWith("print") ? "100%" : `${width}px`;
  targetCanvas.style.height = canvasId.startsWith("print") ? "auto" : `${height}px`;

  const ctx = targetCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const topLegend = options.legendPosition === "top" && !options.hideCanvasLegend;
  const margin = { top: topLegend ? 54 : 24, right: 24, bottom: 58, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = series.flatMap((item) => item.bands.flatMap((point) => [point.min, point.max]));
  if (!allValues.length) {
    ctx.fillStyle = "#675f74";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("Not enough calibration data to draw this graph.", margin.left, margin.top + 20);
    return;
  }

  const visibleReferenceValues = (options.referenceLines || [])
    .map((line) => Number(line.value))
    .filter(Number.isFinite);
  const scaleValues = [...allValues, ...visibleReferenceValues];
  const rawMinY = Math.min(...scaleValues);
  const rawMaxY = Math.max(...scaleValues);
  const padY = Math.max(50, (rawMaxY - rawMinY) * 0.12);
  const minY = options.zeroBaseline === false
    ? Math.max(0, Math.floor((rawMinY - padY) / 100) * 100)
    : 0;
  const maxY = Math.ceil((rawMaxY + padY) / 100) * 100;
  const xScale = (x) => margin.left + ((x - options.minX) / Math.max(1, options.maxX - options.minX)) * plotWidth;
  const yScale = (y) => margin.top + (1 - (y - minY) / Math.max(1, maxY - minY)) * plotHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ddd7e8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotHeight);
  ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#675f74";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const yValue = minY + (maxY - minY) * tick / 4;
    const y = yScale(yValue);
    ctx.strokeStyle = "#eeeaf5";
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.fillStyle = "#675f74";
    ctx.fillText(formatNumber(yValue, 0), margin.left - 8, y);
  }

  drawReferenceLines(
    ctx,
    yScale,
    margin,
    plotWidth,
    minY,
    maxY,
    options.referenceLines || [
      { value: state.calibration.labReferenceLowMgDl, label: "lab ref low" },
      { value: state.calibration.labReferenceHighMgDl, label: "lab ref high" },
    ],
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let tick = 0; tick <= 4; tick += 1) {
    const xValue = options.minX + (options.maxX - options.minX) * tick / 4;
    ctx.fillText(formatNumber(xValue, 0), xScale(xValue), margin.top + plotHeight + 12);
  }

  series.forEach((item) => {
    drawBand(ctx, item.bands, item.color, xScale, yScale);
    drawDoseMarkers(ctx, item.markers, item.color, xScale, margin.top, plotHeight);
  });

  if (Number.isFinite(options.checkpointDay)) {
    drawCheckpointLine(ctx, options.checkpointDay, xScale, margin.top, plotHeight);
  }

  if (!options.hideCanvasLegend) {
    drawLegend(ctx, series, margin.left, topLegend ? 18 : height - 22, width - margin.left - margin.right);
  }

  ctx.save();
  ctx.translate(18, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#675f74";
  ctx.textAlign = "center";
  ctx.fillText(options.yLabel, 0, 0);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#675f74";
  ctx.fillText(options.xLabel, margin.left + plotWidth / 2, height - 6);
}

function drawReferenceLines(ctx, yScale, margin, plotWidth, minY, maxY, lines) {
  lines.forEach((line) => {
    if (!Number.isFinite(line.value) || line.value < minY || line.value > maxY) return;
    const y = yScale(line.value);
    ctx.save();
    ctx.strokeStyle = line.color || "#8d8798";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = line.color || "#675f74";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${line.label} ${formatNumber(line.value, 0)}`, margin.left + 6, y - 3);
  });
}

function drawCheckpointLine(ctx, day, xScale, top, plotHeight) {
  const x = xScale(day);
  ctx.save();
  ctx.strokeStyle = "#164f51";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + plotHeight);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#164f51";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`day ${formatNumber(day, 0)}`, x, top + 5);
  ctx.restore();
}

function drawBand(ctx, points, color, xScale, yScale) {
  if (!points.length) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xScale(point.x);
    const y = yScale(point.max);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  [...points].reverse().forEach((point) => {
    ctx.lineTo(xScale(point.x), yScale(point.min));
  });
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xScale(point.x);
    const y = yScale(point.mid);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawDoseMarkers(ctx, markers, color, xScale, top, plotHeight) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.26;
  ctx.setLineDash([3, 5]);
  markers.forEach((marker) => {
    const x = xScale(marker.x);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
  });
  ctx.restore();
}

function drawLegend(ctx, series, x, y, maxWidth = Infinity) {
  let legendX = x;
  let legendY = y;
  ctx.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  series.forEach((item) => {
    const itemWidth = 46 + ctx.measureText(item.label).width;
    if (legendX + itemWidth > x + maxWidth && legendX > x) {
      legendX = x;
      legendY += 19;
    }
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY);
    ctx.lineTo(legendX + 22, legendY);
    ctx.stroke();
    ctx.fillStyle = "#211a2e";
    ctx.fillText(item.label, legendX + 28, legendY);
    legendX += itemWidth + 14;
  });
}

function scenarioCalibrationPeakMgDl(scenario) {
  return expectedTroughMgDl(scenario) * scenario.peakToTroughRatio;
}

function scenarioScale(scenario) {
  const cacheKey = [
    scenario.baselinePreScigIggMgDl,
    scenario.doseSlopeMgDlPer01GKgWeek,
    scenario.absorptionHalfTimeDays,
    scenario.eliminationHalfLifeDays,
    scenario.peakToTroughRatio,
    state.calibration.mode,
  ].map((value) => String(value)).join("|");
  if (scenarioScaleCache.has(cacheKey)) return scenarioScaleCache.get(cacheKey);

  const treatmentDerived = scenarioCalibrationPeakMgDl(scenario) - scenario.baselinePreScigIggMgDl;
  if (treatmentDerived <= 0) {
    scenarioScaleCache.set(cacheKey, null);
    return null;
  }
  const scenarioParams = { ...state.params, absorptionHalfTimeDays: scenario.absorptionHalfTimeDays, eliminationHalfLifeDays: scenario.eliminationHalfLifeDays };
  const referenceRaw = simulateRegimen(state.reference, scenarioParams, state.product);
  const calibrationDay = calibrationAbsoluteDay(state.reference, state.calibration.tmaxDaysAfterWeeklyInfusion);
  const exposureAtLab = valueAtDay(referenceRaw.points, calibrationDay);
  const scale = exposureAtLab > 0 ? treatmentDerived / exposureAtLab : null;
  scenarioScaleCache.set(cacheKey, scale);
  return scale;
}

function calibrationAbsoluteDay(regimen, daysAfterInfusion) {
  const cycleLength = Math.max(Number(regimen.cycleLengthDays), 0.1);
  const eventDay = firstReferenceEventDay(regimen);
  const latestCycleStart = Math.floor((state.params.simulationHorizonDays - eventDay - daysAfterInfusion) / cycleLength) * cycleLength;
  return Math.max(0, latestCycleStart + eventDay + daysAfterInfusion);
}

function firstReferenceEventDay(regimen) {
  return Math.min(...regimen.events.map((event) => Number(event.day)));
}

function calibrationScenarios() {
  if (calibrationScenarioCache) return calibrationScenarioCache;
  const baselineCenter = Number(state.calibration.baselinePreScigIggMgDl);
  const baselineSpread = Math.max(0, Number(state.calibration.baselineUncertaintyMgDl));
  const baselineLow = Math.max(0, baselineCenter - baselineSpread);
  const baselineHigh = baselineCenter + baselineSpread;
  const slopeCenter = Math.max(0, Number(state.calibration.doseSlopeMgDlPer01GKgWeek));
  const slopeSpread = slopeCenter * Math.max(0, Number(state.calibration.slopeUncertaintyPercent)) / 100;
  const absorptionLow = Math.min(state.calibration.absorptionHalfTimeLowDays, state.calibration.absorptionHalfTimeHighDays);
  const absorptionHigh = Math.max(state.calibration.absorptionHalfTimeLowDays, state.calibration.absorptionHalfTimeHighDays);
  const eliminationLow = Math.min(state.calibration.eliminationHalfLifeLowDays, state.calibration.eliminationHalfLifeHighDays);
  const eliminationHigh = Math.max(state.calibration.eliminationHalfLifeLowDays, state.calibration.eliminationHalfLifeHighDays);

  const baselines = uniqueSortedNumbers([baselineLow, baselineHigh]);
  const slopes = uniqueSortedNumbers([Math.max(0, slopeCenter - slopeSpread), slopeCenter + slopeSpread]);
  const absorptionValues = uniqueSortedNumbers([absorptionLow, absorptionHigh].filter((value) => value > 0));
  const eliminationValues = uniqueSortedNumbers([eliminationLow, eliminationHigh].filter((value) => value > 0));
  const scenarios = [];

  baselines.forEach((baselinePreScigIggMgDl) => {
    slopes.forEach((doseSlopeMgDlPer01GKgWeek) => {
      absorptionValues.forEach((absorptionHalfTimeDays) => {
        eliminationValues.forEach((eliminationHalfLifeDays) => {
          scenarios.push({
            ...state.calibration,
            baselinePreScigIggMgDl,
            doseSlopeMgDlPer01GKgWeek,
            absorptionHalfTimeDays,
            eliminationHalfLifeDays,
          });
        });
      });
    });
  });

  scenarios.push({
    ...state.calibration,
    baselinePreScigIggMgDl: baselineCenter,
    doseSlopeMgDlPer01GKgWeek: slopeCenter,
    absorptionHalfTimeDays: Number(state.params.absorptionHalfTimeDays),
    eliminationHalfLifeDays: Number(state.params.eliminationHalfLifeDays),
  });

  const unique = new Map();
  scenarios.forEach((scenario) => {
    const key = [
      scenario.baselinePreScigIggMgDl,
      scenario.doseSlopeMgDlPer01GKgWeek,
      scenario.absorptionHalfTimeDays,
      scenario.eliminationHalfLifeDays,
    ].map((value) => Number(value).toFixed(4)).join("|");
    unique.set(key, scenario);
  });
  calibrationScenarioCache = [...unique.values()];
  return calibrationScenarioCache;
}

function summarizeSampleObjects(samples, keys) {
  if (!samples.length) return { valid: false };
  const summary = { valid: true };
  keys.forEach((key) => {
    summary[key] = minMax(samples.map((sample) => sample[key]).filter((value) => Number.isFinite(value)));
  });
  return summary;
}

function minMax(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return { min: null, max: null };
  return { min: Math.min(...valid), max: Math.max(...valid) };
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map((value) => Number(value).toFixed(4)))].map(Number).sort((a, b) => a - b);
}

function formatRange(min, max, formatter) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "n/a";
  if (Math.abs(max - min) < 1e-9) return formatter(min);
  return `${formatter(min)}-${formatter(max)}`;
}

function metricTable(referenceMetrics, comparatorSims) {
  const metrics = [
    ["Cycle length (days)", (m) => formatNumber(m.cycleLengthDays, 0)],
    ["Total volume per cycle (mL)", (m) => formatNumber(m.totalMlPerCycle, 0)],
    ["Total dose per cycle (g)", (m) => formatNumber(m.totalGPerCycle, 1)],
    ["Weekly volume equivalent (mL/week)", (m) => formatNumber(m.mlPerWeek, 1)],
    ["Weekly dose equivalent (g/week)", (m) => formatNumber(m.gPerWeek, 1)],
    ["Dose intensity vs reference (%)", (m) => formatNumber(m.percentReferenceDoseIntensity, 2)],
    ["Total sites per cycle", (m) => formatNumber(m.totalSitesPerCycle, 0)],
    ["Sites per 14 days", (m) => formatNumber(m.sitesPer14Days, 2)],
    ["Sites per 28 days", (m) => formatNumber(m.sitesPer28Days, 2)],
    ["Sites per 365 days", (m) => formatNumber(m.sitesPer365Days, 0)],
    ["Infusion days per 28 days", (m) => formatNumber(m.infusionDaysPer28Days, 2)],
    ["Max volume per infusion day (mL)", (m) => formatNumber(m.maxMlPerInfusionDay, 1)],
    ["Max sites per infusion day", (m) => formatNumber(m.maxSitesPerInfusionDay, 0)],
    ["Max volume per site (mL/site)", (m) => formatNumber(m.maxMlPerSite, 1)],
    ["Average volume per site (mL/site)", (m) => formatNumber(m.averageMlPerSite, 1)],
    ["Estimated infusion time", (m) => formatInfusionTimeCell(m)],
    ["Cartridge feasibility", (m) => m.cartridgeFeasible
      ? '<span class="metric-status metric-status-ok" aria-label="Matches available cartridges" title="Matches available cartridges">✓</span>'
      : '<span class="metric-status metric-status-warning" aria-label="Needs unavailable cartridge mix" title="Needs unavailable cartridge mix">!</span>'],
    ["Normalized average exposure (%)", (m) => formatNumber(m.normalizedAverageExposure, 1)],
    ["Normalized peak exposure (%)", (m) => formatNumber(m.normalizedPeakExposure, 1)],
    ["Normalized trough exposure (%)", (m) => formatNumber(m.normalizedTroughExposure, 1)],
    ["Peak-trough range (percentage points)", (m) => formatNumber(m.peakTroughRange, 1)],
    ["Coefficient of variation (%)", (m) => formatNumber(m.coefficientOfVariation * 100, 1)],
  ];

  const columns = [referenceMetrics, ...comparatorSims.map((sim) => sim.metrics)];
  return `
    <table class="metric-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th><span class="column-role">Reference</span>${escapeHtml(referenceMetrics.name)}</th>
          ${comparatorSims.map((sim, index) => `<th><span class="column-role">Comparator ${index + 1}</span>${escapeHtml(sim.metrics.name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${metrics.map(([label, formatter, rowClass = ""]) => `
          <tr class="${rowClass}">
            <td>${label}</td>
            ${columns.map((column) => `<td>${formatter(column)}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function formatInfusionTimeCell(metrics) {
  const maxMinutes = Math.round(Number(metrics.maxInfusionMinutes));
  const maxDay = metrics.infusionTimes.find((time) => Math.round(Number(time.hours) * 60) === maxMinutes)
    || metrics.infusionTimes[0];
  const breakdown = maxDay ? formatInfusionMinuteBreakdown(maxDay) : "";
  const feasibility = maxDay && !maxDay.feasible
    ? '<small class="infusion-time-warning">Unavailable cartridge mix</small>'
    : "";
  return `
    <span class="infusion-time-cell">
      <strong>${formatMinutes(metrics.maxInfusionMinutes)}</strong>
      ${breakdown ? `<small>(${breakdown})</small>` : ""}
      ${feasibility}
    </span>
  `;
}

function formatInfusionMinuteBreakdown(time) {
  const minuteParts = time.runs
    .map((run) => Math.round(Number(run.hours) * 60))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
  if (!minuteParts.length) return "";
  return `${minuteParts.join("+")} min`;
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "n/a";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins} min`;
  return `${hours} hr ${mins} min`;
}

function renderChart(referenceSim, comparatorSims) {
  const datasets = [
    {
      label: "Reference",
      data: chartPoints(referenceSim),
      borderColor: "#4d2d96",
      backgroundColor: "rgba(77, 45, 150, 0.08)",
      borderWidth: 2,
      pointRadius: 0,
    },
    ...comparatorSims.map((sim, index) => ({
      label: `Comparator ${index + 1}: ${sim.regimen.name}`,
      data: chartPoints(sim.normalized),
      borderColor: ["#0f8b8d", "#b95f89", "#7a6f21", "#3266a8"][index % 4],
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
    })),
  ];
  exposurePrintConfig = {
    datasets,
    minX: chartMinDay(referenceSim),
    maxX: referenceSim.points.at(-1).day,
    xAxisLabel: "Simulation day",
    yAxisLabel: "Relative exposure (% of reference average)",
  };

  if (typeof Chart === "undefined") {
    renderCanvasFallback(datasets, referenceSim);
    return;
  }

  if (exposureChart) {
    exposureChart.data.datasets = datasets;
    exposureChart.options.scales.x.min = chartMinDay(referenceSim);
    exposureChart.update();
    return;
  }

  exposureChart = new Chart($("exposureChart"), {
    type: "line",
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: chartMinDay(referenceSim),
          title: { display: true, text: "Simulation day" },
        },
        y: {
          min: 0,
          beginAtZero: true,
          title: { display: true, text: "Relative exposure (% of reference average)" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatPercent(context.parsed.y, 1)}`,
          },
        },
      },
    },
  });
}

function renderSwitchScenario(referenceSteadyAverage) {
  const comparator = switchComparator();
  const simulation = simulateSwitchScenario(state.reference, comparator, state.params, state.product, referenceSteadyAverage);
  const datasets = [
    {
      label: `Continue reference: ${state.reference.name}`,
      data: simulation.continueReference.points.map((point) => ({ x: point.day, y: point.exposure })),
      borderColor: "#4d2d96",
      backgroundColor: "rgba(77, 45, 150, 0.08)",
      borderWidth: 2,
      pointRadius: 0,
    },
    {
      label: `Switch to comparator: ${comparator.name}`,
      data: simulation.switchComparator.points.map((point) => ({ x: point.day, y: point.exposure })),
      borderColor: "#0f8b8d",
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
    },
  ];
  switchPrintConfig = {
    datasets,
    minX: 0,
    maxX: state.params.switchHorizonDays,
    xAxisLabel: "Days after switch",
    yAxisLabel: "Relative exposure (% of reference average)",
  };

  renderSwitchSummary(simulation.switchComparator.points, comparator.name);

  if (typeof Chart === "undefined") {
    renderCanvasFallbackFor("switchChart", datasets, 0, state.params.switchHorizonDays, "Relative exposure (% of reference average)");
    return;
  }

  if (switchChart) {
    switchChart.data.datasets = datasets;
    switchChart.options.scales.x.max = state.params.switchHorizonDays;
    switchChart.update();
    return;
  }

  switchChart = new Chart($("switchChart"), {
    type: "line",
    data: { datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: state.params.switchHorizonDays,
          title: { display: true, text: "Days after switch" },
        },
        y: {
          min: 0,
          beginAtZero: true,
          title: { display: true, text: "Relative exposure (% of reference average)" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatPercent(context.parsed.y, 1)}`,
          },
        },
      },
    },
  });
}

function renderSwitchSummary(points, comparatorName) {
  const values = points.map((point) => point.exposure);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const end = valueAtDay(points, state.params.switchHorizonDays);
  $("switchSummary").innerHTML = `
    <div class="summary-tile"><span>Comparator</span><strong>${escapeHtml(comparatorName)}</strong></div>
    <div class="summary-tile"><span>Average after switch</span><strong>${formatPercent(average, 1)}</strong></div>
    <div class="summary-tile"><span>Lowest after switch</span><strong>${formatPercent(min, 1)}</strong></div>
    <div class="summary-tile"><span>Day ${formatNumber(state.params.switchHorizonDays, 0)}</span><strong>${formatPercent(end, 1)}</strong></div>
  `;
}

function valueAtDay(points, day) {
  return points.reduce((closest, point) => (
    Math.abs(point.day - day) < Math.abs(closest.day - day) ? point : closest
  ), points[0]).exposure;
}

function renderCanvasFallback(datasets, referenceSim) {
  renderCanvasFallbackFor(
    "exposureChart",
    datasets,
    chartMinDay(referenceSim),
    referenceSim.points.at(-1).day,
    "Relative exposure (% of reference average)",
  );
}

function renderCanvasFallbackFor(canvasId, datasets, minX, maxX, yAxisLabel, renderOptions = {}) {
  const targetCanvas = $(canvasId);
  const rect = targetCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(renderOptions.renderWidth || rect.width || targetCanvas.clientWidth || 900));
  const height = Math.max(340, Math.floor(renderOptions.renderHeight || rect.height || targetCanvas.clientHeight || 420));
  const ratio = window.devicePixelRatio || 1;
  targetCanvas.width = width * ratio;
  targetCanvas.height = height * ratio;
  targetCanvas.style.width = canvasId.startsWith("print") ? "100%" : `${width}px`;
  targetCanvas.style.height = canvasId.startsWith("print") ? "auto" : `${height}px`;

  const ctx = targetCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const margin = { top: 22, right: 22, bottom: 56, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allY = datasets.flatMap((dataset) => dataset.data.map((point) => point.y));
  const maxY = Math.max(120, Math.ceil(Math.max(...allY) / 10) * 10);
  const minY = 0;

  const xScale = (x) => margin.left + ((x - minX) / Math.max(1, maxX - minX)) * plotWidth;
  const yScale = (y) => margin.top + (1 - (y - minY) / Math.max(1, maxY - minY)) * plotHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ddd7e8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotHeight);
  ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#675f74";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const yValue = minY + (maxY - minY) * tick / 4;
    const y = yScale(yValue);
    ctx.strokeStyle = "#eeeaf5";
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(yValue)}%`, margin.left - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let tick = 0; tick <= 4; tick += 1) {
    const xValue = minX + (maxX - minX) * tick / 4;
    ctx.fillText(`${Math.round(xValue)}`, xScale(xValue), margin.top + plotHeight + 10);
  }

  datasets.forEach((dataset) => {
    ctx.strokeStyle = dataset.borderColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    dataset.data.forEach((point, index) => {
      const x = xScale(point.x);
      const y = yScale(point.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  if (!renderOptions.hideLegend) {
    let legendX = margin.left;
    const legendY = height - 24;
    ctx.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    datasets.forEach((dataset) => {
      ctx.strokeStyle = dataset.borderColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY);
      ctx.lineTo(legendX + 24, legendY);
      ctx.stroke();
      ctx.fillStyle = "#211a2e";
      ctx.fillText(dataset.label, legendX + 30, legendY);
      legendX += 48 + ctx.measureText(dataset.label).width;
    });
  }

  ctx.save();
  ctx.translate(18, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#675f74";
  ctx.textAlign = "center";
  ctx.fillText(yAxisLabel, 0, 0);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillText(renderOptions.xAxisLabel || "Simulation day", margin.left + plotWidth / 2, height - 6);
}

function chartPoints(simulation) {
  const minDay = chartMinDay(simulation);
  return simulation.points
    .filter((point) => point.day >= minDay)
    .map((point) => ({ x: point.day, y: point.exposure }));
}

function chartMinDay(simulation) {
  if (state.chartWindow === "all") return 0;
  const windowDays = Number(state.chartWindow);
  return Math.max(0, simulation.points.at(-1).day - windowDays);
}

function renderTimeline(reference, comparatorSims) {
  const rows = [
    { label: "Reference", regimen: reference },
    ...comparatorSims.map((sim, index) => ({ label: `Comparator ${index + 1}`, regimen: sim.regimen })),
  ];
  $("timeline").innerHTML = rows.map((row) => timelineRow(row.label, row.regimen)).join("");
}

function timelineRow(label, regimen) {
  const horizon = 32;
  const events = [];
  for (let cycleStart = 0; cycleStart <= horizon; cycleStart += Number(regimen.cycleLengthDays)) {
    regimen.events.forEach((event) => {
      const day = cycleStart + Number(event.day);
      if (day <= horizon) events.push({ ...event, day });
    });
  }
  const totalSites = events.reduce((sum, event) => sum + Number(event.sites), 0);
  const totalVolume = events.reduce((sum, event) => sum + Number(event.volumeMl), 0);
  const yearlySites = regimen.events.reduce((sum, event) => sum + Number(event.sites), 0) / Number(regimen.cycleLengthDays) * 365;
  return `
    <div class="timeline-row">
      <div class="timeline-title">
        <h3>${label}: <span class="muted">${escapeHtml(regimen.name)}</span></h3>
        <span class="pill">${formatNumber(totalSites, 0)} sites / ${formatNumber(totalVolume, 0)} mL over ${horizon} days; ${formatNumber(yearlySites, 0)} sites/year</span>
      </div>
      <div class="timeline-track">
        ${events.map((event) => `
          <div class="timeline-marker" style="left: ${Math.min(98, (event.day / horizon) * 100)}%">
            Day ${formatNumber(event.day, 0)}<br>
            ${formatNumber(event.volumeMl, 0)} mL, ${formatNumber(event.sites, 0)} sites<br>
            ${formatNumber(event.volumeMl / event.sites, 1)} mL/site
          </div>
        `).join("")}
      </div>
      <div class="timeline-axis"><span>0</span><span>8</span><span>16</span><span>24</span><span>32 days</span></div>
    </div>
  `;
}

function scheduleSimulationFromInput() {
  if (simulationInputTimer) window.clearTimeout(simulationInputTimer);
  simulationInputTimer = window.setTimeout(() => {
    simulationInputTimer = null;
    runSimulation();
  }, 280);
}

function cancelScheduledSimulation() {
  if (!simulationInputTimer) return;
  window.clearTimeout(simulationInputTimer);
  simulationInputTimer = null;
}

function bindEvents() {
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches('input[type="number"]')) {
      const invalid = target.value !== "" && (target.validity.badInput || target.validity.rangeUnderflow || target.validity.rangeOverflow);
      if (invalid) target.setAttribute("aria-invalid", "true");
      else target.removeAttribute("aria-invalid");
      if (invalid) return;
    }
    if (target.matches("[data-comparator-id][data-comparator-field]")) {
      const comparator = comparatorById(target.dataset.comparatorId);
      if (comparator) comparator[target.dataset.comparatorField] = target.value;
    } else if (target.matches("[data-type][data-field]")) {
      updateRegimenFromInput(target, { commit: false });
    } else if (target.matches("[data-cartridge-volume]")) {
      state.product.cartridgeSelectionMode = "manual";
      scheduleSimulationFromInput();
    } else if (target.matches("input")) {
      if (["productName", "concentration"].includes(target.id)) {
        $("productPreset").value = "custom";
      }
      if (["bodyWeightKg", "protocolDoseGKgWeek", "totalDoseMl", "totalDoseG", "concentration"].includes(target.id)) {
        state.product.cartridgeSelectionMode = "auto";
      }
      scheduleSimulationFromInput();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    cancelScheduledSimulation();
    if (target.matches("[data-comparator-id][data-comparator-field]")) {
      const comparator = comparatorById(target.dataset.comparatorId);
      if (comparator) comparator[target.dataset.comparatorField] = target.value.trim() || "Untitled comparator";
      runSimulation();
    } else if (target.matches("[data-type][data-field]")) {
      updateRegimenFromInput(target);
      runSimulation();
    } else if (target.matches("[data-cartridge-volume]")) {
      state.product.cartridgeSelectionMode = "manual";
      runSimulation();
    } else if (target.id === "iggScenarioMode") {
      applyIggScenarioPreset(target.value);
      runSimulation();
    } else if (target.id === "productPreset") {
      applyProductPreset(target.value);
      runSimulation();
    } else if (["referencePreset", "candidatePreset", "switchComparator"].includes(target.id)) {
      return;
    } else if (target.matches("input, select")) {
      if (["productName", "concentration"].includes(target.id)) {
        $("productPreset").value = "custom";
      }
      if (["doseEntryMode", "bodyWeightKg", "protocolDoseGKgWeek", "totalDoseUnit", "totalDoseMl", "totalDoseG", "concentration"].includes(target.id)) {
        state.product.cartridgeSelectionMode = "auto";
      }
      runSimulation();
      if (target.matches('input[type="number"]')) {
        syncFormControlsFromState();
        target.removeAttribute("aria-invalid");
      }
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    const sectionLink = target.closest?.('.section-nav a[href^="#"]');
    if (sectionLink) {
      const sectionId = sectionLink.getAttribute("href").slice(1);
      if (navigateToSection(sectionId)) event.preventDefault();
      if (sectionId === "intervalExplorer") {
        intervalExplorerActive = true;
        renderExtendedInterval();
      }
      return;
    }
    if (target.matches(".help-tip")) {
      const shouldOpen = !target.classList.contains("is-open");
      document.querySelectorAll(".help-tip.is-open").forEach((tip) => {
        tip.classList.remove("is-open");
        tip.setAttribute("aria-expanded", "false");
      });
      target.classList.toggle("is-open", shouldOpen);
      target.setAttribute("aria-expanded", String(shouldOpen));
      return;
    }
    document.querySelectorAll(".help-tip.is-open").forEach((tip) => {
      tip.classList.remove("is-open");
      tip.setAttribute("aria-expanded", "false");
    });
    if (target.dataset.action === "add-event") {
      addEvent(target.dataset.type);
      runSimulation();
    }
    if (target.dataset.action === "remove-event") {
      removeEvent(target.dataset.type, Number(target.dataset.eventIndex));
      runSimulation();
    }
    if (target.dataset.action === "select-comparator") {
      editingComparatorId = target.dataset.comparatorId;
      state.activeComparatorId = target.dataset.comparatorId;
      runSimulation();
    }
    if (target.dataset.action === "move-comparator-up") {
      moveComparator(target.dataset.comparatorId, -1);
      runSimulation();
    }
    if (target.dataset.action === "move-comparator-down") {
      moveComparator(target.dataset.comparatorId, 1);
      runSimulation();
    }
    if (target.dataset.action === "remove-comparator") {
      removeComparator(target.dataset.comparatorId);
      runSimulation();
    }
    if (target.dataset.action === "cartridge-step") {
      const input = $(`cartridgePicker`).querySelector(`input[data-cartridge-volume="${target.dataset.cartridgeVolume}"]`);
      if (input) {
        input.value = Math.max(0, Number(input.value) + Number(target.dataset.step));
        state.product.cartridgeSelectionMode = "manual";
        runSimulation();
      }
    }
    if (target.dataset.action === "auto-fill-cartridges") {
      state.product.cartridgeSelectionMode = "auto";
      runSimulation();
    }
    if (target.dataset.intervalDay) {
      state.interval.checkpointDay = Number(target.dataset.intervalDay);
      renderExtendedInterval();
      renderSharePanel();
      renderPrintReport();
    }
    if (target.dataset.chartMode) {
      state.chartMode = target.dataset.chartMode;
      renderChartMode();
      renderSharePanel();
      renderPrintReport();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches?.("[data-chart-mode]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = Array.from(document.querySelectorAll("[data-chart-mode]"));
      const currentIndex = tabs.indexOf(event.target);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      state.chartMode = tabs[nextIndex].dataset.chartMode;
      tabs[nextIndex].focus();
      renderChartMode();
      renderSharePanel();
      renderPrintReport();
      return;
    }
    if (event.key !== "Escape") return;
    document.querySelectorAll(".help-tip.is-open").forEach((tip) => {
      tip.classList.remove("is-open");
      tip.setAttribute("aria-expanded", "false");
    });
  });

  $("autoCartridges").addEventListener("click", () => {
    state.product.cartridgeSelectionMode = "auto";
    runSimulation();
  });

  $("referencePreset").addEventListener("change", (event) => {
    pendingReferencePresetId = event.target.value;
    renderGeneratedPresetControls();
  });

  $("applyReferencePreset").addEventListener("click", () => {
    const preset = presets.find((item) => item.id === pendingReferencePresetId);
    if (!preset) return;
    state.reference = clonePreset(preset);
    editedRegimens.add(state.reference);
    pendingReferencePresetId = "";
    runSimulation();
  });

  $("candidatePreset").addEventListener("change", (event) => {
    pendingComparatorPresetId = event.target.value;
    renderGeneratedPresetControls();
  });

  $("applyCandidatePreset").addEventListener("click", () => {
    const preset = presets.find((item) => item.id === pendingComparatorPresetId);
    if (!preset) return;
    const comparator = editingComparator() || activeComparator();
    Object.assign(comparator, clonePreset(preset), { id: comparator.id });
    editedRegimens.add(comparator);
    pendingComparatorPresetId = "";
    runSimulation();
  });

  $("addComparator").addEventListener("click", () => {
    const next = createComparatorFromPreset(presets[4]);
    state.comparators.push(next);
    editingComparatorId = next.id;
    state.activeComparatorId = next.id;
    state.switchComparatorId = next.id;
    runSimulation();
  });

  $("closeComparatorEditor").addEventListener("click", () => {
    editingComparatorId = null;
    pendingComparatorPresetId = "";
    runSimulation();
  });

  $("switchComparator").addEventListener("change", (event) => {
    state.switchComparatorId = event.target.value;
    runSimulation();
  });

  $("copyShareLink").addEventListener("click", async () => {
    const shareUrl = $("shareUrl").value || buildShareUrl();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        $("shareUrl").select();
        document.execCommand("copy");
      }
      $("shareStatus").textContent = "Share link copied.";
    } catch (error) {
      $("shareStatus").textContent = "Copy failed. Select and copy the share link manually.";
    }
  });

  $("printReport").addEventListener("click", () => {
    preparePrintReport();
    window.print();
  });

  document.querySelector(".share-panel")?.addEventListener("toggle", (event) => {
    if (!event.currentTarget.open) return;
    renderSharePanel({ forceQr: true });
    renderPrintReport();
  });
}

function observeIntervalExplorer() {
  if (!("IntersectionObserver" in window) || !$("intervalExplorer")) return;
  const observer = new window.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    intervalExplorerActive = true;
    renderExtendedInterval();
    observer.disconnect();
  }, { rootMargin: "240px 0px" });
  observer.observe($("intervalExplorer"));
}

function init() {
  const shareToken = readShareTokenFromUrl();
  if (shareToken) {
    try {
      applySimulatorState(decodeSharePayload(shareToken));
      syncFormControlsFromState();
    } catch (error) {
      console.warn("Unable to load shared simulator state", error);
    }
  }
  intervalExplorerActive = currentSectionFromUrl() === "intervalExplorer";
  bindEvents();
  window.addEventListener("beforeprint", preparePrintReport);
  window.addEventListener("afterprint", finishPrintReport);
  runSimulation();
  const initialSection = currentSectionFromUrl();
  document.getElementById(initialSection)?.scrollIntoView?.({ block: "start" });
  if (!intervalExplorerActive) observeIntervalExplorer();
}

window.addEventListener("DOMContentLoaded", init);
