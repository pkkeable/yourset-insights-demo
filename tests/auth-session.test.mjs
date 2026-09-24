import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, unseal, cookieValue } from "../private-api/auth.mjs";

test("encrypted tokens bind to owner, detect tampering and support explicit key overlap", () => {
  const key = randomBytes(32),
    cfg = { key, keyId: "one", keys: new Map([["one", key]]) };
  const tokens = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
    },
    sealed = seal(cfg, tokens, "synthetic-owner");
  assert.deepEqual(unseal(cfg, { sealed, owner: "synthetic-owner" }), tokens);
  assert.throws(
    () => unseal(cfg, { sealed, owner: "another-owner" }),
    (e) => e.status === 503,
  );
  assert.throws(
    () =>
      unseal(cfg, {
        sealed: {
          ...sealed,
          body:
            (parseInt(sealed.body.slice(0, 2), 16) ^ 255)
              .toString(16)
              .padStart(2, "0") + sealed.body.slice(2),
        },
        owner: "synthetic-owner",
      }),
    (e) => e.status === 503,
  );
  assert.throws(
    () =>
      unseal({ ...cfg, keys: new Map() }, { sealed, owner: "synthetic-owner" }),
    (e) => e.status === 503,
  );
  const next = randomBytes(32),
    rotation = {
      key: next,
      keyId: "two",
      keys: new Map([
        ["one", key],
        ["two", next],
      ]),
    };
  const rewrapped = seal(
    rotation,
    unseal(rotation, { sealed, owner: "synthetic-owner" }),
    "synthetic-owner",
  );
  assert.equal(rewrapped.kid, "two");
  assert.deepEqual(
    unseal(rotation, { sealed: rewrapped, owner: "synthetic-owner" }),
    tokens,
  );
});

test("application cookie parser rejects duplicate and malformed credentials", () => {
  const token = "a".repeat(64);
  assert.equal(
    cookieValue({ headers: { cookie: "yourset_session=" + token } }),
    token,
  );
  for (const cookie of [
    "",
    "yourset_session=bad",
    `yourset_session=${token}; yourset_session=${token}`,
  ])
    assert.equal(cookieValue({ headers: { cookie } }), null);
});
