# Model Specification

## Purpose and Scope

The SCIG Schedule Simulator is a deterministic schedule-comparison model. It combines:

1. product-volume and cartridge arithmetic;
2. a simplified pharmacokinetic exposure curve;
3. an illustrative mapping from relative exposure to estimated total IgG;
4. schedule-burden and infusion-time calculations; and
5. switch and extended-interval scenarios.

The model is not a patient-specific pharmacokinetic fit. Its estimated IgG values are model outputs constructed from editable assumptions, not measured laboratory results. The model does not predict symptoms, relapse, infection, adverse events, or the clinical suitability of a schedule.

## Variable Classification

Every important input is described using two kinds of type.

### Provenance type

| Code | Type | Meaning |
| --- | --- | --- |
| **S** | Sourced | The default directly represents a value in an identified external source, such as labeled concentration or presentation size. |
| **D** | Derived | Calculated from other variables by the simulator. |
| **I** | Illustrative | Chosen as an example, convenience default, calibration, or sensitivity assumption. It should not be interpreted as a population estimate or treatment target. |
| **U** | User-selected | Directly editable in the interface or editable indirectly by changing a preset or regimen. |

A variable may have more than one code. For example, product concentration is **S/U**: the preset value is sourced, but a custom value can be entered.

### Computational type

| Type | Meaning |
| --- | --- |
| `number` | JavaScript double-precision number; units are stated separately. |
| `integer` | A `number` treated as a whole count or whole day. |
| `string` | Display name or identifier. |
| `enum` | A string restricted by the normal UI to listed choices. |
| `boolean` | True/false state. |
| `number[]` | Ordered list of numeric values. |
| `event[]` | Ordered dose events shaped as `{ day, volumeMl, sites }`. |
| `inventory[]` | Cartridge records shaped as `{ volumeMl, count }`. |
| `point[]` | Time series records containing time and modeled value. |

All calculations are performed client-side in JavaScript. Display rounding does not change the underlying floating-point values unless the code explicitly rounds a generated product volume or whole cycle length.

## Product, Dose, and Schedule Variables

| Variable | Computational type | Units | Default or examples | Provenance | Role |
| --- | --- | ---: | --- | --- | --- |
| `product.presetId` | `enum` | — | `hizentra` | I/U | Selects a built-in product or custom product. |
| `product.name` | `string` | — | `Hizentra 20%` | S/U | Display name only. |
| `product.concentrationGPerMl` | `number` | g/mL | `0.2` | S/U | Converts product volume to grams. |
| `product.cartridgeSizesMl` | `number[]` | mL | Product-specific sizes | S/U | Feasible unit sizes used by automatic dose allocation. |
| `product.cartridgeInventory` | `inventory[]` | mL and count | Auto-generated | D/U | Units selected to construct the reference infusion cycle. Comparator event volumes are allocated independently from the product's available sizes. |
| `dosing.entryMode` | `enum` | — | `protocol` | I/U | Chooses weight-based or total-product input. |
| `calibration.bodyWeightKg` | `number` | kg | `65` | I/U | Converts a weight-based protocol dose and normalizes dose intensity. |
| `dosing.protocolDoseGKgWeek` | `number` | g/kg/week | `0.1` replacement; `0.4` high-dose neurologic | I/U | Requested weekly weight-based dose. The labeled and published context for these examples is listed in `REFERENCES.md`. |
| `dosing.requestedWeeklyDoseG` | `number` | g | Calculated | D | Requested grams before product rounding. |
| `dosing.requestedWeeklyDoseMl` | `number` | mL | Calculated | D | Requested volume before product rounding. |
| `dosing.weeklyDoseMl` | `number` | mL | Product-rounded | D | Nearest volume constructible from available product sizes. |
| `dosing.weeklyDoseG` | `number` | g | Product-rounded | D | `weeklyDoseMl × concentrationGPerMl`. |
| `regimen.cycleLengthDays` | `integer` | days | 7, 9, or 14 in standard presets | I/U | Repetition interval for a regimen. |
| `regimen.events` | `event[]` | days, mL, sites | One event at day 0 in q7/q9/q14 presets | I/U | Dose events repeated every cycle. |
| `event.day` | `number` | days | `0` | I/U | Offset within the regimen cycle. |
| `event.volumeMl` | `number` | mL | Generated from the dose | D/U | Product volume infused at the event. |
| `event.sites` | `integer` | sites | `4` in q7/q9/q14 presets | I/U | Concurrent sites used in burden and flow calculations. |

### Dose conversion and product rounding

For weight-based entry:

```text
requested_dose_g = protocol_dose_g_per_kg_per_week × body_weight_kg
requested_dose_mL = requested_dose_g ÷ concentration_g_per_mL
```

For total-product entry, the entered grams or milliliters are converted using the same concentration.

Automatic allocation finds the reachable cartridge-volume sum nearest the requested volume. Ties prefer a sum at or above the requested volume, then the lower such sum. Generated standard schedules use the resulting product-rounded amount as the dose per cycle; extending a q7 dose unchanged to q9 or q14 therefore reduces the weekly-equivalent dose intensity.

## Pharmacokinetic Exposure Variables

| Variable | Computational type | Units | Default | Provenance | Role |
| --- | --- | ---: | ---: | --- | --- |
| `params.absorptionHalfTimeDays` | `number` | days | `1.4` | I/U | Central first-order absorption assumption. |
| `params.eliminationHalfLifeDays` | `number` | days | `30` | I/U | Central first-order elimination assumption. |
| `calibration.absorptionHalfTimeLowDays` | `number` | days | `1` | I/U | Low sensitivity-bound assumption. |
| `calibration.absorptionHalfTimeHighDays` | `number` | days | `3` | I/U | High sensitivity-bound assumption. |
| `calibration.eliminationHalfLifeLowDays` | `number` | days | `21` | I/U | Low sensitivity-bound assumption. |
| `calibration.eliminationHalfLifeHighDays` | `number` | days | `35` | I/U | High sensitivity-bound assumption. |
| `params.simulationHorizonDays` | `number` | days | `180` | I/U | Full repeating-regimen simulation horizon. |
| `params.timestepDays` | `number` | days | `0.25` | I/U | Numerical sampling interval. |
| `params.steadyWindowDays` | `number` | days | `28` | I | Final window used for normalization and summary statistics. |
| `params.switchPreconditionDays` | `number` | days | `140` | I/U | Reference dose history before a switch. |
| `params.switchHorizonDays` | `number` | days | `180` | I/U | Follow-up after a switch. |
| `ka` | `number` | 1/day | Calculated | D | First-order absorption rate constant. |
| `ke` | `number` | 1/day | Calculated | D | First-order elimination rate constant. |
| raw contribution | `number` | arbitrary exposure units | Calculated | D | Unscaled treatment-derived exposure from one event. |

The rate constants are:

```text
ka = ln(2) ÷ absorption_half_time_days
ke = ln(2) ÷ elimination_half_life_days
```

For elapsed time `t ≥ 0` after a dose event:

```text
contribution(t) = dose_g × ka / (ka - ke) × (exp(-ke × t) - exp(-ka × t))
```

When `ka` and `ke` are effectively equal, the implementation uses the limiting expression:

```text
contribution(t) = dose_g × ka × t × exp(-ke × t)
```

The raw exposure at a timepoint is the sum of all dose-event contributions at or before that timepoint. This is a Bateman-style, one-compartment first-order model. Published SCIG population models generally contain additional compartments, endogenous turnover, bioavailability, covariates, and variability; this simulator does not reproduce those models.

## Relative Exposure

The repeating-regimen model begins with no prior dose history at day 0. For each regimen, statistics are calculated over the final 28 days of the selected horizon.

Let `A_ref` be the reference regimen's mean raw exposure in that final window. Every displayed relative-exposure point is:

```text
relative_exposure_percent(t) = raw_exposure(t) ÷ A_ref × 100
```

Consequently, the reference regimen's final-window average is 100%. The early full-horizon rise is model accumulation from a zero-start assumption, not a representation of a patient already at maintenance steady state.

## IgG Calibration Variables

| Variable | Computational type | Units | Initial value | Provenance | Role |
| --- | --- | ---: | ---: | --- | --- |
| `calibration.mode` | `enum` | — | `replacement` | I/U | Selects replacement, high-dose neurologic, or custom behavior. |
| `baselinePreScigIggMgDl` | `number` | mg/dL | `1000` | I/U | Additive non-zero baseline/endogenous floor. |
| `doseSlopeMgDlPer01GKgWeek` | `number` | mg/dL per 0.1 g/kg/week | `500` for the replacement profile | I/U | Linear relationship used to construct the reference trough anchor. |
| `peakToTroughRatio` | `number` | ratio | `1.10` | I/U | Multiplies the trough anchor for every profile. |
| `tmaxDaysAfterWeeklyInfusion` | `number` | days | `3` | I/U | Time after the reference infusion used for calibration. |
| `labReferenceLowMgDl` | `number` | mg/dL | `586` | S/U | Orientation line based on one adult laboratory reference interval. |
| `labReferenceHighMgDl` | `number` | mg/dL | `1602` | S/U | Orientation line based on one adult laboratory reference interval. |
| `highIggWarningThresholdMgDl` | `number` | mg/dL | `2600` | I/U | Visual review threshold, not a toxicity or treatment threshold. |
| `baselineUncertaintyMgDl` | `number` | mg/dL | `100` | I/U | Symmetric sensitivity width around baseline. |
| `slopeUncertaintyPercent` | `number` | percent | `20` | I/U | Symmetric sensitivity width around dose slope. |
| expected trough | `number` | mg/dL | Calculated | D | Reference-regimen trough anchor. |
| expected peak | `number` | mg/dL | Calculated | D | Reference-regimen peak/calibration anchor. |
| scenario scale | `number` | mg/dL per raw exposure unit | Calculated | D | Maps raw treatment exposure into treatment-derived IgG. |
| estimated total IgG | `number` | mg/dL | Calculated | D | Baseline plus scaled modeled exposure. |

Selecting a profile calculates its dose slope from that profile's illustrative baseline, protocol dose, and target trough:

```text
profile_slope = (profile_target_trough - profile_baseline) ÷ (profile_protocol_dose ÷ 0.1)
```

The built-in profile anchors are:

| Profile | Protocol dose | Baseline | Target trough used when applying profile | Peak rule | Warning threshold | Provenance |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| Replacement / PI-style | 0.1 g/kg/week | 1000 mg/dL | 1500 mg/dL | trough × 1.10 | 2600 mg/dL | I/U |
| High-dose neurologic | 0.4 g/kg/week | 1400 mg/dL | 2100 mg/dL | trough × 1.12 | 2800 mg/dL | I/U; dose has labeled CIDP context for Hizentra |
| Custom model patient | 0.1 g/kg/week | 1000 mg/dL | 1500 mg/dL | trough × 1.10 | 2600 mg/dL | I/U |

These absolute profile values are illustrative. The laboratory reference lines are orientation only and are not used as treatment targets.

### IgG anchor equations

The reference regimen's weekly weight-normalized dose is:

```text
reference_g_per_kg_per_week =
  reference_total_g_per_cycle ÷ cycle_length_days × 7 ÷ body_weight_kg
```

The expected reference trough is:

```text
expected_trough = baseline
  + dose_slope × (reference_g_per_kg_per_week ÷ 0.1)
```

For every profile:

```text
expected_peak = expected_trough × peak_to_trough_ratio
```

The treatment-derived calibration amount and scale are:

```text
treatment_peak = expected_peak - baseline
scale = treatment_peak ÷ raw_reference_exposure_at_calibration_day
```

Estimated total IgG for any modeled regimen is:

```text
estimated_total_IgG(t) = baseline + scale × raw_exposure(t)
```

This construction makes the selected reference regimen and scenario assumptions the anchor. It does not infer a scale from patient laboratory observations.

## Sensitivity Bands

The model creates a full-factorial set from:

- baseline at `center ± baseline uncertainty`;
- dose slope at `center ± slope uncertainty percent`;
- absorption half-time at its editable low and high values; and
- elimination half-life at its editable low and high values.

The center scenario is added as another curve. At each timepoint, the displayed band is the minimum and maximum across these curves; the center line is their arithmetic mean at that timepoint.

This is an assumption envelope. It has no sampling distribution, probability level, or confidence interpretation. Correlations among parameters are not modeled.

## Switch Scenario

The switch model generates reference-regimen events before day 0 for the selected preconditioning period. Beginning at day 0, it separately simulates:

- continued reference dosing; and
- dosing under one comparator regimen.

Relative switch exposure is normalized to the reference final-window average used by the main comparison. Estimated-IgG switch bands use the same baseline, calibration scale, and sensitivity scenarios described above.

## Extended Interval Explorer

| Variable | Computational type | Units | Default | Provenance | Role |
| --- | --- | ---: | ---: | --- | --- |
| `interval.regimenId` | `enum` | — | reference | I/U | Stable regimen before the gap. |
| `interval.horizonDays` | `number` | days | `180` | I/U | Length of the no-further-dose tail. |
| `interval.checkpointDay` | `integer` | days | `7` | I/U | Selected inspection day; standard choices are 7, 14, 21, and 28. |
| `interval.upperThresholdMgDl` | `number` | mg/dL | `1602` | I/U | User tracking line; initialized from the displayed lab high. |
| `interval.lowerThresholdMgDl` | `number` | mg/dL | `586` | I/U | User tracking line; initialized from the displayed lab low. |
| precondition duration | `number` | days | Calculated | D | `max(210, 6 × elimination half-life, 10 × cycle length)`. |
| crossing day | `number` or unavailable state | days | Calculated | D | First downward crossing after the modeled post-dose peak. |

The selected regimen is shifted so its first listed event is at day 0. Repeated prior events are generated over the calculated preconditioning duration, including the completed event at day 0. No future events are added.

For each sensitivity scenario:

```text
tail_IgG(t) = baseline + scale × exposure_from_completed_history(t)
```

The tail therefore approaches the selected baseline rather than zero. Crossing time is found after the modeled peak and linearly interpolated between the two sampled points surrounding a downward threshold crossing.

## Infusion-Time Variables and Equations

| Variable | Computational type | Units | Default | Provenance | Role |
| --- | --- | ---: | ---: | --- | --- |
| `product.needleType` | `enum` | — | 26G set | S/I/U | Selects the only currently implemented flow table. |
| `product.tubing` | `enum` | — | `F2400` | S/I/U | Selects a nominal flow-rate row. |
| nominal flow per site | `number` | mL/hour/site | Table value by tubing and 1–8 sites | S | Archived manufacturer IFU table. |
| `product.referenceRunMinutes` | `number` | minutes | `46` | I/U | Calibration target for 50 mL, F2400, and 4 sites. |
| calibration factor | `number` | ratio | Calculated | D | Scales the nominal flow table to the reference-time assumption. |
| allocated cartridges | `number[]` | mL | Calculated | D | Exact inventory subset used by an infusion day. |
| estimated run time | `number` | hours/minutes | Calculated | D | Time for one sequential cartridge run. |
| estimated infusion-day time | `number` | hours/minutes | Calculated | D | Sum of cartridge run times on one event day. |

The calibration factor is:

```text
nominal_reference_flow = table_flow_per_site(F2400, 4 sites) × 4
calibrated_reference_flow = 50 mL ÷ (reference_minutes ÷ 60)
calibration_factor = calibrated_reference_flow ÷ nominal_reference_flow
```

For an event using `n` sites:

```text
total_flow = table_flow_per_site(selected_tubing, n) × n × calibration_factor
cartridge_run_hours = cartridge_volume_mL ÷ total_flow
event_hours = sum(cartridge_run_hours)
```

The estimate assumes cartridge runs occur sequentially and uses the same calibration factor across tubing and site counts. It does not model patient-specific back pressure, viscosity differences, pump variation, pauses, setup time, ramping, simultaneous cartridges, or prescribed product-specific limits.

## Derived Schedule Metrics

The results table contains deterministic transformations of the regimen and simulation:

```text
weekly_volume = total_cycle_volume ÷ cycle_days × 7
weekly_dose = total_cycle_grams ÷ cycle_days × 7
dose_intensity_percent = comparator_weekly_volume ÷ reference_weekly_volume × 100
sites_per_N_days = total_cycle_sites ÷ cycle_days × N
infusion_days_per_28 = unique_event_days_per_cycle ÷ cycle_days × 28
volume_per_site = event_volume ÷ event_sites
peak_trough_range = final_window_peak - final_window_trough
coefficient_of_variation = final_window_standard_deviation ÷ final_window_average
```

For the reference regimen, cartridge feasibility is true only when each event-day volume can be built exactly from the selected reference inventory without reusing a cartridge already allocated earlier in the cycle. Each comparator event day is instead auto-allocated independently from the selected product's available presentation sizes. A comparator is feasible when its exact event-day volume can be constructed; its allocation does not reuse or artificially limit itself to the reference dose's cartridge counts.

## Limitations

- The exposure model has one compartment with first-order absorption and elimination.
- Product presets share the same pharmacokinetic equation and do not model product-specific bioavailability.
- The endogenous baseline is constant rather than a turnover process.
- Weight affects dose normalization but does not allometrically alter clearance or distribution.
- The dose-to-IgG relationship is linear and illustrative.
- Scenario bands are sensitivity envelopes, not statistical intervals.
- The model does not fit observations, estimate adherence, or propagate measurement error.
- Repeating-regimen charts use a zero-start horizon; only switch and interval views generate prior dose history.
- Product rounding optimizes volume feasibility, not waste, cost, or clinical preference.
- Infusion-time outputs are simplified burden estimates and not administration instructions.
- Threshold crossings describe the configured curve only and do not imply symptom, safety, or efficacy thresholds.

## Shared-State Validation

Shared URLs contain a compressed, compact JSON token in the `s` query parameter. The token stores only source selections and values that differ from the applicable defaults. For example, a 75 kg neurologic scenario stores the profile and weight; its dose, cartridge allocation, and generated q7/q9/q14 schedules are rebuilt from those inputs. Manually edited regimens or assumptions are stored as sparse overrides. A normal URL fragment such as `#results` can therefore be used for in-page navigation without splitting the share token. Shared URLs do not contain model code and are not a private storage format. On hydration, the implementation:

- rejects unsupported payload versions and tokens longer than 24,000 characters;
- limits a payload to four comparators, six events per regimen, twelve inventory entries, and at most 800 repeated event occurrences per modeled year;
- bounds weight, doses, time horizons, cycle lengths, site counts, thresholds, and model parameters;
- allow-lists profile, product, tubing, chart, and interval selections;
- regenerates comparator IDs before using them in DOM attributes; and
- escapes free-text names before inserting them into rendered HTML.

Values outside these bounds are clamped or replaced with a supported fallback. The validation is a transport and rendering safeguard, not clinical validation of the resulting configuration.

Direct numeric controls use the corresponding bounds in the normal interface. While a value is below or above its supported range, it is marked invalid and does not trigger automatic recalculation. On commit, the value is bounded and the form is synchronized with the value used by the model. This prevents a visibly invalid value from silently driving a different calculation; it does not establish that every in-range value is clinically meaningful.

## Implementation Location

The current implementation is in `script.js`. Core sections include product presets and defaults, `doseContribution`, `simulateRegimen`, `computeRegimenMetrics`, IgG calibration helpers, sensitivity-scenario construction, switch simulation, and extended-interval functions. Model-focused regression tests are in `tests/infusion.test.js`.
