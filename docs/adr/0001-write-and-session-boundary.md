# ADR 0001: Private write and session boundary

Status: **Accepted, 2026-09-12.**

Date: 2026-09-12

This accepted decision locks the architecture direction based on an isolated synthetic spike. Acceptance does not certify production readiness or authorize Phase 1 implementation in this task.

## Decision

Mediate private writes through the application server. Commit each plan change, its associated decision, and its idempotency receipt in one PostgreSQL transaction. Derive the owner from the validated server session, never from client input. Enforce owner isolation with a restricted application role and transaction-local row-level security (RLS) context on the same checked-out connection.

For private request admission, check durable application-session revocation and expiry, enrollment, MFA assurance, and upstream session existence. Use a restricted database function for the upstream session lookup rather than relying on a signed JWT remaining unexpired. Keep private tables outside the exposed Data API and deny browser roles access to the function.

The spike function, `spike.session_valid(session_id, owner_id)`, returns only whether that session belongs to that owner in `auth.sessions`. It is a narrowly scoped `SECURITY DEFINER` function with an empty search path and fully qualified table access. Execution is revoked from PUBLIC, anon, and authenticated, and granted only to the server's authentication role. It neither performs writes nor replaces owner RLS or the other admission checks. Product implementation must review the function owner's privileges and hosted support for this lookup; the spike's administrative setup is not a production migration.

The function is invoked during server admission, not embedded in every domain-table RLS policy. This design trusts the restricted server roles to invoke the checks and establish the correct owner. It does not defend against a compromised server database credential. Admission and the subsequent domain transaction are separate in the spike.

**Revocation semantics (C1):** operator revocation blocks admission of new private requests after its durable application-session revocation write. Already-admitted in-flight requests complete normally; revocation does not cancel them. C1 requires revocation semantics to be defined, and this is that definition. The remaining in-flight window is limited to the remaining duration of an already-admitted request, not the JWT lifetime. In the observed warm local read sample, full-request p95 was **22.121667 ms** and maximum **40.307791 ms**. Those observations bound that sample only; p95 is not a hard upper bound, and reads do not establish write duration. Phase 1 must measure the actual command duration, define and enforce finite request/database deadlines, and test revocation before versus after admission. No production in-flight time bound is established yet.

**Fail-closed admission:** if the session-validity lookup errors or exceeds its finite configured deadline, deny admission with a generic HTTP 503 service-unavailable response. Return no private data, execute no domain write, and never fall back to JWT-only validation or cached acceptance. A successfully evaluated invalid/revoked session remains HTTP 401. Error and timeout behavior is **untested**. Phase 1 must inject both failures in the real application, assert zero private disclosure and zero domain writes, verify deadline enforcement and connection cleanup, and verify recovery on a subsequent healthy request.

**Named risk: internal Auth-schema dependency.** the upstream session check uses a SECURITY DEFINER function reading Supabase's internal `auth` schema. Its implementation details are not a stable public contract, and hosted privileges may differ from local. Current [Supabase session documentation](https://supabase.com/docs/guides/auth/sessions) explicitly describes checking `session_id` against `auth.sessions`; that documented technique does not establish stable internals or validate this function's hosted grants. [Supabase user-data guidance](https://supabase.com/docs/guides/auth/managing-user-data) cautions that managed-schema objects can change.

The application session table is the primary operator-revocation check, independent of the upstream table. An auth-schema break therefore degrades the upstream validation path only in terms of state ownership: it does not erase or bypass application revocation. Because admission requires both checks and fails closed, that degradation can still make new private requests unavailable; it is not permission to skip upstream validation. **Carried hosted risk (local slice authorization):** hosted privilege verification remains unresolved and does not block disposable local implementation. Before hosted operation, verify hosted auth-schema access and the proposed function ownership/grants against current Supabase documentation, record the supported contract and any uncertainty, and stop for a revised design if access is unsupported. Documentation was reviewed on 2026-09-12; actual hosted privilege execution remains unproved and is not authorized by this task.

**Owner command serialization:** deliberately serialize all commands for an owner with a transaction-scoped advisory lock at this scale. Recheck version and idempotency under that lock. Optimistic retry on serialization failure is the alternative to evaluate if measured contention becomes material.

## Two independent requirements

**Atomic plan plus decision commit:** a decision without its plan, or a plan without its decision, is an invalid outcome. Retrying a command after a lost response must return the original durable result, and competing edits must produce a conflict rather than silently overwrite one another. These requirements independently demand a transaction boundary containing validation, both records, and the receipt.

**Revocation within 60 seconds:** an operator must be able to stop an old credential from admitting new private requests independently of the JWT's remaining lifetime. This independently requires consulting current authoritative session state, or another mechanism with a demonstrated bound on revocation propagation. An expiry-only policy does not provide that bound for tokens with more than 60 seconds remaining.

Together these requirements motivate the server-mediated, stateful boundary. Neither mathematically requires a separate application server: a carefully secured transactional database RPC with live session enforcement could also satisfy them. The accepted choice centralizes command validation, cookie handling, session checks, and conflict responses in one server boundary, accepting its operational cost.

## Evidence and its scope

Evidence source: spike commit `5b136a8`, immediately following baseline `822adb3`. The four committed files match the recorded successful run byte for byte. The final guarded run completed **18 of 18 checks**, including expiry, with actual local Supabase Auth, TOTP, PostgreSQL, and HTTP. This document summarizes that existing run; drafting it did not execute a new run.

Numbering follows execution order in [the harness](../../spikes/auth-transaction/test.mjs). Enforcement is in [the spike application](../../spikes/auth-transaction/app.mjs) and [database setup](../../spikes/auth-transaction/schema.sql); timing and mutation methods are in [measurements](../../spikes/auth-transaction/measurements.mjs).

| Check | Observed evidence | Architectural implication |
|---|---|---|
| 6 | Failure after plan insertion rolls back both plan and decision | Both writes share a transaction |
| 7 | A committed command whose HTTP response is deliberately lost returns one durable outcome on retry | Receipt and domain writes commit together |
| 8 | Reusing an idempotency key with a different payload is denied | Key reuse cannot silently change command meaning |
| 9 | Two edits at the same expected version yield one success and one conflict | Concurrent edits preserve version semantics |
| 12 | A genuine AAL2 JWT receives HTTP 406 when requesting the private schema through the Data API | A valid MFA token does not open the private schema directly |
| 11, 14 | Unscoped reads return no rows; unset and empty owner contexts deny after reuse of the same pooled connection | Transaction-local ownership must reset and fail closed |
| 15 | An old cookie is denied after durable operator revocation | Admission consults application-session state |
| 16 | Upstream-only revocation denies a still-active application cookie | Admission also consults upstream session state |
| 17, 18 | Expired application sessions and logged-out cookies are denied | Revocation complements expiry and logout |

Check 12 directly exercises a read and the schema-exposure boundary; it is not a separate direct-write endpoint test and does not prove every possible API route is secure. The private schema restriction and grants are part of the design; product tests must also cover direct mutation attempts.

Check 14 temporarily removes RLS null normalization and observes the negative test fail with SQLSTATE 22P02, then restores the original policies and verifies clean denial again. The broken policy errors on an empty UUID cast; no row disclosure was observed. Test identities, plan values, storage failure, lost response, forced expiry, and the policy regression are synthetic or deliberately injected. The resulting local responses and database behavior were observed, not mocked.

## Measured cost

Operator revocation took **0.001696042 seconds, approximately 1.7 ms**, in one observed sequence. Timing starts before the durable revocation write and ends after the old-cookie private read is denied, including assertion and reporting overhead. This is an observation, not a hosted latency guarantee or proof of a tail-latency objective.

**Product-path comparison:** the slice 1 observation was **11.0 ms** through the product route, compared with **1.7 ms** in the spike. Both are far inside the 60-second requirement. The observed interval depends on the request path and operations included: the product sequence checks command replay and a private read, while the spike sequence checked a private read. These are local observations, not a controlled regression benchmark. Do not quote the spike's 1.7 ms figure as product latency. The subsequent full slice re-verification observed approximately **10.1 ms** for the product sequence, again within the requirement.

The session measurement used **500 successful authenticated private reads**, after **20 warm-up reads**, at **concurrency 1**, with zero HTTP errors and one recorded function evaluation per measured read. Percentiles use nearest rank.

| Measurement, milliseconds | p50 | p90 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Restricted session-validity function | 0.042 | 0.052 | 0.055 | 0.309 |
| Full instrumented private HTTP read | 17.909375 | 20.669584 | 22.121667 | 40.307791 |

As a scale comparison, function p50 is about **0.23%** of full-read p50, and function p95 about **0.25%** of full-read p95: a fraction of a percent at those percentiles. These are ratios of separate percentile summaries, not paired per-request percentages or an enabled-versus-disabled benchmark. They do not quantify the incremental cost of the entire server boundary or prove every request has the same overhead.

Function timing uses the database clock around the original validity call and includes clock/assignment overhead, but excludes the timing-row insert and network. Full-read timing includes the Auth user lookup, database work, HTTP, and measurement instrumentation. The read retrieves the spike's stored plans and decisions, not the full product dashboard. Enforcement remains active during timing.

Environment: macOS 26.5.2; Node 26.0.0; Docker Engine 29.7.2 on aarch64 with 10 allocated CPUs and 8,319,504,384 bytes of memory; Supabase CLI 2.117.0; pg 8.23.0; supabase-js 2.116.0; ARM64 PostgreSQL 17.6.1.167, Auth/gotrue 2.196.0, and PostgREST 16.2. Connections were local direct PostgreSQL, with application and authentication pool maxima of four each. Fixtures contained two synthetic identities and two committed plan versions with decisions for the measured owner.

This is a **warm local measurement on a near-empty database, not a production benchmark**. It supports continuing architecture evaluation; it establishes no capacity, hosted performance, contention, cold-start, or sustained revocation guarantee.

## Rejected alternatives and their costs

**Client-direct PostgREST table writes:** separate requests for plan and decision would lose the required atomic boundary and add compensation, partial-state repair, and retry ambiguity. RLS alone does not turn separate HTTP requests into one transaction. A single secured RPC could restore atomicity, idempotency, version checks, and live session enforcement, but would move the command and authorization surface into database functions and require an additional public API security review. That is a viable different architecture, not the simple client-direct table-write alternative being rejected. **The deciding factor against secured RPC is migration friction:** under this project's operating constraint, the coding agent cannot run project migrations. Putting command logic in database functions means every change to that database-resident business logic requires a manual SQL Editor migration. This project constraint, rather than operational cost alone, decides against RPC. Server-mediated command changes avoid that recurring SQL step; schema and validity-function changes still require the approved migration workflow. This is a project constraint, not a universal limitation of coding agents or local disposable spike setup. The chosen server adds hosting, session/key management, connection management, and an additional service whose failures must be handled.

**JWT-expiry-only revocation:** this avoids the live session lookup but leaves revoked credentials usable until expiry unless another stateful enforcement mechanism intervenes. Meeting a sub-60-second bound through expiry alone would require very short token lifetimes, with clock and processing margins, more frequent refresh, and greater sensitivity to refresh failures. Those lifecycle costs are unproved here. The measured lookup cost does not justify accepting a known revocation window longer than the requirement.

## Remaining product validation requirements

The spike application is not the product application. None of its setup scripts should be deployed as a product migration. The following remain unproved:

- Operating-system process restart and encrypted-session key recovery, rotation, and loss handling. Check 13 only recreates the API object within the same process while retaining its encryption key.
- Refresh-token lifecycle, concurrent refresh, recovery and reauthentication behavior. The spike disables automatic refresh.
- Hosted Auth/session-table behavior, database privileges, pooler semantics, propagation delays, and hosted failure handling.
- Cold starts, realistic history size, concurrency, sustained load, and repeated revocation latency across instances.
- Verification of the decided admission/in-flight semantics and fail-closed error/timeout behavior, plus retry behavior under real outages.
- Production HTTPS/cookie settings, operational access controls, and key custody. The spike intentionally uses an HTTP loopback cookie exception.

These are validation obligations, not a production certification. Subsequent local authentication work now exercises true process restart, encrypted-key restoration/rotation, serialized refresh across two processes, and durable upstream-signout retry against the product. See `AUTH_CONTRACT.md` for that local contract and its limits. This narrows the local evidence gaps; it does not validate hosted behavior, password/authenticator recovery, production key custody, load or deployment safety.
