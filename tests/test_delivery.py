import json
import uuid
import pytest
from collectors.garmin.delivery import Ingest, sign
from collectors.garmin.normalize import activity
from collectors.garmin.store import Store

C = "00000000-0000-4000-8000-000000000001"
KEY = b"synthetic-key-for-tests-only!!!!!"


def setup():
    s = Store(":memory:")
    r = activity(
        {
            "activityId": 1,
            "activityType": {"typeKey": "running"},
            "elapsedDuration": 600,
        },
        C,
        "UTC",
    )
    s.put(r)
    r = s.current()[0]
    payload = {
        "schema_version": "1.0.0",
        "batch_id": str(uuid.uuid4()),
        "collector_id": C,
        "manifest": {"record_count": 1},
        "records": [r.model_dump(mode="json")],
    }
    body = json.dumps(payload).encode()
    server = Ingest(
        ":memory:",
        {
            "test": {
                "owner": "synthetic-owner",
                "collector": C,
                "key": KEY,
                "active": True,
            }
        },
    )
    return s, payload, body, server


def test_signature_exact_bytes_replay_and_retry():
    _, p, body, server = setup()
    headers = sign(KEY, "test", body, 1000)
    receipt = server.receive(headers, body, 1000)
    with pytest.raises(ValueError, match="replayed_nonce"):
        server.receive(headers, body, 1000)
    assert server.receive(sign(KEY, "test", body, 1001), body, 1001) == receipt
    assert len(server.current()) == 1
    with pytest.raises(ValueError, match="invalid_signature"):
        server.receive(headers, body + b" ", 1000)


@pytest.mark.parametrize(
    "change,error",
    [
        (lambda p: p.update(schema_version="9"), "unsupported_schema"),
        (lambda p: p.update(owner_id="spoof"), "unsupported_schema"),
        (lambda p: p.update(collector_id=str(uuid.uuid4())), "collector_spoof"),
        (lambda p: p.update(manifest={"record_count": 3}), "manifest_mismatch"),
        (lambda p: p["records"][0].update(normalized_hash="a" * 64), "record_checksum"),
    ],
)
def test_signed_malformed_batches_fail(change, error):
    _, p, _, server = setup()
    change(p)
    body = json.dumps(p).encode()
    with pytest.raises(ValueError, match=error):
        server.receive(sign(KEY, "test", body, 1000), body, 1000)
    assert server.current() == []


def test_expiry_size_and_inactive_key():
    _, p, body, server = setup()
    with pytest.raises(ValueError, match="expired_signature"):
        server.receive(sign(KEY, "test", body, 1000), body, 1301)
    with pytest.raises(ValueError, match="body_too_large"):
        server.receive({}, b" " * 2097153, 1000)
    server.bindings["test"]["active"] = False
    with pytest.raises(ValueError, match="inactive_key"):
        server.receive(sign(KEY, "test", body, 1000), body, 1000)


def test_batch_conflict_and_out_of_order_current():
    s, p, body, server = setup()
    server.receive(sign(KEY, "test", body, 1000), body, 1000)
    r = s.current()[0]
    s.put(
        r.model_copy(
            update={"data": r.data.model_copy(update={"elapsed_seconds": 800})}
        )
    )
    p["records"] = [s.current()[0].model_dump(mode="json")]
    bad = json.dumps(p).encode()
    with pytest.raises(ValueError, match="conflicting_batch"):
        server.receive(sign(KEY, "test", bad, 1001), bad, 1001)
    p["batch_id"] = str(uuid.uuid4())
    new = json.dumps(p).encode()
    server.receive(sign(KEY, "test", new, 1001), new, 1001)
    p["records"] = [r.model_dump(mode="json")]
    p["batch_id"] = str(uuid.uuid4())
    old = json.dumps(p).encode()
    server.receive(sign(KEY, "test", old, 1002), old, 1002)
    assert json.loads(server.current()[0][0])["revision_no"] == 2
