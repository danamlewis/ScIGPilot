# Contributing

Thank you for helping improve the SCIG Schedule Simulator.

## Before opening a change

- Do not include patient names, dates, laboratory results, copied clinical records, or other identifying health information in issues, tests, examples, screenshots, commits, or shared simulator links.
- Keep the simulator comparative and descriptive. It must not present a modeled schedule as a prescription, safety determination, or individualized recommendation.
- Discuss substantial model changes in an issue before implementation so their assumptions and intended interpretation are explicit.

## Development setup

Use a supported Node.js version listed in `package.json`, then run:

```bash
npm ci
npm test
python3 -m http.server 4183
```

Open `http://127.0.0.1:4183/` and exercise at least the replacement/PI and high-dose neurologic profiles at more than one body weight.

## Pull requests

A pull request should:

1. explain the user-facing or model-facing change;
2. include regression tests for changed calculations, state handling, or UI behavior;
3. update `MODEL.md` when variables, equations, defaults, or limitations change;
4. update `REFERENCES.md` when a sourced value or product preset changes;
5. retain third-party license notices; and
6. pass `npm test` and a browser smoke test.

Numerical defaults must be clearly classified as sourced, derived, illustrative, or user-selected. Do not introduce values copied from an individual's regimen or laboratory history as application defaults or test fixtures.

## Licensing

The project is licensed under the MIT License. By submitting a contribution, you agree that it may be distributed under the same license.
