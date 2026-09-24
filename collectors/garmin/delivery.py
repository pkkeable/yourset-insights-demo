"""Offline signed-ingestion reference implementation. Not a deployed HTTP route.

SQLite transaction exercises nonce reservation, idempotency and revision handling.
Cloud transport must be adapted and independently verified before activation.
"""

import hashlib
import hmac
import json
import sqlite3
import time
import uuid
from .models import Envelope

PATH = "/functions/v1/garmin-ingest"


def canonical_signing(key_id, timestamp, nonce, body):
    return "\n".join(
        [
            "v1",
            "POST",
            PATH,
            key_id,
            str(timestamp),
            nonce,
            hashlib.sha256(body).hexdigest(),
        ]
    ).encode()


def sign(key, key_id, body, now=None):
    timestamp = int(now if now is not None else time.time())
    nonce = str(uuid.uuid4())
    return {
        "X-Collector-Key-Id": key_id,
        "X-Collector-Timestamp": str(timestamp),
        "X-Collector-Nonce": nonce,
        "X-Collector-Signature": hmac.new(
            key, canonical_signing(key_id, timestamp, nonce, body), hashlib.sha256
        ).hexdigest(),
    }


class Ingest:
    def __init__(self, db, bindings):
        self.db = sqlite3.connect(db)
        self.bindings = bindings
        self.db.executescript("""CREATE TABLE IF NOT EXISTS nonces(key_id TEXT,nonce TEXT,time INTEGER,PRIMARY KEY(key_id,nonce));
        CREATE TABLE IF NOT EXISTS batches(owner TEXT,collector TEXT,id TEXT,digest TEXT,receipt TEXT,PRIMARY KEY(owner,collector,id));
        CREATE TABLE IF NOT EXISTS versions(owner TEXT,collector TEXT,key TEXT,revision INTEGER,hash TEXT,body TEXT,PRIMARY KEY(owner,collector,key,revision));""")

    def receive(self, headers, body, now=None):
        now = int(time.time() if now is None else now)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError("body_too_large")
        key_id = headers.get("X-Collector-Key-Id")
        binding = self.bindings.get(key_id)
        if not binding or not binding["active"]:
            raise ValueError("inactive_key")
        try:
            timestamp = int(headers["X-Collector-Timestamp"])
            nonce = str(uuid.UUID(headers["X-Collector-Nonce"]))
        except (KeyError, ValueError, TypeError):
            raise ValueError("invalid_auth") from None
        if abs(now - timestamp) > 300:
            raise ValueError("expired_signature")
        signature = hmac.new(
            binding["key"],
            canonical_signing(key_id, timestamp, nonce, body),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, headers.get("X-Collector-Signature", "")):
            raise ValueError("invalid_signature")
        payload = json.loads(body)
        if (
            set(payload)
            != {"schema_version", "batch_id", "collector_id", "manifest", "records"}
            or payload["schema_version"] != "1.0.0"
        ):
            raise ValueError("unsupported_schema")
        if payload["collector_id"] != binding["collector"]:
            raise ValueError("collector_spoof")
        batch = str(uuid.UUID(payload["batch_id"]))
        records = payload["records"]
        if not isinstance(records, list) or not 0 < len(records) <= 500:
            raise ValueError("record_limit")
        if payload["manifest"] != {"record_count": len(records)}:
            raise ValueError("manifest_mismatch")
        parsed = [Envelope.model_validate(r) for r in records]
        for r in parsed:
            if str(r.collector_id) != binding["collector"]:
                raise ValueError("collector_spoof")
            if r.record_type != r.data.kind:
                raise ValueError("type_mismatch")
            from .store import canonical

            if hashlib.sha256(canonical(r).encode()).hexdigest() != r.normalized_hash:
                raise ValueError("record_checksum")
            if r.record_type == "activity_series":
                raise ValueError("series_transport_not_enabled")
        digest = hashlib.sha256(body).hexdigest()
        owner = binding["owner"]
        collector = binding["collector"]
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            if (
                self.db.execute(
                    "SELECT COUNT(*) FROM nonces WHERE key_id=? AND time>?",
                    (key_id, now - 3600),
                ).fetchone()[0]
                >= 60
            ):
                raise ValueError("rate_limited")
            try:
                self.db.execute(
                    "INSERT INTO nonces VALUES(?,?,?)", (key_id, nonce, now)
                )
            except sqlite3.IntegrityError:
                raise ValueError("replayed_nonce") from None
            existing = self.db.execute(
                "SELECT digest,receipt FROM batches WHERE owner=? AND collector=? AND id=?",
                (owner, collector, batch),
            ).fetchone()
            if existing:
                if existing[0] != digest:
                    raise ValueError("conflicting_batch")
                return json.loads(existing[1])
            for r in parsed:
                previous = self.db.execute(
                    "SELECT hash FROM versions WHERE owner=? AND collector=? AND key=? AND revision=?",
                    (owner, collector, r.source_record_key, r.revision_no),
                ).fetchone()
                if previous and previous[0] != r.normalized_hash:
                    raise ValueError("revision_conflict")
                self.db.execute(
                    "INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,?)",
                    (
                        owner,
                        collector,
                        r.source_record_key,
                        r.revision_no,
                        r.normalized_hash,
                        r.model_dump_json(),
                    ),
                )
            receipt = {"batch_id": batch, "records": len(parsed), "digest": digest}
            self.db.execute(
                "INSERT INTO batches VALUES(?,?,?,?,?)",
                (owner, collector, batch, digest, json.dumps(receipt)),
            )
            return receipt

    def current(self):
        return self.db.execute(
            "SELECT v.body FROM versions v JOIN (SELECT owner,collector,key,MAX(revision) r FROM versions GROUP BY owner,collector,key)c ON v.owner=c.owner AND v.collector=c.collector AND v.key=c.key AND v.revision=c.r"
        ).fetchall()
