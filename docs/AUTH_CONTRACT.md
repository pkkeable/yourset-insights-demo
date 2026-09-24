# Local authentication and session contract

This slice implements password/TOTP authentication against disposable local Supabase. It does not authorize hosted operation, public signup, password recovery, MFA removal or health-account access. ADR 0001 remains authoritative.

## Boundary and limits

The browser holds only a random 256-bit HttpOnly, SameSite=Strict application cookie. The local HTTP loopback exception omits Secure; this runtime rejects hosted origins. Production HTTPS/cookie validation remains a separate gate. Token pairs are encrypted server-side with AES-256-GCM; normal runtime uses the restricted authentication role, never a service-role key. Allowed identities are provisioned independently of login.

Password success creates a five-minute pending session. It cannot read or write private product data. MFA verification rotates the opaque cookie and creates an active session. Active sessions have a 30-minute maximum absolute lifetime (or the configured shorter SESSION_TTL_SECONDS) and a 15-minute idle limit. Valid private activity updates last activity; refresh never extends the absolute lifetime. Auth status checks do not keep a session alive. Expiry requires fresh password and MFA. Six failed MFA verifications revoke the pending session. Login throttles are durable, with generic errors and a Retry-After response.

All session validation/refresh operations serialize using a database row lock. Every admission checks the allowed identity, application expiry/revocation, upstream session existence, validated Auth user and AAL2. Refresh is proactive within 60 seconds of token expiry and also available explicitly. Encrypted replacement tokens commit before the lock is released. Upstream exchange and database commit cannot be one transaction; a lost refresh response is retried with the prior token under Supabase's documented reuse semantics. If recovery is rejected, require reauthentication rather than bypassing validation. Errors/timeouts return 503 with Retry-After, never private data.

Operator revocation blocks new admissions. Already-admitted requests may finish per ADR 0001. Logout durably revokes the application session first, then attempts upstream signout. An upstream failure is retained for bounded retry; it does not reopen the application session. The UI clears state immediately, broadcasts logout/account switching to other tabs, ignores late responses and rechecks session state when returning to a page. No tokens, credentials, health payloads or auth responses are logged or stored in browser storage.

## Routes under /api/private/auth

All POSTs require the exact application Origin and JSON content type; unexpected fields are rejected. No redirect/callback URLs are accepted.

| Route | Input | Success |
|---|---|---|
| POST /login | email, password | Pending cookie; `mfa_required` and whether enrollment is needed |
| GET /session | Cookie | `authenticated` with an opaque session-view identifier, or pending MFA state; no health data/tokens |
| POST /enroll | Empty object; pending cookie | TOTP setup secret for manual entry, factor ID; no private data |
| POST /verify | six-digit code; pending cookie | Rotated active cookie and authenticated state |
| POST /refresh | Empty object; active cookie | Authenticated state after serialized refresh |
| POST /logout | Empty object; cookie if present | Cleared cookie and signed-out state after application revocation |

The enrollment secret is shown only during pending authenticator setup. It remains encrypted server-side so setup can resume after reload; it is removed from the UI on completion/logout and is never a log/test artifact. Existing verified TOTP factors must be challenged; login cannot enroll a replacement to bypass them.

The browser attaches its current session-view identifier to private product requests. If the cookie has switched to a different session, the server rejects that stale view instead of applying its command under the new account. This binds UI intent to a session; it does not replace cookie validation or owner authorization. Non-browser test clients still authenticate through the same validated cookie boundary.

400 means malformed input/invalid MFA code; 401 means missing/invalid/expired session or generic login rejection; 403 means insufficient MFA or invalid request origin; 429 means throttled; 503 means unavailable verification/infrastructure. Every 429/503 includes Retry-After. No successful private read is returned while validation is uncertain.

## Keys, restart and recovery limits

The configured current key has a version ID; an optional server-only previous-key map supports a rotation overlap. New writes use the current key, and successful validation rewraps older encrypted records. Restart with the same key restores sessions. Missing/wrong keys fail closed; restoring the correct key can restore still-valid sessions. Permanently lost keys require revoking affected application sessions and signing in again. No key material belongs in Git.

Lost password or authenticator recovery is deliberately not an automatic MFA bypass. The UI directs the operator to the separately reviewed recovery process; no factor-removal, account-recovery or email-reset route is exposed by this local slice. Full C1 recovery remains an explicit uncompleted gate, alongside hosted privileges and production key custody.

References: [Supabase sessions and refresh reuse](https://supabase.com/docs/guides/auth/sessions), [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp), [pinned Auth HTTP contract](https://github.com/supabase/auth/blob/v2.196.0/openapi.yaml). The server uses these bounded HTTP operations directly, avoiding the SDK's longer automatic refresh retry loop inside the one-second admission budget.
