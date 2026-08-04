"use strict";

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

const defaultProductPresetId = "hizentra";

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
    customCalibrationIggMgDl: 2613,
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
    customCalibrationIggMgDl: 2613,
  },
  custom: {
    label: "Custom upper-tail model patient",
    protocolDoseGKgWeek: 0.4,
    baselinePreScigIggMgDl: 1400,
    steadyStateTroughIggMgDl: 2350,
    weeklyPeakIggMgDl: 2613,
    tmaxDaysAfterWeeklyInfusion: 3,
    peakToTroughRatio: 1.11,
    highIggWarningThresholdMgDl: 2800,
    customCalibrationIggMgDl: 2613,
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
    doseSlopeMgDlPer01GKgWeek: 125,
    peakToTroughRatio: 1.10,
    tmaxDaysAfterWeeklyInfusion: 3,
    labReferenceLowMgDl: 586,
    labReferenceHighMgDl: 1602,
    highIggWarningThresholdMgDl: 2600,
    baselineUncertaintyMgDl: 100,
    slopeUncertaintyPercent: 20,
    customCalibrationIggMgDl: 2613,
    absorptionHalfTimeLowDays: 1,
    absorptionHalfTimeHighDays: 3,
    eliminationHalfLifeLowDays: 21,
    eliminationHalfLifeHighDays: 35,
  },
  reference: structuredClone(presets[0]),
  comparators: [
    createComparatorFromPreset(presets[1], "comp-1"),
    createComparatorFromPreset(presets[3], "comp-2"),
  ],
  activeComparatorId: "comp-1",
  switchComparatorId: "comp-1",
  chartWindow: "all",
  chartMode: "igg",
};

let exposureChart;
let switchChart;

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
  const remainingInventory = cloneInventory(product.cartridgeInventory);
  const infusionTimes = eventGroups
    .sort((a, b) => a.day - b.day)
    .map((group) => {
      const allocation = allocateCartridges(group.volumeMl, remainingInventory);
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
  state.dosing.entryMode = $("doseEntryMode").value;
  state.calibration.bodyWeightKg = Number($("bodyWeightKg").value);
  state.dosing.protocolDoseGKgWeek = Number($("protocolDoseGKgWeek").value);
  state.dosing.requestedProtocolDoseGKgWeek = state.dosing.protocolDoseGKgWeek;
  state.dosing.totalDoseUnit = $("totalDoseUnit").value;
  state.dosing.totalDoseMl = Number($("totalDoseMl").value);
  state.dosing.totalDoseG = Number($("totalDoseG").value);

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
  if (state.product.cartridgeSelectionMode === "auto" || !$("cartridgePicker").querySelector("[data-cartridge-volume]")) {
    state.product.cartridgeInventory = autoAllocation.inventory;
  } else {
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

function syncRegimenToGeneratedPreset(regimen) {
  if (!regimen.presetId || regimen.presetId === "custom") return;
  const generated = generatedPresetById(regimen.presetId);
  if (!generated) return;
  const id = regimen.id;
  Object.assign(regimen, structuredClone(generated), { id, presetId: generated.presetId });
}

function refreshDoseGeneratedPresets() {
  presets = buildPresets(state.dosing.weeklyDoseMl, state.product.cartridgeInventory);
  syncRegimenToGeneratedPreset(state.reference);
  state.comparators.forEach(syncRegimenToGeneratedPreset);
}

function readSettings() {
  state.product.presetId = $("productPreset").value;
  state.product.name = $("productName").value.trim() || "SCIG example";
  state.product.concentrationGPerMl = Number($("concentration").value);
  state.product.needleType = $("needleType").value;
  state.product.tubing = $("tubing").value;
  if (productPresets[state.product.presetId]) {
    state.product.cartridgeSizesMl = productPresets[state.product.presetId].cartridgeSizesMl;
  }
  state.product.referenceRunMinutes = Number($("referenceRunMinutes").value);
  readDosingSettings();
  refreshDoseGeneratedPresets();
  state.params.absorptionHalfTimeDays = Number($("absorptionHalfTime").value);
  state.params.eliminationHalfLifeDays = Number($("eliminationHalfLife").value);
  state.params.simulationHorizonDays = Number($("simulationHorizon").value);
  state.params.timestepDays = Number($("timestep").value);
  state.params.switchPreconditionDays = Number($("switchPreconditionDays").value);
  state.params.switchHorizonDays = Number($("switchHorizonDays").value);
  state.calibration.mode = $("iggScenarioMode").value;
  state.calibration.baselinePreScigIggMgDl = Number($("baselinePreScigIgg").value);
  state.calibration.doseSlopeMgDlPer01GKgWeek = Number($("doseSlope").value);
  state.calibration.peakToTroughRatio = Number($("peakToTroughRatio").value);
  state.calibration.tmaxDaysAfterWeeklyInfusion = Number($("modelTmaxDays").value);
  state.calibration.labReferenceLowMgDl = Number($("labReferenceLow").value);
  state.calibration.labReferenceHighMgDl = Number($("labReferenceHigh").value);
  state.calibration.highIggWarningThresholdMgDl = Number($("highIggWarningThreshold").value);
  state.calibration.baselineUncertaintyMgDl = Number($("baselineUncertainty").value);
  state.calibration.slopeUncertaintyPercent = Number($("slopeUncertaintyPercent").value);
  state.calibration.customCalibrationIggMgDl = Number($("customCalibrationIgg").value);
  state.calibration.absorptionHalfTimeLowDays = Number($("absorptionHalfTimeLow").value);
  state.calibration.absorptionHalfTimeHighDays = Number($("absorptionHalfTimeHigh").value);
  state.calibration.eliminationHalfLifeLowDays = Number($("eliminationHalfLifeLow").value);
  state.calibration.eliminationHalfLifeHighDays = Number($("eliminationHalfLifeHigh").value);
  if ($("switchComparator")) {
    state.switchComparatorId = $("switchComparator").value;
  }
  state.chartWindow = $("chartWindow").value;
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
    : `${formatNumber(regimen.cycleLengthDays, 1)} day cycle`;
  return `
    <div class="regimen-card">
      <div>
        <span>${escapeHtml(role)}</span>
        <strong>${escapeHtml(regimen.name)}</strong>
      </div>
      <div class="regimen-card-metrics">
        <b>${formatNumber(totalMl, 0)} mL</b>
        <b>${formatDose(totalG)}</b>
        <b>${formatNumber(regimen.cycleLengthDays, 1)} days</b>
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
  $("customCalibrationIgg").value = preset.customCalibrationIggMgDl;
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

function switchComparator() {
  return state.comparators.find((comparator) => comparator.id === state.switchComparatorId) || activeComparator();
}

function renderPresetSelect(select, includeLabel = true) {
  select.innerHTML = `${includeLabel ? '<option value="">Select preset</option>' : ""}${presets.map((preset) => (
    `<option value="${preset.id}">${preset.name}</option>`
  )).join("")}`;
}

function renderComparatorSelect() {
  if (!state.comparators.some((comparator) => comparator.id === state.switchComparatorId)) {
    state.switchComparatorId = activeComparator().id;
  }
  $("comparatorManager").innerHTML = state.comparators.map((comparator, index) => `
    <div class="comparator-row ${comparator.id === state.activeComparatorId ? "active" : ""}">
      <span class="comparator-index">${index + 1}</span>
      <input
        data-comparator-id="${comparator.id}"
        data-comparator-field="name"
        type="text"
        aria-label="Comparator ${index + 1} name"
        value="${escapeHtml(comparator.name)}"
      >
      <button class="secondary" data-action="select-comparator" data-comparator-id="${comparator.id}" type="button">Edit</button>
      <button class="icon-button" data-action="move-comparator-up" data-comparator-id="${comparator.id}" ${index === 0 ? "disabled" : ""} type="button">Up</button>
      <button class="icon-button" data-action="move-comparator-down" data-comparator-id="${comparator.id}" ${index === state.comparators.length - 1 ? "disabled" : ""} type="button">Down</button>
      <button class="icon-button" data-action="remove-comparator" data-comparator-id="${comparator.id}" ${state.comparators.length === 1 ? "disabled" : ""} type="button">Remove</button>
    </div>
  `).join("");

  $("switchComparator").innerHTML = state.comparators.map((comparator, index) => (
    `<option value="${comparator.id}">Comparator ${index + 1}: ${escapeHtml(comparator.name)}</option>`
  )).join("");
  $("switchComparator").value = state.switchComparatorId;
}

function renderRegimenEditor(container, regimen, type) {
  container.innerHTML = `
    <div class="regimen-fields">
      <label>
        Regimen name
        <input data-type="${type}" data-field="name" type="text" value="${escapeHtml(regimen.name)}">
      </label>
      <label>
        Cycle length (days)
        <input data-type="${type}" data-field="cycleLengthDays" type="number" min="0.25" step="0.25" value="${regimen.cycleLengthDays}">
      </label>
    </div>
    <table class="event-table">
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
    <div class="event-actions">
      <span class="pill">${round(regimen.events.reduce((sum, event) => sum + Number(event.volumeMl), 0), 0)} mL per cycle</span>
      <button class="secondary" data-type="${type}" data-action="add-event" type="button">Add Event</button>
    </div>
  `;
}

function eventRow(regimen, event, index, type) {
  const dose = volumeToGrams(Number(event.volumeMl), state.product.concentrationGPerMl);
  const mlPerSite = Number(event.volumeMl) / Number(event.sites);
  const disableRemove = regimen.events.length === 1 ? "disabled" : "";
  return `
    <tr>
      <td><input data-type="${type}" data-event-index="${index}" data-field="day" type="number" min="0" step="0.25" value="${event.day}"></td>
      <td><input data-type="${type}" data-event-index="${index}" data-field="volumeMl" type="number" min="0" step="1" value="${event.volumeMl}"></td>
      <td><input data-type="${type}" data-event-index="${index}" data-field="sites" type="number" min="1" max="8" step="1" value="${event.sites}"></td>
      <td>${formatDose(dose)}</td>
      <td>${formatNumber(mlPerSite, 1)}</td>
      <td><button class="icon-button" data-type="${type}" data-event-index="${index}" data-action="remove-event" ${disableRemove} type="button">Remove</button></td>
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

function updateRegimenFromInput(input) {
  const regimen = input.dataset.type === "reference" ? state.reference : activeComparator();
  const field = input.dataset.field;
  const eventIndex = input.dataset.eventIndex;
  const value = input.type === "number" ? Number(input.value) : input.value;

  if (eventIndex === undefined) {
    regimen[field] = value;
    if (field !== "name") regimen.presetId = "custom";
  } else {
    regimen.events[Number(eventIndex)][field] = value;
    regimen.presetId = "custom";
  }
}

function addEvent(type) {
  const regimen = type === "reference" ? state.reference : activeComparator();
  regimen.events.push({ day: 0, volumeMl: 10, sites: 1 });
  regimen.presetId = "custom";
}

function removeEvent(type, index) {
  const regimen = type === "reference" ? state.reference : activeComparator();
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
  if (state.switchComparatorId === id) {
    const fallback = state.comparators[Math.min(index, state.comparators.length - 1)];
    state.switchComparatorId = fallback.id;
  }
}

function runSimulation() {
  readSettings();
  renderCartridgePicker();
  renderDoseSetupSummary();
  renderSetupSnapshot();
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

  renderRegimenEditor($("referenceEditor"), state.reference, "reference");
  renderComparatorSelect();
  renderRegimenEditor($("candidateEditor"), activeComparator(), "candidate");
  renderRegimenCards(comparatorSims);
  renderResults(referenceMetrics, comparatorSims);
  renderAssumptionAudit();
  renderIggScenarioSummary();
  renderAmplitudeEstimate(comparatorSims);
  renderChart(referenceSim, comparatorSims);
  renderSwitchScenario(referenceRawStats.average);
  renderAnalysis(referenceSim, comparatorSims, referenceRawStats.average);
  renderTimeline(state.reference, comparatorSims);
  renderChartMode();
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
  $("interpretation").innerHTML = message;
  $("resultsTable").innerHTML = "";
  $("resultsDashboard").innerHTML = "";
  $("deltaNarratives").innerHTML = "";
  $("assumptionAudit").innerHTML = "";
  $("compareBar").innerHTML = "";
  $("amplitudeSummary").innerHTML = `<div class="analysis-block"><p>${message}</p></div>`;
  $("timeline").innerHTML = "";
  $("iggScenarioSummary").innerHTML = "";
  if (exposureChart) {
    exposureChart.destroy();
    exposureChart = null;
  }
  if (switchChart) {
    switchChart.destroy();
    switchChart = null;
  }
}

function renderResults(referenceMetrics, comparatorSims) {
  const active = comparatorSims.find((sim) => sim.regimen.id === state.activeComparatorId) || comparatorSims[0];
  renderResultsDashboard(referenceMetrics, active.metrics);
  renderCompareBar(referenceMetrics, active.metrics);
  renderDeltaNarratives(referenceMetrics, active.metrics);
  $("interpretation").innerHTML = generateInterpretation(referenceMetrics, active.metrics);
  $("resultsTable").className = "results-table";
  $("resultsTable").innerHTML = metricTable(referenceMetrics, comparatorSims);
}

function renderDeltaNarratives(reference, candidate) {
  const refAmp = labAnchoredAmplitudeSummary(state.reference);
  const candAmp = labAnchoredAmplitudeSummary(activeComparator());
  const refSwing = refAmp.valid ? midpoint(refAmp.amplitude) : null;
  const candSwing = candAmp.valid ? midpoint(candAmp.amplitude) : null;
  const narratives = [
    comparisonSentence("Estimated swing", refSwing, candSwing, "mg/dL", "wider", "narrower"),
    comparisonSentence("Longest gap", reference.longestGapDays, candidate.longestGapDays, "days", "longer", "shorter"),
    comparisonSentence("Dose intensity", 100, candidate.percentReferenceDoseIntensity, "% of reference", "higher", "lower"),
    comparisonSentence("Per-site volume", reference.maxMlPerSite, candidate.maxMlPerSite, "mL/site", "higher", "lower"),
    comparisonSentence("Infusion time", reference.maxInfusionMinutes, candidate.maxInfusionMinutes, "minutes", "longer", "shorter"),
  ];
  $("deltaNarratives").innerHTML = narratives.map((item) => `
    <div class="narrative-card">
      <span>${escapeHtml(item.label)}</span>
      <p>${escapeHtml(item.text)}</p>
    </div>
  `).join("");
}

function comparisonSentence(label, reference, candidate, unit, higherWord, lowerWord) {
  if (!Number.isFinite(reference) || !Number.isFinite(candidate)) {
    return { label, text: `${label} is not estimated with the current settings.` };
  }
  const delta = candidate - reference;
  if (Math.abs(delta) < 0.05) {
    return { label, text: `${label} is about the same as the reference.` };
  }
  const direction = delta > 0 ? higherWord : lowerWord;
  const digits = unit === "minutes" ? 0 : 1;
  const unitLabel = unit === "minutes" ? "min" : unit;
  return {
    label,
    text: `${label} is ${direction}: ${formatNumber(candidate, digits)} ${unitLabel} vs ${formatNumber(reference, digits)} ${unitLabel} for reference.`,
  };
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
  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chartMode === state.chartMode);
  });
  document.querySelectorAll("[data-chart-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.chartPanel !== state.chartMode);
  });
  window.setTimeout(() => {
    if (exposureChart) exposureChart.resize();
    if (switchChart) switchChart.resize();
  }, 0);
}

function renderResultsDashboard(reference, candidate) {
  const referenceAmp = labAnchoredAmplitudeSummary(state.reference);
  const candidateAmp = labAnchoredAmplitudeSummary(activeComparator());
  const refSwing = referenceAmp.valid ? midpoint(referenceAmp.amplitude) : null;
  const candSwing = candidateAmp.valid ? midpoint(candidateAmp.amplitude) : null;
  $("resultsDashboard").innerHTML = [
    dashboardTile("Peak-trough swing", formatDeltaValue(refSwing, candSwing, "mg/dL"), neutralDeltaLabel(refSwing, candSwing, "wider", "narrower")),
    dashboardTile("Lowest estimated IgG", candidateAmp.valid ? formatRange(candidateAmp.trough.min, candidateAmp.trough.max, formatInteger) : "n/a", "selected comparator band"),
    dashboardTile("Longest gap", `${formatNumber(candidate.longestGapDays, 1)} days`, neutralDeltaLabel(reference.longestGapDays, candidate.longestGapDays, "longer", "shorter")),
    dashboardTile("Dose intensity", formatPercent(candidate.percentReferenceDoseIntensity, 1), neutralDeltaLabel(100, candidate.percentReferenceDoseIntensity, "higher", "lower")),
    dashboardTile("Infusion days / 28 days", formatNumber(candidate.infusionDaysPer28Days, 1), neutralDeltaLabel(reference.infusionDaysPer28Days, candidate.infusionDaysPer28Days, "more", "fewer")),
    dashboardTile("Max mL/site", `${formatNumber(candidate.maxMlPerSite, 1)} mL`, neutralDeltaLabel(reference.maxMlPerSite, candidate.maxMlPerSite, "higher", "lower")),
    dashboardTile("Estimated infusion time", formatMinutes(candidate.maxInfusionMinutes), neutralDeltaLabel(reference.maxInfusionMinutes, candidate.maxInfusionMinutes, "longer", "shorter")),
  ].join("");
}

function dashboardTile(label, value, note) {
  return `
    <div class="dashboard-tile">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}

function midpoint(range) {
  return Number.isFinite(range?.min) && Number.isFinite(range?.max) ? (range.min + range.max) / 2 : null;
}

function formatDeltaValue(reference, candidate, unit) {
  if (!Number.isFinite(reference) || !Number.isFinite(candidate)) return "n/a";
  return `${formatNumber(candidate, 0)} ${unit}`;
}

function neutralDeltaLabel(reference, candidate, higherWord, lowerWord) {
  if (!Number.isFinite(reference) || !Number.isFinite(candidate)) return "not estimated";
  const delta = candidate - reference;
  if (Math.abs(delta) < 0.05) return "about the same as reference";
  return `${delta > 0 ? higherWord : lowerWord} than reference`;
}

function renderCompareBar(reference, candidate) {
  $("compareBar").innerHTML = `
    <div><span>Reference</span><strong>${escapeHtml(reference.name)}</strong></div>
    <div><span>Comparator</span><strong>${escapeHtml(candidate.name)}</strong></div>
    <div><span>Dose intensity</span><strong>${formatPercent(candidate.percentReferenceDoseIntensity, 1)}</strong></div>
    <div><span>Longest gap</span><strong>${formatNumber(candidate.longestGapDays, 1)} days</strong></div>
    <div><span>Max mL/site</span><strong>${formatNumber(candidate.maxMlPerSite, 1)} mL</strong></div>
  `;
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
  if (scenario.mode === "custom") return scenario.customCalibrationIggMgDl;
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
    { label: "Reference", regimen: state.reference },
    ...comparatorSims.map((sim, index) => ({ label: `Comparator ${index + 1}`, regimen: sim.regimen })),
  ]);
  renderAmplitudeSwitchBandChart();
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

  return summarizeSampleObjects(samples, ["average", "peak", "trough", "amplitude", "amplitudePercent"]);
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
    color: ["#4d2d96", "#0f8b8d", "#b95f89", "#3266a8", "#7a6f21"][index % 5],
    bands: labAnchoredRegimenBand(row.regimen, startDay, state.params.simulationHorizonDays, startDay),
    markers: regimenDoseMarkers(row.regimen, startDay, state.params.simulationHorizonDays, startDay),
  })).filter((row) => row.bands.length);

  renderBandCanvas("amplitudeBandChart", series, {
    xLabel: "Days within final 42-day window",
    yLabel: "Estimated IgG (mg/dL)",
    minX: 0,
    maxX: state.params.simulationHorizonDays - startDay,
  });
}

function renderAmplitudeSwitchBandChart() {
  const comparator = switchComparator();
  const horizon = state.params.switchHorizonDays;
  const series = [
    {
      label: `Switch: ${comparator.name}`,
      color: "#0f8b8d",
      bands: labAnchoredSwitchBand(comparator, horizon),
      markers: regimenDoseMarkers(comparator, 0, horizon, 0),
    },
  ].filter((row) => row.bands.length);

  renderBandCanvas("amplitudeSwitchChart", series, {
    xLabel: "Days after switch",
    yLabel: "Estimated IgG (mg/dL)",
    minX: 0,
    maxX: horizon,
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
  const rect = targetCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width || targetCanvas.clientWidth || 700));
  const height = Math.max(320, Math.floor(rect.height || targetCanvas.clientHeight || 360));
  const ratio = window.devicePixelRatio || 1;
  targetCanvas.width = width * ratio;
  targetCanvas.height = height * ratio;
  targetCanvas.style.width = `${width}px`;
  targetCanvas.style.height = `${height}px`;

  const ctx = targetCanvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const margin = { top: 24, right: 24, bottom: 58, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = series.flatMap((item) => item.bands.flatMap((point) => [point.min, point.max]));
  if (!allValues.length) {
    ctx.fillStyle = "#675f74";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("Not enough calibration data to draw this graph.", margin.left, margin.top + 20);
    return;
  }

  const rawMinY = Math.min(...allValues);
  const rawMaxY = Math.max(...allValues);
  const padY = Math.max(50, (rawMaxY - rawMinY) * 0.12);
  const minY = 0;
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

  drawNormalRangeLines(ctx, yScale, margin, plotWidth, minY, maxY);

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

  drawLegend(ctx, series, margin.left, height - 22);

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

function drawNormalRangeLines(ctx, yScale, margin, plotWidth, minY, maxY) {
  const low = Math.min(state.calibration.labReferenceLowMgDl, state.calibration.labReferenceHighMgDl);
  const high = Math.max(state.calibration.labReferenceLowMgDl, state.calibration.labReferenceHighMgDl);
  [
    { value: low, label: "lab ref low" },
    { value: high, label: "lab ref high" },
  ].forEach((line) => {
    if (!Number.isFinite(line.value) || line.value < minY || line.value > maxY) return;
    const y = yScale(line.value);
    ctx.save();
    ctx.strokeStyle = "#8d8798";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#675f74";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${line.label} ${formatNumber(line.value, 0)}`, margin.left + 6, y - 3);
  });
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

function drawLegend(ctx, series, x, y) {
  let legendX = x;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  series.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(legendX, y);
    ctx.lineTo(legendX + 22, y);
    ctx.stroke();
    ctx.fillStyle = "#211a2e";
    ctx.fillText(item.label.slice(0, 24), legendX + 28, y);
    legendX += Math.min(190, 48 + item.label.length * 7);
  });
}

function scenarioCalibrationPeakMgDl(scenario) {
  if (state.calibration.mode === "custom") return scenario.customCalibrationIggMgDl;
  return expectedTroughMgDl(scenario) * scenario.peakToTroughRatio;
}

function scenarioScale(scenario) {
  const treatmentDerived = scenarioCalibrationPeakMgDl(scenario) - scenario.baselinePreScigIggMgDl;
  if (treatmentDerived <= 0) return null;
  const scenarioParams = { ...state.params, absorptionHalfTimeDays: scenario.absorptionHalfTimeDays, eliminationHalfLifeDays: scenario.eliminationHalfLifeDays };
  const referenceRaw = simulateRegimen(state.reference, scenarioParams, state.product);
  const calibrationDay = calibrationAbsoluteDay(state.reference, state.calibration.tmaxDaysAfterWeeklyInfusion);
  const exposureAtLab = valueAtDay(referenceRaw.points, calibrationDay);
  return exposureAtLab > 0 ? treatmentDerived / exposureAtLab : null;
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

  const baselines = uniqueSortedNumbers([baselineLow, (baselineLow + baselineHigh) / 2, baselineHigh]);
  const slopes = uniqueSortedNumbers([Math.max(0, slopeCenter - slopeSpread), slopeCenter, slopeCenter + slopeSpread]);
  const absorptionValues = uniqueSortedNumbers([absorptionLow, state.params.absorptionHalfTimeDays, absorptionHigh].filter((value) => value > 0));
  const eliminationValues = uniqueSortedNumbers([eliminationLow, state.params.eliminationHalfLifeDays, eliminationHigh].filter((value) => value > 0));
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

  return scenarios;
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
    ["Cycle length (days)", (m) => formatNumber(m.cycleLengthDays, 1)],
    ["Total volume per cycle (mL)", (m) => formatNumber(m.totalMlPerCycle, 0)],
    ["Total dose per cycle (g)", (m) => formatNumber(m.totalGPerCycle, 1)],
    ["Volume per day (mL/day)", (m) => formatNumber(m.mlPerDay, 1)],
    ["Dose per day (g/day)", (m) => formatNumber(m.gPerDay, 2)],
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
    ["Longest gap (days)", (m) => formatNumber(m.longestGapDays, 1)],
    ["Max estimated infusion time", (m) => formatMinutes(m.maxInfusionMinutes)],
    ["Cartridge feasibility", (m) => m.cartridgeFeasible ? "Matches available cartridges" : "Needs unavailable cartridge mix"],
    ["Normalized average exposure (%)", (m) => formatNumber(m.normalizedAverageExposure, 1)],
    ["Normalized peak exposure (%)", (m) => formatNumber(m.normalizedPeakExposure, 1)],
    ["Normalized trough exposure (%)", (m) => formatNumber(m.normalizedTroughExposure, 1)],
    ["Peak-trough range (percentage points)", (m) => formatNumber(m.peakTroughRange, 1)],
    ["Coefficient of variation (%)", (m) => formatNumber(m.coefficientOfVariation * 100, 1)],
    ["Final-window drift check", (m) => m.driftFraction > 0.05 ? "Still drifting" : "Near repeating pattern"],
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
        ${metrics.map(([label, formatter]) => `
          <tr>
            <td>${label}</td>
            ${columns.map((column) => `<td>${formatter(column)}</td>`).join("")}
          </tr>
        `).join("")}
        <tr>
          <td>Infusion time detail</td>
          ${columns.map((column) => `<td>${formatInfusionDetails(column.infusionTimes)}</td>`).join("")}
        </tr>
      </tbody>
    </table>
  `;
}

function formatInfusionDetails(times) {
  return times.map((time) => {
    const runs = time.runs.map((run) => `${formatNumber(run.volumeMl, 0)} mL (${formatMinutes(run.hours * 60)})`).join(" + ");
    const feasibility = time.feasible ? "" : " - unavailable cartridge mix";
    return `Day ${formatNumber(time.day, 0)}: ${formatMinutes(time.minutes)} (${runs})${feasibility}`;
  }).join("<br>");
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "n/a";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins} min`;
  return `${hours} hr ${mins} min`;
}

function generateInterpretation(reference, candidate) {
  const intensityDelta = Math.abs(candidate.percentReferenceDoseIntensity - 100);
  const cards = [
    {
      label: "Dose intensity",
      text: intensityDelta > 5
        ? `This schedule provides ${formatNumber(candidate.mlPerWeek, 1)} mL/week, or ${formatPercent(candidate.percentReferenceDoseIntensity, 2)} of the reference dose intensity.`
        : `This schedule keeps average dose intensity close to reference; differences mainly reflect timing and split pattern.`,
    },
    {
      label: "Burden",
      text: `Sites per 14 days change from ${formatNumber(reference.sitesPer14Days, 2)} to ${formatNumber(candidate.sitesPer14Days, 2)}, with max per-site volume ${formatNumber(reference.maxMlPerSite, 1)} to ${formatNumber(candidate.maxMlPerSite, 1)} mL/site.`,
    },
    {
      label: "Infusion time",
      text: `Estimated max infusion-day time changes from ${formatMinutes(reference.maxInfusionMinutes)} to ${formatMinutes(candidate.maxInfusionMinutes)} using ${state.product.tubing} and selected cartridge counts.`,
    },
  ];
  if (!candidate.cartridgeFeasible) {
    cards.push({
      label: "Cartridge check",
      text: "This active candidate cannot be exactly assembled from the available cartridge selection.",
    });
  }
  return `<div class="interpretation-grid">${cards.map((card) => `
    <div class="interpretation-card">
      <span>${escapeHtml(card.label)}</span>
      <p>${escapeHtml(card.text)}</p>
    </div>
  `).join("")}</div>`;
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

function renderAnalysis(referenceSim, comparatorSims, referenceSteadyAverage) {
  const zeroStartRows = [
    {
      label: "Reference",
      name: state.reference.name,
      points: referenceSim.points,
    },
    ...comparatorSims.map((sim, index) => ({
      label: `Comparator ${index + 1}`,
      name: sim.regimen.name,
      points: sim.normalized.points,
    })),
  ].map((row) => {
    const finalStats = computeSteadyWindowStats({ points: row.points }, state.params.steadyWindowDays);
    const target = finalStats.average * 0.95;
    return {
      ...row,
      finalAverage: finalStats.average,
      rampDay: firstDaySustainedAtOrAbove(row.points, target),
    };
  });

  const selectedComparator = switchComparator();
  const switchSim = simulateSwitchScenario(state.reference, selectedComparator, state.params, state.product, referenceSteadyAverage);
  const comparatorRaw = simulateRegimen(selectedComparator, state.params, state.product);
  const comparatorNormalized = normalizeSimulation(comparatorRaw, referenceSteadyAverage);
  const comparatorFinalStats = computeSteadyWindowStats(comparatorNormalized, state.params.steadyWindowDays);
  const switchSettleDay = firstDaySustainedWithinFraction(
    switchSim.switchComparator.points,
    comparatorFinalStats.average,
    0.05,
  );

  $("analysisSummary").innerHTML = `
    <div class="analysis-block">
      <h3>Zero-start ramp-up</h3>
      <p>Time until the curve first reaches and remains above 95% of that regimen's own final-28-day average within this simulation horizon.</p>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Regimen</th>
            <th>Final-window average</th>
            <th>Ramp-up time</th>
          </tr>
        </thead>
        <tbody>
          ${zeroStartRows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}: ${escapeHtml(row.name)}</td>
              <td>${formatPercent(row.finalAverage, 1)}</td>
              <td>${formatAnalysisDay(row.rampDay)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="analysis-block">
      <h3>Switch settling</h3>
      <p>Assumes reference preconditioning for ${formatNumber(state.params.switchPreconditionDays, 0)} days, then switches to the selected comparator. Settling means the switch curve enters and remains within 5% of the comparator's expected final-28-day average.</p>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Switch target</th>
            <th>Expected comparator average</th>
            <th>Time to settle after switch</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(selectedComparator.name)}</td>
            <td>${formatPercent(comparatorFinalStats.average, 1)}</td>
            <td>${formatAnalysisDay(switchSettleDay)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function firstDaySustainedAtOrAbove(points, target) {
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].exposure >= target && points.slice(index).every((point) => point.exposure >= target)) {
      return points[index].day;
    }
  }
  return null;
}

function firstDaySustainedWithinFraction(points, target, fraction) {
  const tolerance = Math.abs(target) * fraction;
  for (let index = 0; index < points.length; index += 1) {
    if (Math.abs(points[index].exposure - target) <= tolerance
      && points.slice(index).every((point) => Math.abs(point.exposure - target) <= tolerance)) {
      return points[index].day;
    }
  }
  return null;
}

function formatAnalysisDay(day) {
  return day === null ? "Not reached in horizon" : `Day ${formatNumber(day, 0)}`;
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

function renderCanvasFallbackFor(canvasId, datasets, minX, maxX, yAxisLabel) {
  const targetCanvas = $(canvasId);
  const rect = targetCanvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width || targetCanvas.clientWidth || 900));
  const height = Math.max(340, Math.floor(rect.height || targetCanvas.clientHeight || 420));
  const ratio = window.devicePixelRatio || 1;
  targetCanvas.width = width * ratio;
  targetCanvas.height = height * ratio;
  targetCanvas.style.width = `${width}px`;
  targetCanvas.style.height = `${height}px`;

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

  let legendX = margin.left;
  const legendY = height - 24;
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
    ctx.fillText(dataset.label.slice(0, 36), legendX + 30, legendY);
    legendX += Math.min(280, 36 + dataset.label.length * 7);
  });

  ctx.save();
  ctx.translate(18, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#675f74";
  ctx.textAlign = "center";
  ctx.fillText(yAxisLabel, 0, 0);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillText("Simulation day", margin.left + plotWidth / 2, height - 6);
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

function bindEvents() {
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-comparator-id][data-comparator-field]")) {
      const comparator = comparatorById(target.dataset.comparatorId);
      if (comparator) comparator[target.dataset.comparatorField] = target.value;
    } else if (target.matches("[data-type][data-field]")) {
      updateRegimenFromInput(target);
      runSimulation();
    } else if (target.matches("[data-cartridge-volume]")) {
      state.product.cartridgeSelectionMode = "manual";
      runSimulation();
    } else if (target.matches("input, select")) {
      if (["productName", "concentration"].includes(target.id)) {
        $("productPreset").value = "custom";
      }
      if (["doseEntryMode", "bodyWeightKg", "protocolDoseGKgWeek", "totalDoseUnit", "totalDoseMl", "totalDoseG", "concentration"].includes(target.id)) {
        state.product.cartridgeSelectionMode = "auto";
      }
      runSimulation();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-comparator-id][data-comparator-field]")) {
      const comparator = comparatorById(target.dataset.comparatorId);
      if (comparator) comparator[target.dataset.comparatorField] = target.value.trim() || "Untitled comparator";
      runSimulation();
    } else if (target.id === "iggScenarioMode") {
      applyIggScenarioPreset(target.value);
      runSimulation();
    } else if (target.id === "productPreset") {
      applyProductPreset(target.value);
      runSimulation();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.dataset.action === "add-event") {
      addEvent(target.dataset.type);
      runSimulation();
    }
    if (target.dataset.action === "remove-event") {
      removeEvent(target.dataset.type, Number(target.dataset.eventIndex));
      runSimulation();
    }
    if (target.dataset.action === "select-comparator") {
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
    if (target.dataset.chartMode) {
      state.chartMode = target.dataset.chartMode;
      renderChartMode();
    }
  });

  $("autoCartridges").addEventListener("click", () => {
    state.product.cartridgeSelectionMode = "auto";
    runSimulation();
  });

  $("referencePreset").addEventListener("change", (event) => {
    const preset = presets.find((item) => item.id === event.target.value);
    if (!preset) return;
    state.reference = clonePreset(preset);
    event.target.value = "";
    runSimulation();
  });

  $("candidatePreset").addEventListener("change", (event) => {
    const preset = presets.find((item) => item.id === event.target.value);
    if (!preset) return;
    const comparator = activeComparator();
    Object.assign(comparator, clonePreset(preset), { id: comparator.id });
    event.target.value = "";
    runSimulation();
  });

  $("addComparator").addEventListener("click", () => {
    const next = createComparatorFromPreset(presets[4]);
    state.comparators.push(next);
    state.activeComparatorId = next.id;
    state.switchComparatorId = next.id;
    runSimulation();
  });

  $("switchComparator").addEventListener("change", (event) => {
    state.switchComparatorId = event.target.value;
    runSimulation();
  });
}

function init() {
  renderPresetSelect($("referencePreset"));
  renderPresetSelect($("candidatePreset"));
  bindEvents();
  runSimulation();
}

window.addEventListener("DOMContentLoaded", init);
