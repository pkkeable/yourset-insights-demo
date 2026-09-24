// Disposable verification only; no product data or configuration is mounted.
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

export const browserImage =
  "mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27";
const name = "browser_yourset-insights";

export async function startBrowser(call, docker, root, network) {
  let id, browser, probe;
  const stop = () => {
    if (id) {
      call(docker, ["rm", "-f", "-v", id]);
      id = null;
    }
  };
  try {
    console.log("Starting pinned disposable browser");
    id = call(docker, [
      "create",
      "--init",
      "--read-only",
      "--user",
      "pwuser",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--shm-size=256m",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=256m",
      "--name",
      name,
      "--network",
      network,
      "-p",
      "127.0.0.1::3000",
      "--mount",
      `type=bind,src=${path.join(root, "node_modules/playwright")},dst=/opt/node_modules/playwright,readonly`,
      "--mount",
      `type=bind,src=${path.join(root, "node_modules/playwright-core")},dst=/opt/node_modules/playwright-core,readonly`,
      browserImage,
      "node",
      "/opt/node_modules/playwright/cli.js",
      "run-server",
      "--host",
      "0.0.0.0",
      "--port",
      "3000",
    ])
      .toString()
      .trim();
    call(docker, ["start", id]);
    console.log("Checking browser binding and loopback forwarding");
    const c = JSON.parse(call(docker, ["inspect", id]))[0];
    const bindings = Object.values(c.NetworkSettings.Ports ?? {}).flatMap(
      (b) => b ?? [],
    );
    if (bindings.length !== 1 || bindings.some((b) => b.HostIp !== "127.0.0.1"))
      throw Error("non_loopback_browser_port");
    const endpoint = `ws://127.0.0.1:${bindings[0].HostPort}/`;
    probe = http.createServer((req, res) =>
      res.end("<title>YourSet browser preflight</title>"),
    );
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = probe.address().port,
      until = Date.now() + 15000;
    while (!browser && Date.now() < until) {
      try {
        browser = await chromium.connect(endpoint, {
          exposeNetwork: `127.0.0.1:${port}`,
          timeout: 2000,
        });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!browser)
      throw Error(
        "Browser preflight failed: pinned Docker browser did not become ready",
      );
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`, { timeout: 10000 });
    if ((await page.title()) !== "YourSet browser preflight")
      throw Error("Browser loopback forwarding failed");
    console.log(
      `PASS automated browser preflight: Chromium ${browser.version()}, loopback-only port and forwarding`,
    );
    return { endpoint, stop };
  } catch (error) {
    stop();
    throw error;
  } finally {
    if (browser) await browser.close();
    if (probe) await new Promise((resolve) => probe.close(resolve));
  }
}

export async function connectBrowser() {
  const endpoint = process.env.YOURSET_BROWSER_ENDPOINT;
  if (!endpoint || !/^ws:\/\/127\.0\.0\.1:\d+\/$/.test(endpoint))
    throw Error("Run the product suite through npm run test:product-slice");
  return chromium.connect(endpoint, {
    exposeNetwork: "127.0.0.1:4187",
    timeout: 10000,
  });
}
