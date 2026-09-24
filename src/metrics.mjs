export const VERSION = "1.3.0";
const DAY = 86400000;
export const mean = (a) =>
  a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export function latestRevisions(records) {
  const map = new Map();
  for (const r of records) {
    const k = `${r.writer}:${r.id}`;
    if (!map.has(k) || map.get(k).revision < r.revision) map.set(k, r);
  }
  return [...map.values()].filter((r) => !r.removed);
}
export function localDate(instant, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
export function shift(date, n) {
  return new Date(Date.parse(date + "T12:00:00Z") + n * DAY)
    .toISOString()
    .slice(0, 10);
}
export function planAt(plans, date) {
  return (
    [...plans]
      .filter((p) => p.effective && p.effective <= date)
      .sort((a, b) => b.effective.localeCompare(a.effective))[0] ?? null
  );
}
export function slope(rows) {
  if (rows.length < 4) return null;
  const base = Date.parse(rows[0].date),
    p = rows.map((r) => [(Date.parse(r.date) - base) / DAY, r.value]);
  if (Math.max(...p.map((r) => r[0])) - Math.min(...p.map((r) => r[0])) < 7)
    return null;
  const mx = mean(p.map((r) => r[0])),
    my = mean(p.map((r) => r[1]));
  return (
    (7 * p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0)) /
    p.reduce((s, [x]) => s + (x - mx) ** 2, 0)
  );
}
export function windowMetrics(data, from, to) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const rows = latestRevisions(data.records)
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const series = (kind) =>
    rows.filter(
      (r) =>
        r.kind === kind &&
        finite(r.value) &&
        (kind !== "steps" || r.writer === data.stepWriter),
    );
  const aggregate = (kind, complete = false) => {
    const selected = series(kind).filter(
      (r) => !complete || r.complete === true,
    );
    return {
      mean: mean(selected.map((r) => r.value)),
      count: new Set(selected.map((r) => r.date)).size,
      days,
      rows: selected,
    };
  };
  const calories = aggregate("calories", true),
    protein = aggregate("protein", true),
    weight = aggregate("weight");
  const variance = calories.rows
    .map((r) => {
      const p = planAt(data.plans, r.date);
      return p ? r.value - p.calories : null;
    })
    .filter(finite);
  const proteinFloor = protein.rows.filter((r) => {
    const p = planAt(data.plans, r.date);
    return p && r.value >= p.proteinFloor;
  }).length;
  const lifts = series("lift"),
    aerobic = series("aerobic");
  const anchors = {};
  for (const r of lifts) {
    const key = [
      r.exercise,
      r.equipment,
      r.loadConvention,
      r.reps,
      r.writer,
    ].join("|");
    anchors[key] = Math.max(anchors[key] ?? -Infinity, r.load);
  }
  const weeks = [];
  for (let start = from; shift(start, 6) <= to; start = shift(start, 7)) {
    const values = calories.rows.filter(
      (r) => r.date >= start && r.date <= shift(start, 6),
    );
    weeks.push({
      from: start,
      to: shift(start, 6),
      complete: values.length === 7,
      mean: values.length === 7 ? mean(values.map((r) => r.value)) : null,
      count: values.length,
    });
  }
  return {
    from,
    to,
    days,
    calories: {
      ...calories,
      targetVariance: mean(variance),
      targetDays: variance.length,
      weeks,
    },
    protein: { ...protein, floorDays: proteinFloor },
    weight: { ...weight, slope: slope(weight.rows) },
    steps: aggregate("steps"),
    sleep: aggregate("sleep"),
    rhr: aggregate("rhr"),
    hrv: aggregate("hrv"),
    composition: aggregate("composition"),
    waist: aggregate("waist"),
    lifts: {
      count: new Set(lifts.map((r) => r.sessionId)).size,
      lower: new Set(
        lifts
          .filter((r) => r.movements.includes("lower"))
          .map((r) => r.sessionId),
      ).size,
      anchors,
      rows: lifts,
    },
    aerobic: {
      count: new Set(aerobic.map((r) => r.sessionId)).size,
      minutes: aerobic.reduce((s, r) => s + r.value, 0),
      distanceMeters: aerobic.some((r) => finite(r.distanceMeters))
        ? aerobic
            .filter((r) => finite(r.distanceMeters))
            .reduce((total, r) => total + r.distanceMeters, 0)
        : null,
      distanceCount: new Set(
        aerobic.filter((r) => finite(r.distanceMeters)).map((r) => r.sessionId),
      ).size,
    },
    rows,
  };
}
export function analyze(data, periodDays = 28) {
  if (![14, 28, 90, 180].includes(periodDays))
    throw Error("Unsupported reporting window");
  const end = shift(data.clock, -1),
    current = windowMetrics(data, shift(end, 1 - periodDays), end),
    previous = windowMetrics(
      data,
      shift(end, 1 - 2 * periodDays),
      shift(end, -periodDays),
    ),
    whole = current,
    last7 = windowMetrics(data, shift(end, -6), end);
  const delta = (a, b) => (finite(a) && finite(b) ? a - b : null);
  const strengthKeys = Object.keys(current.lifts.anchors).filter(
    (k) => k in previous.lifts.anchors,
  );
  const anchorChanges = strengthKeys.map((key) => {
    const before = previous.lifts.anchors[key],
      after = current.lifts.anchors[key];
    const percent = before > 0 ? (100 * (after - before)) / before : null;
    return {
      key,
      before,
      after,
      percent,
      change: after - before,
      status:
        percent === null
          ? "unknown"
          : percent > 1
            ? "improving"
            : percent < -1
              ? "declining"
              : "stable",
    };
  });
  const strengthCounts = Object.fromEntries(
    ["improving", "stable", "declining", "unknown"].map((status) => [
      status,
      anchorChanges.filter((r) => r.status === status).length,
    ]),
  );
  const strength = strengthKeys.length
    ? mean(
        strengthKeys.map(
          (k) => current.lifts.anchors[k] - previous.lifts.anchors[k],
        ),
      )
    : null;
  const d = {
    calories: delta(current.calories.mean, previous.calories.mean),
    steps: delta(current.steps.mean, previous.steps.mean),
    sleep: delta(current.sleep.mean, previous.sleep.mean),
    rhr: delta(current.rhr.mean, previous.rhr.mean),
    strength,
  };
  const complete =
    current.calories.count === current.days &&
    previous.calories.count === previous.days;
  const recoveryFresh = [current.sleep, current.rhr].every(
    (m) => m.rows.at(-1)?.date >= shift(end, -2),
  );
  const recentRecovery = periodDays > 28 ? analyze(data, 28) : null;
  const recoveryKnown = recentRecovery
    ? recentRecovery.recoveryKnown
    : recoveryFresh &&
      current.sleep.count >= 7 &&
      previous.sleep.count >= 7 &&
      current.rhr.count >= 7 &&
      previous.rhr.count >= 7;
  const recoveryConcern = recentRecovery
    ? recentRecovery.recoveryConcern
    : recoveryKnown && (d.sleep <= -0.75 || d.rhr >= 5);
  const slowdown =
    finite(current.weight.slope) &&
    finite(previous.weight.slope) &&
    current.weight.slope - previous.weight.slope > 0.1;
  const missingLower =
    current.lifts.count > 0 &&
    current.lifts.lower === 0 &&
    planAt(data.plans, end)?.movement.includes("lower");
  const evidence = [];
  const add = (type, title, detail, refs, measurement = null) =>
    evidence.push({
      type,
      title,
      detail,
      ...(measurement ? { measurement } : {}),
      refs: refs.map((r) => `${r.writer}:${r.id}@${r.revision}`),
    });
  if (slowdown)
    add(
      "supported_observation",
      "Weight loss has slowed",
      `The fitted slope changed from ${previous.weight.slope.toFixed(2)} to ${current.weight.slope.toFixed(2)} kg/week.`,
      [...previous.weight.rows, ...current.weight.rows],
      {
        kind: "weightRate",
        previous: previous.weight.slope,
        current: current.weight.slope,
      },
    );
  if (complete && d.calories > 100)
    add(
      "plausible_explanation",
      "Logged intake is higher",
      `Complete-day intake increased ${Math.round(d.calories)} kcal/day. This does not establish the cause of the weight response.`,
      [...previous.calories.rows, ...current.calories.rows],
    );
  if (finite(d.steps) && d.steps < -1000)
    add(
      "plausible_explanation",
      "Recorded movement is lower",
      `Steps fell ${Math.round(Math.abs(d.steps))}/day. Steps do not measure all non-exercise expenditure.`,
      [...previous.steps.rows, ...current.steps.rows],
    );
  if (!complete)
    add(
      "insufficient_evidence",
      "Food logging has gaps",
      `${current.calories.count}/${current.days} current days are explicitly complete. Full-period intake and target appropriateness are not established.`,
      current.calories.rows,
    );
  if (recoveryConcern)
    add(
      "supported_observation",
      "Recovery context deserves attention",
      `Sleep changed ${(recentRecovery?.delta.sleep ?? d.sleep).toFixed(1)} h/night and resting HR ${(recentRecovery?.delta.rhr ?? d.rhr).toFixed(1)} bpm${recentRecovery ? ` in the latest 28-day check (${recentRecovery.current.from}–${recentRecovery.current.to} vs ${recentRecovery.previous.from}–${recentRecovery.previous.to})` : ""}. Routine adjustment suggestions are withheld.`,
      recentRecovery
        ? [
            ...recentRecovery.current.sleep.rows,
            ...recentRecovery.previous.sleep.rows,
            ...recentRecovery.current.rhr.rows,
            ...recentRecovery.previous.rhr.rows,
          ]
        : [...whole.sleep.rows, ...whole.rhr.rows],
    );
  if (!recoveryKnown)
    add(
      "insufficient_evidence",
      "Recovery is unknown",
      "Missing recovery observations are not evidence of good recovery.",
      [],
    );
  if (strength === null)
    add(
      "insufficient_evidence",
      "Strength comparability boundary",
      "Exercise, equipment, loading convention, repetitions or source changed; no cross-boundary progression claim.",
      current.lifts.rows,
    );
  else
    add(
      "supported_observation",
      strengthCounts.declining > 0
        ? "Comparable strength declined"
        : strengthCounts.improving > 0
          ? "Comparable strength improved"
          : "Comparable strength is stable",
      `${strengthCounts.improving} improving, ${strengthCounts.stable} stable and ${strengthCounts.declining} declining of ${strengthKeys.length} comparable anchors (±1% stability tolerance). This does not prove muscle retention.`,
      [...previous.lifts.rows, ...current.lifts.rows],
    );
  if (missingLower)
    add(
      "supported_observation",
      "Attendance hides a movement gap",
      `${current.lifts.count} sessions recorded; none include the explicitly planned lower-body movement exposure.`,
      current.lifts.rows,
    );
  const weightKnown =
    finite(current.weight.slope) &&
    current.weight.rows.at(-1)?.date >= shift(end, -2);
  let action = recoveryConcern
    ? "defer"
    : !complete || strength === null || !recoveryKnown || !weightKnown
      ? "collect_missing_evidence"
      : slowdown || missingLower || strengthCounts.declining > 0
        ? "investigate"
        : "continue_unchanged";
  let title = recoveryConcern
    ? "Review recovery before changing the plan"
    : !weightKnown
      ? "Weight trend needs recent observations"
      : !complete
        ? "Establish execution before judging the target"
        : missingLower
          ? "Sessions are happening. Movement coverage is incomplete."
          : strength === null
            ? "Keep the equipment change visible"
            : slowdown
              ? "Progress has slowed. Check execution first."
              : strengthCounts.declining > 0
                ? "Comparable strength declined. Inspect the context."
                : strengthCounts.improving > 0
                  ? "Strength is improving alongside weight change."
                  : "Comparable strength is stable. Review the measured weight direction.";
  const w = whole.weight.rows;
  return {
    version: VERSION,
    ruleVersion: VERSION,
    asOf: data.clock,
    timezone: data.timezone,
    current,
    previous,
    whole,
    last7,
    delta: d,
    strengthKeys,
    anchorChanges,
    strengthCounts,
    periodDays,
    recoveryFresh,
    recoveryWindow: recentRecovery
      ? {
          from: recentRecovery.current.from,
          to: recentRecovery.current.to,
          previousFrom: recentRecovery.previous.from,
          previousTo: recentRecovery.previous.to,
        }
      : null,
    weightKnown,
    excludedAnchors: Object.keys(current.lifts.anchors).filter(
      (k) => !(k in previous.lifts.anchors),
    ).length,
    complete,
    recoveryKnown,
    recoveryConcern,
    slowdown,
    missingLower,
    action,
    title,
    evidence,
    latestWeight: w.at(-1)?.value ?? null,
    netWeight: w.length > 1 ? w.at(-1).value - w[0].value : null,
    netDates: w.length > 1 ? [w[0].date, w.at(-1).date] : [],
    weightRangeState: planAt(data.plans, end)?.weightRange
      ? "configured"
      : "unconfigured",
    limitations: [
      "Scale weight is not fat or lean tissue change.",
      "Scale composition is a device estimate; waist observations are sparse.",
      "Calorie-target appropriateness is not established by these comparisons.",
      "Observed associations do not isolate causes.",
    ],
  };
}
export function decide(
  data,
  analysis,
  { choice, reason = "", effective, review, adjustment = null },
) {
  if (
    !["accept", "edit", "defer", "reject", "continue_unchanged"].includes(
      choice,
    )
  )
    throw Error("Invalid decision");
  if (!effective || effective < data.clock || (review && review < effective))
    throw Error(
      "Choose valid effective/review dates at or after the analysis clock",
    );
  if (choice === "edit" && !reason.trim())
    throw Error("Explain the user-entered adjustment");
  if (
    adjustment &&
    (!finite(adjustment.calories) ||
      adjustment.calories <= 0 ||
      !finite(adjustment.protein) ||
      adjustment.protein <= 0)
  )
    throw Error("Invalid user-entered targets");
  return structuredClone({
    id: `decision-${data.id}-${crypto.randomUUID()}`,
    choice,
    reason,
    effective,
    review,
    adjustment,
    status: ["defer", "reject"].includes(choice) ? choice : "active",
    originalPlans: data.plans,
    evidence: data.records,
    analysis,
    ruleVersion: VERSION,
    createdAt: data.clock,
  });
}
export function reassess(decision, data) {
  const end = shift(data.clock, -1);
  if (end < decision.effective)
    return {
      status: "awaiting_observations",
      due: !!decision.review && data.clock >= decision.review,
    };
  return {
    status:
      decision.review && data.clock >= decision.review
        ? "review_due"
        : "observing",
    due: !!decision.review && data.clock >= decision.review,
    execution: windowMetrics(data, decision.effective, end),
    caution:
      "Subsequent execution and weight response do not establish that the decision caused the outcome.",
  };
}
export function editPlan(data, changes) {
  if (!changes.effective || changes.effective < data.clock)
    throw Error("New plan must start at or after the reference clock");
  if (data.plans.some((p) => p.effective === changes.effective))
    throw Error("A plan already starts on this date");
  if (
    !Number.isFinite(changes.calories) ||
    changes.calories <= 0 ||
    !Number.isFinite(changes.protein) ||
    changes.protein <= 0 ||
    !changes.reason?.trim()
  )
    throw Error("Positive targets and a reason are required");
  const previous = planAt(data.plans, changes.effective);
  return {
    ...data,
    plans: [
      ...data.plans,
      { ...previous, ...changes, id: `plan-${data.plans.length + 1}` },
    ],
  };
}

export function appendDecision(history, decision) {
  if (
    decision.status === "active" &&
    history.some(
      (d) =>
        d.status === "active" &&
        d.choice === decision.choice &&
        d.reason === decision.reason &&
        d.effective === decision.effective &&
        JSON.stringify(d.adjustment) === JSON.stringify(decision.adjustment),
    )
  )
    throw Error(
      "This action is already active. Review it before recording the same action again.",
    );
  if (history.some((d) => d.id === decision.id))
    throw Error("Decision already recorded");
  return [...history, structuredClone(decision)];
}

// A single presentation contract shared by Overview and detailed reports.
export function dashboard(data, a, decisions = []) {
  const c = a.current,
    p = a.previous;
  const diff = (x, y) => (finite(x) && finite(y) ? x - y : null);
  const fresh = (m) => ({
    latest: m.rows?.at(-1)?.date ?? null,
    missing: m.days - m.count,
    stale: !m.rows?.length || m.rows.at(-1).date < shift(c.to, -2),
  });
  const daily = (kind, field, unit, floorField = null) => {
    const m = c[kind];
    const eligible = m.rows
      .map((r) => ({ r, plan: planAt(data.plans, r.date) }))
      .filter(({ plan }) => finite(plan?.[field]));
    const targets = [...new Set(eligible.map(({ plan }) => plan[field]))];
    const floorEligible = floorField
      ? eligible.filter(({ plan }) => finite(plan[floorField]))
      : [];
    return {
      id: `execution.${kind}`,
      name: kind === "calories" ? "Calories" : "Protein",
      unit,
      actual: m.mean,
      target: mean(eligible.map(({ plan }) => plan[field])),
      targets,
      versusPlan: mean(eligible.map(({ r, plan }) => r.value - plan[field])),
      versusPrior: diff(m.mean, p[kind].mean),
      eligibleDays: eligible.length,
      floor: floorField
        ? mean(floorEligible.map(({ plan }) => plan[floorField]))
        : null,
      floorDays: floorEligible.filter(
        ({ r, plan }) => r.value >= plan[floorField],
      ).length,
      floorEligibleDays: floorEligible.length,
      count: m.count,
      previousCount: p[kind].count,
      days: c.days,
      ...fresh(m),
    };
  };
  const stepEligible = c.steps.rows
    .map((r) => ({ r, plan: planAt(data.plans, r.date) }))
    .filter(({ plan }) => finite(plan?.stepsMin) && finite(plan?.stepsMax));
  const steps = {
    id: "execution.steps",
    name: "Steps",
    unit: "steps/day",
    actual: c.steps.mean,
    targetMin: mean(stepEligible.map(({ plan }) => plan.stepsMin)),
    targetMax: mean(stepEligible.map(({ plan }) => plan.stepsMax)),
    versusPlan: mean(
      stepEligible.map(({ r, plan }) =>
        r.value < plan.stepsMin
          ? r.value - plan.stepsMin
          : r.value > plan.stepsMax
            ? r.value - plan.stepsMax
            : 0,
      ),
    ),
    inRange: stepEligible.filter(
      ({ r, plan }) => r.value >= plan.stepsMin && r.value <= plan.stepsMax,
    ).length,
    versusPrior: diff(c.steps.mean, p.steps.mean),
    eligibleDays: stepEligible.length,
    targetVersions: new Set(
      stepEligible.map(({ plan }) => `${plan.stepsMin}:${plan.stepsMax}`),
    ).size,
    count: c.steps.count,
    previousCount: p.steps.count,
    days: c.days,
    ...fresh(c.steps),
  };
  const sessions = (kind, field) => {
    const rows = c.rows.filter(
      (r) => r.kind === (kind === "lifts" ? "lift" : "aerobic"),
    );
    let expected = 0,
      weeks = 0,
      counted = 0;
    for (let start = c.from; shift(start, 6) <= c.to; start = shift(start, 1)) {
      const plans = Array.from({ length: 7 }, (_, i) =>
        planAt(data.plans, shift(start, i)),
      );
      const base = plans[0];
      if (
        !base ||
        new Date(start + "T12:00:00Z").getUTCDay() !== base.weekStartsOn ||
        !finite(base[field]) ||
        !plans.every((x) => x?.id === base.id)
      )
        continue;
      expected += base[field];
      weeks++;
      counted += new Set(
        rows
          .filter((r) => r.date >= start && r.date <= shift(start, 6))
          .map((r) => r.sessionId),
      ).size;
    }
    return {
      id: `execution.${kind}`,
      name: kind === "lifts" ? "Lifting" : "Aerobic",
      unit: "sessions",
      actual: c[kind].count,
      target: weeks ? expected : null,
      versusPlan: weeks ? counted - expected : null,
      comparableCount: counted,
      versusPrior: c[kind].count - p[kind].count,
      weeks,
      days: c.days,
      latest: rows.at(-1)?.date ?? null,
      baseline: planAt(data.plans, c.to)?.[field] ?? null,
      coverage: "Recorded inventory; unlogged sessions are unknown",
    };
  };
  const weekend = (rows) =>
    rows.filter((r) =>
      [0, 6].includes(new Date(r.date + "T12:00:00Z").getUTCDay()),
    );
  const weekendRows = weekend(c.calories.rows),
    weekdayRows = c.calories.rows.filter((r) => !weekendRows.includes(r));
  const recovery = ["sleep", "rhr", "hrv"].map((kind) => ({
    id: `recovery.${kind}`,
    kind,
    current: c[kind].mean,
    prior: p[kind].mean,
    delta: diff(c[kind].mean, p[kind].mean),
    count: c[kind].count,
    previousCount: p[kind].count,
    days: c.days,
    latestValue: c[kind].rows.at(-1)?.value ?? null,
    ...fresh(c[kind]),
  }));
  const weight = {
    ...fresh(c.weight),
    id: "weight.trend",
    latest: a.latestWeight,
    latestDate: c.weight.rows.at(-1)?.date ?? null,
    mean7: a.last7.weight.mean,
    count7: a.last7.weight.count,
    net: a.netWeight,
    slope: c.weight.slope,
    priorSlope: p.weight.slope,
    count: c.weight.count,
    days: c.days,
    direction: !finite(c.weight.slope)
      ? "Trend not established"
      : c.weight.slope < -0.01
        ? "Weight is trending down"
        : c.weight.slope > 0.01
          ? "Weight is trending up"
          : "Weight is broadly flat",
  };
  const blocked = !a.recoveryKnown || a.recoveryConcern;
  let next = a.recoveryConcern
    ? "Review the recovery change before adjusting intake or training."
    : !a.recoveryKnown
      ? "Collect recent recovery observations before routine changes."
      : !a.complete
        ? "Complete the missing food-log days before judging the calorie target."
        : a.strengthCounts.declining > 0
          ? "Review the declining comparable lifts; avoid judging progress from weight alone."
          : a.missingLower
            ? "Review the recorded movement gap against the existing program."
            : !a.strengthKeys.length
              ? "Establish comparable exercise observations before judging strength progress."
              : !a.weightKnown
                ? "Collect recent weight observations before judging the trend."
                : a.slowdown &&
                    c.calories.targetDays === c.days &&
                    c.calories.targetVariance > 100
                  ? "Return to the documented intake plan and review subsequent execution."
                  : a.slowdown &&
                      steps.eligibleDays === c.days &&
                      steps.versusPlan < -1000
                    ? "Restore the documented movement range and review subsequent execution."
                    : a.slowdown
                      ? "Check the changed weight trend against execution before changing targets."
                      : "Continue the existing plan and review the next observation window.";
  const due = decisions.filter(
    (d) => d.status === "active" && reviewState(d, data).due,
  );
  if (due.length)
    next = `Review ${due.length} active decision${due.length > 1 ? "s" : ""}: the checkpoint is due. ${due.every((d) => reviewState(d, data).enough) ? "Compare subsequent execution and response." : "Collect the missing post-decision evidence before concluding."}${a.recoveryConcern ? " Recovery concerns still constrain changes." : ""}`;
  const priorities = a.evidence
    .filter(
      (e) =>
        e.type !== "insufficient_evidence" && !e.title.includes("Weight loss"),
    )
    .sort((x, y) => {
      const rank = (e) =>
        e.title.includes("Recovery")
          ? 0
          : e.title.includes("declined")
            ? 1
            : e.title.includes("gap")
              ? 2
              : e.type === "plausible_explanation"
                ? 3
                : 4;
      return rank(x) - rank(y);
    })
    .slice(0, 3);
  const caveat = !a.complete
    ? `Only ${c.calories.count}/${c.days} intake days are complete; full-period intake is unknown.`
    : blocked
      ? "Available recovery evidence limits routine adjustment suggestions."
      : a.excludedAnchors
        ? `${a.excludedAnchors} current anchor group(s) cannot be compared across equipment/source boundaries.`
        : "These associations do not isolate causes; calorie-target appropriateness remains unestablished.";
  const strengthHeadline = !a.strengthKeys.length
    ? "Strength comparison is unresolved"
    : a.strengthCounts.declining > 0
      ? "Some comparable lifts declined"
      : a.strengthCounts.improving > 0
        ? "Comparable strength is improving"
        : "Comparable strength is holding";
  return {
    headline: `${a.slowdown ? "Weight loss has slowed" : weight.direction}. ${strengthHeadline}.`,
    version: VERSION,
    from: c.from,
    to: c.to,
    previousFrom: p.from,
    previousTo: p.to,
    weight,
    recovery,
    execution: [
      daily("calories", "calories", "kcal/day"),
      daily("protein", "protein", "g/day", "proteinFloor"),
      steps,
      sessions("lifts", "liftsPerWeek"),
      sessions("aerobic", "aerobicPerWeek"),
    ],
    next,
    priorities,
    caveat,
    weekend: {
      count: weekendRows.length,
      weekdayCount: weekdayRows.length,
      mean: mean(weekendRows.map((r) => r.value)),
      weekdayMean: mean(weekdayRows.map((r) => r.value)),
      delta: diff(
        mean(weekendRows.map((r) => r.value)),
        mean(weekdayRows.map((r) => r.value)),
      ),
    },
    strengthSummary: !a.strengthKeys.length
      ? "Comparable strength not established"
      : `${a.strengthCounts.improving} improving · ${a.strengthCounts.stable} stable · ${a.strengthCounts.declining} declining`,
  };
}

export function reviewState(decision, data) {
  if (decision.status !== "active")
    return { label: decision.status, active: false };
  const r = reassess(decision, data);
  const enough =
    !!r.execution &&
    r.execution.days >= 7 &&
    r.execution.calories.count === r.execution.days &&
    r.execution.weight.slope !== null &&
    r.execution.sleep.count >= 7 &&
    r.execution.rhr.count >= 7 &&
    r.execution.lifts.count > 0 &&
    r.execution.sleep.rows.at(-1)?.date >= shift(data.clock, -3) &&
    r.execution.rhr.rows.at(-1)?.date >= shift(data.clock, -3);
  return {
    ...r,
    active: true,
    enough,
    label: !decision.review
      ? "Review date not set"
      : r.status === "awaiting_observations"
        ? "Awaiting observations"
        : r.due
          ? enough
            ? "Review due with sufficient evidence"
            : "Review due with insufficient evidence"
          : "Gathering evidence",
  };
}

// Canonical observations remain SI. Convert only at the presentation boundary.
const US_MEASURES = {
  weight: { factor: 1 / 0.45359237, unit: "lb", digits: 1 },
  load: { factor: 1 / 0.45359237, unit: "lb", digits: 1 },
  weightRate: { factor: 1 / 0.45359237, unit: "lb/week", digits: 2 },
  waist: { factor: 1 / 2.54, unit: "in", digits: 1 },
  distance: { factor: 1 / 1609.344, unit: "mi", digits: 2 },
  elevation: { factor: 1 / 0.3048, unit: "ft", digits: 0 },
  speed: { factor: 3600 / 1609.344, unit: "mph", digits: 1 },
  pace: { factor: 1.609344, unit: "s/mi", digits: 2 },
};
export function usMeasure(kind, value) {
  const spec = US_MEASURES[kind];
  if (!spec) throw Error("Unsupported display measure");
  return { ...spec, value: finite(value) ? value * spec.factor : null };
}
export function formatUS(kind, value, { signed = false, unit = true } = {}) {
  const m = usMeasure(kind, value);
  if (m.value === null) return "Not available";
  if (kind === "pace") {
    if (m.value < 0) return "Not available";
    const seconds = Math.round(m.value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${unit ? " min/mi" : ""}`;
  }
  const rounded = Number(m.value.toFixed(m.digits)) || 0;
  return `${signed && rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits })}${unit ? " " + m.unit : ""}`;
}
export function displayEvidence(e) {
  if (e.measurement?.kind === "weightRate")
    return `Weight trend changed from ${formatUS("weightRate", e.measurement.previous)} to ${formatUS("weightRate", e.measurement.current)}.`;
  return e.detail;
}

export function completeReview(
  history,
  id,
  data,
  { outcome, note, analysis = analyze(data) },
) {
  if (!["continue_plan", "conclude", "stop"].includes(outcome))
    throw Error("Choose a review outcome");
  if (!note?.trim()) throw Error("Add a short review note");
  const selected = history.find((d) => d.id === id);
  if (!selected || selected.status !== "active")
    throw Error("This decision is not active");
  if (data.clock < selected.effective)
    throw Error("Review starts after the decision takes effect");
  const review = structuredClone({
    outcome,
    note: note.trim(),
    reviewedAt: data.clock,
    assessment: analysis,
    evidence: data.records,
    ruleVersion: VERSION,
    evidenceSufficient: reviewState(selected, data).enough,
  });
  return history.map((d) =>
    d.id === id
      ? { ...structuredClone(d), status: "completed", reviewResult: review }
      : d,
  );
}
