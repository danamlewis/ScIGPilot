"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const code = fs.readFileSync("script.js", "utf8");
const context = {
  console,
  structuredClone,
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
  parseCartridgeInventory,
  cloneInventory,
  allocateCartridges,
  estimateInfusionTime,
  formatMinutes,
  productPresets,
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
  parseCartridgeInventory,
  cloneInventory,
  allocateCartridges,
  estimateInfusionTime,
  formatMinutes,
  productPresets,
} = context.__testApi;

const sameArray = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

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
