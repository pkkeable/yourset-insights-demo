// Synthetic portfolio walkthrough; no private service or configuration is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../../server.mjs";
import { SCENARIOS } from "../../src/scenarios.mjs";
import { startBrowser } from "./browser.mjs";
const root = fileURLToPath(new URL("../..", import.meta.url));
const docker = realpathSync(
  "/Applications/Docker.app/Contents/Resources/bin/docker",
);
const env = {
  ...process.env,
  DOCKER_HOST:
    process.env.DOCKER_HOST ??
    `unix://${process.env.HOME}/.docker/run/docker.sock`,
};
const call = (bin, args) =>
  execFileSync(bin, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
  });
const network = "yourset-demo-verification";
let service,
  browser,
  owned = false;
const app = createServer();
try {
  call(docker, [
    "network",
    "create",
    "-o",
    "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    network,
  ]);
  owned = true;
  service = await startBrowser(call, docker, root, network);
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${app.address().port}`;
  browser = await chromium.connect(service.endpoint, {
    exposeNetwork: new URL(origin).host,
  });
  const page = await browser.newPage({
      viewport: { width: 1536, height: 1600 },
    }),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin + "/")) external.push(r.url());
  });
  await page.goto(origin);
  await page.locator('[data-card="recovery"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".overview-trends > [data-card]").count(), 6);
  if (process.argv.includes("--screenshots")) {
    await mkdir(new URL("../../docs/images/", import.meta.url), {
      recursive: true,
    });
    const trendBounds = await page.locator(".overview-trends").boundingBox();
    await page.screenshot({
      clip: {
        x: 0,
        y: 0,
        width: 1536,
        height: Math.ceil(trendBounds.y + trendBounds.height + 24),
      },
      path: fileURLToPath(
        new URL("../../docs/images/overview.png", import.meta.url),
      ),
    });
  }
  for (const [id] of SCENARIOS) {
    await page.locator("#scenario").selectOption(id);
    assert.equal(
      await page.locator(".overview-trends > [data-card]").count(),
      6,
    );
    for (const view of [
      "Training",
      "Nutrition / Weight",
      "Investigations",
      "Overview",
    ]) {
      await page.locator(`button[data-page="${view}"]`).first().click();
      assert(!/NaN|undefined/.test(await page.locator("main").innerText()));
    }
  }
  await page.locator("#scenario").selectOption("slowdown");
  await page.locator('button[data-page="Investigations"]').first().click();
  await page
    .locator("#decision-form [name=reason]")
    .fill("Review movement and food logging before changing targets.");
  await page.locator("#decision-form [name=review]").fill("2026-07-13");
  await page.locator("#decision-form button.primary").click();
  await page.locator("#advance").click();
  await page.locator("[data-review-id]").first().click();
  await page
    .locator("#review-form [name=note]")
    .fill(
      "Synthetic follow-up shows consistent execution; continue observing without a causal claim.",
    );
  await page.locator("#review-form button.primary").click();
  await page
    .locator(".global-status")
    .filter({ hasText: "Review saved" })
    .waitFor();
  assert.equal(await page.locator("[data-review-id]").count(), 0);
  await page.locator("#scenario").selectOption("slowdown");
  await page.locator('button[data-page="Overview"]').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [id] of SCENARIOS) {
    await page.locator("#scenario").selectOption(id);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page.locator("#scenario").selectOption("slowdown");
  await page.locator('[data-chart="recovery"][data-metric="hrv"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .locator('[data-chart="recovery"][data-metric="hrv"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS public demo: ten scenarios across all views, six cards, complete decision/review story, narrow-screen overflow, keyboard selector and no external requests or browser errors.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => app.close(r));
  service?.stop();
  if (owned) call(docker, ["network", "rm", network]);
}
