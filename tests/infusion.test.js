"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const code = fs.readFileSync("script.js", "utf8");
const context = {
  console,
  structuredClone,
  Buffer,
  window: { addEventListener() {} },
};

vm.createContext(context);
vm.runInContext(`${code}
globalThis.__testApi = {
  presets,
  buildPresets,
  closestFeasibleVolume,
  autoAllocateProductCartridges,
  inventoryFromCounts,
  inventoryTextFromInventory,
  selectedCartridgeVolume,
  simulateRegimen,
  computeSteadyWindowStats,
  simulateSwitchScenario,
  intervalScenarioCurves,
  intervalBandFromCurves,
  firstWaningCrossing,
  parseCartridgeInventory,
  cloneInventory,
  allocateCartridges,
  estimateInfusionTime,
  formatMinutes,
  productPresets,
  state,
  serializeSimulatorState,
  encodeSharePayload,
  decodeSharePayload,
  applySimulatorState,
};`, context);

const {
  presets,
  buildPresets,
  closestFeasibleVolume,
  autoAllocateProductCartridges,
  inventoryFromCounts,
  inventoryTextFromInventory,
  selectedCartridgeVolume,
  simulateRegimen,
  computeSteadyWindowStats,
  simulateSwitchScenario,
  intervalScenarioCurves,
  intervalBandFromCurves,
  firstWaningCrossing,
  parseCartridgeInventory,
  cloneInventory,
  allocateCartridges,
  estimateInfusionTime,
  formatMinutes,
  productPresets,
  state,
  serializeSimulatorState,
  encodeSharePayload,
  decodeSharePayload,
  applySimulatorState,
} = context.__testApi;

const sameArray = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

const product = {
  tubing: "F2400",
  referenceRunMinutes: 46,
  cartridgeInventory: parseCartridgeInventory("50x3, 10x1"),
};

function approx(actual, expected, tolerance = 0.05) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);
}

function assertValidCartridgeTotal(inventory, expectedVolumeMl) {
  assert.equal(selectedCartridgeVolume(inventory), expectedVolumeMl);
}

function assertInvalidCartridgeTotal(inventory, expectedVolumeMl) {
  assert.notEqual(selectedCartridgeVolume(inventory), expectedVolumeMl);
}

{
  const estimate = estimateInfusionTime(50, 4, product, [50]);
  approx(estimate.minutes, 46);
  assert.equal(formatMinutes(estimate.minutes), "46 min");
}

{
  const estimate = estimateInfusionTime(10, 4, product, [10]);
  approx(estimate.minutes, 9.2);
  assert.equal(formatMinutes(estimate.minutes), "9 min");
}

{
  const inventory = cloneInventory(product.cartridgeInventory);
  sameArray(allocateCartridges(160, inventory), [50, 50, 50, 10]);
  const estimate = estimateInfusionTime(160, 4, product, [50, 50, 50, 10]);
  approx(estimate.minutes, 147.2);
  assert.equal(formatMinutes(estimate.minutes), "2 hr 27 min");
}

{
  const inventory = cloneInventory(product.cartridgeInventory);
  sameArray(allocateCartridges(100, inventory), [50, 50]);
  sameArray(allocateCartridges(60, inventory), [50, 10]);
}

{
  const inventory = cloneInventory(product.cartridgeInventory);
  assert.equal(allocateCartridges(80, inventory), null);
}

console.log("infusion timing tests passed");

{
  const splitPresets = buildPresets(120, parseCartridgeInventory("50x2, 10x2"));
  const split = splitPresets.find((preset) => preset.id === "split-large-small");
  sameArray(split.events.map((event) => event.volumeMl), [70, 50]);
}

{
  const splitPresets = buildPresets(120, parseCartridgeInventory("50x2, 20x1"));
  const split = splitPresets.find((preset) => preset.id === "split-large-small");
  sameArray(split.events.map((event) => event.volumeMl), [70, 50]);
}

{
  const splitPresets = buildPresets(160, parseCartridgeInventory("50x3, 10x1"));
  const split = splitPresets.find((preset) => preset.id === "split-large-small");
  sameArray(split.events.map((event) => event.volumeMl), [100, 60]);
}

console.log("cartridge-aware split preset tests passed");

{
  assert.equal(productPresets.hyqvia, undefined);
  const hizentraInventory = autoAllocateProductCartridges(35, productPresets.hizentra.cartridgeSizesMl).inventory;
  assert.equal(closestFeasibleVolume(32.5, hizentraInventory), 35);
  assert.equal(closestFeasibleVolume(120, parseCartridgeInventory("50x2, 10x2")), 120);
}

{
  const allocation = autoAllocateProductCartridges(160, productPresets.hizentra.cartridgeSizesMl);
  assert.equal(allocation.volumeMl, 160);
  sameArray(allocation.inventory, [
    { volumeMl: 50, count: 3 },
    { volumeMl: 20, count: 0 },
    { volumeMl: 10, count: 1 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation.inventory, 160);
  assert.equal(inventoryTextFromInventory(allocation.inventory), "50x3, 10x1");
}

{
  const allocation = autoAllocateProductCartridges(120, productPresets.hizentra.cartridgeSizesMl);
  assert.equal(allocation.volumeMl, 120);
  sameArray(allocation.inventory, [
    { volumeMl: 50, count: 2 },
    { volumeMl: 20, count: 1 },
    { volumeMl: 10, count: 0 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation.inventory, 120);
  assert.equal(inventoryTextFromInventory(allocation.inventory), "50x2, 20x1");
}

{
  const wrongFor160 = inventoryFromCounts({ 50: 2, 20: 1, 10: 0, 5: 0 });
  assertInvalidCartridgeTotal(wrongFor160, 160);
  assert.equal(selectedCartridgeVolume(wrongFor160), 120);

  const wrongFor120 = inventoryFromCounts({ 50: 3, 20: 0, 10: 1, 5: 0 });
  assertInvalidCartridgeTotal(wrongFor120, 120);
  assert.equal(selectedCartridgeVolume(wrongFor120), 160);
}

{
  const allocation = autoAllocateProductCartridges(160, productPresets.cuvitru.cartridgeSizesMl);
  assert.equal(allocation.volumeMl, 160);
  sameArray(allocation.inventory, [
    { volumeMl: 50, count: 3 },
    { volumeMl: 40, count: 0 },
    { volumeMl: 20, count: 0 },
    { volumeMl: 10, count: 1 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation.inventory, 160);

  const wrongForCuvitru = inventoryFromCounts({ 50: 2, 40: 1, 20: 0, 10: 0, 5: 0 });
  assertInvalidCartridgeTotal(wrongForCuvitru, 160);
  assert.equal(selectedCartridgeVolume(wrongForCuvitru), 140);
}

{
  const allocation = autoAllocateProductCartridges(120, productPresets.cuvitru.cartridgeSizesMl);
  assert.equal(allocation.volumeMl, 120);
  sameArray(allocation.inventory, [
    { volumeMl: 50, count: 2 },
    { volumeMl: 40, count: 0 },
    { volumeMl: 20, count: 1 },
    { volumeMl: 10, count: 0 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation.inventory, 120);
}

{
  const allocation160 = autoAllocateProductCartridges(160, productPresets.xembify.cartridgeSizesMl);
  assert.equal(allocation160.volumeMl, 160);
  sameArray(allocation160.inventory, [
    { volumeMl: 50, count: 3 },
    { volumeMl: 20, count: 0 },
    { volumeMl: 10, count: 1 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation160.inventory, 160);

  const allocation120 = autoAllocateProductCartridges(120, productPresets.xembify.cartridgeSizesMl);
  assert.equal(allocation120.volumeMl, 120);
  sameArray(allocation120.inventory, [
    { volumeMl: 50, count: 2 },
    { volumeMl: 20, count: 1 },
    { volumeMl: 10, count: 0 },
    { volumeMl: 5, count: 0 },
  ]);
  assertValidCartridgeTotal(allocation120.inventory, 120);

  const wrongForXembify = inventoryFromCounts({ 50: 2, 20: 0, 10: 1, 5: 0 });
  assertInvalidCartridgeTotal(wrongForXembify, 120);
  assert.equal(selectedCartridgeVolume(wrongForXembify), 110);
}

console.log("product dose rounding tests passed");

{
  const params = {
    absorptionHalfTimeDays: 1.4,
    eliminationHalfLifeDays: 30,
    simulationHorizonDays: 180,
    timestepDays: 0.25,
    steadyWindowDays: 28,
    switchPreconditionDays: 140,
    switchHorizonDays: 180,
  };
  const reference = presets[0];
  const referenceSim = simulateRegimen(reference, params, { concentrationGPerMl: 0.2 });
  const referenceAvg = computeSteadyWindowStats(referenceSim, 28).average;
  const switchSim = simulateSwitchScenario(reference, reference, params, { concentrationGPerMl: 0.2 }, referenceAvg);
  const day180Continue = switchSim.continueReference.points.at(-1).exposure;
  const day180Switch = switchSim.switchComparator.points.at(-1).exposure;
  approx(day180Continue, day180Switch, 0.001);
}

console.log("switch scenario tests passed");

{
  const reference = presets[0];
  const curves = intervalScenarioCurves(reference, 180);
  const band = intervalBandFromCurves(curves);
  const centerCurve = curves.find((curve) => (
    curve.scenario.baselinePreScigIggMgDl === state.calibration.baselinePreScigIggMgDl
    && curve.scenario.absorptionHalfTimeDays === state.params.absorptionHalfTimeDays
    && curve.scenario.eliminationHalfLifeDays === state.params.eliminationHalfLifeDays
  ));

  assert.ok(curves.length >= 2, "extended interval should include uncertainty scenarios");
  assert.ok(band.length > 100, "extended interval should follow the full tail");
  assert.ok(centerCurve, "extended interval should retain the center scenario");
  const initial = centerCurve.points[0].value;
  const final = centerCurve.points.at(-1).value;
  const baseline = centerCurve.scenario.baselinePreScigIggMgDl;
  assert.ok(final >= baseline, "held-dose curve should not fall below the endogenous baseline");
  assert.ok(final - baseline < initial - baseline, "treatment contribution should wane after doses stop");
  assert.ok(band.find((point) => point.x === 14).mid > band.find((point) => point.x === 30).mid);

  const crossing = firstWaningCrossing([
    { day: 0, value: 100 },
    { day: 1, value: 120 },
    { day: 2, value: 110 },
    { day: 3, value: 90 },
  ], 100);
  assert.equal(crossing.kind, "crosses");
  approx(crossing.day, 2.5, 0.001);
}

console.log("extended interval tests passed");

{
  state.product.presetId = "cuvitru";
  state.product.name = "Cuvitru 20%";
  state.product.concentrationGPerMl = 0.2;
  state.product.tubing = "F1200";
  state.product.cartridgeSelectionMode = "manual";
  state.product.cartridgeInventory = inventoryFromCounts({ 50: 2, 20: 1, 10: 0, 5: 0 });
  state.product.referenceRunMinutes = 52;
  state.dosing.entryMode = "total";
  state.dosing.totalDoseUnit = "mL";
  state.dosing.totalDoseMl = 120;
  state.dosing.totalDoseG = 24;
  state.params.absorptionHalfTimeDays = 1.8;
  state.params.eliminationHalfLifeDays = 28;
  state.params.simulationHorizonDays = 365;
  state.params.switchPreconditionDays = 168;
  state.calibration.mode = "neurologic";
  state.calibration.bodyWeightKg = 72;
  state.reference = {
    id: "q7",
    presetId: "custom",
    name: "Custom reference",
    cycleLengthDays: 10,
    events: [
      { day: 0, volumeMl: 80, sites: 4 },
      { day: 5, volumeMl: 40, sites: 2 },
    ],
  };
  state.comparators = [
    {
      id: "comp-custom",
      presetId: "custom",
      name: "Custom comparator",
      cycleLengthDays: 14,
      events: [{ day: 0, volumeMl: 120, sites: 5 }],
    },
  ];
  state.activeComparatorId = "comp-custom";
  state.switchComparatorId = "comp-custom";
  state.chartWindow = "90";
  state.chartMode = "switch";
  state.interval.regimenId = "comp-custom";
  state.interval.horizonDays = 120;
  state.interval.checkpointDay = 28;
  state.interval.upperThresholdMgDl = 1900;
  state.interval.lowerThresholdMgDl = 1100;

  const payload = serializeSimulatorState();
  const token = encodeSharePayload(payload);
  assert.ok(token.length > 100);
  sameArray(decodeSharePayload(token), payload);

  state.product.name = "Changed product";
  state.product.cartridgeSelectionMode = "auto";
  state.dosing.entryMode = "protocol";
  state.reference.name = "Changed reference";
  state.comparators = [];
  assert.equal(applySimulatorState(decodeSharePayload(token)), true);

  assert.equal(state.product.name, "Cuvitru 20%");
  assert.equal(state.product.cartridgeSelectionMode, "manual");
  assert.equal(state.product.referenceRunMinutes, 52);
  assert.equal(state.dosing.entryMode, "total");
  assert.equal(state.params.simulationHorizonDays, 365);
  assert.equal(state.calibration.bodyWeightKg, 72);
  assert.equal(state.reference.name, "Custom reference");
  assert.equal(state.reference.events.length, 2);
  assert.equal(state.comparators[0].name, "Custom comparator");
  assert.equal(state.activeComparatorId, "comp-1", "shared comparator IDs should be regenerated");
  assert.equal(state.chartMode, "switch");
  assert.equal(state.interval.regimenId, "comp-1", "interval selection should follow the regenerated comparator ID");
  assert.equal(state.interval.horizonDays, 120);
  assert.equal(state.interval.checkpointDay, 28);
  assert.equal(state.interval.upperThresholdMgDl, 1900);
  assert.equal(state.interval.lowerThresholdMgDl, 1100);
  assert.equal(selectedCartridgeVolume(state.product.cartridgeInventory), 120);

  const hostilePayload = structuredClone(payload);
  hostilePayload.m.h = 1000000000;
  hostilePayload.m.ts = 0.000001;
  hostilePayload.g.w = 1000000;
  hostilePayload.r.n = '<img id="unsafe-shared-markup" src=x>';
  hostilePayload.cs = Array.from({ length: 20 }, (_item, index) => ({
    i: `\" onmouseover=\"unsafe-${index}`,
    p: "custom",
    n: `Comparator ${index}`,
    c: 1000000,
    e: Array.from({ length: 30 }, () => [-20, 1000000, 100]),
  }));
  hostilePayload.a = hostilePayload.cs[3].i;
  hostilePayload.sw = hostilePayload.cs[4].i;
  hostilePayload.x.r = hostilePayload.cs[2].i;
  assert.equal(applySimulatorState(hostilePayload), true);
  assert.equal(state.params.simulationHorizonDays, 365, "unknown simulation horizons should fall back to a safe allowed value");
  assert.equal(state.params.timestepDays, 0.25, "unknown timesteps should fall back to a safe allowed value");
  assert.equal(state.calibration.bodyWeightKg, 300, "shared numeric inputs should be bounded");
  assert.equal(state.comparators.length, 4, "shared comparator count should be bounded");
  assert.deepEqual(state.comparators.map((comparator) => comparator.id), ["comp-1", "comp-2", "comp-3", "comp-4"]);
  assert.ok(state.comparators.every((comparator) => comparator.events.length === 6), "shared event counts should be bounded");
  assert.ok(state.comparators.every((comparator) => comparator.cycleLengthDays === 365));
  assert.ok(state.comparators.every((comparator) => comparator.events.every((event) => event.day >= 0 && event.day < 365 && event.volumeMl <= 5000 && event.sites <= 8)));
  assert.equal(state.activeComparatorId, "comp-4");
  assert.equal(state.switchComparatorId, "comp-1", "a selection beyond the comparator limit should fall back safely");
  assert.equal(state.interval.regimenId, "comp-3");
  assert.throws(() => decodeSharePayload("a".repeat(24001)), /too large/);
}

console.log("share state round-trip tests passed");
