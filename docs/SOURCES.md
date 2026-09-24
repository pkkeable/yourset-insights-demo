# Source capabilities and rights register

Status labels are capability-specific. No fixture proves account access, provider permission or physiological benefit.

| Source | Implemented locally | Live status | Required before operation |
|---|---|---|---|
| Synthetic | Seeded daily records, all ten scenarios, shared metric engine | Not applicable | Software tests and UI review |
| Garmin | Pinned 0.3.15 read facade, bounded validation CLI, typed normalization, private SQLite, export, transport guard | Not account-tested at initial build | User-run sign-in; second-process resume; field/date/unit comparisons; real refresh observation; rights assessment |
| Hevy | Offline workout/set projection requiring explicit exercise/equipment mapping | No account read in this task | Dedicated secret setup, bounded history read, routines capability verification, update/deletion semantics, incremental daily schedule |
| Apple Health | Offline selected-sample projection preserving writer/time/unit and explicit completeness | Actual background-export schema and delivery not tested | Configure exporter, establish native payload mapping, secure narrow destination, select primary writers, measure delivery while phone is locked |
| MyNetDiary / Wyze | Planned original writers through Apple Health, not independent duplicate connectors | Unverified route | Verify actual writer metadata and whether required measurements arrive |
| Strava | Excluded | No access | Separate rights review before any future proposal |

A monthly strength export alone is insufficient to establish daily freshness for this product. Workout history does not establish prescribed routine definitions. In the offline Apple adapter, selected samples are explicitly marked as requiring daily aggregation; it does not pretend that the selection contract is Health Auto Export's native JSON.

## Garmin field map candidate

| Internal field | Provider path | Method | Unit/date handling |
|---|---|---|---|
| activity_id, sport | activityId; activityTypeDTO.typeKey or activityType.typeKey | get_activity / inventory | String stable ID; source sport category |
| start_utc | summaryDTO.startTimeGMT or startTimeGMT | get_activity | Explicit GMT parsed once; local date via configured timezone |
| elapsed/timer/moving seconds | elapsedDuration / duration / movingDuration in summary DTO or inventory | get_activity | Separate seconds; no fallback equating timer with elapsed |
| distance, HR, power | distance, averageHR, maxHR, avgPower | get_activity | m, bpm, W; populated fields and units await live comparison |
| provider expenditure | calories | get_activity | Provider estimate, not intake or established need |
| Training Effect | trainingEffect, anaerobicTrainingEffect | get_activity | Proprietary units; valid zero retained |
| sleep | dailySleepDTO.sleepTimeSeconds; sleepStartTimestampGMT; sleepEndTimestampGMT; calendarDate | get_sleep_data | Asleep seconds separate from duration in bed; provider date and local wake date retained |
| HRV | hrvSummary.lastNightAvg, weeklyAvg, baseline.balancedLow, baseline.balancedUpper | get_hrv_data | Candidate milliseconds; no RMSSD/SDNN equivalence claim |
| RHR | allMetrics.metricsMap.WELLNESS_RESTING_HEART_RATE[].value, matched calendarDate | get_rhr_day | Candidate bpm mapping; unrecognized structure is schema_mismatch |
| chart channels | metricDescriptors[].key / metricsIndex + activityDetailMetrics[].metrics | get_activity_details | Preserve positions/gaps; units from descriptor or unknown; chart resolution only; maxPolylineSize=0 and route fields dropped |

Missing optional features are not diagnosed as unsupported hardware. Readiness, stress, load, Body Battery, VO2max and native FIT are not requested by this candidate. Naps, comprehensive activity hierarchy and recording-origin attribution require further verified mapping; no raw-payload reconstruction guarantee is made. Confirmed Strava origin is excluded, unknown origins are visible and must be resolved before applicable private activation.

## Dependency / permission separation

Garmin library MIT licensing does not grant permission to access or redistribute Garmin data. Personal unofficial access remains separate from official commercial approval. Source access constraints, source/device definitions and live account behavior require individual review. See the pinned [dependency review](../collectors/garmin/DEPENDENCY_REVIEW.md).

Fonts: Fontsource Variable DM Sans 5.3.0 and JetBrains Mono 5.3.0, original SIL OFL notices included. YourSet mark is an owner-provided brand asset for this product. The source retains `UNLICENSED`; public review grants no reuse rights. No wholesale production code is copied.
