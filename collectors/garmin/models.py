"""Allowlisted normalized records. No raw response or location fields."""

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

Status = Literal[
    "available",
    "valid_empty",
    "not_observed_in_window",
    "pending_sync",
    "not_requested",
    "unsupported_confirmed",
    "reauth_required",
    "rate_limited",
    "fetch_error",
    "schema_mismatch",
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Metric(Strict):
    kind: Literal["daily_metric"] = "daily_metric"
    metric_key: Literal[
        "hrv_nightly_mean",
        "hrv_weekly_mean",
        "hrv_baseline_low",
        "hrv_baseline_high",
        "resting_hr",
    ]
    value_number: float | None
    unit: Literal["ms", "bpm"]
    definition: str


class Sleep(Strict):
    kind: Literal["sleep_session"] = "sleep_session"
    asleep_seconds: float | None = Field(default=None, ge=0)
    start_utc: datetime | None = None
    end_utc: datetime | None = None
    wake_date: date | None = None
    session_class: Literal["main", "nap", "unknown"] = "main"
    score: float | None = None
    date_ambiguity: bool = False


class Activity(Strict):
    kind: Literal["activity"] = "activity"
    activity_id: str
    sport: str
    start_utc: datetime | None = None
    elapsed_seconds: float | None = Field(default=None, ge=0)
    timer_seconds: float | None = Field(default=None, ge=0)
    moving_seconds: float | None = Field(default=None, ge=0)
    distance_m: float | None = Field(default=None, ge=0)
    avg_hr_bpm: float | None = None
    max_hr_bpm: float | None = None
    avg_power_w: float | None = None
    expenditure_estimate_kcal: float | None = None
    training_effect_aerobic: float | None = None
    training_effect_anaerobic: float | None = None
    parent_id: str | None = None
    is_parent: bool = False
    strength_context: bool = False
    origin: Literal["unknown", "garmin", "excluded_strava"] = "unknown"


class Series(Strict):
    kind: Literal["activity_series"] = "activity_series"
    activity_id: str
    sampling_class: Literal["chart"] = "chart"
    requested_limit: int = 2000
    sample_count: int
    suspected_truncation: bool
    channels: dict[
        Literal[
            "directTimestamp",
            "sumElapsedDuration",
            "directHeartRate",
            "sumDistance",
            "directSpeed",
            "directPower",
            "directRunCadence",
        ],
        list[float | None],
    ]
    units: dict[
        Literal[
            "directTimestamp",
            "sumElapsedDuration",
            "directHeartRate",
            "sumDistance",
            "directSpeed",
            "directPower",
            "directRunCadence",
        ],
        str,
    ]
    limitation: str = "Chart series; native resolution and channel units require account verification."


Payload = Annotated[Metric | Sleep | Activity | Series, Field(discriminator="kind")]


class Envelope(Strict):
    schema_version: Literal["1.0.0"] = "1.0.0"
    collector_id: UUID
    record_type: Literal["daily_metric", "sleep_session", "activity", "activity_series"]
    source_record_key: str
    revision_no: int = Field(default=1, ge=1)
    normalized_hash: str = Field(default="", pattern="^([0-9a-f]{64})?$")
    provider: Literal["garmin"] = "garmin"
    provider_date: date | None = None
    observed_at_utc: datetime | None = None
    source_updated_at_utc: datetime | None = None
    fetched_at_utc: datetime
    source_timezone: str
    adapter_version: Literal["1.0.0"] = "1.0.0"
    upstream_version: Literal["0.3.15"] = "0.3.15"
    data: Payload
    field_status: dict[str, Status]
