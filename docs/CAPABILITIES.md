# Capability matrix

What is built, what was actually exercised, and what is not established. Five
states, deliberately distinguished, because "the tests pass" and "this works"
are different claims:

| State | Meaning |
| --- | --- |
| **Implemented** | Code exists and is reachable. |
| **Tested locally** | Exercised by automated checks on the one supported host. |
| **Hosted-verified** | Observed in a deployed environment. |
| **Source-validated** | Reconciled against a real external provider account. |
| **Operationally observed** | Survived an elapsed, unattended real-use trial. |

Personal-source validation and unattended operation are not established. The public static demonstration and the private runtime have different verification boundaries; hosting the demo does not change the private-runtime rows below.

## Check the release, not an inaccessible commit

- [Public CI](https://github.com/pkkeable/yourset-insights-demo/actions/workflows/privacy.yml) attaches test, build, lint, credential-scan and static-browser results to each public commit. Follow the run for the revision you are reviewing.
- [Release notes](https://github.com/pkkeable/yourset-insights-demo/releases) identify published versions and any hosted walkthrough results. [Release checks](RELEASE_CHECKS.md) records the local test scope and commands.
- The exported `SOURCE_RELEASE.json` identifies the private source commit and hashes each included file. The initial public commit `47aafc6` exported private source `d9a103a`; its [CI run](https://github.com/pkkeable/yourset-insights-demo/actions/runs/35949321394) is directly inspectable. Later releases update the manifest while preserving normal public history.

Private commit identifiers establish provenance; they are not public links or independent proof of test execution. The older results at the end of this page retain their original date and revision. They have not been relabelled as tests of the current public commit.

## Synthetic product

| Capability | State |
| --- | --- |
| Four surfaces sharing one deterministic metric engine | Tested locally |
| Ten scenarios from seeded source records | Tested locally |
| 14 / 28 / 90 / 180-day completed-day windows against equal preceding periods | Tested locally |
| Effective-dated plans, revision lineage, tombstoned records | Tested locally |
| Decision and review loop with immutable snapshots | Tested locally |
| US display units over unchanged canonical data | Tested locally |
| Allowlisted static build excluding collectors, SQL and private config | Tested locally |

Browser-held decisions in the synthetic demo are tab-local and reset on
reload. That is the demo's design, not a persistence bug.

## Private authenticated slice

| Capability | State |
| --- | --- |
| Local password sign-in; TOTP enrollment and challenge | Tested locally |
| Opaque `HttpOnly` cookie rotation; encrypted server-side tokens | Tested locally |
| Session expiry, serialized refresh, logout, cross-tab clearing | Tested locally |
| Stale-response protection and session-view binding | Tested locally |
| Application and upstream revocation checks, failing closed | Tested locally |
| Wrong-key denial; correct-key restart; previous-key rotation overlap | Tested locally |
| Upstream signout retry surviving process restart | Tested locally |
| Atomic combined target/decision command and receipt | Tested locally |
| Standalone plans, decision-only choices and review completion | Tested locally |
| Authenticated read restoring that command's committed version | Tested locally |

Retries stop after five attempts and then require operator investigation.
Auth expiry tests aged stored timestamps deliberately; outages were injected
through a local relay. Successful exchanges, browser behaviour, process
restarts and upstream signout were observed on one host.

## Local implementation milestones: September 23, 2026

The six-card overview and authenticated dashboard read are tested locally. Saved targets merge by effective date, drive the current plan and completed-day comparison after reload, and preserve historical targets. Private read failures show an explicit unavailable state with no synthetic fallback.

The dashboard milestone recorded **115 JavaScript tests, 18 product integration checks, 23 authentication checks and 23 Python tests passed**; lint, formatting, privacy gate and static build passed. Browser coverage includes six-card rendering, dated-target reload, an empty plan, missing weight/recovery/cardio, chart keyboard controls, desktop/mobile overflow and unavailable evidence. These tests use independent synthetic records in disposable local services; they do not establish personal ingestion or a persistent installation.

### Decision-loop milestone

Standalone plan changes, decision-only choices (including a defer before any saved plan) and review completion use the same admission, owner transaction, evidence revision and receipt boundary. Browser saves, reload and an actual Node process restart preserve their state. Reviews do not change targets, and original snapshots are immutable to the application role. Fresh verification passed **24 product integration checks and 23 authentication checks**. Injected review failure rolled back both the new review and decision transition; attempts to update original decision snapshots were denied. That decision-loop candidate also passed 117 JavaScript tests, including a static-build check that rejects leftover output outside its allowlist.

## Not implemented

- Password and lost-authenticator recovery, without MFA bypass.
- Key custody, permanent key loss, and revocation-retry exhaustion procedures.
- Reviewed versioned product migrations. Current DDL is disposable setup.
- A supported service launcher. A development Docker shim stands in, with an
  authoritative loopback guard that must not be weakened before replacement.
- CI for private real-service and authentication suites. Public CI covers JavaScript/Python tests, lint, privacy checks and the static demo walkthrough in Chromium. Private database/Auth/browser verification still uses the separate macOS-specific runner; it is not covered by the public CI badge.
- Backup and restore, export and deletion, retention, redacted monitoring.
- Any real source integration. Hevy is the first candidate, subject to access
  and rights review. Garmin is a separate track.
- Scheduler and daily cross-source synchronisation.

## Supported host

macOS 26.5.2 ARM · Node 26.0.0 · Docker 29.7.2.

The automated browser runs Linux ARM inside Docker. That does **not** establish
Linux-host support. Windows is simulated, unverified and unsupported.

## Historical local evidence: September 18, 2026

These observations used private development commit `73b37cf`, which is not present in public history. They document the earlier experiment, not current release certification.

| Suite | Result |
| --- | --- |
| Authentication integration checks | 23 / 23 |
| Product integration checks | 14 / 14 |
| JavaScript tests | 110 / 110 |
| Python tests | 23 / 23 |
| Lint and build | pass |
| Formatting | clean |
| Full-history credential scan (gitleaks 8.30.1) | no leaks, 16 commits |

Every row was re-run on the evening of September 18, including both suites,
which require local disposable services and a disposable browser. All
containers, volumes and networks were removed afterwards.

## Measured, with its limits

`docs/adr/0001-write-and-session-boundary.md` records a warm local read
sample: full-request p95 **22.121667 ms**, maximum **40.307791 ms**. The
September 18 evening run added a write-path sample over 100 sequential commands at
concurrency 1: p50 **70.26 ms**, p95 **83.44 ms**, maximum **100.86 ms**,
with revocation at **4.87 ms**.

Both samples bound themselves and nothing else. They are warm measurements
against a near-empty local database on a single host. They are not production
benchmarks, p95 is not a hard upper bound, and neither establishes capacity,
contention or cold-start behaviour. See
[ENGINEERING.md](../ENGINEERING.md) for what the experiments did and did not
show.
