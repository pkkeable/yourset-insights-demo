# Private command and read contracts

The private runtime implements combined target/decision edits, standalone plan changes, decision-only choices, review completion and authenticated dashboard reads. The synthetic demo keeps its tab-local workflow. GET `/api/private/plan-decision` remains the narrow command-context endpoint; GET `/api/private/dashboard` restores the dashboard model.

## Admission and ownership

Derive the owner exclusively from the opaque server session. Require enrollment, AAL2, unexpired/unrevoked application session, upstream session existence and a verified upstream identity. Reject any client owner field. Revalidate admission even for receipt replay. The application session table is the primary operator-revocation state; upstream lookup errors still fail closed, never bypassing it. Hosted Auth-schema privileges remain a carried, unresolved risk for local work.

## Combined plan edit and decision

POST `/api/private/commands/plan-decision`, same-origin JSON, maximum 16 KiB. Required UUID `Idempotency-Key` is scoped to owner across command types. Body fields: expectedPlanVersion, evidenceRevision, analysisPeriodDays, calories, proteinGrams, reason, effectiveDate, optional reviewDate. Reject unknown fields. Version is a nonnegative safe integer; targets are positive finite numbers; reason is trimmed, nonempty and at most 2,000 characters. Reporting periods are the existing product's 14, 28, 90 and 180 completed days.

Use SHA-256 of a deterministic schema-versioned representation containing command type and every validated field, fixed field order, normalized numeric values, trimmed text and explicit null for absent review date. Generate one key per submission; retain both key and identical payload for a retry with an uncertain outcome.

After admission, open one transaction, establish transaction-local owner context on its checked-out connection, and acquire the per-owner transaction lock. Inspect the receipt before current-version/evidence validation. Identical key/digest returns the stored result; changed digest returns idempotency_mismatch. Compare expectedPlanVersion against the latest committed revision while holding the lock. Concurrent same-version writes yield one commit and one conflict.

The server constructs the immutable snapshot from the authenticated owner's stored evidence, effective-dated plan state, server analysis clock, selected analysis period, computed assessment and rule version. The client supplies an expected evidence revision, not records or conclusions. Reject stale evidence. Current integration tests seed independent synthetic evidence; a live-source import is a separate milestone.

Dates are strict valid YYYY-MM-DD calendar dates. Effective date must be on/after the server analysis date. Optional review date must be on/after effective date. Reject an occupied effective date. Record UTC receipt time separately; it is assigned within the committing transaction and returned only after commit, not a measurement of PostgreSQL's physical commit timestamp.

Insert plan, linked decision with evidence snapshot, and idempotency receipt atomically. Failure before commit leaves none of the three. HTTP 200 after commit returns:

```text
{commandId,
 plan: {id, version, calories, proteinGrams, effectiveDate},
 decision: {id, version, planVersion, choice: "edit", status: "active",
            reason, effectiveDate, reviewDate, evidenceSnapshotId},
 committedAt}
```

Identical retry returns exactly the stored body. The form displays only that durable returned version. GET restore returns planVersion, evidenceRevision, analysisDate, scenarioId and latest command result; it requires the same admission checks.

## Standalone plan and decision commands

`POST /api/private/commands/plan` accepts the combined command fields except `reviewDate`. It creates one dated plan with its original evidence snapshot and a receipt without creating a decision. `POST /api/private/commands/decision` accepts `expectedPlanVersion`, `evidenceRevision`, `analysisPeriodDays`, `choice`, `reason`, `effectiveDate` and optional `reviewDate`. Choices are accept, edit (a written adjustment without target changes), defer, reject and continue_unchanged. It captures a server-owned evidence snapshot and creates a decision and receipt without changing any target. Both routes require a nonempty reason.

Decision-only commands can precede any saved plan (planVersion 0); they do not manufacture a plan row. Receipts therefore retain the observed plan version independently of a foreign key to a newly created plan. A database-generated ordinal orders receipts. The decision's persisted plan foreign key is nullable only when there is no saved plan, while its immutable snapshot retains the source plan context. Same-key replay is scoped across command types. Duplicate active decisions with the same choice, reason, date and adjustment return `409 already_active`.

## Review completion

POST `/api/private/commands/review-completion`. Same admission, owner, idempotency, digest and error conventions. Body: decisionId, expectedDecisionVersion, evidenceRevision, analysisPeriodDays, outcome, note. Outcome is continue_plan, conclude or stop; note is trimmed, nonempty, at most 2,000 characters. Decision must be active, owned by the caller, at the expected version, and already effective on the server analysis date.

Capture immutable review evidence, assessment, rule version and evidence-sufficiency result. Atomically insert an immutable review snapshot, advance the decision revision to completed and store a receipt. The restricted application role may update decision content but cannot update its original snapshot. The review table uses the same owner RLS as decisions; it is not exposed through the Data API. No plan targets change, including for continue_plan. Return HTTP 200:

```text
{commandId, decisionId, decisionVersion, status: "completed",
 review: {id, outcome, note, reviewedAt, evidenceSnapshotId, evidenceSufficient},
 committedAt}
```

Return indistinguishable 404 for nonexistent and other-owner decisions. Check receipts first: same key/different digest is 409 idempotency_mismatch (a client retry bug); a different key targeting an already completed decision is 409 already_completed (another command did the work). These cases must not share a code. Stale version/evidence is 409 with the appropriate conflict code.

## Failure responses

All error bodies have `{error: {code, message, currentPlanVersion?, currentEvidenceRevision?}}`. Only authorized conflicts may include current revisions. Never return raw database errors, keys, tokens or private records.

| Cause | Response |
|---|---|
| Invalid body, forbidden owner, validation or constraint failure, including inside the transaction | 400 with specific invalid_command, invalid_dates, invalid_idempotency_key, body_too_large or constraint_violation code; rollback |
| Stale expected version/evidence, occupied date, same-key changed digest | 409 version_conflict, evidence_conflict, effective_date_conflict or idempotency_mismatch; rollback |
| Different-key review of completed decision | 409 already_completed; rollback (review route) |
| Missing, expired, revoked session | 401; no private data or write |
| Insufficient MFA/enrollment, invalid origin/host | 403; no private data or write |
| Genuine infrastructure failure: lookup error/timeout, pool exhaustion, unreachable database, lock/statement/overall deadline | 503 service_unavailable, always Retry-After: 1; no admission/domain write when admission failed; rollback or discard affected connection |
| Lost connection around commit | Outcome uncertain; retry identical key/payload to retrieve the durable receipt; never promise rollback without knowing |

503 is not used for client-correctable rollback. The UI does not automatically retry indefinitely; it preserves uncertain commands for an unchanged user retry.

## Deadline decision

Keep 1,000 ms admission lookup, 1,000 ms lock wait, 2,000 ms statement and 5,000 ms overall command budgets. These are caps, not delays that must all elapse. Multiple statements mean summing three caps cannot prove the overall deadline.

Use an absolute request deadline and reserve 150 ms for disposal/rollback and response handling. Cap each operation by its own limit and the remaining overall budget. The lookup includes pool acquisition, local checks and upstream verification within its own capped budget. Configure server-side statement/lock deadlines before queries; client-side watchdogs discard connections if they do not settle. Late pool acquisitions are discarded, not leaked or reused by the cancelled command. Never return a potentially executing/aborted connection to the pool. Recalculate before each statement and before commit. Already-admitted requests may complete after revocation, subject to these execution limits.

Contention tests and measured p50/p95/max must justify the five-second setting for this local workload. Deadline ordering is enforced in application/database logic, not a hard real-time guarantee through an operating-system or event-loop stall. An ambiguous commit remains an idempotency-recovery case.

## Authenticated dashboard read

`GET /api/private/dashboard` uses the same admission and session-view binding as writes. A single owner-scoped SQL statement returns the canonical source snapshot, saved effective-dated plans, decisions and latest receipt from one database snapshot. It never accepts an owner or scenario from the browser. The schema-versioned result includes the source evidence revision, current plan version, analysis date/timezone, canonical model and decision history. The browser calculates the dashboard with the shared metric engine; it cannot replace a failed read with a fixture.

Saved plans inherit the effective preceding plan's non-edited fields. They do not rewrite historical targets or change the analysis clock. A target effective today is shown as current, but only affects completed-day execution when observations reach its effective date. Decision history retains the evidence and plans as known at the original command. The dashboard returns compact summaries (original plans, assessment title/action, evidence count, analysis date and rule version); full immutable evidence remains in the database. A full snapshot drill-down endpoint is not yet implemented.

No evidence row is an explicit `409 evidence_unavailable`, not an empty successful fixture. A valid model with zero observations renders empty states. The current bounded local read rejects over 50,000 records, 1,000 plans, 1,000 decisions or a 16 MiB serialized response; it never truncates silently. Larger histories require a paginated contract before ingestion. Responses are `no-store`. Read errors replace the private dashboard with a retry/sign-out state. Source freshness is distinct from successfully reading the database.
