# Data required by the six-card dashboard

Canonical observations retain source writer, stable source identifier, revision, observation date/time, canonical unit, import timestamp and deletion state. Import time does not make old observations fresh. Adapters validate native payloads before they enter this model; synthetic tests do not establish provider access.

| Family | Canonical meaning | Selection and completeness |
| --- | --- | --- |
| Weight | Observed body mass in kg | Select one validated writer per day; retain source unit/time. Display lb. Not fat or lean tissue change. |
| Nutrition | One selected daily total per nutrient: kcal and grams protein | Resolve revisions/repeated exports before aggregation. Competing writer totals are not additive. Explicit food-log completeness is separate from data presence. |
| Steps | Daily recorded steps | One configured writer; never sum overlapping device totals. Coverage does not establish all non-exercise activity. |
| Lifting | Identified session plus exercise/set records | Preserve equipment, reps, load convention, warm-up/working type and bodyweight status. Session IDs prevent attendance duplication. Duration is elapsed workout minutes, not active lifting. Unknown duration/set classification remains unknown. |
| Cardio | Identified activity with minutes, optional distance | Reconcile mirrored activities across sources. Preserve sport; do not infer Zone 2 from duration or names alone. |
| Sleep | Selected writer's daily asleep duration in hours | Assign local wake date, resolve overlapping intervals and distinguish asleep from time in bed. |
| Resting HR | Provider-defined daily resting rate in bpm | Keep original writer and measurement definition; missing is not zero. |
| HRV | Source-defined value in ms | Optional context. Preserve method/device; do not compare SDNN and RMSSD as interchangeable. |

Training line charts require an explicit covered source interval (`trainingCoverage.lift` / `.aerobic`, inclusive `from` and `to`). A rolling point needs all seven dates inside that interval. An absent session in a covered interval is a recorded zero, not proof of physical inactivity. Unknown coverage is a gap. An entirely absent family uses an unavailable state. An adapter may declare coverage only after complete bounded source retrieval, not from the presence of one record.

Strength uses matched exercise, equipment, repetitions, load convention and writer. Daily points are peak observed load in that exact group. Different exercises never combine into a single load score. The UI must retain group exclusions.

Initial ingestion work must reconcile a bounded native-source sample against the normalized records and rendered summary, then replay it without duplicate inflation. Validate units, time zone/DST, late corrections, deletions, daily totals and session identity before backfill. Preserve unknown food completeness and unsupported fields. Keep actual writer selections, owner targets, personal mappings and sample measurements outside source control.
