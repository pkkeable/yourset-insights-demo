from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from .models import Envelope, Metric, Sleep, Activity, Series


def number(x):
    if x is None:
        return None
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        raise ValueError("schema_mismatch")
    if x != x or abs(x) == float("inf"):
        raise ValueError("schema_mismatch")
    return x


def instant(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return datetime.fromtimestamp(x / 1000, timezone.utc)
    value = datetime.fromisoformat(x.replace("Z", "+00:00"))
    # Garmin startTimeGMT is explicitly GMT even when lacking a suffix.
    return (
        value.replace(tzinfo=timezone.utc)
        if value.tzinfo is None
        else value.astimezone(timezone.utc)
    )


def envelope(payload, key, day, collector, tz, now=None):
    values = payload.model_dump()
    status = {
        k: "available" if v is not None else "not_observed_in_window"
        for k, v in values.items()
    }
    return Envelope(
        collector_id=collector,
        record_type=payload.kind,
        source_record_key=key,
        provider_date=day,
        observed_at_utc=payload.start_utc
        if isinstance(payload, Activity)
        else payload.end_utc
        if isinstance(payload, Sleep)
        else None,
        fetched_at_utc=now or datetime.now(timezone.utc),
        source_timezone=tz,
        data=payload,
        field_status=status,
    )


def sleep(raw, day, collector, tz):
    if not isinstance(raw, dict) or "dailySleepDTO" not in raw:
        raise ValueError("schema_mismatch")
    d = raw["dailySleepDTO"]
    if not d:
        return []
    provider_day = d.get("calendarDate") or day
    end = instant(d.get("sleepEndTimestampGMT"))
    start = instant(d.get("sleepStartTimestampGMT"))
    wake = end.astimezone(ZoneInfo(tz)).date() if end else None
    score = ((d.get("sleepScores") or {}).get("overall") or {}).get("value")
    p = Sleep(
        asleep_seconds=number(d.get("sleepTimeSeconds")),
        start_utc=start,
        end_utc=end,
        wake_date=wake,
        score=number(score),
        date_ambiguity=bool(wake and str(wake) != provider_day),
    )
    # Stable main-sleep date key survives a corrected start; naps deliberately not inferred.
    return [envelope(p, f"sleep:main:{provider_day}", provider_day, collector, tz)]


def hrv(raw, day, collector, tz):
    if raw is None:
        return []
    if not isinstance(raw, dict) or "hrvSummary" not in raw:
        raise ValueError("schema_mismatch")
    d = raw["hrvSummary"] or {}
    base = d.get("baseline") or {}
    pairs = [
        ("hrv_nightly_mean", d.get("lastNightAvg")),
        ("hrv_weekly_mean", d.get("weeklyAvg")),
        ("hrv_baseline_low", base.get("balancedLow")),
        ("hrv_baseline_high", base.get("balancedUpper")),
    ]
    return [
        envelope(
            Metric(
                metric_key=k,
                value_number=number(v),
                unit="ms",
                definition="Garmin HRV summary; not assumed equivalent to Apple SDNN",
            ),
            f"{k}:{day}",
            d.get("calendarDate") or day,
            collector,
            tz,
        )
        for k, v in pairs
    ]


def rhr(raw, day, collector, tz):
    if not isinstance(raw, dict):
        raise ValueError("schema_mismatch")
    # Candidate provider path, explicitly pending live field validation.
    values = (
        raw.get("allMetrics", {})
        .get("metricsMap", {})
        .get("WELLNESS_RESTING_HEART_RATE")
    )
    if values is None:
        raise ValueError("schema_mismatch")
    matches = [x for x in values if x.get("calendarDate") == day]
    if not matches:
        return []
    value = number(matches[-1].get("value"))
    return [
        envelope(
            Metric(
                metric_key="resting_hr",
                value_number=value,
                unit="bpm",
                definition="Garmin daily wellness resting HR",
            ),
            f"rhr:{day}",
            day,
            collector,
            tz,
        )
    ]


def activity(d, collector, tz):
    if not isinstance(d, dict) or "activityId" not in d:
        raise ValueError("schema_mismatch")
    if str(d.get("origin", "")).lower() == "strava":
        return None
    summary = d.get("summaryDTO") or d
    kind = d.get("activityTypeDTO") or d.get("activityType") or {}
    sport = kind.get("typeKey", "unknown")
    start = instant(summary.get("startTimeGMT") or d.get("startTimeGMT"))
    day = str(start.astimezone(ZoneInfo(tz)).date()) if start else None
    fields = {
        "elapsed_seconds": "elapsedDuration",
        "timer_seconds": "duration",
        "moving_seconds": "movingDuration",
        "distance_m": "distance",
        "avg_hr_bpm": "averageHR",
        "max_hr_bpm": "maxHR",
        "avg_power_w": "avgPower",
        "expenditure_estimate_kcal": "calories",
        "training_effect_aerobic": "trainingEffect",
        "training_effect_anaerobic": "anaerobicTrainingEffect",
    }
    payload = Activity(
        activity_id=str(d["activityId"]),
        sport=sport,
        start_utc=start,
        parent_id=str(d["parentActivityId"]) if d.get("parentActivityId") else None,
        is_parent=bool(d.get("childIds")),
        strength_context=sport == "strength_training",
        **{k: number(summary.get(v)) for k, v in fields.items()},
    )
    return envelope(payload, f"activity:{d['activityId']}", day, collector, tz)


def series(d, activity_id, day, collector, tz):
    if (
        not isinstance(d, dict)
        or "metricDescriptors" not in d
        or "activityDetailMetrics" not in d
    ):
        raise ValueError("schema_mismatch")
    allowed = {
        "directTimestamp",
        "sumElapsedDuration",
        "directHeartRate",
        "sumDistance",
        "directSpeed",
        "directPower",
        "directRunCadence",
    }
    channels = {}
    units = {}
    samples = d["activityDetailMetrics"]
    for desc in d["metricDescriptors"]:
        key = desc.get("key")
        idx = desc.get("metricsIndex")
        if key not in allowed:
            continue
        if isinstance(idx, bool) or not isinstance(idx, int) or idx < 0:
            raise ValueError("schema_mismatch")
        if key in channels:
            raise ValueError("schema_mismatch")
        channels[key] = [
            number(r["metrics"][idx]) if idx < len(r.get("metrics", [])) else None
            for r in samples
        ]
        unit = desc.get("unit") or {}
        units[key] = unit.get("key", "unknown") if isinstance(unit, dict) else "unknown"
    p = Series(
        activity_id=str(activity_id),
        sample_count=len(samples),
        suspected_truncation=len(samples) >= 2000,
        channels=channels,
        units=units,
    )
    return envelope(p, f"series:{activity_id}", day, collector, tz)
