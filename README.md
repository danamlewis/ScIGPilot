# SCIG Schedule Simulator

A static, browser-based simulator for comparing subcutaneous immunoglobulin dosing schedules. The first version focuses on relative exposure shape, model-derived IgG amplitude estimates, dose intensity, infusion-site burden, and estimated infusion time.

The simulator is designed for comparison only. It does not estimate an individual patient's true serum IgG level, fit patient-specific parameters, or recommend dose changes.

## Run Locally

Open `index.html` in a browser.

The page is static and has no backend. The only external dependency is Chart.js pinned by exact CDN version in `index.html`.

## GitHub Pages

This project can be deployed as a GitHub Pages site by serving the repository root. No build step is required.

## Default Product Assumption

The default product setting is an example 20% SCIG concentration:

- Concentration: `0.2 g/mL`
- `50 mL = 10 g`
- `160 mL = 32 g`
- `100 mL = 20 g`
- `60 mL = 12 g`

The product name and concentration are editable so other SCIG products can be added later.

## Dose Setup

The simulator starts from a generated reference q7 product dose. Users can enter either:

- protocol dose plus body weight, e.g. `0.1 g/kg/week` and `65 kg` for the replacement default or `0.4 g/kg/week` for the high-dose neurologic default
- total product amount for the reference q7 dose, e.g. `160 mL` or `32 g`

The built-in presets are regenerated from that amount:

- q7 uses the entered amount every 7 days
- q9 uses the same amount every 9 days
- q14 uses the same amount every 14 days
- split presets choose cartridge-feasible event volumes close to a `62.5% / 37.5%` split over 16 days

For example, if the reference dose is `120 mL` and the configured cartridges are `50x2, 10x2` or `50x2, 20x1`, the generated split is `70 mL / 50 mL`, not an infeasible `75 mL / 45 mL`.

The dose setup also feeds the IgG scenario model by calculating the current `g/kg/week`.

## Exposure Model

Each dose event contributes to a relative exposure curve using a first-order absorption / first-order elimination function:

```js
contribution(t) = dose_g * (ka / (ka - ke)) * (Math.exp(-ke * t) - Math.exp(-ka * t))
```

Defaults:

- Absorption half-time: `1.4 days`
- Elimination half-life: `30 days`
- Simulation horizon: `180 days`
- Timestep: `0.25 days`
- Steady-state comparison window: final `28 days`

The current simulation starts from zero exposure at day 0. Exposure is normalized so the reference regimen's final 28-day average exposure is `100%`. Full-horizon charts therefore show accumulation toward the normalization window, not a patient who was already at maintenance steady state before day 0.

The Switch Scenario section uses a different setup: it preconditions the model on the reference regimen for a configurable number of days, then switches to the selected comparator at day 0 and follows relative exposure after that switch.

## IgG Scenario Defaults

The public-facing IgG estimate section starts from one of three editable scenario presets:

- Replacement / PI-style default
- High-dose neurologic default
- Custom upper-tail model patient

The generic replacement default does not use the prior `2613 mg/dL` example. That value is treated as a custom upper-tail day-3 value, not a typical all-comer SCIG value.

The dose-driven trough estimate uses:

```text
expected_trough_mg_dL =
  baseline_pre_SCIG_IgG_mg_dL
  + dose_slope_mg_dL_per_0_1gkgwk * dose_g_per_kg_per_week / 0.1
```

The generic replacement preset is initialized around:

- Baseline pre-SCIG IgG: `1000 mg/dL`
- Protocol dose: `0.1 g/kg/week`
- Default body weight: `65 kg`
- Reference q7 product dose with 20% SCIG: `6.5 g` / `32.5 mL`
- Steady-state trough target at the default weekly dose: `1500 mg/dL`
- Weekly peak target at the default weekly dose: `1650 mg/dL`
- Peak timing after weekly infusion: `3 days`
- Peak-to-trough ratio: `1.10`

The high-dose neurologic preset is initialized around:

- Baseline pre-SCIG IgG: `1400 mg/dL`
- Protocol dose: `0.4 g/kg/week`
- Default body weight: `65 kg`
- Reference q7 product dose with 20% SCIG: `26 g` / `130 mL`
- Steady-state trough target at the default weekly dose: `2100 mg/dL`
- Weekly peak target at the default weekly dose: `2350 mg/dL`
- Peak timing after weekly infusion: `3 days`
- Peak-to-trough ratio: `1.12`

Lab reference low/high lines are shown only for orientation against common laboratory reference intervals. They are not treatment targets for people receiving SCIG.

## Infusion-Time Estimate

The MVP uses an example 26G needle set with precision flow-rate tubing average flow-rate table. The default tubing is `F2400`.

Infusion events are checked against the configured cartridge inventory, default `50x3, 10x1` per cycle. For example, a `160 mL` event is modeled as:

```text
50 mL + 50 mL + 50 mL + 10 mL
```

The default timing uses a configurable reference time where `F2400 + 26G + 4 sites + 50 mL` equals `46 minutes`. Each cartridge run then uses:

```js
runHours = runVolumeMl / calibratedTotalFlowMlPerHour
```

The displayed infusion time is the sum of those sequential runs. It is an estimate tied to selected product/device assumptions, not an administration instruction.

## Generated Presets

Preset names and volumes are generated from the current Dose Setup and cartridge inventory. With the replacement default of `65 kg` and `0.1 g/kg/week`, the reference q7 dose is `6.5 g` / `32.5 mL` for a 20% product. With the high-dose neurologic preset at `0.4 g/kg/week`, the q7 dose is `26 g` / `130 mL`.

## Non-Goals

This MVP intentionally excludes:

- lab entry
- patient-specific fitting
- clinical recommendations
- dose-adjustment advice
- diagnosis-specific pharmacodynamic modeling
- infection-risk prediction
- true patient-specific serum IgG concentration prediction
- user accounts
- backend database
- authentication
