# Private operation runbook: candidate, not activated

## Status boundary

The synthetic demo is working. The collector and signed-ingestion reference are locally tested. Private database DDL and role/claim tests may be deployed independently, but an empty protected database is not a working personal reporting system. The authenticated private UI and dashboard read run against disposable local integration services. They are not yet a persistent personal installation. Source ingestion, operational key custody, backups and scheduling remain incomplete.

## Secure Garmin validation

Use Python 3.12+ and an isolated environment. The reviewed transitive install is hash-locked:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r collectors/garmin/requirements.lock
.venv/bin/python -m collectors.garmin.cli doctor
.venv/bin/python -m collectors.garmin.cli auth login
.venv/bin/python -m collectors.garmin.cli validate --recent-days 7 --historical-offsets 30,90 --max-activities 5
.venv/bin/python -m collectors.garmin.cli status
```

Run auth in an ordinary user Terminal, not a captured agent terminal. Hidden prompts read email/password/MFA. No password is stored. Login necessarily reads minimum Garmin social profile/settings into memory. Validation uses the previous seven completed local days plus one day 30 and 90 days earlier, sleep/HRV/RHR, the recent activity inventory, and summaries/chart details for at most five representative activities. One concurrent request, >=1 second spacing, 100 actual underlying requests and 15 minutes per validation. It does not request today, a full archive, FIT or optional scores. No cloud delivery occurs.

Runtime resolves to `~/Library/Application Support/YourSetInsights/GarminCollector/`, outside this repository and ordinary synced document folders. Verify actual system sync/backup configuration before operation; path naming alone is not proof. Auth is 0700/0600 and must never be opened by the coding agent. Normalized records, coverage and validation reports are also private. Doctor checks FileVault status but does not change it. Same-user processes are outside the protection offered by file modes.

On access challenge, expired credentials or rate limit, stop. No alternate login strategy, proxy rotation, CAPTCHA bypass or TLS disabling. The wrapper permits the selected mobile flow only. A sanitized blocked status is useful evidence. Do not repeatedly retry. Confirm source field values in Garmin Connect without editing real records.

Export is a deliberate local handoff, not routine final transport:

```sh
.venv/bin/python -m collectors.garmin.cli export --from YYYY-MM-DD --to YYYY-MM-DD --profile analysis
```

Dates are inclusive. Archive contains exactly the manifest, selected activities/recovery, coverage, reference totals and README. Exported health measurements are not anonymous. External analysis readback remains `HANDOFF_PENDING_EXTERNAL_READ` until tested through the selected reader.

## Activation checklist

1. Garmin is a separate optional track, not a prerequisite for the initial Hevy/Apple Health release. Before activating Garmin, finish Gate 1: live token resume, mapped field units/dates, manual comparisons, refresh observation, account/access limitations and named gaps. Inventory origin/hierarchy and optional fields must not be silently assumed.
2. Establish actual MyNetDiary/Wyze→Apple Health→background exporter delivery, one primary step/sleep writer, original-writer metadata, complete-log signal, secure phone delivery and latency. Offline sample projections do not prove this route.
3. Establish dedicated Hevy access without exposing its key; verify routines separately; implement daily incremental history while preserving the existing monthly export.
4. Bind authenticated owner identity in the persistent local installation. The tested runtime requires AAL2 and reads the owner's canonical snapshot into the shared UI; repeat these checks with retained storage and validated imported records. No shared sensitive-response cache; test anonymous/AAL1/cross-owner HTTP access, not just SQL claims.
5. Adapt signed-ingestion reference to a narrow deployed handler. Keep server elevated key off the collector. Store a random 256-bit signing key in Keychain and its counterpart server-side, bind key→owner/collector, verify exact bytes/nonce/time/schema/checksum/limits, atomic receipt and revision write. Current offline reference rejects series delivery until chunk completeness is implemented. Exercise deployed behavior and revocation.
6. Implement and verify per-family cursors, resumable bounded 90-day backfill only within authorized scope, seven-day overlap refresh, late corrections, repeated inventory/removal confirmation, durable delivery retry and partial-series assembly. Local outbox/revision tests are groundwork, not completion of these tasks.
7. Verify Keychain and source sessions under the real per-user scheduler context, host availability, no overlapping jobs, DST and missed-run recovery. Proposed 07:17/20:17 local targets and hourly due checks make no request when not due. Do not force the Mac awake or promise collection while off. Install only after validation; provide disable/uninstall without deleting data/tokens. No scheduler file is installed by this build.
8. Reproduce reference counts/hashes and durations through the intended authenticated analysis path for a fixed seven-day window, then validate joined intake/weight/movement/training reports. A Garmin-only export is insufficient.
9. Observe the 14-day trial: at least 13 days caught up within 24 hours for agreed available fields, at most one reauthentication, and <=10 minutes/week routine maintenance. Count host downtime and missing checks. Notify meaningful failures/staleness, not repeated unchanged status. A trial cannot pass before elapsed observations exist.

Owner setup still needs target effective dates, selected writer metadata and exact program information where routine access cannot provide it. Do not invent a numerical intended weight-change rate. Routine private setup is authorized; additional costs, required consent and public release remain user decisions.

## Retention and rollback

Retain selected normalized longitudinal history until deletion is requested. Proposed acknowledged outbox/log receipts 30 days, exports 14 days; no pruning job is enabled yet. Unacknowledged batches must never be pruned. Keep raw provider payloads out of routine storage. Backup retention/deletion limitations must be disclosed at activation.

Before activation, rollback means leaving the private resources empty and disabling any candidate endpoint. Once scheduling exists, unload only the dedicated per-user job, revoke its signing-key binding separately, and preserve local history/tokens until a separate deletion decision. Removing local tokens is not confirmed server-side revocation. No production YourSet resource is involved.
