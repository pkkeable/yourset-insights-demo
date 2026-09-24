"""Transactional revisions/outbox; clocks excluded from normalized hash."""

import hashlib
import json
import sqlite3
from .models import Envelope


def canonical(record):
    d = record.model_dump(mode="json")
    return json.dumps(
        {
            k: v
            for k, v in d.items()
            if k not in ["fetched_at_utc", "normalized_hash", "revision_no"]
        },
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript("""PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS versions (source_key TEXT, revision INTEGER, hash TEXT, body TEXT, PRIMARY KEY(source_key,revision));
        CREATE TABLE IF NOT EXISTS outbox (source_key TEXT, revision INTEGER, acknowledged INTEGER DEFAULT 0, PRIMARY KEY(source_key,revision));
        CREATE TABLE IF NOT EXISTS family_status (family TEXT PRIMARY KEY,last_success TEXT,status TEXT,cursor TEXT);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);""")

    def put(self, r):
        digest = hashlib.sha256(canonical(r).encode()).hexdigest()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            last = self.db.execute(
                "SELECT revision,hash FROM versions WHERE source_key=? ORDER BY revision DESC LIMIT 1",
                (r.source_record_key,),
            ).fetchone()
            if last and last[1] == digest:
                return last[0], False
            rev = last[0] + 1 if last else 1
            r = r.model_copy(update={"revision_no": rev, "normalized_hash": digest})
            self.db.execute(
                "INSERT INTO versions VALUES(?,?,?,?)",
                (r.source_record_key, rev, digest, r.model_dump_json()),
            )
            self.db.execute(
                "INSERT INTO outbox(source_key,revision) VALUES(?,?)",
                (r.source_record_key, rev),
            )
            return rev, True

    def current(self):
        return [
            Envelope.model_validate_json(row[0])
            for row in self.db.execute(
                "SELECT v.body FROM versions v JOIN (SELECT source_key,MAX(revision) r FROM versions GROUP BY source_key) c ON v.source_key=c.source_key AND v.revision=c.r ORDER BY v.source_key"
            )
        ]

    def status(self, family, status, cursor=None, now=None):
        with self.db:
            self.db.execute(
                'INSERT INTO family_status VALUES(?,?,?,?) ON CONFLICT(family) DO UPDATE SET status=excluded.status,last_success=CASE WHEN excluded.status="available" THEN excluded.last_success ELSE family_status.last_success END,cursor=CASE WHEN excluded.status="available" THEN excluded.cursor ELSE family_status.cursor END',
                (family, now, status, cursor),
            )

    def close(self):
        self.db.close()
