# Local authentication/transaction spike

> Preserved verbatim from the original experiment, including its formatting. It is excluded from the repository's Prettier configuration deliberately: this directory and its loopback guard are kept as they were when the findings in `../../ENGINEERING.md` were observed.

This isolated experiment exercises real Supabase Auth, TOTP MFA, Postgres and a Node HTTP boundary with random disposable identities and synthetic plan values. It is excluded from the public demo build. It is not the private application and must never receive personal records or be deployed.

## Run

Docker Desktop (ARM supported), Node 22+ and npm are required. From this directory:

```sh
npm ci
npm test
```

The pinned CLI starts only the needed services. The runner checks that every published port binds to loopback before creating test identities. It fails closed if that cannot be established. This CLI's loopback behavior is an unresolved installation limitation; see the evidence report. `npm run test:running` is an internal test entry point, not a way to bypass a failed network check.

The local project name `yourset-auth-spike`, `spike` schema and `yourset_spike_*` roles are reserved for this disposable experiment. The test refuses an existing spike schema. The runner disposes this project's containers and volumes after a run; never store anything worth retaining here. No hosted project is linked. CLI service keys are consumed internally and should never be printed or copied. Random test-user credentials and encryption keys exist only in process memory. Test identities and schema are removed after execution.

## Boundaries being tested

- Supabase password sign-in, a real TOTP enrollment/challenge and AAL2 enforcement.
- Opaque HttpOnly/SameSite cookie; encrypted server-side token storage; pre-MFA cookie rotation.
- Restricted application and auth-broker database roles. Private schema inaccessible through the Data API, including with a genuine AAL2 JWT.
- Owner context local to an explicit database transaction, RLS and same-owner plan/decision foreign key.
- Atomic plan/decision/receipt commit, injected rollback, lost-response retry, content-bound idempotency and concurrent-version conflict.
- Application revocation and upstream session removal checked on subsequent requests.

`schema.sql` is a disposable setup fixture, not a production migration. The fixed `session_valid` security-definer function has an empty search path, two UUID arguments, boolean-only output, and execute permission only for the broker role. Ordinary CRUD uses a separate non-owner role and RLS. The broker never grants Auth-table read access to the browser or the application CRUD role.

## Deliberate limitations

The server listens only on loopback. Its cookie omits Secure solely for HTTP loopback testing; there is no deployment entry point. This is not production login UX, rate limiting, refresh/recovery, CSRF-token implementation, backup/restore, full decision/review persistence, deployment-pool validation or a complete security audit. Strict origin/content-type checks cover the tested mutation surface. Refresh is disabled and expiry fails closed. API object restart was tested with the same process-held encryption key; actual process/key-management recovery remains unverified. Fault injection is a constructor-only test hook, never an HTTP endpoint.

The prototype currently returns stored plans/decisions at `/overview`; it does not yet run the product dashboard engine on persistent records. The claim is a boundary/transaction proof, not completion of Phases 0–2.
