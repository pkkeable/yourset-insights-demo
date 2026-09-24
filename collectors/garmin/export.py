import hashlib
import os
import zipfile
from .security import verify_path, atomic_json


def reference_totals(records):
    activities = [
        r
        for r in records
        if r.record_type == "activity"
        and not r.data.is_parent
        and not r.data.strength_context
        and r.data.origin != "excluded_strava"
    ]
    sports = {}
    for r in activities:
        s = sports.setdefault(
            r.data.sport, {"count": 0, "elapsed_minutes": 0, "duration_missing": 0}
        )
        s["count"] += 1
        if r.data.elapsed_seconds is None:
            s["duration_missing"] += 1
        else:
            s["elapsed_minutes"] += r.data.elapsed_seconds / 60
    return {
        "sports": sports,
        "sleep_dates": sorted(
            {
                str(r.provider_date)
                for r in records
                if r.record_type == "sleep_session"
                and r.data.asleep_seconds is not None
            }
        ),
        "hrv_dates": sorted(
            {
                str(r.provider_date)
                for r in records
                if r.record_type == "daily_metric"
                and r.data.metric_key == "hrv_nightly_mean"
                and r.data.value_number is not None
            }
        ),
        "tolerance": "Counts exact; elapsed minutes rounded only for display.",
    }


def export_bundle(store, root, start, end, tz):
    records = [
        r
        for r in store.current()
        if r.provider_date
        and start <= str(r.provider_date) <= end
        and r.record_type != "activity_series"
    ]
    dest = verify_path(root / f"analysis-{start}-{end}", True)
    dest.mkdir(mode=0o700, exist_ok=True)
    names = [
        "activities.jsonl",
        "recovery.jsonl",
        "coverage.json",
        "reference_totals.json",
        "README.md",
    ]
    for name in names[:2]:
        subset = [
            r
            for r in records
            if (r.record_type == "activity") == (name == "activities.jsonl")
        ]
        target = verify_path(dest / name, True)
        fd = os.open(
            target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(fd, "w") as f:
            for r in subset:
                f.write(r.model_dump_json() + "\n")
    atomic_json(
        dest / "coverage.json",
        {
            "records": len(records),
            "fields": [
                {"key": r.source_record_key, "status": r.field_status} for r in records
            ],
        },
    )
    atomic_json(dest / "reference_totals.json", reference_totals(records))
    verify_path(dest / "README.md", True).write_text(
        "Health-sensitive local export. Not anonymous. No names, notes, GPS, raw responses or token stores. Chart streams excluded. Garmin-only data cannot validate nutrition/weight/training joins. Field units require live comparison.\n"
    )
    checksums = {n: hashlib.sha256((dest / n).read_bytes()).hexdigest() for n in names}
    atomic_json(
        dest / "manifest.json",
        {
            "schema_version": "1.0.0",
            "from": start,
            "to": end,
            "inclusive": True,
            "timezone": tz,
            "count": len(records),
            "checksums": checksums,
        },
    )
    archive = verify_path(root / f"analysis-{start}-{end}.zip", True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for n in names + ["manifest.json"]:
            z.write(dest / n, n)
    os.chmod(archive, 0o600)
    return len(records)
