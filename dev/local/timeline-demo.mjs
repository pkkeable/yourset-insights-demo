import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { METRICS } from "../../src/timeline.mjs";
export async function openDemoControls(page) {
  const controls = page.locator("#demo-controls");
  if (!(await controls.getAttribute("open").then((v) => v !== null)))
    await controls.locator("summary").first().click();
}
export async function chooseDemo(page, id, value) {
  await openDemoControls(page);
  await page.locator(id).selectOption(value);
}
export async function visitView(page, name) {
  await openDemoControls(page);
  await page.locator(`#demo-controls [data-page="${name}"]`).click();
}
async function openRecords(page, id) {
  const track = page.locator(`[data-track="${id}"]`);
  if (
    !(await track
      .locator(".track-details")
      .getAttribute("open")
      .then((v) => v !== null))
  )
    await track.locator(".track-details > summary").click();
  await track.locator("[data-record-metric]").click();
}
export async function verifyTimeline(page, { screenshots = false } = {}) {
  const out = process.env.YOURSET_REVIEW_DIR ?? "/tmp/yourset-prototype-review";
  if (screenshots) await mkdir(out, { recursive: true });
  await page.locator('[data-track="strength"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator("[data-track]").count(), 2);
  assert.match(
    await page.locator(".overview-brief").innerText(),
    /Weight down. Bench, Squat and Row weekly maximum loads unchanged for three weeks/,
  );
  assert.match(
    await page.locator(".week-control").innerText(),
    /Latest complete week:.*Oct 19–Oct 25, 2026/s,
  );
  if (screenshots) {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  }
  assert.match(
    await page.locator(".overview-brief").innerText(),
    /Strength assessment: Bench, Squat, Row/,
  );
  assert.equal(
    await page.locator('[data-track="strength"] h3').innerText(),
    "Strength",
  );
  assert.equal(
    await page.getByText("Full debrief", { exact: true }).count(),
    0,
  );
  assert.equal(await page.locator("[data-overlay-series]").count(), 3);
  await page.locator(".strength-details > summary").click();
  assert.match(
    await page.locator(".strength-details").innerText(),
    /2026-10-05–2026-10-25/,
  );
  for (const name of ["Bench", "Squat", "Row"])
    assert.match(
      await page.locator(".strength-details").innerText(),
      new RegExp(name),
    );
  if (screenshots)
    await page.screenshot({
      path: `${out}/strength-details.png`,
      fullPage: true,
    });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const squatKey = await page
    .locator("#timeline-anchor option")
    .evaluateAll(
      (options) => options.find((o) => o.value.startsWith("Squat|")).value,
    );
  await page.locator("#timeline-anchor").selectOption(squatKey);
  await page.locator('[data-record-metric="strength"]').click();
  assert.match(
    await page.locator(".daily-observation:visible").innerText(),
    /Squat/,
  );
  assert.match(
    await page.locator(".daily-observation:visible").innerText(),
    /212.5 lb/,
  );
  await page.keyboard.press("Escape");

  await visitView(page, "Strength");
  await page.locator('[data-strength-mode="split"]').click();
  assert.equal(await page.locator("[data-split-lift]").count(), 3);
  assert.equal(await page.locator("[data-overlay-series]").count(), 0);
  assert.equal(await page.locator("#inspect-week").inputValue(), "2026-10-19");
  if (screenshots)
    await page.screenshot({
      path: `${out}/strength-split.png`,
      fullPage: true,
    });
  await page.locator('[data-strength-mode="overlay"]').click();
  assert.equal(await page.locator("[data-overlay-series]").count(), 3);
  await visitView(page, "Overview");
  await page.locator("#demo-controls > summary").focus();
  await page.keyboard.press("Enter");
  assert(await page.locator("#scenario").isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#demo-controls").getAttribute("open"), null);
  await page.locator("#inspect-week").selectOption("2026-09-21");
  await page.locator("#add-metric").focus();
  await page.keyboard.press("Enter");
  await page.locator("#metric-search").fill("sleep");
  assert.equal(await page.locator("[data-add-metric]:visible").count(), 1);
  await page.locator('[data-add-metric="sleep"]').click();
  await page.locator("#metric-search").fill("nothing matches");
  assert(await page.locator("#no-metrics").isVisible());
  await page.locator("#metric-search").fill("");
  if (screenshots) await page.screenshot({ path: `${out}/picker.png` });
  for (const id of ["calories", "protein"])
    await page.locator(`[data-add-metric="${id}"]`).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-track]").count(), 5);
  assert.equal(await page.locator('[data-track="protein"] svg').count(), 0);
  assert(
    (await page.locator('[data-track="protein"]').boundingBox()).height < 130,
  );
  await page.locator("#inspect-week").selectOption("2026-10-12");
  assert.match(
    await page.locator('[data-track="weight"]').innerText(),
    /195.8/,
  );
  assert.match(
    await page.locator('[data-track="calories"]').innerText(),
    /2,180/,
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  const fiveMarkers = await page
    .locator(".week-marker")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("x1")));
  assert.equal(new Set(fiveMarkers).size, 1);
  if (screenshots)
    await page.screenshot({ path: `${out}/expanded.png`, fullPage: true });
  await openRecords(page, "calories");
  assert.equal(await page.locator(".daily-observation").count(), 7);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#inspect-week").inputValue(), "2026-10-12");
  await page.locator("#inspect-week").selectOption("2026-09-21");
  await page.locator("#add-metric").click();
  for (const metric of METRICS.filter(
    (m) =>
      !["weight", "strength", "sleep", "calories", "protein"].includes(m.id),
  ))
    await page.locator(`[data-add-metric="${metric.id}"]`).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-track]").count(), 16);
  assert.equal(await page.locator("#inspect-week").inputValue(), "2026-09-21");
  assert.match(
    await page.locator('[data-track="protein"]').innerText(),
    /No eligible observations/,
  );
  assert.match(
    await page.locator('[data-track="rhr"]').innerText(),
    /Not connected/,
  );
  assert.match(
    await page.locator('[data-track="calories"]').innerText(),
    /incomplete/,
  );
  // Every SVG with observations uses the same selected-week marker.
  const markers = await page
    .locator(".week-marker")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("x1")));
  assert.equal(new Set(markers).size, 1);
  await openRecords(page, "calories");
  assert(await page.locator(".empty-records").isVisible());
  await page.keyboard.press("Escape");
  await page.locator("#inspect-week").selectOption("2026-10-19");
  await openRecords(page, "calories");
  assert.equal(await page.locator(".daily-observation").count(), 7);
  await page.locator(".daily-observation summary").first().click();
  assert.match(
    await page.locator("#records-dialog").innerText(),
    /fictional-plan-1/,
  );
  assert.match(await page.locator("#records-dialog").innerText(), /2,100 kcal/);
  await page.locator('[data-record-day="2026-10-21"]').click();
  assert.equal(await page.locator(".daily-observation:visible").count(), 1);
  assert.match(
    await page.locator(".daily-observation:visible").innerText(),
    /2026-10-21/,
  );
  await page.locator(".daily-observation:visible summary").click();
  if (screenshots) await page.screenshot({ path: `${out}/records.png` });
  await page
    .getByRole("button", { name: "Return to timeline", exact: true })
    .last()
    .click();
  assert.equal(await page.locator("#inspect-week").inputValue(), "2026-10-19");
  await page.locator('[data-remove-metric="sleep"]').click();
  assert.equal(await page.locator("[data-track]").count(), 15);
  await chooseDemo(page, "#period", "14");
  assert.doesNotMatch(
    await page.locator(".overview-brief h2").innerText(),
    /loads unchanged for three weeks/,
  );
  await chooseDemo(page, "#period", "56");
  // Touch input and long-page scrolling: the week/records route stays reachable.
  const mobile = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
  try {
    const phone = await mobile.newPage();
    await phone.goto(page.url());
    await phone.evaluate(() => document.fonts.ready);
    if (screenshots)
      await phone.screenshot({ path: `${out}/mobile.png`, fullPage: true });
    if (screenshots) {
      await phone.locator('[data-track="weight"]').scrollIntoViewIfNeeded();
      await phone.screenshot({ path: `${out}/mobile-tracks.png` });
    }
    await visitView(phone, "Strength");
    await phone.locator('[data-strength-mode="split"]').tap();
    assert.equal(await phone.locator("[data-split-lift]").count(), 3);
    assert(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await phone.locator(".strength-details > summary").tap();
    assert(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await visitView(phone, "Overview");
    await phone.locator("#add-metric").tap();
    for (const id of ["calories", "sleep", "protein"])
      await phone.locator(`[data-add-metric="${id}"]`).tap();
    await phone.getByRole("button", { name: "Done", exact: true }).tap();
    assert.equal(await phone.locator("[data-track]").count(), 5);
    assert.equal(await phone.locator('[data-track="protein"] svg').count(), 0);
    assert(
      (await phone.locator('[data-track="protein"]').boundingBox()).height <
        160,
    );
    await phone.locator("#inspect-week").selectOption("2026-10-12");
    assert.match(
      await phone.locator('[data-track="calories"]').innerText(),
      /2,180/,
    );
    assert(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (screenshots)
      await phone.screenshot({
        path: `${out}/mobile-expanded.png`,
        fullPage: true,
      });
    await phone.locator('[data-track="protein"]').scrollIntoViewIfNeeded();
    const fiveControl = await phone.locator(".week-control").boundingBox();
    assert(fiveControl.y >= -1 && fiveControl.y + fiveControl.height < 844);
    await phone.locator("#daily-records").tap();
    await phone
      .getByRole("button", { name: "Return to timeline", exact: true })
      .last()
      .tap();
    assert.equal(
      await phone.locator("#inspect-week").inputValue(),
      "2026-10-12",
    );
    await phone.locator("#add-metric").tap();
    for (const id of ["rhr", "hrv", "steps"])
      await phone.locator(`[data-add-metric="${id}"]`).tap();
    await phone.getByRole("button", { name: "Done", exact: true }).tap();
    await phone.locator("#inspect-week").selectOption("2026-09-21");
    await phone.locator('[data-track="hrv"]').scrollIntoViewIfNeeded();
    const control = await phone.locator(".week-control").boundingBox();
    assert(control.y >= -1 && control.y + control.height < 844);
    assert(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    if (screenshots)
      await phone.screenshot({ path: `${out}/mobile-scrolled.png` });
    await phone.locator("#daily-records").tap();
    assert(await phone.locator("#records-dialog").isVisible());
    await phone.locator("#record-day").selectOption("2026-09-23");
    assert.match(
      await phone.locator(".daily-observation:visible").innerText(),
      /2026-09-23/,
    );
    await phone.locator(".daily-observation:visible summary").tap();
    if (screenshots)
      await phone.screenshot({ path: `${out}/mobile-records.png` });
    await phone
      .getByRole("button", { name: "Return to timeline", exact: true })
      .last()
      .tap();
    assert.equal(
      await phone.locator("#inspect-week").inputValue(),
      "2026-09-21",
    );
  } finally {
    await mobile.close();
  }
  // Restore compact selection for the existing scenario and decision regression walk.
  for (const m of METRICS.filter(
    (m) => !["weight", "strength", "sleep"].includes(m.id),
  ))
    await page.locator(`[data-remove-metric="${m.id}"]`).click();
  await visitView(page, "Investigations");
  await page.locator('[name="choice"]').selectOption("continue_unchanged");
  await page
    .locator('[name="reason"]')
    .fill("Keep the fictional target while reviewing more observations.");
  await page.locator('[name="review"]').fill("2026-11-09");
  await page.locator("#decision-form button.primary").click();
  await page.locator("#advance").click();
  assert.match(
    await page.locator("main").innerText(),
    /Weight down. Bench, Squat and Row weekly maximum loads unchanged for three weeks/,
  );
  await page.locator("[data-review-id]").first().click();
  await page
    .locator('#review-form [name="note"]')
    .fill("Retain the plan; missing recovery context remains explicit.");
  await page.locator("#review-form button.primary").click();
  assert.match(
    await page.locator("main").innerText(),
    /Review saved. Targets are unchanged/,
  );
  await visitView(page, "Overview");
  console.log(
    "PASS timeline: 16 metrics, search, gaps, large selection, matched markers, daily source/target records, windows, keyboard, touch and sticky mobile inspection.",
  );
}
