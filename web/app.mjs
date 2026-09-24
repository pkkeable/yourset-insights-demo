import { overviewCards } from "./overview-view.mjs";
import {
  SCENARIOS,
  scenario,
  addSyntheticFollowup,
} from "../src/scenarios.mjs";
import {
  analyze,
  decide,
  reassess,
  editPlan,
  planAt,
  shift,
  appendDecision,
  dashboard,
  reviewState,
  usMeasure,
  formatUS,
  displayEvidence,
  completeReview,
} from "../src/metrics.mjs";
const privateSlice =
  document.querySelector('meta[name="yourset-runtime"]')?.content ===
  "private-local";
const chartState = {
  lift: "sessions",
  aerobic: "minutes",
  recovery: "sleep",
  anchor: null,
};
let readState = "loading";
let data = privateSlice ? null : scenario(),
  page = "Overview",
  periodDays = 28,
  decision = null,
  history = [],
  showPlan = false,
  reviewing = null,
  message = "";
let durableContext = null,
  privateNotice = "",
  pendingPrivate = null,
  privateBusy = false;
let authState = "checking",
  authMessage = "",
  authEnrollment = null,
  authBusy = false,
  authGeneration = 0,
  sessionView = null,
  authNeedsEnrollment = false;
let explicitlySignedOut =
  privateSlice &&
  ["signed_out", "switching"].includes(
    localStorage.getItem("yourset-auth-intent"),
  );
const authChannel = privateSlice ? new BroadcastChannel("yourset-auth") : null;
function clearPrivate() {
  authGeneration++;
  durableContext = null;
  privateNotice = "";
  pendingPrivate = null;
  privateBusy = false;
  sessionView = null;
  authEnrollment = null;
  data = privateSlice ? null : scenario();
  readState = "loading";
  history = [];
  decision = null;
  reviewing = null;
  showPlan = false;
  message = "";
}
function announceAuth(type) {
  localStorage.setItem("yourset-auth-intent", type);
  authChannel?.postMessage(type);
}
if (authChannel)
  authChannel.onmessage = (event) => {
    clearPrivate();
    explicitlySignedOut = ["signed_out", "switching"].includes(event.data);
    authState = event.data === "signed_out" ? "signed_out" : "checking";
    render();
    if (!explicitlySignedOut) void checkSession();
  };
async function authCall(route, payload) {
  const response = await fetch("/api/private/auth/" + route, {
    method: payload ? "POST" : "GET",
    credentials: "same-origin",
    redirect: "error",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      Error(
        response.status === 503
          ? "Sign-in service unavailable. Please retry."
          : response.status === 429
            ? "Too many attempts. Wait one minute before trying again."
            : value.error.code === "invalid_mfa"
              ? "That verification code was not accepted."
              : response.status === 401
                ? "Sign in again to continue."
                : value.error.message,
      ),
      { status: response.status },
    );
  return value;
}
async function checkSession() {
  if (explicitlySignedOut || authBusy) return;
  const generation = authGeneration;
  try {
    const state = await authCall("session");
    if (generation !== authGeneration) return;
    if (sessionView && sessionView !== state.sessionView) {
      clearPrivate();
      authState = "checking";
    }
    sessionView = state.sessionView;
    authNeedsEnrollment = state.needsEnrollment;
    const changed = authState !== state.state;
    authState = state.state;
    if (changed) render();
    if (authState === "authenticated" && !durableContext)
      await restorePrivate();
  } catch (e) {
    if (generation !== authGeneration) return;
    clearPrivate();
    authState = e.status === 401 ? "signed_out" : "unavailable";
    authMessage = e.message;
    render();
  }
}
function authScreen() {
  $("#app").innerHTML =
    `<main id="main" class="auth-shell"><div class="card"><div class="brand"><img class="brand-mark" src="./web/assets/yourset-logo.svg" alt="YourSet"><div class="logo">Your<span>Set</span></div></div><h1>Private workspace</h1><p>Local verification · synthetic records only</p>${authState === "checking" ? '<p role="status">Checking your session…</p>' : authState === "mfa_required" ? `<h2>Authenticator verification</h2>${authEnrollment ? `<p>Enter this setup key in your authenticator app. It disappears after verification.</p><code id="totp-setup-key">${esc(authEnrollment.secret)}</code>` : authNeedsEnrollment ? '<button id="auth-enroll" type="button">Set up authenticator</button>' : "<p>Enter the current code from your enrolled authenticator.</p>"}<form id="auth-verify" class="form"><label>Six-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required></label><button class="primary">Verify</button></form><button id="auth-cancel">Cancel sign-in</button>` : `<form id="auth-login" class="form"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Sign in</button></form>`}<p id="auth-message" role="status">${esc(authMessage)}</p><p class="micro">Access is limited to enrolled identities. Lost password or authenticator access requires the reviewed recovery process; verification cannot be skipped.</p></div></main>`;
  const login = $("#auth-login");
  if (login)
    login.onsubmit = async (e) => {
      e.preventDefault();
      if (authBusy) return;
      authBusy = true;
      const f = new FormData(login),
        payload = {
          email: String(f.get("email")),
          password: String(f.get("password")),
        };
      login.reset();
      clearPrivate();
      const generation = authGeneration;
      announceAuth("switching");
      try {
        const result = await authCall("login", payload);
        if (generation !== authGeneration) return;
        explicitlySignedOut = false;
        authState = result.state;
        authNeedsEnrollment = result.needsEnrollment;
        authMessage = result.needsEnrollment
          ? "Set up your authenticator to finish signing in."
          : "Enter the code from your enrolled authenticator.";
        announceAuth("mfa_required");
      } catch (e) {
        if (generation !== authGeneration) return;
        explicitlySignedOut = true;
        authState = "signed_out";
        authMessage = e.message;
        announceAuth("signed_out");
      } finally {
        payload.password = "";
        authBusy = false;
        render();
      }
    };
  if ($("#auth-enroll"))
    $("#auth-enroll").onclick = async () => {
      if (authBusy) return;
      authBusy = true;
      const generation = authGeneration;
      try {
        const enrolled = await authCall("enroll", {});
        if (generation !== authGeneration) return;
        authEnrollment = enrolled;
        authMessage =
          "Store the key in your authenticator, then enter its code.";
      } catch (e) {
        if (generation !== authGeneration) return;
        if (e.status === 401) {
          clearPrivate();
          authState = "signed_out";
        }
        authMessage = e.message;
      } finally {
        authBusy = false;
        render();
      }
    };
  const verify = $("#auth-verify");
  if (verify)
    verify.onsubmit = async (e) => {
      e.preventDefault();
      if (authBusy) return;
      authBusy = true;
      const generation = authGeneration,
        code = new FormData(verify).get("code");
      verify.reset();
      try {
        const result = await authCall("verify", { code });
        if (generation !== authGeneration) return;
        clearPrivate();
        authState = result.state;
        sessionView = result.sessionView;
        authMessage = "";
        explicitlySignedOut = false;
        announceAuth("authenticated");
        await restorePrivate();
      } catch (e) {
        if (generation !== authGeneration) return;
        if (e.status === 401) {
          clearPrivate();
          authState = "signed_out";
        }
        authMessage = e.message;
      } finally {
        authBusy = false;
        render();
      }
    };
  if ($("#auth-cancel")) $("#auth-cancel").onclick = logout;
}
async function logout() {
  explicitlySignedOut = true;
  clearPrivate();
  authState = "signed_out";
  authMessage = "Signing out…";
  announceAuth("signed_out");
  render();
  try {
    await authCall("logout", {});
    authMessage = "Signed out.";
  } catch {
    authMessage =
      "Local view cleared. Server sign-out could not be confirmed; retry sign-out before leaving.";
  }
  render();
  if (authMessage.includes("could not")) {
    const b = document.createElement("button");
    b.textContent = "Retry sign-out";
    b.onclick = logout;
    $("#auth-message").after(b);
  }
}
if (privateSlice) {
  addEventListener("pagehide", () => {
    clearPrivate();
    authState = "checking";
    $("#app").replaceChildren();
  });
  addEventListener("pageshow", () => {
    if (explicitlySignedOut) {
      authState = "signed_out";
      render();
    } else void checkSession();
  });
  addEventListener("focus", () => {
    if (!explicitlySignedOut) void checkSession();
  });
  setInterval(() => {
    if (authState === "authenticated") void checkSession();
  }, 30000);
}

async function restorePrivate() {
  const generation = authGeneration;
  readState = "loading";
  try {
    const r = await fetch("/api/private/dashboard", {
      credentials: "same-origin",
      redirect: "error",
      headers: sessionView ? { "X-YourSet-Session": sessionView } : {},
    });
    if (!r.ok)
      throw Object.assign(
        Error(
          "Private dashboard unavailable. Your data has not been replaced with demo records.",
        ),
        { status: r.status },
      );
    const restored = await r.json();
    if (generation !== authGeneration) return;
    if (
      restored.schemaVersion !== 1 ||
      !Array.isArray(restored.data?.records) ||
      !Array.isArray(restored.history)
    )
      throw Error("Private dashboard response was not recognized.");
    durableContext = restored;
    data = restored.data;
    history = restored.history;
    decision =
      history.filter((d) => d.status === "active").at(-1) ??
      history.at(-1) ??
      null;
    readState = "ready";
    privateNotice = restored.planVersion
      ? `Committed plan version ${restored.planVersion} restored from the server.`
      : "Private dashboard loaded. No plan edit committed yet.";
  } catch (e) {
    if (generation !== authGeneration) return;
    durableContext = null;
    data = null;
    history = [];
    decision = null;
    readState = "error";
    privateNotice = e.message;
    if (e.status === 401 || e.status === 403) {
      clearPrivate();
      authState = "signed_out";
      authMessage = "Your session ended. Sign in again.";
    }
  }
  render();
}
async function savePrivate(form, type = "plan-decision") {
  if (privateBusy) return;
  privateBusy = true;
  const generation = authGeneration;
  const statusId =
    type === "plan"
      ? "#plan-message"
      : type === "review-completion"
        ? "#review-message"
        : "#private-save-status";
  try {
    if (!durableContext)
      throw Error(
        "Private form unavailable. Nothing was saved. Reload to reconnect.",
      );
    const f = new FormData(form);
    const common = {
      evidenceRevision: durableContext.evidenceRevision,
      analysisPeriodDays: periodDays,
    };
    const body =
      type === "review-completion"
        ? {
            ...common,
            decisionId: form.dataset.decisionId,
            expectedDecisionVersion: history.find(
              (d) => d.id === form.dataset.decisionId,
            )?.version,
            outcome: f.get("outcome"),
            note: String(f.get("note")),
          }
        : {
            expectedPlanVersion: durableContext.planVersion,
            ...common,
            ...(type === "decision"
              ? { choice: f.get("choice") }
              : {
                  calories: Number(f.get("calories")),
                  proteinGrams: Number(f.get("protein")),
                }),
            reason: String(
              f.get("reason") ||
                (f.get("choice") === "accept"
                  ? dashboard(data, analyze(data, periodDays), history).next
                  : ""),
            ),
            effectiveDate: String(f.get("effective")),
            ...(type === "plan" ? {} : { reviewDate: f.get("review") || null }),
          };
    const serialized = JSON.stringify(body);
    if (
      pendingPrivate &&
      (pendingPrivate.serialized !== serialized || pendingPrivate.type !== type)
    )
      throw Error(
        "Resolve the previous command before changing its values. Retry unchanged, then reload.",
      );
    pendingPrivate ??= { key: crypto.randomUUID(), serialized, type };
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const panel = document.querySelector(statusId);
    if (panel) panel.textContent = "Saving…";
    const r = await fetch(`/api/private/commands/${type}`, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": pendingPrivate.key,
        "X-YourSet-Session": sessionView,
      },
      body: pendingPrivate.serialized,
    });
    const result = await r.json();
    if (generation !== authGeneration) return;
    if (r.status === 401 || r.status === 403) {
      clearPrivate();
      authState = "signed_out";
      authMessage = "Your session ended. Sign in again.";
      render();
      return;
    }
    if (!r.ok) {
      if (r.status < 500) pendingPrivate = null;
      throw Error(
        r.status === 503
          ? "Server unavailable. Save not confirmed; retry unchanged."
          : `${result.error.message}. Nothing was saved. Reload before retrying a conflicting edit.`,
      );
    }
    pendingPrivate = null;
    showPlan = false;
    reviewing = null;
    await restorePrivate();
    if (generation !== authGeneration) return;
    const saved =
      type === "plan-decision"
        ? `Committed plan version ${result.plan.version}. Decision saved with it. ${result.plan.calories} kcal/day · ${result.plan.proteinGrams} g/day · effective ${result.plan.effectiveDate}.`
        : type === "plan"
          ? `Plan version ${result.plan.version} saved · effective ${result.plan.effectiveDate}.`
          : type === "decision"
            ? `Decision version ${result.decision.version} saved · ${result.decision.choice.replaceAll("_", " ")}. Targets unchanged.`
            : `Review saved · decision version ${result.decisionVersion} completed. Targets unchanged.`;
    privateNotice =
      saved +
      (readState === "ready"
        ? ""
        : " Dashboard refresh failed; retry the read to see the committed state.");
    message = privateNotice;
    render();
  } catch (e) {
    if (generation !== authGeneration) return;
    privateNotice =
      e instanceof TypeError
        ? "Server connection failed. Save not confirmed; retry unchanged."
        : e.message;
  } finally {
    if (generation === authGeneration) {
      privateBusy = false;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
      const panel = document.querySelector(statusId);
      if (panel) panel.textContent = privateNotice;
    }
  }
}
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const fmt = (v, n = 0) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? "Unknown"
    : (Number(Number(v).toFixed(n)) || 0).toLocaleString("en-US", {
        minimumFractionDigits: n,
        maximumFractionDigits: n,
      });
const sign = (v, n = 0) =>
  v === null
    ? "Unknown"
    : `${Number(Number(v).toFixed(n)) > 0 ? "+" : ""}${fmt(v, n)}`;
const label = (a) =>
  ({
    investigate: "Inspect execution",
    collect_missing_evidence: "Collect missing evidence",
    continue_unchanged: "Continue unchanged",
    defer: "Defer routine changes",
  })[a];
function chart(rows) {
  rows = rows.map((r) => ({ ...r, value: usMeasure("weight", r.value).value }));
  if (rows.length < 2)
    return '<p class="empty">Not enough weight readings for a chart.</p>';
  const v = rows.map((r) => r.value),
    lo = Math.min(...v) - 0.08,
    hi = Math.max(...v) + 0.08;
  const first = Date.parse(rows[0].date),
    span = Date.parse(rows.at(-1).date) - first;
  const p = rows.map(
    (r) =>
      `${40 + ((Date.parse(r.date) - first) / span) * 510},${130 - ((r.value - lo) / (hi - lo)) * 110}`,
  );
  return `<svg class="chart" viewBox="0 0 570 160" role="img" aria-label="Weight readings from ${rows[0].date} to ${rows.at(-1).date}; ${fmt(v[0], 1)} to ${fmt(v.at(-1), 1)} pounds"><line x1="40" y1="20" x2="550" y2="20"/><line x1="40" y1="75" x2="550" y2="75"/><line x1="40" y1="130" x2="550" y2="130"/><text x="0" y="25">${fmt(hi, 1)}</text><text x="0" y="80">${fmt((hi + lo) / 2, 1)}</text><text x="0" y="135">${fmt(lo, 1)}</text><path d="M${p.join(" L")}"/></svg><div class="legend"><span>${rows[0].date}</span><span>Recorded weight · lb</span><span>${rows.at(-1).date}</span></div>`;
}
function table(rows, cols) {
  return `<div class="records"><table><thead><tr>${cols.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map(([, get]) => `<td>${esc(get(r))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function evidence(a) {
  return `<div class="evidence">${a.evidence.map((e) => `<article><span class="tag ${e.type === "insufficient_evidence" ? "blue" : ""}">${esc(e.type.replaceAll("_", " "))}</span><h3>${esc(e.title)}</h3><p>${esc(displayEvidence(e))}</p><details><summary>Inspect ${e.refs.length} source revisions</summary><p>${e.refs.map(esc).join("<br>") || "No qualifying records"}</p></details></article>`).join("")}</div>`;
}
function execution(a) {
  const d = dashboard(data, a);
  const planText = (r) =>
    r.id === "execution.steps"
      ? `${fmt(r.targetMin)}–${fmt(r.targetMax)}`
      : `${fmt(r.target)}`;
  const coverage = (r) =>
    r.unit === "sessions"
      ? `${r.weeks} complete plan weeks · ${r.comparableCount} recorded in those weeks. ${r.coverage}. Latest ${r.latest ?? "none"}.`
      : `${r.count}/${r.days} ${r.id === "execution.steps" ? "observed" : "complete"} days; prior ${r.previousCount}/${r.days}. ${r.eligibleDays} target-comparable days. Latest ${r.latest ?? "none"}.${r.stale ? " Stale / unavailable." : ""}`;
  return `<section class="card execution-card" aria-labelledby="execution-title"><div class="card-head"><h2 id="execution-title">Execution vs. plan</h2><span class="eyebrow">${a.periodDays} completed days</span></div><table class="dashboard-table"><thead><tr>${["Metric", "Effective plan", "Recorded actual", "Versus plan", "Versus prior period"].map((t) => `<th scope="col">${t}</th>`).join("")}</tr></thead><tbody>${d.execution.map((r) => `<tr data-metric="${r.id}"><th scope="row">${r.name}<small>${r.unit}</small></th><td data-label="Effective plan">${planText(r)}${r.unit === "sessions" ? `<small>${r.weeks} full weeks; baseline ${fmt(r.baseline)}/week</small>` : r.targets?.length > 1 || r.targetVersions > 1 ? "<small>Targets changed; eligible-day mean</small>" : ""}${r.id === "execution.protein" ? `<small>Floor ${fmt(r.floor)} g/day</small>` : ""}</td><td data-label="Recorded actual">${fmt(r.actual)}${r.id === "execution.protein" ? `<small>${r.floorDays}/${r.floorEligibleDays} eligible days at floor</small>` : ""}</td><td data-label="Versus plan">${sign(r.versusPlan)}${r.id === "execution.steps" ? `<small>Distance outside dated range; ${r.inRange}/${r.eligibleDays} within range</small>` : r.unit === "sessions" ? "<small>Complete plan weeks only</small>" : ""}</td><td data-label="Versus prior period">${sign(r.versusPrior)}</td></tr><tr class="coverage-row"><td colspan="5">${coverage(r)}</td></tr>`).join("")}</tbody></table><p class="micro">Attendance does not establish program completion. Lower-body exposure: ${a.current.lifts.lower} recorded sessions; ${a.missingLower ? "explicitly planned exposure is missing." : "no numerical set target is configured."}</p></section>`;
}
function adjustment(a) {
  const active = history.filter((d) => d.status === "active");
  return `<section class="card adjustment" tabindex="-1" aria-labelledby="adjustment-title"><div class="card-head"><div><span class="eyebrow">Your decision & review</span><h2 id="adjustment-title">${active.length ? `${active.length} active decision${active.length > 1 ? "s" : ""}` : "No active adjustment"}</h2></div><button class="text-button" data-page="Investigations">${history.length ? "Decision history" : "Choose a next step"} →</button></div>${
    active.length
      ? active
          .map((d) => {
            const r = reviewState(d, data);
            return `<article class="decision-summary"><h3>${esc(d.reason || (d.choice === "continue_unchanged" ? "Continue the existing plan" : label(d.analysis.action)))}</h3><p class="micro">${esc(d.choice.replaceAll("_", " "))} · starts ${d.effective} · ${d.review ? `review ${d.review}` : "review date not set"}</p><span class="tag">${r.label}</span>${r.execution ? `<p>${r.execution.calories.count}/${r.execution.days} complete intake days since the decision · ${fmt(r.execution.calories.mean)} kcal/day · fitted weight ${formatUS("weightRate", r.execution.weight.slope, { signed: true })}.</p><small>Observed follow-up does not establish that the decision caused the response.</small>` : '<p class="micro">No post-decision observations yet.</p>'}<button class="text-button" data-review-id="${esc(d.id)}">Finish review →</button>${reviewing === d.id ? reviewForm(d) : ""}</article>`;
          })
          .join("")
      : `<p class="muted">The next action above is a suggestion. Nothing changes until you record a decision.</p>${decision ? `<p>Latest decision: ${decision.status === "completed" ? "Review completed" : esc(decision.choice)} · ${esc(decision.reviewResult?.note || decision.reason)}</p>` : ""}`
  }</section>`;
}
function reviewForm(d) {
  return `<form id="review-form" class="form" data-decision-id="${esc(d.id)}"><h3>Record what you learned</h3><label>Review outcome<select name="outcome"><option value="continue_plan">Continue the current plan</option><option value="conclude">Conclude this adjustment</option><option value="stop">Stop this adjustment</option></select></label><label>Review note<textarea name="note" required placeholder="What changed, what remains uncertain, and what will you do next?"></textarea></label><small>Finishing records this review and closes the action. It does not change your targets or prove what caused the result.</small><div class="actions"><button class="primary">Save review</button><button type="button" id="cancel-review">Cancel</button></div><p id="review-message" role="status"></p></form>`;
}
function quickExecution(d, a) {
  const [energy, protein, steps, lifts, aerobic] = d.execution;
  const cells = [
    [
      "Intake",
      `${fmt(energy.actual)} <span>kcal/day</span>`,
      energy.versusPlan === null
        ? "Target not configured"
        : `${sign(energy.versusPlan)} vs dated target`,
      `${energy.count}/${energy.days} complete days`,
    ],
    [
      "Protein",
      `${fmt(protein.actual)} <span>g/day</span>`,
      `${fmt(protein.target)} g target · ${fmt(protein.floor)} g floor`,
      `${protein.count}/${protein.days} complete days`,
    ],
    [
      "Movement",
      `${fmt(steps.actual)} <span>steps/day</span>`,
      `${fmt(steps.targetMin)}–${fmt(steps.targetMax)} planned`,
      `${steps.count}/${steps.days} observed days`,
    ],
    [
      "Training",
      `${lifts.actual} <span>lifts · ${aerobic.actual} aerobic</span>`,
      `${lifts.weeks} full weeks: ${lifts.comparableCount}/${fmt(lifts.target)} lifts · ${aerobic.comparableCount}/${fmt(aerobic.target)} aerobic`,
      a.missingLower
        ? "Planned lower-body work is missing"
        : "Attendance is not full program adherence",
    ],
  ];
  return `<section class="quick-execution" aria-label="Execution at a glance">${cells.map(([name, value, plan, coverage]) => `<div><h3>${name}</h3><div class="quick-value">${value}</div><p>${plan}</p><small>${coverage}</small></div>`).join("")}</section>`;
}
function overview(a) {
  const d = dashboard(data, a, history),
    p = planAt(data.plans, data.clock);
  const notes = [];
  if (!a.weightKnown)
    notes.push([
      "Weight coverage",
      `Latest ${d.weight.latestDate ?? "unavailable"} · ${d.weight.count}/${a.current.days} days. A recent trend is not established.`,
    ]);
  if (!a.recoveryKnown)
    notes.push([
      "Recovery coverage",
      "Recent sleep and resting-heart-rate coverage is insufficient for comparison.",
    ]);
  for (const item of d.priorities)
    if (notes.length < 3) notes.push([item.title, displayEvidence(item)]);
  return `<section class="overview-brief"><div><span class="eyebrow">Your briefing · ${a.periodDays} days</span><h2>${esc(d.headline)}</h2><p>${esc(d.caveat)}</p></div><div class="brief-next"><span class="eyebrow">Next step</span><p>${esc(d.next)}</p><button class="primary" data-page="Investigations">Review evidence →</button></div></section>
 <div class="overview-plan" data-current-plan><strong>Current plan</strong><span>${p ? `${fmt(p.calories)} kcal · ${fmt(p.protein)} g protein · effective ${esc(p.effective)}` : "No dated plan configured"}</span><span>Steps ${fmt(a.current.steps.mean)}/day · ${a.current.steps.count}/${a.current.days} recorded</span></div>
 ${overviewCards(data, a, chartState)}
 <section class="review-notes"><h2>Review notes</h2><div class="review-note-grid">${notes.map(([title, text]) => `<article><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("")}</div></section>
 ${adjustment(a)}
 <details class="full-debrief"><summary>Full debrief <span>Execution, comparisons & source evidence</span></summary>${detailedOverview(a)}</details>`;
}
function detailedOverview(a) {
  const d = dashboard(data, a, history),
    c = a.current,
    w = d.weight;
  const recoveryStatus = a.recoveryConcern
    ? a.recoveryWindow
      ? "Recent recovery changed"
      : "Period recovery changed"
    : !a.recoveryKnown
      ? "Recent recovery is unknown"
      : a.recoveryWindow
        ? "No recent 28-day flag"
        : "No period-level flag";
  const scale = c.composition.rows.at(-1),
    waist = c.waist.rows.at(-1);
  const strengthDetail = a.anchorChanges
    .map((r) => {
      const [exercise, equipment, convention, reps] = r.key.split("|");
      return `<li><div><strong>${esc(exercise.replace("demo-", "").replaceAll("-", " "))}</strong><small>${esc(equipment)} · ${reps} reps · ${esc(convention.replace(/kg/g, "lb"))}</small></div><div><b>${sign(r.percent, 1)}%</b><small>${formatUS("load", r.before, { unit: false })} → ${formatUS("load", r.after)} · ${r.status}</small></div></li>`;
    })
    .join("");
  const aerobic = d.execution.find((r) => r.id === "execution.aerobic");
  return `<section class="hero dashboard-hero"><div><span class="eyebrow">Current assessment</span><h2>${esc(d.headline)}</h2><p>${esc(a.recoveryConcern ? "Recovery changes warrant attention before routine changes." : a.missingLower ? "Attendance is consistent, but the planned lower-body work is missing." : !a.complete ? "Food-log gaps limit the intake comparison. Keep the observed outcomes separate from the missing data." : (d.priorities.find((e) => e.type === "plausible_explanation")?.title ?? "Read weight, strength and recovery together before changing the plan."))}</p><small>${esc(d.caveat)}</small></div><div class="next-action"><span class="eyebrow">Next step</span><p>${esc(d.next)}</p><button class="primary" ${history.some((x) => x.status === "active" && reviewState(x, data).due) ? 'id="jump-review"' : 'data-page="Investigations"'}>${history.some((x) => x.status === "active" && reviewState(x, data).due) ? "Review your adjustment" : "Choose next step"} →</button></div></section>
  ${quickExecution(d, a)}<div class="grid dashboard-outcomes">
  <section class="card outcome" data-answer="body"><div class="card-head"><h2>Weight & composition</h2><span class="mini-icon">↘</span></div><div class="metric" data-metric="weight.latest">${formatUS("weight", w.latest, { unit: false })} <span>lb</span></div><p class="status">${a.slowdown ? "Slower fitted trend" : w.direction}</p><small>Latest ${w.latestDate ?? "unavailable"} · ${w.count}/${w.days} observed days${w.stale ? " · stale" : ""}</small>${chart(c.weight.rows)}<dl class="metric-list"><div><dt>7-day mean (${w.count7}/7)</dt><dd>${formatUS("weight", w.mean7)}</dd></div><div><dt>Observed period change</dt><dd>${formatUS("weight", w.net, { signed: true })}</dd></div><div><dt>${a.periodDays}-day fitted rate</dt><dd>${formatUS("weightRate", w.slope, { signed: true })}</dd></div><div><dt>Prior fitted rate</dt><dd>${formatUS("weightRate", w.priorSlope, { signed: true })}</dd></div></dl><p class="micro">Endpoint dates: ${a.netDates.join(" → ") || "unavailable"}. Rate target ${a.weightRangeState}.</p><div class="composition"><p><strong>Waist ${waist ? `${formatUS("waist", waist.value)}` : "not recorded"}</strong><small>${waist ? ` · ${waist.date}; ${c.waist.count} observations` : " · optional measurement"} · trend not established</small></p><p><strong>Scale estimate ${scale ? `${fmt(scale.value, 1)}%` : "unavailable"}</strong><small>${scale ? ` · ${scale.date}; ${esc(scale.writer)} · bioimpedance estimate` : ""}</small></p><small>Fat / lean tissue change is not established by weight or scale estimates.</small></div><button class="text-button" data-page="Nutrition / Weight">Weight details →</button></section>
  <section class="card outcome" data-answer="strength"><div class="card-head"><h2>Strength</h2><span class="mini-icon">↗</span></div><div class="metric">${a.strengthCounts.improving + a.strengthCounts.stable}<span> / ${a.strengthKeys.length} comparable lifts</span></div><p class="status">${a.strengthKeys.length ? "Stable or improving" : "Comparison not established"}</p><p class="micro">${d.strengthSummary}. Same reporting periods as above.</p><ul class="anchor-list">${strengthDetail || "<li>No matched exercise / equipment groups.</li>"}</ul><p class="micro">${a.excludedAnchors} comparisons excluded. Latest lift ${d.execution[3].latest ?? "none"}; ${c.lifts.count} recorded sessions.</p><p class="micro">Load at matched exercise, equipment, reps and source. Stable = within ±1%.</p><p class="boundary micro">${a.missingLower ? "No recorded lower-body exposure despite an explicit movement plan." : `${c.lifts.lower} sessions include recorded lower-body exposure; set-target adherence is unconfigured.`} Stable strength does not prove muscle retention.</p><button class="text-button" data-page="Training">Training details →</button></section>
  <section class="card outcome" data-answer="aerobic"><div class="card-head"><h2>Aerobic work</h2><span class="mini-icon">≈</span></div><div class="metric">${aerobic.actual}<span> recorded sessions</span></div><p class="status">${aerobic.target === null ? "Plan comparison unavailable" : `${aerobic.comparableCount} / ${aerobic.target} in ${aerobic.weeks} complete plan weeks`}</p><dl class="metric-list"><div><dt>Recorded distance (mi)</dt><dd>${formatUS("distance", c.aerobic.distanceMeters)}</dd></div><div><dt>Recorded duration</dt><dd>${fmt(c.aerobic.minutes)} min</dd></div><div><dt>Versus prior period</dt><dd>${sign(aerobic.versusPrior)} sessions</dd></div><div><dt>Weekly baseline</dt><dd>${fmt(aerobic.baseline)} session(s)</dd></div></dl><p class="micro">Latest ${aerobic.latest ?? "none"}. Distance covers ${c.aerobic.distanceCount}/${c.aerobic.count} sessions; unlogged activity is unknown.</p><p class="boundary">Endurance change is not established.</p><small>Attendance shows consistency. A matched performance measure is still needed to assess endurance.</small><button class="text-button" data-page="Training">Aerobic details →</button></section>
  <section class="card outcome" data-answer="recovery"><div class="card-head"><h2>Recovery</h2><span class="mini-icon">◷</span></div><h3 class="recovery-title">${recoveryStatus}</h3>${a.recoveryWindow ? `<p class="micro">Recovery flag: latest 28 days (${a.recoveryWindow.from}–${a.recoveryWindow.to}) vs ${a.recoveryWindow.previousFrom}–${a.recoveryWindow.previousTo}. The means below follow the selected ${a.periodDays}-day period.</p>` : ""}<ul class="recovery-list">${d.recovery.map((r) => `<li data-metric="${r.id}"><div><strong>${{ sleep: "Sleep", rhr: "Resting HR", hrv: "Nightly HRV" }[r.kind]}</strong><b>${fmt(r.latestValue, 1)} <small>${{ sleep: "h/night", rhr: "bpm", hrv: "ms" }[r.kind]}</small></b></div><small>Period mean ${fmt(r.current, 1)} · ${sign(r.delta, 1)} vs prior ${fmt(r.prior, 1)} · ${r.count}/${r.days} days (prior ${r.previousCount}/${r.days})</small><small>Latest on ${r.latest ?? "no observation"}${r.stale ? " · stale / unavailable" : ""}; ${r.missing} missing days</small></li>`).join("")}</ul><small>Sleep and resting HR inform this review; HRV is context only. Stale or missing observations cannot reassure. No flag is not clearance.</small></section></div>
  <div class="grid dashboard-lower">${execution(a)}<section class="card" data-answer="findings"><h2>What changed?</h2><div class="evidence">${d.priorities.map((e, i) => `<article><span class="eyebrow">${i + 1} · ${e.type === "plausible_explanation" ? "Possible explanation" : "Observed"}</span><h3>${esc(e.title)}</h3><p>${esc(displayEvidence(e))}</p></article>`).join("")}</div><div class="divider"></div><h3>Food-log pattern</h3><p class="micro">Weekend ${fmt(d.weekend.mean)} vs weekday ${fmt(d.weekend.weekdayMean)} kcal/day (${sign(d.weekend.delta)}). ${d.weekend.count} complete weekend and ${d.weekend.weekdayCount} complete weekday days. Missing days may change the pattern.</p><h3>What limits the answer?</h3><p class="micro">${esc(d.caveat)} ${a.recoveryConcern ? "Recovery concerns remain relevant even if strength is stable." : ""}</p><button class="text-button" data-page="Investigations">Full evidence & alternatives →</button></section></div>`;
}
function training(a) {
  const c = a.current,
    p = planAt(data.plans, c.to);
  return `<div class="hero"><span class="eyebrow">Program continuity</span><h2>${p ? p.sequence.join(" → ") : "No program sequence configured"}</h2><p>${p ? "A repeating sequence, independent of weekdays." : "Attendance and anchors below are observed; no planned sequence exists to compare them against."} The exercise and movement assignments below are independently synthetic.</p></div><div class="grid outcomes"><div class="card"><h2>Attendance</h2><div class="metric">${c.lifts.count} <span>sessions / ${dashboard(data, a).execution[3].target ?? "unconfigured"} planned</span></div><small>Counts unique strength sessions; Garmin HR context would not add a second session.</small></div><div class="card"><h2>Movement exposure</h2><div class="metric">${c.lifts.lower} <span>sessions with lower-body work</span></div><small>${a.missingLower ? "Planned exposure is missing despite attendance." : "Synthetic program explicitly includes lower-body exposure."} Routine names alone do not define exercises.</small></div><div class="card"><h2>Aerobic work</h2><div class="metric">${c.aerobic.minutes} <span>minutes · ${c.aerobic.count} sessions</span></div><small>${formatUS("distance", c.aerobic.distanceMeters)} recorded distance · ${c.aerobic.distanceCount}/${c.aerobic.count} sessions with distance. No duration target is assumed.</small></div></div><div class="card"><h2>Comparable anchor history</h2><p class="boundary">${a.delta.strength === null ? "Equipment or source changed. These groups remain separate; no progression delta is calculated." : `${dashboard(data, a).strengthSummary}; ${a.excludedAnchors} excluded current groups. Changes below compare each anchor at matched repetitions; no combined strength score.`}</p>${table(
    a.whole.lifts.rows,
    [
      ["Date", (r) => r.date],
      ["Routine", (r) => r.routine],
      ["Exercise", (r) => r.exercise],
      ["Equipment", (r) => r.equipment],
      [
        "Load",
        (r) =>
          `${formatUS("load", r.load, { unit: false })} ${r.loadConvention.replace(/kg/g, "lb")}`,
      ],
      ["Reps", (r) => r.reps],
      ["Movement", (r) => r.movements.join(", ")],
    ],
  )}</div>`;
}
function nutrition(a) {
  const c = a.current;
  return `<div class="grid two-col"><div class="card"><h2>Logged intake, not inferred intake</h2><div class="metric">${fmt(c.calories.mean)} <span>kcal / complete day</span></div><p>${c.calories.count}/${c.days} days explicitly complete.</p><p class="muted">${sign(c.calories.targetVariance)} kcal/day versus effective targets on ${c.calories.targetDays} comparable days; ${sign(a.delta.calories)} kcal/day versus the previous period's complete-day mean.</p><div class="notice">${a.complete ? "Complete logging permits an execution comparison. It does not validate the calorie target or establish measured expenditure." : "Full-period intake is unknown. A successful sync cannot establish complete food logging."}</div><h3 style="margin-top:24px">Complete-week arithmetic</h3>${table(
    [...a.previous.calories.weeks, ...c.calories.weeks],
    [
      ["Week starts", (r) => r.from],
      ["Complete days", (r) => `${r.count}/7`],
      ["Daily mean", (r) => (r.complete ? `${fmt(r.mean)} kcal` : "Unknown")],
    ],
  )}</div><div class="card"><h2>Weight observations</h2>${chart(a.whole.weight.rows)}<p>Latest ${formatUS("weight", a.latestWeight)} · 7-day average ${formatUS("weight", a.last7.weight.mean)}</p><small>Observed endpoint change ${formatUS("weight", a.netWeight, { signed: true })} across ${a.netDates.join(" → ")}. Fitted current slope ${formatUS("weightRate", c.weight.slope, { signed: true })}. None identifies fat or lean tissue change.</small></div></div><div class="card"><h2>Daily records and coverage</h2>${table(
    a.whole.calories.rows
      .concat(a.whole.rows.filter((r) => r.kind === "calories" && !r.complete))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [
      ["Date", (r) => r.date],
      [
        "Logged energy",
        (r) => (r.value === null ? "No record" : `${fmt(r.value)} kcal`),
      ],
      [
        "Logging",
        (r) => (r.complete ? "Explicitly complete" : "Unknown/incomplete"),
      ],
      [
        "Dated target",
        (r) => `${planAt(data.plans, r.date)?.calories ?? "Unknown"} kcal`,
      ],
      ["Writer", (r) => r.writer],
      ["Revision", (r) => r.revision],
    ],
  )}</div>`;
}
function investigation(a) {
  return `<div class="hero"><span class="eyebrow">Investigation · rule ${a.ruleVersion}</span><h2>${esc(a.title)}</h2><p>${esc(dashboard(data, a, history).next)} No new numerical target is prescribed. Accepting records this bounded action; only an explicit edit changes targets.</p></div><div class="grid two-col"><div class="card"><h2>Supporting and competing evidence</h2>${evidence(a)}<div class="divider"></div><h3>Limits of the explanation</h3>${a.limitations.map((x) => `<p><small>${x}</small></p>`).join("")}</div><div><div class="card"><h2>Choose the next step</h2><form id="decision-form" class="form"><label>Decision<select name="choice"><option value="accept">Accept the bounded review action</option><option value="edit">Edit · enter my own adjustment</option><option value="defer">Defer</option><option value="reject">Reject</option><option value="continue_unchanged">Continue unchanged</option></select></label><label>Reason or adjustment<textarea name="reason" placeholder="What will you do, and what evidence will you review?"></textarea></label><div class="form-grid"><label>Effective date<input name="effective" type="date" required min="${data.clock}" value="${data.clock}"></label><label>Review checkpoint (optional)<input name="review" type="date" min="${data.clock}" value=""></label></div><div id="target-inputs" hidden><p><small>Optional user-entered targets. The software does not prescribe or validate these values.</small></p><div class="form-grid"><label>Energy target (kcal/day)<input type="number" min="1" name="calories"></label><label>Protein target (g/day)<input type="number" min="1" name="protein"></label></div></div><button class="primary">Record decision</button></form><div id="message" role="status">${esc(message)}</div><small>${privateSlice ? "Plans, decisions and reviews are saved to the local server. History preserves the evidence available when you acted." : "Stored only in this tab. Synthetic records reset when reloaded."}</small></div><div style="height:18px"></div>${adjustment(a)}${decision?.status === "active" ? followup(a) : ""}${history.length ? historyView() : ""}</div></div>`;
}
function followup(a) {
  const r = reassess(decision, data);
  return `<div class="card" style="margin-top:18px"><h2>Reassessment</h2><p>${r.status.replaceAll("_", " ")} · ${r.due ? "checkpoint reached" : "checkpoint ahead"}</p>${r.execution ? `<p>${r.execution.calories.count}/${r.execution.days} complete intake days; ${fmt(r.execution.calories.mean)} kcal/day. Weight slope ${formatUS("weightRate", r.execution.weight.slope, { signed: true })}.</p><small>${r.caution}</small>` : '<p class="muted">No subsequent observations are available at the frozen clock.</p>'}<details><summary>Original decision snapshot</summary><p><small>${esc(decision.analysis.title)}<br>Plan versions: ${decision.originalPlans.map((p) => p.id).join(", ")}<br>Evidence as of ${decision.createdAt}; rule ${decision.ruleVersion}.</small></p></details><button class="text-button" id="advance">Load independent synthetic follow-up →</button></div>`;
}
function planForm() {
  const p = planAt(data.plans, data.clock);
  return `<div class="card"><h2>Edit the plan</h2><p class="muted">New versions apply from their effective date. Historical execution keeps its original targets.</p><form id="plan-form" class="form"><div class="form-grid"><label>Energy target (kcal/day)<input name="calories" type="number" min="1" required value="${p?.calories ?? ""}"></label><label>Protein target (g/day)<input name="protein" type="number" min="1" required value="${p?.protein ?? ""}"></label></div><label>Effective date<input name="effective" type="date" min="${data.clock}" required value="${data.clock}"></label><label>Reason<textarea name="reason" required></textarea></label><button class="primary">Save new plan version</button><button type="button" id="cancel-plan">Cancel</button></form><div id="plan-message" role="status"></div><h3>Target history</h3>${table(
    data.plans,
    [
      ["Version", (r) => r.id],
      ["Effective", (r) => r.effective],
      ["Energy", (r) => r.calories],
      ["Protein", (r) => r.protein],
      ["Reason", (r) => r.reason],
    ],
  )}</div>`;
}
const pages = ["Overview", "Training", "Nutrition / Weight", "Investigations"];

function renderNavigation() {
  const icons = ["◫", "↗", "◷", "⌕"];
  return pages
    .map(
      (name, i) => `
    <button data-page="${name}" ${page === name ? 'aria-current="page"' : ""}>
      <span class="nav-icon">${icons[i]}</span>${name}
    </button>
  `,
    )
    .join("");
}

function renderSidebar(a) {
  return `<aside>
    <div class="brand">
      <img class="brand-mark" src="./web/assets/yourset-logo.svg" alt="YourSet YS and dumbbell mark">
      <div><div class="logo">Your<span>Set</span></div><div class="brand-sub">Insights</div></div>
    </div>
    <nav aria-label="Main navigation">${renderNavigation()}</nav>
    <div class="aside-bottom">
      <span class="demo-dot">●</span> Independent synthetic profile<br>
      No live sources connected<br>Metrics & rules v${a.version}
    </div>
  </aside>`;
}

function renderScenarioSelector() {
  const options = SCENARIOS.map(
    ([id, title]) =>
      `<option value="${id}" ${id === data.id ? "selected" : ""}>${title}</option>`,
  ).join("");
  return `<div class="topbar">
    <span class="demo">◉ Synthetic demonstration data</span>
    <label class="scenario-label">Explore a scenario
      <select id="scenario" aria-label="Scenario">${options}</select>
    </label>
  </div>`;
}

function renderHeading(a) {
  const title = showPlan
    ? "Your plan"
    : page === "Overview"
      ? "Your progress, in view."
      : page;
  const phase = planAt(data.plans, data.clock)?.phase ?? "Phase unconfigured";
  const windows = [28, 14, 90, 180]
    .map(
      (days) =>
        `<option value="${days}" ${periodDays === days ? "selected" : ""}>Last ${days} completed days</option>`,
    )
    .join("");
  return `<div class="heading-row">
    <div>
      <span class="eyebrow">${esc(phase)} · Review period</span>
      <h1>${title}</h1>
      <small>${a.current.from}–${a.current.to} vs ${a.previous.from}–${a.previous.to} · ${data.timezone}</small>
    </div>
    <div class="header-controls">
      <label>Reporting window<select id="period" aria-label="Reporting window">${windows}</select></label>
      <button id="edit-plan">Edit plan</button>
    </div>
  </div>`;
}

function renderProgress() {
  const steps = [
    "Plan",
    "Execute",
    "Measure",
    "Investigate",
    "Adjust",
    "Reassess",
  ];
  const active = pages.indexOf(page) + 2;
  return `<div class="progress" hidden aria-label="Decision loop">${steps
    .map(
      (step, i) =>
        `<span class="${i === active ? "active" : ""}">${step}</span>`,
    )
    .join('<span aria-hidden="true">→</span>')}</div>`;
}

function renderContent(a) {
  if (showPlan) return planForm();
  switch (page) {
    case "Overview":
      return overview(a);
    case "Training":
      return training(a);
    case "Nutrition / Weight":
      return nutrition(a);
    default:
      return investigation(a);
  }
}

function renderSources() {
  return `<div class="source-grid">${[
    "Nutrition",
    "Weight / composition",
    "Training",
    "Recovery",
  ]
    .map(
      (name) => `
    <div class="source"><strong>${name}</strong><br>
      <span class="muted">Synthetic-tested<br>Live account: not validated</span>
    </div>
  `,
    )
    .join("")}</div>`;
}

function renderFooter() {
  return `<footer class="footer">
    US units · Reference date: ${data.clock} · Synthetic observations only · No external requests or live import routes.<br>
    Coverage describes available records. These scenarios test software behavior, not physiological efficacy.<br>
    <strong>Not medical advice.</strong> This is a software demonstration. It does not diagnose, treat or prescribe,
    and it is not a substitute for a qualified health professional.
  </footer>`;
}

function renderShell(a) {
  return `<div class="shell">
    ${renderSidebar(a)}
    <main id="main" tabindex="-1">
      ${renderScenarioSelector()}
      ${renderHeading(a)}
      ${renderProgress()}
      ${message ? `<p class="global-status" role="status">${esc(message)}</p>` : ""}
      ${renderContent(a)}
      ${renderSources()}
      ${renderFooter()}
    </main>
  </div>`;
}

function render() {
  if (privateSlice && authState !== "authenticated") {
    authScreen();
    return;
  }
  if (privateSlice && (!data || readState !== "ready")) {
    $("#app").innerHTML =
      `<main id="main" class="auth-shell"><section class="card"><h1>Private dashboard</h1><p id="private-read-status" role="status">${readState === "error" ? esc(privateNotice) : "Loading your saved records and plans…"}</p>${readState === "error" ? '<button id="retry-read">Retry dashboard read</button>' : ""}<button id="auth-logout">Sign out</button></section></main>`;
    if ($("#retry-read"))
      $("#retry-read").onclick = () => {
        void restorePrivate();
        render();
      };
    $("#auth-logout").onclick = logout;
    return;
  }
  const a = analyze(data, periodDays);
  $("#app").innerHTML = renderShell(a);
  document.querySelectorAll("[data-chart]").forEach(
    (b) =>
      (b.onclick = () => {
        chartState[b.dataset.chart] = b.dataset.metric;
        render();
        document
          .querySelector(
            `[data-chart="${b.dataset.chart}"][data-metric="${b.dataset.metric}"]`,
          )
          ?.focus({ preventScroll: true });
      }),
  );
  document.querySelectorAll("[data-anchor]").forEach(
    (el) =>
      (el.onchange = () => {
        chartState.anchor = el.value;
        render();
        document.querySelector("[data-anchor]")?.focus({ preventScroll: true });
      }),
  );
  if (privateSlice) {
    $(".scenario-label")?.remove();
    $(".demo").textContent = "◉ Private local workspace";
    const button = document.createElement("button");
    button.id = "auth-logout";
    button.textContent = "Sign out";
    button.onclick = logout;
    $(".topbar").prepend(button);
  }
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        page = b.dataset.page;
        showPlan = false;
        message = "";
        render();
        $("#main").focus();
      }),
  );
  if ($("#jump-review"))
    $("#jump-review").onclick = () => {
      $(".adjustment").scrollIntoView({ behavior: "smooth", block: "start" });
      $(".adjustment").focus({ preventScroll: true });
    };
  document.querySelectorAll("[data-review-id]").forEach(
    (button) =>
      (button.onclick = () => {
        reviewing = button.dataset.reviewId;
        render();
        $("#review-form").scrollIntoView({ block: "center" });
      }),
  );
  if ($("#cancel-review"))
    $("#cancel-review").onclick = () => {
      reviewing = null;
      render();
    };
  if ($("#review-form"))
    $("#review-form").onsubmit = (e) => {
      e.preventDefault();
      if (privateSlice) {
        void savePrivate(e.target, "review-completion");
        return;
      }
      const f = new FormData(e.target);
      try {
        history = completeReview(history, e.target.dataset.decisionId, data, {
          outcome: f.get("outcome"),
          note: f.get("note"),
          analysis: a,
        });
        decision =
          history.filter((d) => d.status === "active").at(-1) ?? history.at(-1);
        reviewing = null;
        message = "Review saved. Targets are unchanged.";
        render();
        $(".adjustment").focus();
      } catch (err) {
        $("#review-message").textContent = err.message;
      }
    };
  $("#period").onchange = (e) => {
    periodDays = Number(e.target.value);
    render();
  };
  if ($("#scenario"))
    $("#scenario").onchange = (e) => {
      data = scenario(e.target.value);
      decision = null;
      history = [];
      reviewing = null;
      showPlan = false;
      message = "";
      if (data.id === "followup") seedFollowup();
      render();
    };
  $("#edit-plan").onclick = () => {
    showPlan = true;
    message = "";
    render();
  };
  if ($("#cancel-plan"))
    $("#cancel-plan").onclick = () => {
      showPlan = false;
      render();
    };
  if ($("#plan-form"))
    $("#plan-form").onsubmit = (e) => {
      e.preventDefault();
      if (privateSlice) {
        void savePrivate(e.target, "plan");
        return;
      }
      const f = new FormData(e.target);
      try {
        data = editPlan(data, {
          calories: +f.get("calories"),
          protein: +f.get("protein"),
          effective: f.get("effective"),
          reason: f.get("reason"),
        });
        showPlan = false;
        message = "Plan version saved.";
        render();
      } catch (err) {
        $("#plan-message").textContent = err.message;
      }
    };
  if ($("#decision-form")) {
    $("[name=choice]").onchange = (e) =>
      ($("#target-inputs").hidden = e.target.value !== "edit");
    if (privateSlice) {
      const panel = document.createElement("p");
      panel.id = "private-save-status";
      panel.setAttribute("role", "status");
      panel.textContent = privateNotice || "Loading private command state…";
      $("#decision-form").append(panel);
    }
    $("#decision-form").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      if (privateSlice) {
        const targetEdit =
          f.get("choice") === "edit" && (f.get("calories") || f.get("protein"));
        void savePrivate(e.target, targetEdit ? "plan-decision" : "decision");
        return;
      }
      try {
        let adj = null;
        if (
          f.get("choice") === "edit" &&
          (f.get("calories") || f.get("protein"))
        )
          adj = { calories: +f.get("calories"), protein: +f.get("protein") };
        const next = decide(data, a, {
          choice: f.get("choice"),
          reason:
            f.get("reason") ||
            (f.get("choice") === "accept"
              ? dashboard(data, a, history).next
              : ""),
          effective: f.get("effective"),
          review: f.get("review"),
          adjustment: adj,
        });
        const proposedHistory = appendDecision(history, next);
        let proposedData = data;
        if (adj)
          proposedData = editPlan(data, {
            ...adj,
            effective: next.effective,
            reason: next.reason,
          });
        data = proposedData;
        decision = next;
        history = proposedHistory;
        message = "Decision recorded with an immutable evidence snapshot.";
        render();
      } catch (err) {
        $("#message").textContent = err.message;
      }
    };
  }
  if (privateSlice) $("#advance")?.remove();
  if ($("#advance"))
    $("#advance").onclick = () => {
      data = addSyntheticFollowup(data, decision);
      message =
        "Loaded a new independent synthetic observation window. Causality is not established.";
      render();
    };
}
function historyView() {
  return `<div class="card" style="margin-top:18px"><h2>Decision history</h2>${history.map((d) => `<details><summary>${esc(d.createdAt)} · ${esc(d.choice.replaceAll("_", " "))} · ${esc(d.status)}</summary><p>${esc(d.reason)}</p>${d.reviewResult ? `<p>Reviewed ${d.reviewResult.reviewedAt}: ${esc(d.reviewResult.outcome.replaceAll("_", " "))}. ${esc(d.reviewResult.note)}</p><small>Evidence sufficient for review: ${d.reviewResult.evidenceSufficient ? "yes" : "no"}; causal attribution remains unestablished.</small>` : ""}<small>Effective ${d.effective}; review ${d.review || "not set"}. ${d.evidenceCount ?? d.evidence.length} source revisions; plan ${d.originalPlans.map((p) => p.id).join(", ")}; rule ${d.ruleVersion}.<br>Original assessment: ${esc(d.analysis.title)}</small></details>`).join("")}</div>`;
}
function seedFollowup() {
  const before = {
    ...scenario("followup"),
    clock: "2026-06-15",
    plans: [scenario("followup").plans[0]],
    records: scenario("followup").records.filter((r) => r.date < "2026-06-15"),
  };
  decision = decide(before, analyze(before), {
    choice: "edit",
    reason: "Synthetic user chose more consistent movement; no calorie change.",
    effective: "2026-06-15",
    review: "2026-06-29",
  });
  history = appendDecision(history, decision);
}
render();

if (privateSlice) {
  if (explicitlySignedOut) {
    authState = "signed_out";
    render();
  } else void checkSession();
}
