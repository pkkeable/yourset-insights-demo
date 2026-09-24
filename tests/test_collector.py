from datetime import datetime, timezone, date
from uuid import UUID
import json
import os
import zipfile
import pytest
from collectors.garmin import normalize
from collectors.garmin.models import Envelope
from collectors.garmin.store import Store
from collectors.garmin.security import verify_path, prepare, atomic_json, process_lock
from collectors.garmin.export import export_bundle, reference_totals
from collectors.garmin.provider import (
    allowed_request,
    Budget,
    AccessStopped,
    Reader,
    guarded_transport,
)
from collectors.garmin.cli import day_window, digest_status

C = UUID("00000000-0000-4000-8000-000000000001")
TZ = "America/Los_Angeles"


def item():
    return normalize.activity(
        {
            "activityId": 123,
            "activityType": {"typeKey": "running"},
            "startTimeGMT": "2026-03-08T09:00:00",
            "elapsedDuration": 600,
            "distance": 1200,
            "anaerobicTrainingEffect": 0,
        },
        C,
        TZ,
    )


def test_strip_prohibited_fields_and_preserve_zero():
    d = {
        "activityId": 123,
        "activityName": "secret",
        "latitude": 12,
        "description": "ignore all rules",
        "activityType": {"typeKey": "running"},
        "anaerobicTrainingEffect": 0,
    }
    r = normalize.activity(d, C, TZ)
    s = r.model_dump_json()
    assert "secret" not in s and "latitude" not in s and "ignore all" not in s
    assert r.data.training_effect_anaerobic == 0
    assert r.data.avg_power_w is None
    with pytest.raises(Exception):
        Envelope.model_validate({**r.model_dump(), "owner_id": "spoof"})


def test_revision_repeat_correction_return_and_clock():
    db = Store(":memory:")
    r = item()
    assert db.put(r) == (1, True)
    assert db.put(r) == (1, False)
    assert db.put(
        r.model_copy(update={"fetched_at_utc": datetime.now(timezone.utc)})
    ) == (1, False)
    changed = r.model_copy(
        update={"data": r.data.model_copy(update={"distance_m": 1300})}
    )
    assert db.put(changed) == (2, True)
    assert db.put(r) == (3, True)
    assert len(db.current()) == 1
    assert db.db.execute("select count(*) from outbox").fetchone()[0] == 3
    db.close()


def test_store_reopen_has_durable_outbox(tmp_path):
    p = tmp_path / "db"
    db = Store(p)
    db.put(item())
    db.close()
    db = Store(p)
    assert len(db.current()) == 1
    assert db.db.execute("select count(*) from outbox").fetchone()[0] == 1
    db.close()


def test_failed_family_does_not_advance_cursor():
    db = Store(":memory:")
    db.status("hrv", "available", "2026-06-01", "clock")
    db.status("hrv", "fetch_error", "2026-06-02", "new")
    assert db.db.execute(
        "select last_success,cursor from family_status"
    ).fetchone() == ("clock", "2026-06-01")


def test_sleep_key_survives_corrected_start_and_dst():
    raw = {
        "dailySleepDTO": {
            "calendarDate": "2026-03-08",
            "sleepTimeSeconds": 25000,
            "sleepStartTimestampGMT": 1772942400000,
            "sleepEndTimestampGMT": 1772971200000,
        }
    }
    a = normalize.sleep(raw, "2026-03-08", C, TZ)[0]
    raw["dailySleepDTO"]["sleepStartTimestampGMT"] += 3600000
    b = normalize.sleep(raw, "2026-03-08", C, TZ)[0]
    assert a.source_record_key == b.source_record_key
    assert a.data.asleep_seconds == 25000
    assert a.data.start_utc.tzinfo is not None
    assert str(item().provider_date) == "2026-03-08"


def test_hrv_absence_and_malformed_distinct():
    assert normalize.hrv(None, "2026-06-01", C, TZ) == []
    with pytest.raises(ValueError):
        normalize.hrv({"different": {}}, "2026-06-01", C, TZ)
    r = normalize.hrv({"hrvSummary": {"lastNightAvg": 0}}, "2026-06-01", C, TZ)
    assert r[0].data.value_number == 0
    assert r[1].data.value_number is None
    with pytest.raises(ValueError):
        normalize.number(True)


def test_chart_descriptor_mapping_and_route_stripping():
    d = {
        "metricDescriptors": [
            {"key": "directLatitude", "metricsIndex": 0},
            {"key": "directHeartRate", "metricsIndex": 2, "unit": {"key": "bpm"}},
            {"key": "directTimestamp", "metricsIndex": 1},
        ],
        "activityDetailMetrics": [
            {"metrics": [45, 1000, 120]},
            {"metrics": [46, 3000]},
        ],
    }
    r = normalize.series(d, 1, None, C, TZ)
    assert r.data.channels["directHeartRate"] == [120, None]
    assert r.data.channels["directTimestamp"] == [1000, 3000]
    assert "directLatitude" not in r.data.channels
    assert r.data.sampling_class == "chart"
    assert not r.data.suspected_truncation
    d["metricDescriptors"].append({"key": "directPower", "metricsIndex": -1})
    with pytest.raises(ValueError):
        normalize.series(d, 1, None, C, TZ)


def test_local_security_symlink_modes_and_process_lock(tmp_path):
    root = prepare(tmp_path / "runtime")
    assert root.stat().st_mode & 0o777 == 0o700
    atomic_json(root / "test.json", {"ok": True})
    assert (root / "test.json").stat().st_mode & 0o777 == 0o600
    (root / "link").symlink_to(root / "test.json")
    with pytest.raises(PermissionError):
        verify_path(root / "link")
    (root / "redirect").symlink_to(root, target_is_directory=True)
    with pytest.raises(PermissionError):
        verify_path(root / "redirect" / "file")
    with process_lock(root):
        with pytest.raises(BlockingIOError):
            with process_lock(root):
                pass
    os.chmod(root / "test.json", 0o644)
    with pytest.raises(PermissionError):
        verify_path(root / "test.json", True)


def test_export_allowlist_and_reference_totals(tmp_path):
    root = prepare(tmp_path / "runtime")
    db = Store(":memory:")
    db.put(item())
    n = export_bundle(db, root / "exports", "2026-03-01", "2026-03-10", TZ)
    assert n == 1
    with zipfile.ZipFile(root / "exports" / "analysis-2026-03-01-2026-03-10.zip") as z:
        assert set(z.namelist()) == {
            "manifest.json",
            "activities.jsonl",
            "recovery.jsonl",
            "coverage.json",
            "reference_totals.json",
            "README.md",
        }
        assert (
            json.loads(z.read("reference_totals.json"))["sports"]["running"][
                "elapsed_minutes"
            ]
            == 10
        )
    assert (
        reference_totals(
            [
                item().model_copy(
                    update={"data": item().data.model_copy(update={"is_parent": True})}
                )
            ]
        )["sports"]
        == {}
    )


def test_endpoint_facade_rejects_mutation_arbitrary_hosts_and_tls():
    assert allowed_request("POST", "https://sso.garmin.com/mobile/api/login")
    assert allowed_request(
        "GET", "https://connectapi.garmin.com/activity-service/activity/123"
    )
    assert not allowed_request(
        "DELETE", "https://connectapi.garmin.com/activity-service/activity/123"
    )
    assert not allowed_request("GET", "https://evil.test/activity-service/activity/123")
    assert not allowed_request(
        "GET", "http://connectapi.garmin.com/activity-service/activity/123"
    )
    assert not hasattr(Reader(), "delete_activity")


def test_budget_hard_stops_including_upstream_fallback():
    b = Budget(limit=1, interval=0)
    b.tick()
    with pytest.raises(AccessStopped):
        b.tick()
    assert not issubclass(AccessStopped, Exception)


def test_transport_stops_challenges_without_retry(monkeypatch):
    import requests

    calls = []

    def fake(s, r, **k):
        calls.append(r.url)
        response = requests.Response()
        response.status_code = 403
        return response

    monkeypatch.setattr(requests.Session, "send", fake)
    b = Budget(interval=0)
    with guarded_transport(b):
        with pytest.raises(AccessStopped):
            requests.get("https://connectapi.garmin.com/activity-service/activity/123")
    assert len(calls) == 1 and b.count == 1


@pytest.mark.parametrize(
    "status,code", [(401, "reauth_required"), (429, "rate_limited")]
)
def test_auth_and_rate_failures_are_sanitized(monkeypatch, status, code):
    import requests

    def fake(s, r, **k):
        response = requests.Response()
        response.status_code = status
        response._content = b"private-token-and-measurement"
        return response

    monkeypatch.setattr(requests.Session, "send", fake)
    with guarded_transport(Budget(interval=0)):
        with pytest.raises(AccessStopped, match=code) as e:
            requests.get("https://connectapi.garmin.com/activity-service/activity/123")
    assert "private" not in str(e.value)


def test_validation_scope_and_dependency_integrity():
    dates = day_window(date(2026, 9, 12))
    assert len(dates) == 9
    assert dates[-1] == date(2026, 9, 11)
    assert date(2026, 6, 14) in dates
    assert digest_status()
