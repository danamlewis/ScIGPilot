# References and Source Mapping

## How to Read This File

This file records the external sources that inform specific simulator defaults or provide scientific context. A citation here does not mean the simulator reproduces a source's complete model or that an illustrative default was estimated from that source.

The provenance codes used in [MODEL.md](MODEL.md) are:

- **Sourced:** directly represented from an identified source.
- **Derived:** calculated by the simulator.
- **Illustrative:** chosen as an example, calibration, or sensitivity assumption.
- **User-selected:** editable in the application.

Sources were last checked on **July 23, 2026**.

## U.S. Product Labeling

### Hizentra

- National Library of Medicine, DailyMed. [Hizentra—human immunoglobulin G liquid](https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=7b58f5ff-0316-49a3-b585-1f6003ddb953).
- Simulator mapping: `0.2 g/mL`; `5`, `10`, `20`, and `50 mL` cartridge sizes.
- Additional context: the label describes PI dosing from daily through biweekly, weekly CIDP dosing, and studied `0.4 g/kg/week` CIDP maintenance dosing. The simulator does not convert those statements into a dosing recommendation.

### Cuvitru

- National Library of Medicine, DailyMed. [Cuvitru—immune globulin subcutaneous (human) injection, solution](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9aad7ec9-6097-4805-8f1b-898bec35f218).
- Simulator mapping: `0.2 g/mL`; `5`, `10`, `20`, `40`, and `50 mL` cartridge sizes.

### Xembify

- National Library of Medicine, DailyMed. [Xembify—immune globulin subcutaneous, human-klhw solution](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=8c174b11-a061-412e-a3b2-7bf7e1adaace).
- Simulator mapping: `0.2 g/mL`; `5`, `10`, `20`, and `50 mL` cartridge sizes.

The application uses **cartridge** as a generic operational term. The labels describe the marketed presentations using terms such as vial or prefilled syringe. Product and device names are trademarks of their respective owners and are used for identification only.

## Pharmacokinetic Model Context

### Bateman-style first-order absorption and elimination

- Roanes-Lozano E, González-Bermejo A, Roanes-Macías E, Cabezas J. [An Application of Computer Algebra to Pharmacokinetics: The Bateman Equation](https://doi.org/10.1137/050634074). *SIAM Review*. 2006;48(1):133-146.
- Simulator mapping: mathematical context for a one-compartment curve with first-order absorption and elimination. The simulator adds dose-event contributions by superposition.

### SCIG absorption timing and elimination context

- [Subcutaneous immunoglobulin therapy: a new option for patients with primary immunodeficiency diseases](https://pmc.ncbi.nlm.nih.gov/articles/PMC3430092/). This review reports slower SCIG absorption, peak serum IgG commonly occurring approximately 2–4 days after infusion, and historical IgG half-life values spanning roughly 21–37 days depending on product and context.
- Skoda-Smith S, Torgerson TR, Ochs HD. [Subcutaneous immunoglobulin replacement therapy in the treatment of patients with primary immunodeficiency disease](https://pmc.ncbi.nlm.nih.gov/articles/PMC2817783/). *Biologics*. 2010;4:1-10. This source discusses the flatter serum profile with SCIG, peak timing after subcutaneous administration, and IgG half-life context.
- Simulator mapping: these sources provide qualitative context for the illustrative 3-day calibration timing and the 21–35-day elimination sensitivity range. They do not establish the simulator's precise 1.4-day absorption half-time, 30-day center value, or absolute IgG anchors.

### Product and population pharmacokinetic studies

- Wasserman RL, Melamed I, Nelson RP Jr, et al. [Pharmacokinetics of subcutaneous IgPro20 in patients with primary immunodeficiency](https://pubmed.ncbi.nlm.nih.gov/21553933/). *Clinical Pharmacokinetics*. 2011;50(6):405-414. DOI: `10.2165/11587030-000000000-00000`.
- Zhang Y, Baheti G, Chapdelaine H, et al. [Population pharmacokinetic analysis of weekly and biweekly IgPro20 dosing in patients with primary immunodeficiency](https://pubmed.ncbi.nlm.nih.gov/31806567/). *International Immunopharmacology*. 2020;81:106005. DOI: `10.1016/j.intimp.2019.106005`.
- Li Z, Follman K, Freshwater E, Engler F, Yel L. [Integrated population pharmacokinetics of immunoglobulin G following intravenous or subcutaneous administration of various immunoglobulin products in patients with primary immunodeficiencies](https://pubmed.ncbi.nlm.nih.gov/36461591/). *International Immunopharmacology*. 2022;113(Pt A):109331. DOI: `10.1016/j.intimp.2022.109331`.
- Simulator mapping: these papers support the general use of pharmacokinetic modeling to compare SCIG schedules. Their models include features such as multiple compartments, endogenous production, bioavailability, covariates, and between-patient variability that are not present in this simulator.

## Laboratory Orientation Range

- Labcorp. [Immunoglobulin G, Quantitative, test 001776](https://www.labcorp.com/tests/001776/immunoglobulin-g-quantitative).
- Simulator mapping: the default orientation lines `586–1602 mg/dL` correspond to the source's adult female reference interval. The same source lists a different adult male interval, and other laboratories use different methods and intervals.
- The displayed lines are orientation only. They are not treatment targets, individualized reference intervals, or thresholds for SCIG dose adjustment.

## Infusion-Device Flow Table

- KORU Medical Systems. [Freedom60 Syringe Infusion System Instructions for Use, document 337125](https://d1io3yog0oux5.cloudfront.net/rmsmedicalproducts/files/pages/rmsmedicalproducts/db/513/description/337125-F60_Pump_domestic_IFU-RevU.pdf).
- KORU Medical Systems. [Instructions for Use library](https://korumedical.com/ifus/).
- Simulator mapping: the nominal HIgH-Flo 26G/Precision Tubing per-site values for F120 through F2400 and one through eight sites match the archived document's Hizentra CIDP table. Applying that single table across the simulator's product presets is a simplifying assumption.
- The simulator then applies its own illustrative calibration so `50 mL`, `F2400`, and four sites default to `46 minutes`. That calibration and the assumption that cartridge runs are sequential are not taken from the cited table.
- Device instructions and product labeling, not this simulator, govern actual setup, rates, volume per site, and administration.

## Absolute IgG Profiles and Sensitivity Defaults

The following values are **illustrative**, not direct estimates taken from the cited literature:

- baseline IgG values of `1000` and `1400 mg/dL`;
- target trough anchors of `1500` and `2100 mg/dL`;
- peak-to-trough ratios of `1.10` and `1.12`;
- high-value warning thresholds of `2600` and `2800 mg/dL`;
- baseline sensitivity of `±100 mg/dL`;
- dose-slope sensitivity of `±20%`;
- the central `1.4-day` absorption half-time;
- simulation horizons, timesteps, run-in periods, and the final 28-day summary window; and
- the 46-minute infusion-time calibration.

These values remain editable so users can explore how assumptions affect the comparative output. Changing an assumption does not turn the output into a patient-specific prediction.

## Third-Party Software

- [Chart.js 4.4.1](https://www.chartjs.org/) is loaded at runtime from jsDelivr. Chart.js is distributed under the MIT License; retain the upstream license notice when vendoring or redistributing it.
- `qrcode.js` is a vendored QR generator by Kazuhiko Arase. Its source header identifies the original project and MIT license. Preserve that header and include it in any third-party notice file.

## Updating References

When a preset or model default changes:

1. update the implementation;
2. update the variable and provenance tables in `MODEL.md`;
3. update the source mapping here;
4. note whether the value is sourced, derived, illustrative, or user-selected; and
5. add or update regression tests for any changed calculation.
