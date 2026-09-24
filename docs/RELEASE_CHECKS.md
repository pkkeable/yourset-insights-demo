# Portfolio release checks: v0.1.1-demo

The v0.1.1 candidate uses the approved six-card overview and one shared metric engine. The screenshot in `docs/images/overview.png` was captured from the default independent synthetic scenario using `node dev/local/demo.mjs --static --screenshots`. It contains no personal snapshot or provider payload.

## Release identity and public evidence

Review the [v0.1.1-demo release](https://github.com/pkkeable/yourset-insights-demo/releases/tag/v0.1.1-demo) for the public commit, deployment and hosted walkthrough result. [Public CI](https://github.com/pkkeable/yourset-insights-demo/actions/workflows/privacy.yml) records each run against its actual public SHA. The export's `SOURCE_RELEASE.json` records the corresponding private source revision and the hashes of included files; private commits are not available in public history.

This release separates the app shell into named render functions, adds project-relative asset paths and a static-build content security policy, adds a Chromium walkthrough of `dist/` to CI, and explicitly configures the existing Vercel project as a static deployment. The new screenshot captured from the static build is byte-for-byte identical to the previous six-card reference.

## Local results: September 23, 2026

| Check | Result |
| --- | --- |
| JavaScript tests | 117 passed |
| Product integration | 24 checks passed |
| Authentication integration | 23 checks passed |
| Python collector/reference tests | 23 passed |
| Ruff, formatting and static build | passed |
| Built-static browser walkthrough | ten scenarios across four views; six cards, decision/follow-up/review, mobile overflow, keyboard controls and subdirectory asset loading passed |
| Built-static browser external requests / failed assets / JavaScript errors | none observed |
| npm advisory audit | zero reported vulnerabilities |

Integration checks use disposable local PostgreSQL/Auth and the actual HTTP runtime with a pinned Chromium container. They exercise owner isolation, insufficient MFA, stale sessions, save conflicts, ambiguous response retries, rollback, stored snapshots and real process restart. The public demo remains tab-local; it does not call those private routes.

The earlier v0.1.0 advisory review queried OSV for 21 exact Python lockfile packages and reported zero advisories after fixing the following development dependency. It found CVE-2025-71176 in development-only pytest 9.0.2. The lock now pins 9.0.3 using its exact PyPI release hashes; hash-required install, Python tests and lint passed. The check used [OSV's versioned package API](https://google.github.io/osv.dev/post-v1-querybatch/) and the [upstream patched release](https://github.com/pytest-dev/pytest/releases/tag/9.0.3). Advisory results are dated database observations, not a guarantee that dependencies contain no vulnerabilities.

## Reproduce the public checks

```sh
npm ci
npm run check
npm run build
npm run test:demo -- --static
npm run test:demo -- --url https://yourset-insights-demo.vercel.app/
```

The browser command uses the pinned Docker browser on the supported Mac. Public CI installs Playwright Chromium on its Linux runner. The two private integration suites remain local-only; the public CI badge does not certify them. See [verification setup](../dev/local/README.md).

## Release provenance

The reviewed source allowlist is `release-files.txt`. The exporter records every file's SHA-256 in `SOURCE_RELEASE.json` without copying private Git history. Each candidate must pass clean installation, build, local documentation-link checks, its synthetic walkthrough, tracked-tree privacy checks and a full-history credential scan before push. The source and public commit mapping is retained separately from personal records.

## Limits

The table above records local synthetic checks. A successful hosted walkthrough establishes only that the static demonstration works at its published URL. Neither establishes a persistent personal installation, account recovery, backup/restore, real provider ingestion, private hosted operation or unattended refresh. Private service suites remain macOS-specific; public CI covers the core tests/build/lint/privacy gates and the static-browser walkthrough. Performance measurements elsewhere retain their original workload and date.
