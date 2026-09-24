# Portfolio release checks — September 23, 2026

The candidate uses the approved six-card overview and one shared metric engine. The screenshot in `docs/images/overview.png` was captured from the default independent synthetic scenario using `node dev/local/demo.mjs --screenshots`. It contains no personal snapshot or provider payload.

## Observed local results

| Check | Result |
| --- | --- |
| JavaScript tests | 117 passed |
| Product integration | 24 checks passed |
| Authentication integration | 23 checks passed |
| Python collector/reference tests | 23 passed |
| Ruff, formatting and static build | passed |
| Public browser walkthrough | ten scenarios across four views; six cards, decision/follow-up/review, mobile overflow and keyboard controls passed |
| Public browser external requests / JavaScript errors | none observed |
| npm advisory audit | zero reported vulnerabilities |
| OSV query for 21 exact Python lockfile packages | zero reported advisories after the pytest fix below |

Integration checks use disposable local PostgreSQL/Auth and the actual HTTP runtime with a pinned Chromium container. They exercise owner isolation, insufficient MFA, stale sessions, save conflicts, ambiguous response retries, rollback, stored snapshots and real process restart. The public demo remains tab-local; it does not call those private routes.

The source advisory review found CVE-2025-71176 in development-only pytest 9.0.2. The lock now pins 9.0.3 using its exact PyPI release hashes; hash-required install, Python tests and lint passed. The check used [OSV's versioned package API](https://google.github.io/osv.dev/post-v1-querybatch/) and the [upstream patched release](https://github.com/pytest-dev/pytest/releases/tag/9.0.3). Advisory results are dated database observations, not a guarantee that dependencies contain no vulnerabilities.

## Release provenance

The reviewed source allowlist is `release-files.txt`. The exporter records every file's SHA-256 in `SOURCE_RELEASE.json` without copying private Git history. A fresh candidate must pass clean installation, build, local documentation-link checks, its synthetic walkthrough, tracked-tree privacy checks and a full-history credential scan before push. The source and public commit mapping is retained separately from personal records.

## Limits

This evidence is local and synthetic. It does not establish a persistent personal installation, account recovery, backup/restore, real provider ingestion, hosted operation or unattended refresh. The browser and service suites remain macOS-specific; remote CI covers the core tests/build/lint/privacy gates. Performance measurements elsewhere retain their original workload and date.
