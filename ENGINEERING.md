# Engineering findings

What the local experiments actually taught, including the things that broke.

This is deliberately not a status document. Current state belongs in
[docs/CAPABILITIES.md](docs/CAPABILITIES.md); the architecture decision and
its reasoning belong in
[docs/adr/0001-write-and-session-boundary.md](docs/adr/0001-write-and-session-boundary.md).
This file records what was discovered along the way, because those findings
shaped the design more than any plan did.

## Delegating Auth-schema access was not available

The intended session check read `auth.sessions` directly. Under the local
administrative role that delegation could not be granted, so the direct
approach was not merely inadvisable — it was unavailable.

The resolution was a narrow boolean function, `spike.session_valid(session_id,
owner_id)`, returning only whether that session belongs to that owner. It is
`SECURITY DEFINER` with a fixed body, an empty search path and fully qualified
table access. Execution is revoked from `PUBLIC`, `anon` and `authenticated`,
and granted only to the server's authentication role. It performs no writes
and replaces neither owner RLS nor the other admission checks.

The constraint produced a better boundary than the original design: the
application learns one bit, and never sees a session row.

## Connection reuse left transaction context empty

Owner context is transaction-local, set per request. After connection reuse,
that setting came back empty rather than absent — and an empty string cast to
the owner type raised an error instead of simply matching nothing.

Normalising the empty setting to null fixed it: unscoped RLS then returns no
rows, which is the correct failure. This is the difference between a query
that errors and a query that correctly denies. Only one of those is safe to
build admission on, and a cast error can be mistaken for an outage.

## The pinned CLI published ports its network option did not restrict

Installation hardening found that the pinned Supabase CLI's published
container ports were not constrained by its network option. Services intended
to be loopback-only were reachable more broadly than the configuration implied.

The guarded runner now refuses to continue rather than proceeding, and a
development-only Docker shim rewrites port mappings to explicit `127.0.0.1`
bindings for the spike and local product names only. The runner then inspects
the *actual* published bindings of every started container and fails on any
non-loopback host IP — it verifies the observed result rather than trusting
the configuration that was requested.

That guard is authoritative and must keep equivalent verified protection until
a supported service launcher replaces it.

## What the measurements do and do not show

The September 18 local run recorded, over 100 sequential product commands:
p50 **70.26 ms**, p95 **83.44 ms**, maximum **100.86 ms**. Revocation took
**4.87 ms**.

Those bound that sample and nothing else. They are warm measurements against a
near-empty local database on one host, at concurrency 1. They establish no
capacity, hosted performance, contention, cold-start or sustained-load
behaviour. The ADR's read-path sample carries the same limits.

Any future performance claim needs measured workload, sample count, cold
behaviour and errors. Dataset size alone is not scale evidence.

## What none of this established

No personal health record was used. The local HTTP origin and the
process-held encryption key are test constraints, not deployment design.
Hosted deployment permissions, connection pooling, recovery procedures and
unattended operation remain unproven — see the capability matrix for the
full list.
