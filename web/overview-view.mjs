import { dashboard, formatUS, planAt, usMeasure } from "../src/metrics.mjs";
import {
  recordedNutrition,
  strengthSeries,
  activitySeries,
} from "../src/overview.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n, d = 0) =>
  Number.isFinite(n)
    ? (Number(n.toFixed(d)) || 0).toLocaleString("en-US", {
        maximumFractionDigits: d,
      })
    : "—";
export function spark(
  rows,
  from,
  to,
  unit,
  color = "var(--accent)",
  connectDays = 2,
  zero = false,
) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const valid = sorted.filter((r) => Number.isFinite(r.value));
  if (!valid.length)
    return '<div class="trend-empty">No comparable observations<span>Missing data stays unknown.</span></div>';
  const lo = zero
    ? 0
    : Math.floor(Math.min(...valid.map((r) => r.value)) * 10) / 10;
  const hi = Math.max(
    lo + 1,
    Math.ceil(Math.max(...valid.map((r) => r.value)) * 10) / 10,
  );
  const span = Math.max(1, Date.parse(to) - Date.parse(from));
  const pts = sorted.map((r) => ({
    ...r,
    x: 40 + ((Date.parse(r.date) - Date.parse(from)) / span) * 278,
    y: Number.isFinite(r.value) ? 94 - ((r.value - lo) / (hi - lo)) * 67 : null,
  }));
  return `<svg class="trend-chart" viewBox="0 0 334 125" role="img" aria-label="${esc(unit)} trend from ${from} to ${to}. ${valid.length} observations."><line x1="40" x2="318" y1="27" y2="27"/><line x1="40" x2="318" y1="94" y2="94"/><text x="0" y="31">${fmt(hi, 1)}</text><text x="0" y="98">${fmt(lo, 1)}</text>${pts.map((p, i) => (p.y === null ? "" : `${i && pts[i - 1].y !== null && Date.parse(p.date) - Date.parse(pts[i - 1].date) <= connectDays * 86400000 ? `<line class="trend-stroke" style="stroke:${color}" x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${p.x}" y2="${p.y}"/>` : ""}<circle cx="${p.x}" cy="${p.y}" r="2.5" style="fill:${color}"><title>${p.date}: ${fmt(p.value, 1)} ${esc(unit)}</title></circle>`)).join("")}<text x="40" y="121">${from.slice(5)}</text><text x="283" y="121">${to.slice(5)}</text></svg>`;
}
const control = (kind, options, selected) =>
  `<div class="trend-switch" role="group" aria-label="${kind} chart metric">${options.map(([key, label]) => `<button type="button" data-chart="${kind}" data-metric="${key}" aria-pressed="${key === selected}">${label}</button>`).join("")}</div>`;
const link = (page, label) =>
  `<button class="text-button" data-page="${page}">${label} →</button>`;
function activityCard(data, a, kind, mode) {
  const lifting = kind === "lift",
    name = lifting ? "Lifting" : "Cardio";
  const m = activitySeries(data, a, kind, mode),
    c = a.current;
  return `<section class="card trend-card" data-card="${kind}"><span class="eyebrow">${name} activity</span><h2>${lifting ? "Training consistency" : "Time spent on cardio"}</h2><div class="trend-value">${fmt(m.total)}<span>${mode} · this period</span></div>${spark(m.points, c.from, c.to, mode, lifting ? "var(--accent)" : "var(--blue)", 2, true)}${control(
    kind,
    lifting
      ? [
          ["sessions", "Sessions"],
          ["sets", "Sets"],
          ["minutes", "Minutes"],
        ]
      : [
          ["minutes", "Minutes"],
          ["sessions", "Sessions"],
        ],
    mode,
  )}<p class="trend-summary">${m.observations ? "Rolling 7-day recorded totals" : "No activity records in this period"}</p><p class="micro">${lifting ? (mode === "minutes" ? "Elapsed workout time includes rests." : mode === "sets" ? "Recorded working sets; excludes warm-ups." : "Unique recorded strength sessions.") : "Attendance and duration do not establish endurance."} ${m.observations ? "Gaps mean unknown coverage; zero means no records in a covered span." : "Unlogged activity is unknown."}</p>${link("Training", name + " details")}</section>`;
}
export function overviewCards(data, a, state) {
  const c = a.current,
    d = dashboard(data, a),
    w = d.weight,
    n = recordedNutrition(a),
    strength = strengthSeries(a, state.anchor);
  const recovery =
    d.recovery.find((r) => r.kind === state.recovery) ?? d.recovery[0];
  const unit = { sleep: "h/night", rhr: "bpm", hrv: "ms" }[recovery.kind];
  const p = planAt(data.plans, data.clock);
  return `<div class="overview-trends">
 <section class="card trend-card" data-card="weight"><span class="eyebrow">Weight</span><h2>${!a.weightKnown ? "A clearer trend needs recent data" : a.slowdown ? "Weight loss has slowed" : "Follow the weight trend"}</h2><div class="trend-value" data-metric="weight.latest">${formatUS("weight", w.latest, { unit: false })}<span>lb · latest</span></div>${spark(
   c.weight.rows.map((r) => ({
     ...r,
     value: usMeasure("weight", r.value).value,
   })),
   c.from,
   c.to,
   "lb",
 )}<p class="trend-summary">${formatUS("weightRate", w.slope, { signed: true })} fitted rate</p><p class="micro">${w.count}/${c.days} days · latest ${w.latestDate ?? "unavailable"}${w.stale ? " · stale" : ""}. Scale weight does not identify fat or lean tissue change.</p>${link("Nutrition / Weight", "Weight & composition")}</section>
 <section class="card trend-card" data-card="nutrition"><span class="eyebrow">Nutrition</span><h2>Intake alongside outcomes</h2><div class="trend-value">${fmt(n.energyMean)}<span>kcal / recorded day</span></div>${spark(n.calories, c.from, c.to, "kcal", "var(--blue)")}<p class="trend-summary">${fmt(n.proteinMean)} g protein / recorded day</p><p class="micro">Energy ${n.calories.length}/${c.days} days · ${c.calories.count} explicitly complete. ${p ? `Current target ${fmt(p.calories)} kcal · ${fmt(p.protein)} g protein.` : "No dated target configured."}</p>${link("Nutrition / Weight", "Intake & records")}</section>
 <section class="card trend-card" data-card="strength"><span class="eyebrow">Comparable strength</span><h2>${a.strengthKeys.length ? `${a.strengthCounts.stable + a.strengthCounts.improving} of ${a.strengthKeys.length} lifts holding or improving` : "Comparison not established"}</h2><div class="trend-value">${fmt(strength.points.at(-1)?.value, 1)}<span>lb · selected lift</span></div>${spark(strength.points, c.from, c.to, "lb", "#c2a6f0", Infinity)}<label class="trend-picker">Compare a lift<select data-anchor ${strength.options.length ? "" : "disabled"}>${strength.options.map((o) => `<option value="${esc(o.key)}" ${o.key === strength.key ? "selected" : ""}>${esc(o.label)}</option>`).join("") || "<option>No matched groups</option>"}</select></label><p class="micro">Peak recorded load at matched reps, equipment and source. ${a.excludedAnchors} groups excluded; lines join observations.</p>${link("Training", "Strength details")}</section>
 ${activityCard(data, a, "lift", state.lift)}${activityCard(data, a, "aerobic", state.aerobic)}
 <section class="card trend-card" data-card="recovery"><span class="eyebrow">Recovery</span><h2>${!a.recoveryKnown ? "Recent recovery data is incomplete" : a.recoveryConcern ? "Recovery changes need attention" : "Sleep and resting HR are steady"}</h2><div class="trend-value">${fmt(recovery.current, 1)}<span>${unit} · period average</span></div>${spark(c[recovery.kind].rows, c.from, c.to, unit, "#c2a6f0")}${control(
   "recovery",
   [
     ["sleep", "Sleep"],
     ["rhr", "Resting HR"],
     ["hrv", "HRV"],
   ],
   recovery.kind,
 )}<p class="trend-summary">${recovery.count}/${c.days} days · ${Number.isFinite(recovery.delta) ? `${Number(recovery.delta.toFixed(1)) > 0 ? "+" : ""}${fmt(recovery.delta, 1)} ${unit} vs prior` : "comparison unavailable"}</p><p class="micro">Latest ${recovery.latest ?? "unavailable"}${recovery.stale ? " · stale" : ""}. Sleep and resting HR inform the review; HRV adds context. No readiness score.</p><details class="trend-records"><summary>Recovery records</summary><table><thead><tr><th>Date</th><th>${unit}</th></tr></thead><tbody>${c[recovery.kind].rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${fmt(r.value, 1)}</td></tr>`).join("") || '<tr><td colspan="2">No records</td></tr>'}</tbody></table></details></section></div>`;
}
