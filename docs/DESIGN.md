# YourSet Classic Dark

The analytics UI follows the YourSet Classic Dark visual identity: its Y/S dumbbell mark (white Y and plates; apricot S), DM Sans for interface text, JetBrains Mono for primary numeric measures, neutral dark surfaces, 12px cards, and restrained apricot actions. Fonts are self-hosted; their original SIL Open Font License notices are included with the assets. This is not a selection of a license for this project's source.

Source code from the existing production application is not reused. The approved logo asset is the narrow intentional brand-asset reuse; its path geometry is unchanged. No existing production files or services are modified. Other production themes do not expand the v1.2 scope: this release implements Classic Dark only.

The analytics brief's accessibility correction takes precedence over the earlier theme document: solid apricot controls use dark text. Meaningful metadata uses the higher-contrast secondary color rather than decorative tertiary grey. Temporal window badges use cyan; no color or percentage is used to imply calibrated confidence. Status always has a text label. Charts have text summaries and underlying values.

The visual reference does not supply any personal fixture values. All records, dates and target examples are independently synthetic.


## Approved overview baseline — September 21, 2026

Status: approved design for the next implementation. The six-card local preview is the layout reference. This section supersedes the earlier four-outcome-card layout and the requirement to show the full execution table and findings before expansion. Approval fixes the information hierarchy for now; it does not certify implementation, data completeness, source delivery or publication readiness.

### Page hierarchy

1. Compact header with reporting window, exact current/prior dates and an unobtrusive source-status disclosure.
2. Short bottom-line assessment and one bounded next step, readable as a morning glance or post-training debrief.
3. Six trend cards, ordered as below. Desktop uses two rows of three; narrow screens stack cards in the same reading order. Do not place all six in one row. The first card row begins within the initial viewport at the supported desktop size.
4. Concise review notes for material findings or data gaps, and active adjustments with their review state.
5. A collapsed full debrief containing execution versus plan, detailed comparisons, evidence and provenance. Card links open the relevant detailed views.

Do not restore the dense overview merely to keep every detail above the fold. Keep the primary assessment, charts and material limitations visible; use progressive disclosure for supporting material.

### Six-card contract

| Position | Card | Primary view | Controls and interpretation |
| --- | --- | --- | --- |
| Top left | Weight | Daily scale-weight line, latest value and fitted trend when supported | Show coverage and freshness. Weight is total body mass, not a measurement of fat or lean tissue change. |
| Top center | Nutrition | Recorded daily energy line and average per recorded day | Include protein summary and coverage. Unknown food-log completeness stays explicit; missing days are not zero-intake days. |
| Top right | Comparable strength | Load line for a selected comparable exercise group | Exercise selector; compare matched exercise, equipment, repetitions, load convention and source. Show stable/improving summary without inventing a combined strength score. |
| Bottom left | Lifting activity | Rolling seven-day recorded activity line | Sessions / Sets / Minutes switches. Headline reports the selected metric's total for the reporting period; line reports rolling seven-day totals. Sets describe recorded set volume, not an aggregate strength measure. Minutes are elapsed workout time, including rests. |
| Bottom center | Cardio activity | Rolling seven-day recorded activity line | Minutes / Sessions switches, with the same period-total versus rolling-line distinction. Do not label duration as Zone 2 unless supported by source data. |
| Bottom right | Recovery | Daily sleep line with period summary | Sleep / Resting HR / HRV switches. Sleep and resting HR provide recovery context alongside workload and weight; HRV is supporting context. No global readiness score or training clearance. |

Use the same reporting dates across all six cards. Rolling seven-day series may read the six days preceding the displayed start date; disclose insufficient source history instead of silently padding it. Preserve missing values and comparability boundaries. Every chart needs a readable text summary, units, date labels, keyboard-accessible controls and access to underlying records. Switching a metric must update the value, unit, line and explanation together.

### Weight and body composition

The overview card is named **Weight**, not **Body composition**. Body composition refers to fat and lean tissue; scale weight alone does not establish either. Waist measurements and clearly labeled scale estimates belong in the weight/composition detail view when available. Do not introduce a second overview card that repeats weight under a different name. Photo body-fat estimation remains out of scope.

### Recovery and incomplete data

Recovery answers whether sleep and resting-heart-rate trends are changing alongside training workload and weight. It provides context for reviewing a plan; it does not establish causation or prescribe a response.

Keep all six card positions present when data is missing. Use an explicit unavailable state rather than a fabricated line, reassuring status or physiological zero. Distinguish absent observations, stale observations, insufficient comparisons and an actual concerning trend. Complete coverage does not automatically mean favorable recovery. A zero recorded-activity total means no activity records in that interval, not proof of no activity.

Data-gap notices must identify what is missing and how it limits interpretation. Do not put missing weight or recovery under an undifferentiated alarm heading. Fresh, sufficient observations remove the corresponding gap notice; real adverse findings remain eligible for attention.

### Illustrative and private data

The approved preview used illustrative complete weight and recovery series to evaluate their placement beside the other four cards. Those invented values are not approved fixtures for private analysis or substitutes for missing personal observations. Any illustrative mode must remain conspicuously labeled, reversible and isolated from real analyses, decisions and saved history. Public/demo builds remain entirely synthetic. Do not copy personal snapshots or screenshots into the source tree.

### Acceptance criteria

- All six cards appear together in the approved order, with responsive stacking and no horizontal page overflow.
- The assessment and next step remain concise; full execution tables and detailed findings are available through the debrief or drill-downs.
- Weight, nutrition and comparable strength use lines; lifting and cardio use rolling seven-day lines when observations support them.
- Metric selectors work by keyboard and keep values, units, labels and charts consistent.
- Recovery occupies the sixth card even when unavailable; its switches do not imply a composite readiness score.
- Complete-data, partial-data, stale-data and absent-data cases have distinct, truthful presentation. Missing data never becomes a fabricated zero.
- The public demo contains only synthetic records; private data never enters source control.
- Verify the implemented layout in the browser using synthetic complete and incomplete fixtures. Record remaining source or calculation limitations separately from visual approval.

## Decisions and display contracts retained

A suggested next step is not an active adjustment. Date fields do not silently commit the user to a review interval. Accepted, deferred, rejected, edited and continue-unchanged choices preserve their original snapshots. Multiple active decisions remain visible. Review due and sufficient follow-up evidence are distinct states. Close-out is keyboard accessible, preserves the evidence and review note, and removes completed actions from the active list. Duplicate active actions are blocked. Form validation does not partially apply a new plan.

All rendered measurements use the US presentation contract, including charts, strength-history tables, investigative prose and reassessment. Source status is not repeated as a wall of green badges; dated coverage sits beside the affected answer. No pictured owner identity, target or connection timestamp is used as a fixture.

Durable private history, live onboarding and source delivery, complete plan configuration and real-use verification remain separate implementation requirements.
