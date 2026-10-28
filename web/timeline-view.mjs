import {
  METRICS,
  weeklyBuckets,
  metricTrack,
  dailyRecords,
  datedTargets,
  timelineAssessment,
} from "../src/timeline.mjs";
import { finite, formatUS, shift } from "../src/metrics.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (v) =>
  finite(v) ? Number(v.toFixed(1)).toLocaleString("en-US") : "—";
const short = (date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
export const weekLabel = (w) =>
  `${short(w.from)}–${short(w.to)}, ${w.to.slice(0, 4)}`;
export function timelineModel(data, a, state) {
  const weeks = weeklyBuckets(data, a);
  if (!weeks.some((w) => w.from === state.week))
    state.week = weeks.at(-1)?.from ?? null;
  const keys = [...new Set(weeks.flatMap((w) => Object.keys(w.lifts.anchors)))];
  if (!keys.includes(state.anchor)) state.anchor = keys[0] ?? null;
  return { weeks, keys, selected: weeks.find((w) => w.from === state.week) };
}
function plot(points, selected, label, unit, targets = []) {
  const values = [...points.map((p) => p.value), ...targets].filter(finite);
  let low = values.length ? Math.min(...values) : 0,
    high = values.length ? Math.max(...values) : 1;
  const pad = Math.max((high - low) * 0.2, Math.abs(high) * 0.015, 0.5);
  low -= pad;
  high += pad;
  const x = (i) => 55 + i * (700 / Math.max(1, points.length - 1)),
    y = (v) => 105 - ((v - low) / (high - low)) * 85;
  let path = "",
    open = false;
  points.forEach((p, i) => {
    if (!finite(p.value)) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${x(i)},${y(p.value)} `;
    open = true;
  });
  let targetPath = "",
    targetOpen = false;
  targets.forEach((v, i) => {
    if (!finite(v)) {
      targetOpen = false;
      return;
    }
    targetPath += `${targetOpen ? "L" : "M"}${x(i)},${y(v)} `;
    targetOpen = true;
  });
  const index = points.findIndex((p) => p.from === selected);
  const selectedValue = points[index]?.value;
  return `<div class="plot-wrap">${finite(selectedValue) ? `<span aria-hidden="true" class="selected-point" style="left:${x(index) / 8}%;top:calc(var(--plot-height) * ${y(selectedValue) / 120})"></span>` : ""}${values.length ? `<span class="plot-high">${number(high)}</span><span class="plot-low">${number(low)}</span>` : '<span class="plot-missing">No eligible observations. Missing values remain gaps.</span>'}<svg class="track-chart" viewBox="0 0 800 120" preserveAspectRatio="none" role="img" aria-label="${esc(label)} weekly values in ${esc(unit)}; selected week ${esc(selected)}. Gaps indicate missing evidence."><line class="chart-grid" x1="55" x2="755" y1="105" y2="105"/><line class="week-marker" x1="${x(index)}" x2="${x(index)}" y1="8" y2="110"/><path class="target-line" d="${targetPath}"/><path class="track-line" d="${path}"/>${points.map((p, i) => (finite(p.value) && p.from !== selected ? `<circle class="${p.from === selected ? "selected-dot" : "track-dot"}" cx="${x(i)}" cy="${y(p.value)}" r="${p.from === selected ? 6 : 3}"/>` : "")).join("")}</svg><div class="plot-dates"><span>${short(points[0].to)}</span><span>${short(points.at(-1).to)}</span></div></div>`;
}
const strengthColors = [
  "#db8e4a",
  "#5cb8e6",
  "#d4b4ef",
  "#9cd6b0",
  "#f0c868",
  "#ef9baf",
];
const strengthDash = ["", "7 3", "2 3"];
function strengthLegend(series, selected) {
  return `<ul class="strength-legend">${series.map((s, i) => `<li><span class="strength-swatch" style="--series-color:${strengthColors[i % 6]};border-top-style:${i % 3 === 0 ? "solid" : i % 3 === 1 ? "dashed" : "dotted"}"></span><span>${esc(s.key.split("|")[0])}<strong>${number(s.points.find((p) => p.from === selected)?.value)} lb × ${esc(s.key.split("|")[3])}</strong></span></li>`).join("")}</ul>`;
}
function strengthOverlay(series, selected) {
  const points = series[0].points,
    values = series.flatMap((s) => s.points.map((p) => p.value)).filter(finite);
  const lo = Math.min(...values),
    hi = Math.max(...values),
    pad = Math.max((hi - lo) * 0.12, 1),
    low = lo - pad,
    high = hi + pad;
  const x = (i) => 55 + (i * 700) / Math.max(1, points.length - 1),
    y = (v) => 105 - ((v - low) / (high - low)) * 85;
  const index = points.findIndex((p) => p.from === selected);
  return `<div class="plot-wrap strength-overlay"><span class="plot-high">${number(high)}</span><span class="plot-low">${number(low)}</span><svg class="track-chart" viewBox="0 0 800 120" preserveAspectRatio="none" role="img" aria-label="Matched strength loads in pounds: ${esc(series.map((s) => s.key.split("|")[0]).join(", "))}. Each line is a separate matched group; gaps stay missing."><line class="chart-grid" x1="55" x2="755" y1="105" y2="105"/><line class="week-marker" x1="${x(index)}" x2="${x(index)}" y1="8" y2="110"/>${series
    .map((s, i) => {
      let path = "",
        open = false;
      s.points.forEach((p, j) => {
        if (!finite(p.value)) {
          open = false;
          return;
        }
        path += `${open ? "L" : "M"}${x(j)},${y(p.value)} `;
        open = true;
      });
      return `<path data-overlay-series="${esc(s.key)}" fill="none" stroke="${strengthColors[i % 6]}" stroke-width="2" stroke-dasharray="${strengthDash[i % 3]}" d="${path}"/>`;
    })
    .join("")}</svg>${series
    .map((s, i) => {
      const v = s.points[index]?.value;
      return finite(v)
        ? `<span aria-hidden="true" class="selected-point" style="background:${strengthColors[i % 6]};left:${x(index) / 8}%;top:calc(var(--plot-height) * ${y(v) / 120})"></span>`
        : "";
    })
    .join(
      "",
    )}<div class="plot-dates"><span>${short(points[0].to)}</span><span>${short(points.at(-1).to)}</span></div></div>`;
}
function strengthTrack(data, a, state, weeks, keys, onlyStrength) {
  const metric = METRICS.find((m) => m.id === "strength");
  const series = keys.map((key) => ({
    key,
    ...metricTrack(data, weeks, metric, key),
  }));
  const assessment = timelineAssessment(data, a);
  const split = onlyStrength && state.strengthMode === "split";
  const details = `<details class="track-details strength-details"><summary>Details · lifts & assessment</summary><h4>How the three-week assessment works</h4><p>${assessment ? `${esc(assessment.detail)} Headline groups: ${esc(assessment.keys.map((k) => k.split("|")[0]).join(", "))}.` : "The selected window does not satisfy the three-week headline conditions. The observations below remain available."}</p><p>For each identical exercise, equipment, load convention, rep count and source, take the maximum recorded load in each completed Monday–Sunday bucket. The latest three buckets must all contain that group and have equal maxima (apart from floating-point precision). No lift is carried forward. The full headline also requires an earlier bucket with lower loads for those groups and falling first-to-last weekly mean weight, with at least four weight observations per bucket. Stable is not declining.</p><p>Compare each line with its own history. Heavier loads on a different exercise are not a combined strength score. Different equipment, reps or sources stay separate groups.</p><div class="table-wrap"><table><caption>Weekly matched maxima · lb · final three completed buckets marked *</caption><thead><tr><th>Group / week</th>${weeks.map((w, i) => `<th>${weekLabel(w)}${i >= weeks.length - 3 ? " *" : ""}</th>`).join("")}</tr></thead><tbody>${series.map((s) => `<tr><th>${esc(s.key.split("|").join(" · ").replaceAll("kg", "load"))}</th>${s.points.map((p) => `<td>${number(p.value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><label>Lift for daily records<select id="timeline-anchor">${keys.map((k) => `<option value="${esc(k)}" ${k === state.anchor ? "selected" : ""}>${esc(k.split("|").join(" · ").replaceAll("kg", "load"))}</option>`).join("")}</select></label><button class="text-button" data-record-metric="strength">View daily records →</button>${!onlyStrength ? '<button class="text-button" data-page="Strength">Open Strength tab →</button>' : ""}</details>`;
  return `<article class="metric-track strength-track ${split ? "strength-split" : ""}" data-track="strength"><div class="track-heading"><h3>Strength</h3><span class="track-unit">${keys.length} matched groups · weekly maximum · lb</span>${strengthLegend(series, state.week)}</div>${split ? `<div class="split-lifts"><p class="micro">Separate labeled scales; compare each lift with its own history.</p>${series.map((s, i) => `<section style="--lift-color:${strengthColors[i % 6]}" data-split-lift="${esc(s.key)}"><h4>${esc(s.key.split("|").join(" · ").replaceAll("kg", "load"))}</h4>${plot(s.points, state.week, s.key.split("|")[0], "lb")}</section>`).join("")}</div>` : strengthOverlay(series, state.week)}${details}</article>`;
}
export function timelineView(data, a, state, onlyStrength = false) {
  const { weeks, keys, selected } = timelineModel(data, a, state);
  if (!selected) return "<p>No completed weekly buckets in this window.</p>";
  const selectedMetrics = onlyStrength ? ["strength"] : state.metrics;
  const label =
    state.week === weeks.at(-1).from ? "Latest complete week" : "Selected week";
  return `<section class="timeline" aria-label="Shared weekly metric timeline">
 
 <div class="metric-pills" ${onlyStrength ? "hidden" : ""} aria-label="Selected metrics">${state.metrics.map((id) => `<button data-remove-metric="${id}" aria-label="Remove ${METRICS.find((m) => m.id === id).label}">${METRICS.find((m) => m.id === id).label} <span aria-hidden="true">×</span></button>`).join("") || "<span>No metrics selected. Add a metric to begin.</span>"}<button id="add-metric">＋ Add metric</button></div>
 <div class="week-control"><label for="inspect-week">${label}:</label><div><select id="inspect-week" aria-label="Inspect week">${weeks.map((w) => `<option value="${w.from}" ${w.from === state.week ? "selected" : ""}>${weekLabel(w)}</option>`).join("")}</select><button id="daily-records" data-default-metric="${onlyStrength ? "strength" : state.recordMetric}">Daily records →</button></div></div>
 
 <div class="strength-view-controls" ${onlyStrength ? "" : "hidden"} aria-label="Strength chart layout"><button data-strength-mode="overlay" aria-pressed="${state.strengthMode !== "split"}">Overlay lifts</button><button data-strength-mode="split" aria-pressed="${state.strengthMode === "split"}">Split by lift</button></div><div class="metric-tracks">${selectedMetrics
   .map((id) => {
     const m = METRICS.find((m) => m.id === id),
       track = metricTrack(data, weeks, m, state.anchor),
       point = track.points.find((p) => p.from === state.week);
     if (id === "strength" && keys.length)
       return strengthTrack(data, a, state, weeks, keys, onlyStrength);
     if (!track.points.some((p) => finite(p.value)))
       return `<article class="metric-track empty-track" data-track="${id}"><h3>${m.label} <span>· ${track.state === "not connected" ? "Not connected" : "No eligible observations"}</span></h3><details class="track-details"><summary>Details</summary><p>${m.label} remains selected. Status: ${track.state}. No eligible observations in ${weekLabel({ from: weeks[0].from, to: weeks.at(-1).to })}; missing values are not zero.</p><button class="text-button" data-record-metric="${id}">View daily records →</button></details></article>`;
     const method =
       m.id === "strength"
         ? "Maximum recorded load in the exact matched group"
         : m.mode
           ? "Weekly recorded total; requires full source coverage"
           : m.id === "distance"
             ? "Sum of recorded distances; coverage may be partial"
             : ["calories", "protein"].includes(id)
               ? "Mean of explicitly complete logging days"
               : "Mean of observed days";
     const target = m.id === "calories" ? datedTargets(data, selected) : null;
     const coverage = finite(point.value)
       ? `${point.count}${m.kind === "lift" ? " set records" : m.mode || m.id === "distance" ? " records" : ["calories", "protein"].includes(m.id) ? "/7 complete days" : m.id === "sleep" ? "/7 nights" : "/7 days"}`
       : track.state === "available"
         ? "No observations"
         : track.state;
     return `<article class="metric-track" data-track="${id}"><div class="track-heading"><h3>${m.id === "strength" ? `Strength · ${esc(state.anchor?.split("|")[0] ?? "no matched lift")}` : m.label}</h3><div class="track-reading"><strong>${number(point.value)}</strong><span>${m.unit}${m.id === "strength" && state.anchor ? ` × ${state.anchor.split("|")[3]}` : ""}</span></div><span class="track-unit">${coverage} · ${m.id === "strength" ? "matched max" : m.mode ? "total" : "mean"}</span></div>
 ${plot(track.points, state.week, m.label, m.unit, target ? weeks.map((w) => datedTargets(data, w).mean) : [])}

 ${target ? `<p class="target-note">Dashed · chosen target: ${target.changed ? "changes within this week — see dated daily targets" : finite(target.mean) ? `${number(target.mean)} kcal/day` : "unavailable"} · not a prescription.</p>` : ""}
 <details class="track-details"><summary>Details</summary><button class="text-button" data-record-metric="${id}">View daily records →</button> ${m.id === "strength" ? `<label class="anchor-label">Matched lift <select id="timeline-anchor" aria-label="Matched lift">${keys.map((k) => `<option value="${esc(k)}" ${k === state.anchor ? "selected" : ""}>${esc(k.split("|").slice(0, 2).join(" · ") + " · " + k.split("|")[3] + " reps · " + k.split("|")[2].replace("kg", "load"))}</option>`).join("")}</select></label><p class="micro anchor-scope">${esc(state.anchor?.split("|")[4] ?? "No matching source")} · one matched lift, no combined score.</p>` : ""}<p>${method}. Missing observations are never filled. ${m.id === "composition" ? "Unvalidated provider estimate; not measured tissue change." : ""}</p><div class="table-wrap"><table><thead><tr><th>Week</th><th>${m.unit}</th><th>Coverage</th></tr></thead><tbody>${track.points.map((p) => `<tr><td><button data-week="${p.from}" aria-label="Inspect ${weekLabel(p)}">${weekLabel(p)}</button></td><td>${number(p.value)}</td><td>${p.count} ${m.kind === "lift" ? "sets" : "records"}</td></tr>`).join("")}</tbody></table></div></details></article>`;
   })
   .join(
     "",
   )}</div><p class="timeline-note">Weeks ending · independent scales · complete Monday–Sunday buckets</p></section>
 <dialog id="metric-picker" aria-labelledby="picker-title"><div class="dialog-heading"><div><h2 id="picker-title">Add a metric</h2></div><button data-close-dialog aria-label="Close metric picker">×</button></div><label>Search metrics<input id="metric-search" type="search" placeholder="Try sleep, protein or activity…"></label><p class="micro">Select as many as you need. Unavailable metrics stay discoverable.</p><div class="catalogue">${[
   ...new Set(METRICS.map((m) => m.group)),
 ]
   .map(
     (group) =>
       `<section data-metric-group><h3>${group}</h3>${METRICS.filter(
         (m) => m.group === group,
       )
         .map((m) => {
           const t = metricTrack(data, weeks, m, state.anchor);
           return `<button class="catalogue-item" data-add-metric="${m.id}" data-search="${(m.label + " " + group).toLowerCase()}" aria-pressed="${state.metrics.includes(m.id)}"><span><strong>${m.label}</strong><small>${m.unit} · ${t.state}${!m.mode && m.kind !== "lift" && m.id !== "distance" ? ` · ${t.points.reduce((n, p) => n + p.count, 0)}/${weeks.length * 7} days` : ""}</small></span><span>${state.metrics.includes(m.id) ? "Selected ✓" : "Add ＋"}</span></button>`;
         })
         .join("")}</section>`,
   )
   .join(
     "",
   )}</div><p id="no-metrics" hidden>No matching metrics.</p><button class="primary" data-close-dialog>Done</button></dialog>
 <dialog id="records-dialog" aria-labelledby="records-title"><div class="dialog-heading"><div><span class="eyebrow">Synthetic observations · ${weekLabel(selected)}</span><h2 id="records-title">Daily records</h2></div><button data-close-dialog aria-label="Return to timeline">×</button></div><label>Metric<select id="records-metric">${METRICS.map((m) => `<option value="${m.id}" ${m.id === state.recordMetric ? "selected" : ""}>${m.label}</option>`).join("")}</select></label>${recordsView(
   data,
   selected,
   METRICS.find((m) => m.id === state.recordMetric),
   state.anchor,
 )}<button class="primary" data-close-dialog>Return to timeline</button></dialog>`;
}
function recordsView(data, week, m, anchor) {
  const rows = dailyRecords(data, week, m, anchor);
  const initialDate = rows[0]?.date ?? week.from;
  const tableMetrics = METRICS.filter((m) =>
    ["weight", "calories", "protein", "sleep"].includes(m.id),
  );
  const dayTable = `<div class="table-wrap records-week-table"><table><caption>Daily observations · ${weekLabel(week)} · select a date for record details</caption><thead><tr><th>Date</th>${tableMetrics.map((m) => `<th>${m.label} · ${m.unit}</th>`).join("")}</tr></thead><tbody>${Array.from(
    { length: 7 },
    (_, i) => shift(week.from, i),
  )
    .map(
      (date) =>
        `<tr data-record-row="${date}" class="${date === initialDate ? "inspected-day" : ""}"><td><button data-record-day="${date}" aria-pressed="${date === initialDate}">${short(date)}</button></td>${tableMetrics
          .map((metric) => {
            const record = dailyRecords(data, week, metric, anchor).find(
              (r) => r.date === date,
            );
            return `<td>${record ? (metric.id === "weight" ? formatUS("weight", record.value, { unit: false }) : number(record.value)) : "—"}${record && ["calories", "protein"].includes(metric.id) && !record.complete ? " (incomplete)" : ""}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
  const targets = m.id === "calories" ? datedTargets(data, week).days : [];
  const targetDetails = targets.length
    ? `<details class="daily-targets"><summary>Dated chosen targets · separate from observations</summary><p>Targets are plan choices, including dates without food observations.</p><table><thead><tr><th>Date</th><th>Chosen kcal/day</th><th>Plan</th></tr></thead><tbody>${targets.map((t) => `<tr><td>${t.date}</td><td>${number(t.value)}</td><td>${esc(t.id ?? "unavailable")}</td></tr>`).join("")}</tbody></table></details>`
    : "";
  return `<label class="record-day-select">Day<select id="record-day">${Array.from(
    { length: 7 },
    (_, i) => shift(week.from, i),
  )
    .map(
      (date) =>
        `<option value="${date}" ${date === initialDate ? "selected" : ""}>${short(date)}</option>`,
    )
    .join(
      "",
    )}</select></label>${dayTable}${targetDetails}<p id="day-empty" hidden>No observations for this metric on the selected date.</p><p>Actual generated observations, not weekly averages. Source identifiers below belong only to this fictional fixture.</p>${!rows.length ? '<p class="empty-records">No daily observations for this metric in the selected week.</p>' : rows.map((r) => `<article class="daily-observation" data-record-date="${r.date}" ${r.date === initialDate ? "" : "hidden"}><div><strong>${r.date}</strong><strong>${m.id === "liftMinutes" ? `${number(r.workoutElapsedMinutes)} minutes per session` : m.id === "distance" ? formatUS("distance", r.distanceMeters) : r.kind === "lift" ? formatUS("load", r.load) : ["weight", "waist"].includes(r.kind) ? formatUS(r.kind, r.value) : `${number(r.value)} ${esc(r.unit)}`}</strong></div>${r.kind === "lift" ? `<p>${esc(r.exercise)} · ${esc(r.equipment)} · ${r.reps} reps · ${esc(r.loadConvention)}</p>` : ""}<p>${["calories", "protein"].includes(r.kind) ? `Food log: ${r.complete === true ? "complete" : "incomplete; excluded from complete-day means"}. ` : ""}Chosen energy target on this date: ${finite(r.plan?.calories) ? `${number(r.plan.calories)} kcal/day` : "unavailable"}.</p><details><summary>Source, revision & dated plan</summary><dl><dt>Source</dt><dd>${esc(r.writer)} · ${esc(r.device ?? "Device unavailable")}</dd>${r.sessionId ? `<dt>Session</dt><dd>${esc(r.sessionId)} · records in the same session are counted once for attendance/duration</dd>` : ""}<dt>Record / revision</dt><dd>${esc(r.id)} / ${r.revision}</dd><dt>Observation date</dt><dd>${r.date}</dd><dt>Adapter / import</dt><dd>${esc(r.adapter ?? "unavailable")} / ${esc(r.fetchedAt ?? "unavailable")}</dd><dt>Plan</dt><dd>${esc(r.plan?.id ?? "unavailable")} · effective ${esc(r.plan?.effective ?? "unknown")}</dd></dl></details></article>`).join("")}`;
}
export function bindTimeline(state, render) {
  const $ = (s) => document.querySelector(s);
  if (!$("#add-metric")) return;
  const rerender = (focus) => {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    $(focus)?.focus({ preventScroll: true });
  };
  const open = (id) => $(id).showModal();
  document.querySelectorAll("[data-strength-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        state.strengthMode = b.dataset.strengthMode;
        rerender(`[data-strength-mode="${state.strengthMode}"]`);
      }),
  );
  $("#add-metric").onclick = () => open("#metric-picker");
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  $("#metric-search").oninput = (e) => {
    let count = 0;
    document.querySelectorAll("[data-add-metric]").forEach((b) => {
      b.hidden = !b.dataset.search.includes(e.target.value.toLowerCase());
      if (!b.hidden) count++;
    });
    document
      .querySelectorAll("[data-metric-group]")
      .forEach(
        (g) =>
          (g.hidden = ![...g.querySelectorAll("[data-add-metric]")].some(
            (b) => !b.hidden,
          )),
      );
    $("#no-metrics").hidden = count > 0;
  };
  document.querySelectorAll("[data-add-metric]").forEach(
    (b) =>
      (b.onclick = () => {
        const query = $("#metric-search").value,
          scroll = $("#metric-picker").scrollTop;
        state.metrics = state.metrics.includes(b.dataset.addMetric)
          ? state.metrics.filter((id) => id !== b.dataset.addMetric)
          : [...state.metrics, b.dataset.addMetric];
        rerender("#add-metric");
        open("#metric-picker");
        $("#metric-search").value = query;
        $("#metric-search").dispatchEvent(new Event("input"));
        $(`[data-add-metric="${b.dataset.addMetric}"]`).focus();
        $("#metric-picker").scrollTop = scroll;
      }),
  );
  document.querySelectorAll("[data-remove-metric]").forEach(
    (b) =>
      (b.onclick = () => {
        state.metrics = state.metrics.filter(
          (id) => id !== b.dataset.removeMetric,
        );
        rerender("#add-metric");
      }),
  );
  $("#inspect-week").onchange = (e) => {
    state.week = e.target.value;
    rerender("#inspect-week");
  };
  document.querySelectorAll("[data-week]").forEach(
    (b) =>
      (b.onclick = () => {
        state.week = b.dataset.week;
        rerender("#inspect-week");
      }),
  );
  if ($("#timeline-anchor"))
    $("#timeline-anchor").onchange = (e) => {
      state.anchor = e.target.value;
      rerender("#timeline-anchor");
      $(".strength-details").open = true;
      $("#timeline-anchor").focus({ preventScroll: true });
    };
  const records = (id) => {
    state.recordMetric = id;
    rerender("#daily-records");
    open("#records-dialog");
  };
  $("#daily-records").onclick = () =>
    records($("#daily-records").dataset.defaultMetric);
  document
    .querySelectorAll("[data-record-metric]")
    .forEach((b) => (b.onclick = () => records(b.dataset.recordMetric)));
  document.querySelectorAll("[data-record-day]").forEach(
    (button) =>
      (button.onclick = () => {
        const date = button.dataset.recordDay;
        document
          .querySelectorAll("[data-record-date]")
          .forEach(
            (article) => (article.hidden = article.dataset.recordDate !== date),
          );
        document
          .querySelectorAll("[data-record-row]")
          .forEach((row) =>
            row.classList.toggle(
              "inspected-day",
              row.dataset.recordRow === date,
            ),
          );
        document
          .querySelectorAll("[data-record-day]")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              String(b.dataset.recordDay === date),
            ),
          );
        $("#day-empty").hidden = !!document.querySelector(
          `[data-record-date="${date}"]`,
        );
      }),
  );
  if ($("#record-day"))
    $("#record-day").onchange = (event) =>
      document
        .querySelector(`[data-record-day="${event.target.value}"]`)
        .click();
  $("#records-metric").onchange = (e) => {
    records(e.target.value);
    $("#records-metric").focus();
  };
}
