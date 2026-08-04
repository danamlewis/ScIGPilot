"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const qrCode = fs.readFileSync(path.join(root, "qrcode.js"), "utf8");
const appCode = fs.readFileSync(path.join(root, "script.js"), "utf8");

function createApp(url = "http://localhost:4183/", { withChart = true } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  window.console = console;
  window.structuredClone = structuredClone;
  window.Buffer = Buffer;
  if (!("dataset" in window.Element.prototype)) {
    Object.defineProperty(window.Element.prototype, "dataset", {
      get() {
        const values = {};
        Array.from(this.attributes || []).forEach((attribute) => {
          if (!attribute.name.startsWith("data-")) return;
          const key = attribute.name
            .slice(5)
            .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
          values[key] = attribute.value;
        });
        return values;
      },
    });
  }
  const canvasContext = new Proxy({}, {
    get(_target, property) {
      if (property === "measureText") return (text) => ({ width: String(text).length * 7 });
      if (property === "createLinearGradient") return () => ({ addColorStop() {} });
      if (property === "canvas") return {};
      return () => undefined;
    },
    set() {
      return true;
    },
  });
  window.HTMLCanvasElement.prototype.getContext = () => canvasContext;
  if (withChart) {
    window.Chart = class ChartStub {
      constructor() {
        this.options = { scales: { x: {} } };
        this.data = {};
      }

      destroy() {}

      resize() {}

      update() {}
    };
  }
  window.print = () => undefined;
  window.navigator.clipboard = { writeText: async () => undefined };
  const context = dom.getInternalVMContext();
  vm.runInContext(qrCode, context);
  vm.runInContext(`${appCode}\ninit();`, context);
  return dom;
}

function input(dom, id) {
  return dom.window.document.getElementById(id);
}

function setValue(dom, id, value) {
  const element = input(dom, id);
  element.value = value;
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

{
  const dom = createApp();

  const patientProfilePanel = input(dom, "setup");
  const doseSetupPanel = input(dom, "doseSetupPanel");
  const bodyWeight = input(dom, "bodyWeightKg");
  assert.equal(patientProfilePanel.querySelector("h2").textContent.trim(), "Patient Profile");
  assert.equal(doseSetupPanel.hidden, true, "default profiles should not show redundant dose setup");
  assert.equal(patientProfilePanel.contains(doseSetupPanel), true, "custom dose setup should live inside Patient Profile");
  assert.equal(doseSetupPanel.contains(bodyWeight), false, "weight should remain visible when a built-in profile is selected");
  assert.equal(bodyWeight.parentElement.parentElement.classList.contains("scenario-picker-row"), true, "weight should sit beside the profile selector");
  assert.equal(input(dom, "doseSlope").value, "500", "the initial PI slope should match the applied PI preset");
  assert.ok(input(dom, "iggScenarioMode").parentElement.parentElement.compareDocumentPosition(doseSetupPanel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

  setValue(dom, "bodyWeightKg", "80");
  assert.equal(input(dom, "totalDoseG").value, "8", "changing weight should recalculate the built-in profile dose");
  assert.equal(dom.window.document.querySelector('[data-type="reference"][data-field="volumeMl"]').value, "40", "weight changes should regenerate the reference schedule");
  assert.ok(input(dom, "scenarioDoseEffect").textContent.includes("80 kg"), "the setup guidance should confirm the active weight");
  bodyWeight.value = "-5";
  bodyWeight.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(bodyWeight.getAttribute("aria-invalid"), "true", "an out-of-range numeric edit should be exposed to assistive technology while it is being corrected");
  assert.ok(input(dom, "scenarioDoseEffect").textContent.includes("80 kg"), "an invalid in-progress value must not recalculate the model");
  bodyWeight.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(input(dom, "bodyWeightKg").value, "1", "a committed weight below the supported range should be bounded");
  assert.equal(input(dom, "bodyWeightKg").hasAttribute("aria-invalid"), false, "the invalid state should clear after the form displays the bounded value");
  assert.ok(input(dom, "scenarioDoseEffect").textContent.includes("at 1 kg"), "an invalid displayed weight must not drive a contradictory model result");
  setValue(dom, "bodyWeightKg", "301");
  assert.equal(input(dom, "bodyWeightKg").value, "300", "a committed weight above the supported range should be bounded");
  setValue(dom, "bodyWeightKg", "65");
  assert.equal(input(dom, "bodyWeightKg").hasAttribute("aria-invalid"), false, "valid numeric input should clear the invalid state");

  const chartsSection = input(dom, "charts");
  const iggChartPanel = dom.window.document.querySelector('[data-chart-panel="igg"]');
  const intervalSection = input(dom, "intervalExplorer");
  const sharePanel = dom.window.document.querySelector(".share-panel");
  const advancedSettings = input(dom, "advancedSettings");
  const advancedIggAssumptions = input(dom, "advancedIggAssumptions");
  const finalChartMode = dom.window.document.querySelector('[data-chart-panel="switch"]');
  const interpretationNotes = dom.window.document.querySelector(".interpretation-notes");
  assert.ok(chartsSection.compareDocumentPosition(intervalSection) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(chartsSection.compareDocumentPosition(iggChartPanel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(chartsSection.querySelector('[data-chart-panel="igg"]'), null, "IgG charts should be a peer panel, not nested in the selector");
  assert.ok(finalChartMode.compareDocumentPosition(intervalSection) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(sharePanel.tagName, "DETAILS", "share/export should be reachable as a compact disclosure");
  assert.equal(sharePanel.open, false, "share/export should start collapsed");
  assert.ok(intervalSection.compareDocumentPosition(sharePanel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(sharePanel.compareDocumentPosition(interpretationNotes) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(intervalSection.compareDocumentPosition(interpretationNotes) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(patientProfilePanel.contains(advancedSettings), true, "advanced settings should be nested in Patient Profile");
  assert.ok(doseSetupPanel.compareDocumentPosition(advancedSettings) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(advancedSettings.compareDocumentPosition(advancedIggAssumptions) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "advanced settings should sit immediately before advanced IgG assumptions");
  assert.equal(advancedSettings.nextElementSibling, advancedIggAssumptions);
  assert.equal(advancedSettings.hasAttribute("open"), false, "advanced settings should start collapsed");
  assert.equal(advancedSettings.contains(input(dom, "productPreset")), true);
  assert.equal(advancedSettings.contains(input(dom, "simulationHorizon")), true);
  const chartScript = dom.window.document.querySelector('script[src="vendor/chart.umd.min.js?v=4.4.1"]');
  assert.ok(chartScript, "Chart.js should be loaded from the vendored runtime asset");
  assert.equal(chartScript.hasAttribute("integrity"), false, "the local Chart.js asset should not retain CDN-only integrity metadata");
  assert.equal(fs.existsSync(path.join(root, "vendor", "Chart.js-LICENSE.md")), true, "the vendored Chart.js license should be retained");
  const siteFooter = dom.window.document.querySelector(".site-footer");
  assert.ok(siteFooter.textContent.includes("v0.1.0"), "the browser footer should identify the release version");
  assert.equal(siteFooter.querySelector("a").href, "https://github.com/danamlewis/ScIGPilot", "the browser footer should link to the repository");
  assert.deepEqual(Array.from(input(dom, "productPreset").options).map((option) => option.value), ["hizentra", "cuvitru", "xembify", "custom"]);
  assert.equal(interpretationNotes.querySelectorAll("article").length, 0, "interpretation notes should be compact helper copy, not cards");
  assert.ok(input(dom, "amplitudeBandSeriesLegend").textContent.includes("Reference: 35 mL every 7 days"));
  assert.ok(input(dom, "amplitudeBandSeriesLegend").textContent.includes("Comparator 1: 35 mL every 9 days"));
  assert.ok(input(dom, "amplitudeBandSeriesLegend").textContent.includes("Comparator 2: 35 mL every 14 days"));
  assert.ok(input(dom, "amplitudeSwitchSeriesLegend").textContent.includes("Comparator 1: 35 mL every 9 days"));
  assert.ok(input(dom, "amplitudeSwitchSeriesLegend").textContent.includes("Comparator 2: 35 mL every 14 days"));
  assert.equal(input(dom, "amplitudeSwitchSeriesLegend").querySelectorAll("span").length, 2, "switch IgG chart should include every comparator");
  assert.equal(dom.window.document.querySelector('[data-chart-mode="burden"]'), null, "duplicative model analysis tab should be removed");
  assert.equal(dom.window.document.querySelector('[data-chart-panel="burden"]'), null, "duplicative model analysis panel should be removed");
  assert.equal(dom.window.document.querySelectorAll('[role="tab"]').length, 4);
  const iggTab = dom.window.document.querySelector('[data-chart-mode="igg"]');
  const relativeTab = dom.window.document.querySelector('[data-chart-mode="relative"]');
  assert.equal(iggTab.getAttribute("aria-selected"), "true");
  assert.equal(dom.window.document.querySelector('[data-chart-panel="igg"]').getAttribute("aria-hidden"), "false");
  assert.ok(Array.from(dom.window.document.querySelectorAll("canvas")).every((canvas) => canvas.getAttribute("role") === "img" && canvas.getAttribute("aria-label")), "every chart canvas should have an accessible description");
  iggTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(relativeTab.getAttribute("aria-selected"), "true", "arrow keys should move between chart tabs");
  assert.equal(dom.window.document.querySelector('[data-chart-panel="relative"]').getAttribute("aria-hidden"), "false");
  relativeTab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  assert.equal(iggTab.getAttribute("aria-selected"), "true");
  const assumptionAudit = input(dom, "assumptionAudit");
  assert.equal(assumptionAudit.classList.contains("hidden"), true, "model assumptions content should stay hidden");
  assert.equal(dom.window.document.body.textContent.includes("View model assumptions used"), false);
  const intervalDays = Array.from(dom.window.document.querySelectorAll("[data-interval-day]"));
  assert.deepEqual(intervalDays.map((button) => Number(button.dataset.intervalDay)), [7, 14, 21, 28]);
  assert.equal(intervalDays[0].classList.contains("active"), true);
  assert.ok(input(dom, "resultsTable").innerHTML.includes("metric-status-ok"));
  assert.ok(input(dom, "resultsTable").textContent.includes("Cartridge feasibility"));
  assert.equal(input(dom, "resultsTable").textContent.includes("Matches available cartridges"), false);
  assert.equal(input(dom, "resultsHeading").textContent.trim(), "Results");
  assert.equal(input(dom, "resultsHeading").getAttribute("role"), "heading");
  assert.equal(dom.window.document.querySelector("#resultsSummaryHeading"), null);
  assert.equal(dom.window.document.querySelector("#keyComparisonTitle"), null);
  assert.equal(dom.window.document.querySelector("#resultsDashboard"), null);
  assert.equal(dom.window.document.querySelector("#deltaNarratives"), null);
  assert.equal(dom.window.document.querySelector("#interpretation"), null);
  assert.equal(input(dom, "resultsTable").textContent.includes("Infusion time detail"), false);
  assert.equal(input(dom, "resultsTable").textContent.includes("Day 0: 32 min"), false);
  assert.equal(input(dom, "resultsTable").textContent.includes("Time by cartridge"), false);
  assert.equal(dom.window.document.querySelector("#compareBar"), null, "redundant top comparison bar should be removed");
  const infusionTimeRow = Array.from(input(dom, "resultsTable").querySelectorAll("tbody tr")).find((row) => row.querySelector("td").textContent.trim() === "Estimated infusion time");
  assert.ok(infusionTimeRow, "concise infusion-time row should be present");
  assert.equal(infusionTimeRow.querySelectorAll("td")[1].textContent.replace(/\s+/g, " ").trim(), "32 min (18+9+5 min)");
  assert.ok(infusionTimeRow.querySelectorAll("td")[1].querySelector(".infusion-time-cell"), "infusion time should include the minute breakdown in the same cell");
  ["Volume per day (mL/day)", "Dose per day (g/day)", "Longest gap (days)", "Final-window drift check"].forEach((removedMetric) => {
    assert.equal(input(dom, "resultsTable").textContent.includes(removedMetric), false, `${removedMetric} should be omitted from detailed metrics`);
  });
  ["Sites per 14 days", "Sites per 365 days", "Average volume per site", "Normalized average exposure", "Coefficient of variation"].forEach((retainedMetric) => {
    assert.equal(input(dom, "resultsTable").textContent.includes(retainedMetric), true, `${retainedMetric} should remain unchanged`);
  });
  assert.ok(input(dom, "amplitudeSummary").textContent.includes("Reference schedule waning if the next dose is delayed"), "delayed-dose waning table should remain unchanged");
  assert.equal(dom.window.document.body.textContent.includes("Reset to defaults"), false, "no reset control should be added");
  const resultsDetails = input(dom, "resultsTable").parentElement;
  assert.equal(resultsDetails.hasAttribute("open"), true, "detailed metrics table should be expanded by default");
  assert.equal(input(dom, "comparatorChooserStep").hidden, false, "q9 and q14 comparator cards should remain visible");
  assert.equal(input(dom, "comparatorPresetStep").hidden, true, "comparator preset controls should start collapsed");
  assert.equal(input(dom, "comparatorEditorStep").hidden, true, "no comparator should be edited by default");
  assert.equal(input(dom, "candidateEditor").textContent, "");
  assert.ok(input(dom, "comparatorManager").textContent.includes("35 mL every 9 days"));
  assert.ok(input(dom, "comparatorManager").textContent.includes("35 mL every 14 days"));

  const doubleDoseDom = createApp();
  setValue(doubleDoseDom, "bodyWeightKg", "55");
  const doubleDoseEdit = input(doubleDoseDom, "comparatorManager").querySelector('[data-action="select-comparator"][data-comparator-id="comp-1"]');
  doubleDoseEdit.dispatchEvent(new doubleDoseDom.window.Event("click", { bubbles: true }));
  const doubleDoseCycle = input(doubleDoseDom, "candidateEditor").querySelector('[data-field="cycleLengthDays"]');
  doubleDoseCycle.value = "14";
  doubleDoseCycle.dispatchEvent(new doubleDoseDom.window.Event("change", { bubbles: true }));
  const doubleDoseVolume = input(doubleDoseDom, "candidateEditor").querySelector('[data-field="volumeMl"]');
  doubleDoseVolume.value = "60";
  doubleDoseVolume.dispatchEvent(new doubleDoseDom.window.Event("change", { bubbles: true }));
  const doubleDoseFeasibilityRow = Array.from(input(doubleDoseDom, "resultsTable").querySelectorAll("tbody tr"))
    .find((row) => row.querySelector("td").textContent.trim() === "Cartridge feasibility");
  assert.ok(doubleDoseFeasibilityRow.querySelectorAll("td")[2].querySelector(".metric-status-ok"), "a doubled comparator dose should auto-allocate its own available cartridge mix");
  const doubleDoseTimeRow = Array.from(input(doubleDoseDom, "resultsTable").querySelectorAll("tbody tr"))
    .find((row) => row.querySelector("td").textContent.trim() === "Estimated infusion time");
  assert.ok(doubleDoseTimeRow.querySelectorAll("td")[2].textContent.includes("46+9 min"), "the doubled comparator should use a 50 mL and 10 mL cartridge allocation");

  const switchModeButton = dom.window.document.querySelector('[data-chart-mode="switch"]');
  assert.equal(switchModeButton.textContent.trim(), "Relative after switch");
  assert.equal(finalChartMode.querySelector("h2").textContent.trim(), "Relative Exposure After Switch");
  assert.ok(finalChartMode.textContent.includes("normalized to the reference average"));

  const helpTips = Array.from(dom.window.document.querySelectorAll(".help-tip"));
  assert.ok(helpTips.length >= 5, "contextual help should remain available throughout the page");
  helpTips.forEach((tip) => {
    assert.equal(tip.tagName, "BUTTON");
    assert.equal(tip.hasAttribute("title"), false, "help should not depend on hover-only title tooltips");
    assert.ok(tip.getAttribute("aria-label"));
    assert.ok(tip.dataset.help);
  });
  helpTips[0].dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(helpTips[0].getAttribute("aria-expanded"), "true", "help should open on click or keyboard activation");
  dom.window.document.body.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(helpTips[0].getAttribute("aria-expanded"), "false");

  const referenceEditor = input(dom, "referenceEditor");
  assert.equal(input(dom, "referenceEditorDetails").hasAttribute("open"), false, "reference editor should start collapsed");
  const addDoseDayButton = referenceEditor.querySelector('[data-action="add-event"]');
  assert.equal(addDoseDayButton.textContent.trim(), "+ Add another dose day");
  assert.equal(referenceEditor.querySelector(".auto-apply-note"), null, "untouched reference should not show an applied notice");
  assert.equal(input(dom, "candidateEditor").querySelector(".auto-apply-note"), null, "untouched comparator should not show an applied notice");
  assert.ok(referenceEditor.textContent.includes("1 dose day already shown above"));
  addDoseDayButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(input(dom, "referenceEditor").querySelectorAll("tbody tr").length, 2);
  assert.ok(input(dom, "referenceEditor").textContent.includes("Changes applied automatically"));
  assert.equal(input(dom, "candidateEditor").querySelector(".auto-apply-note"), null, "reference edits should not affect comparator notice state");
  assert.equal(input(dom, "referenceEditor").querySelector('[data-event-index="1"][data-field="day"]').value, "1");
  input(dom, "referenceEditor").querySelector('[data-action="remove-event"][data-event-index="1"]').dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(input(dom, "referenceEditor").querySelectorAll("tbody tr").length, 1);

  let referenceCycleInput = input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]');
  assert.equal(referenceCycleInput.step, "1");
  assert.equal(referenceCycleInput.min, "1");
  referenceCycleInput.value = "10";
  referenceCycleInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  referenceCycleInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]').value, "10", "whole-day cycle edits should remain whole");
  referenceCycleInput = input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]');
  referenceCycleInput.value = "9.25";
  referenceCycleInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  referenceCycleInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]').value, "9", "fractional cycle edits should normalize to a whole day");
  setValue(dom, "referencePreset", "q7");
  assert.equal(input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]').value, "9", "reference presets should wait for explicit Apply");
  assert.equal(input(dom, "applyReferencePreset").disabled, false);
  input(dom, "applyReferencePreset").dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(input(dom, "referenceEditor").querySelector('[data-field="cycleLengthDays"]').value, "7");

  setValue(dom, "iggScenarioMode", "neurologic");
  assert.equal(doseSetupPanel.hidden, true, "high-dose default should not show redundant dose setup");
  assert.equal(input(dom, "doseEntryMode").value, "protocol");
  assert.equal(input(dom, "protocolDoseGKgWeek").value, "0.4");
  assert.equal(input(dom, "totalDoseG").value, "26");
  assert.equal(dom.window.document.querySelector('[data-type="reference"][data-field="volumeMl"]').value, "130");
  assert.ok(Array.from(input(dom, "referencePreset").options).some((option) => option.textContent.includes("130 mL every 14 days")));
  assert.ok(Array.from(input(dom, "candidatePreset").options).some((option) => option.textContent.includes("130 mL every 9 days")));
  assert.ok(input(dom, "referenceRegimenHelp").textContent.includes("26 g / 130 mL"));
  const highDoseInfusionTimeRow = Array.from(input(dom, "resultsTable").querySelectorAll("tbody tr")).find((row) => row.querySelector("td").textContent.trim() === "Estimated infusion time");
  assert.equal(input(dom, "resultsTable").textContent.includes("Time by cartridge"), false, "separate cartridge timing row should stay removed");
  assert.ok(highDoseInfusionTimeRow.querySelectorAll("td")[1].textContent.includes("+"), "high-dose infusion timing should show additive minute detail");

  setValue(dom, "iggScenarioMode", "custom");
  assert.equal(doseSetupPanel.hidden, false, "custom patients should reveal dose setup");
  assert.ok(doseSetupPanel.textContent.includes("Custom profile selected"));
  assert.ok(input(dom, "scenarioDoseEffect").textContent.includes("Custom dose controls are open below"));
  setValue(dom, "iggScenarioMode", "neurologic");

  const editSecondComparator = input(dom, "comparatorManager").querySelector('[data-action="select-comparator"][data-comparator-id="comp-2"]');
  editSecondComparator.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  input(dom, "closeComparatorEditor").dispatchEvent(new dom.window.Event("click", { bubbles: true }));

  const editFirstComparator = input(dom, "comparatorManager").querySelector('[data-action="select-comparator"][data-comparator-id="comp-1"]');
  assert.equal(editFirstComparator.textContent.trim(), "Edit this");
  editFirstComparator.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(input(dom, "comparatorPresetStep").hidden, false);
  assert.equal(input(dom, "comparatorEditorStep").hidden, false);
  const comparatorCycleBefore = dom.window.document.querySelector('[data-type="candidate"][data-field="cycleLengthDays"]').value;
  setValue(dom, "candidatePreset", "");
  const candidateNameInput = dom.window.document.querySelector('[data-type="candidate"][data-field="name"]');
  candidateNameInput.value = "My comparison schedule";
  candidateNameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  candidateNameInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(input(dom, "comparatorManager").textContent.includes("My comparison schedule"), true, "custom comparator names should survive automatic recalculation");
  setValue(dom, "candidatePreset", "q14");
  assert.equal(comparatorCycleBefore, "9");
  assert.equal(dom.window.document.querySelector('[data-type="candidate"][data-field="cycleLengthDays"]').value, "9", "selecting a preset should not apply it immediately");
  assert.equal(input(dom, "applyCandidatePreset").disabled, false);
  input(dom, "applyCandidatePreset").dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(dom.window.document.querySelector('[data-type="candidate"][data-field="cycleLengthDays"]').value, "14");
  assert.ok(input(dom, "candidateEditor").textContent.includes("Changes applied automatically"));
  input(dom, "closeComparatorEditor").dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  assert.equal(input(dom, "comparatorPresetStep").hidden, true);
  assert.equal(input(dom, "comparatorEditorStep").hidden, true);
  assert.equal(input(dom, "candidateEditor").textContent, "");

  setValue(dom, "productPreset", "cuvitru");
  setValue(dom, "bodyWeightKg", "72");
  setValue(dom, "doseEntryMode", "total");
  setValue(dom, "totalDoseUnit", "mL");
  setValue(dom, "totalDoseMl", "120");
  setValue(dom, "simulationHorizon", "365");
  setValue(dom, "switchPreconditionDays", "168");
  setValue(dom, "intervalHorizonDays", "120");
  setValue(dom, "intervalUpperThreshold", "1450");

  const titleBeforePrint = dom.window.document.title;
  input(dom, "printReport").dispatchEvent(new dom.window.Event("click", { bubbles: true }));

  const shareUrl = input(dom, "shareUrl").value;
  const qrSvg = dom.window.document.querySelector("#shareQr svg");
  const shareHashParams = new URLSearchParams(new URL(shareUrl).hash.slice(1));
  assert.ok(shareHashParams.get("s"), "share URL should include encoded state in the fragment");
  assert.ok(qrSvg, "QR SVG should be generated");
  assert.ok(qrSvg.querySelectorAll("path").length > 0, "QR SVG should contain path modules");
  assert.match(dom.window.document.title, /^SCIG Schedule Simulator - [A-Z][a-z]{2}-\d{1,2}-\d{4}$/, "PDF title should suggest a dated filename");
  const printReport = input(dom, "printReportSummary");
  assert.equal(printReport.querySelectorAll(".print-page").length, 5, "the PDF should use a dedicated five-page report layout");
  assert.ok(printReport.querySelector(".print-results-table .metric-table"), "the print report should include the full metrics table");
  const primaryPrintCharts = Array.from(printReport.querySelectorAll(".print-figure > canvas"));
  assert.deepEqual(
    primaryPrintCharts.map((canvas) => canvas.id),
    ["printAmplitudeBandChart", "printAmplitudeSwitchChart", "printExposureChart", "printSwitchChart", "printIntervalChart"],
    "the print report should include every primary modeled graph",
  );
  assert.ok(primaryPrintCharts.every((canvas) => canvas.width >= 1000 && canvas.height >= 410), "print charts should be rendered at report resolution");
  assert.ok(printReport.textContent.includes("Threshold crossings"), "the extended-interval interpretation should be included");
  assert.equal(printReport.textContent.includes(shareUrl), false, "the encoded share URL should not be printed as a long visible string");
  assert.equal(printReport.querySelector(".print-share-card a").getAttribute("href"), shareUrl, "the PDF should preserve a clickable setup link");
  assert.equal(printReport.querySelectorAll(".print-page-footer").length, 5, "every PDF page should include a footer");
  assert.ok(Array.from(printReport.querySelectorAll(".print-page-footer")).every((footer) => footer.textContent.includes("v0.1.0")), "every PDF page should identify the release version");
  assert.ok(Array.from(printReport.querySelectorAll(".print-page-footer a")).every((link) => link.getAttribute("href") === "https://github.com/danamlewis/ScIGPilot"), "every PDF page should link to the repository");
  dom.window.dispatchEvent(new dom.window.Event("afterprint"));
  assert.equal(dom.window.document.title, titleBeforePrint, "the browser tab title should be restored after printing");

  const hydrated = createApp(shareUrl);
  assert.equal(input(hydrated, "productPreset").value, "cuvitru");
  assert.equal(input(hydrated, "bodyWeightKg").value, "72");
  assert.equal(input(hydrated, "doseEntryMode").value, "total");
  assert.equal(input(hydrated, "totalDoseUnit").value, "mL");
  assert.equal(input(hydrated, "totalDoseMl").value, "120");
  assert.equal(input(hydrated, "simulationHorizon").value, "365");
  assert.equal(input(hydrated, "switchPreconditionDays").value, "168");
  assert.equal(input(hydrated, "intervalHorizonDays").value, "120");
  assert.equal(input(hydrated, "intervalUpperThreshold").value, "1450");
  assert.ok(new URLSearchParams(new URL(input(hydrated, "shareUrl").value).hash.slice(1)).get("s"), "hydrated page should regenerate its share link");

  const hydratedResultsLink = hydrated.window.document.querySelector('.section-nav a[href="#results"]');
  hydratedResultsLink.dispatchEvent(new hydrated.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const navigatedHashParams = new URLSearchParams(hydrated.window.location.hash.slice(1));
  assert.equal(navigatedHashParams.get("section"), "results", "section navigation should coexist with shared state");
  assert.ok(navigatedHashParams.get("s"), "section navigation should preserve an encoded state token");
  const navigatedHydrated = createApp(hydrated.window.location.href);
  assert.equal(input(navigatedHydrated, "bodyWeightKg").value, "72", "refreshing after section navigation should retain shared state");
  assert.equal(new URLSearchParams(navigatedHydrated.window.location.hash.slice(1)).get("section"), "results");

  const validToken = shareHashParams.get("s");
  const paddedToken = validToken.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(validToken.length / 4) * 4, "=");
  const hostilePayload = JSON.parse(Buffer.from(paddedToken, "base64").toString("utf8"));
  hostilePayload.r.n = '<img id="unsafe-shared-markup" src=x>';
  hostilePayload.cs[0].i = '\" onmouseover=\"unsafe';
  hostilePayload.cs[0].n = '<svg id="unsafe-comparator-markup">';
  hostilePayload.a = hostilePayload.cs[0].i;
  hostilePayload.sw = hostilePayload.cs[0].i;
  hostilePayload.x.r = hostilePayload.cs[0].i;
  const hostileToken = Buffer.from(JSON.stringify(hostilePayload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const hostileHydrated = createApp(`http://localhost:4183/#s=${hostileToken}`);
  assert.equal(hostileHydrated.window.document.getElementById("unsafe-shared-markup"), null, "shared names must not create markup");
  assert.equal(hostileHydrated.window.document.getElementById("unsafe-comparator-markup"), null, "shared comparator names must not create markup");
  assert.equal(hostileHydrated.window.document.querySelector('[data-comparator-id="comp-1"]') !== null, true, "shared comparator IDs should be regenerated");

  const fallbackDom = createApp("http://localhost:4183/", { withChart: false });
  assert.ok(input(fallbackDom, "resultsTable").querySelector("table"), "the simulator should initialize when Chart.js is unavailable");
  assert.ok(input(fallbackDom, "exposureChart").width > 0, "a canvas fallback should be drawn when Chart.js is unavailable");

  const cycleEditDom = createApp();
  const cycleEditButton = input(cycleEditDom, "comparatorManager").querySelector('[data-action="select-comparator"][data-comparator-id="comp-1"]');
  cycleEditButton.dispatchEvent(new cycleEditDom.window.Event("click", { bubbles: true }));
  const cycleEditInput = input(cycleEditDom, "candidateEditor").querySelector('[data-field="cycleLengthDays"]');
  cycleEditInput.value = "10";
  cycleEditInput.dispatchEvent(new cycleEditDom.window.Event("input", { bubbles: true }));
  input(cycleEditDom, "closeComparatorEditor").dispatchEvent(new cycleEditDom.window.Event("click", { bubbles: true }));
  assert.ok(input(cycleEditDom, "comparatorManager").textContent.includes("35 mL every 10 days"), "a simple generated name should follow the edited interval");
  assert.ok(input(cycleEditDom, "comparatorManager").textContent.includes("35 mL over 10 days"), "clicking Done should retain the visible cycle edit even without a separate change event");
  const cycleMetricRow = Array.from(input(cycleEditDom, "resultsTable").querySelectorAll("tbody tr"))
    .find((row) => row.querySelector("td").textContent.trim() === "Cycle length (days)");
  assert.equal(cycleMetricRow.querySelectorAll("td")[2].textContent.trim(), "10", "results should use the committed comparator cycle");
  assert.ok(input(cycleEditDom, "resultsTable").querySelectorAll("thead th")[2].textContent.includes("35 mL every 10 days"), "results should not retain a stale generated name");

  hydrated.window.close();
  hostileHydrated.window.close();
  fallbackDom.window.close();
  cycleEditDom.window.close();
  doubleDoseDom.window.close();
  navigatedHydrated.window.close();
  dom.window.close();

}

console.log("share UI QR and hydration tests passed");
