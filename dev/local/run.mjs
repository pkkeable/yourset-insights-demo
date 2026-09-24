// Disposable product tests only. macOS ARM is the sole supported platform.
import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startBrowser } from "./browser.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const suite = process.argv[2] ?? "slice";
if (!["slice", "auth"].includes(suite))
  throw Error("Unknown local verification suite");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("Unsupported platform");
const docker = realpathSync(
  "/Applications/Docker.app/Contents/Resources/bin/docker",
);
const cli = path.join(root, "node_modules/.bin/supabase"),
  cwd = path.join(root, "dev/local");
const env = {
  ...process.env,
  SUPABASE_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  DOCKER_HOST:
    process.env.DOCKER_HOST ??
    `unix://${process.env.HOME}/.docker/run/docker.sock`,
  YOURSET_SPIKE_DOCKER_BIN: docker,
  PATH:
    path.join(root, "spikes/auth-transaction/runtime-bin") +
    path.delimiter +
    process.env.PATH,
};
const call = (bin, args) =>
  execFileSync(bin, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
  });
const network = "yourset-product-slice-local";
let owned = false,
  browserService;
try {
  if (call(cli, ["--version"]).toString().trim() !== "2.117.0")
    throw Error("CLI pin mismatch");
  if (
    call(docker, [
      "ps",
      "-a",
      "--filter",
      "name=_yourset-insights",
      "--format",
      "{{.Names}}",
    ])
      .toString()
      .trim()
  )
    throw Error("Existing product containers; refusing reuse");
  if (
    call(docker, [
      "volume",
      "ls",
      "--filter",
      "name=_yourset-insights",
      "--format",
      "{{.Name}}",
    ])
      .toString()
      .trim()
  )
    throw Error("Existing product volumes; refusing reuse");
  call(docker, [
    "network",
    "create",
    "-o",
    "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    network,
  ]);
  owned = true;
  if (env.YOURSET_EXTERNAL_BROWSER !== "1") {
    browserService = await startBrowser(call, docker, root, network);
    env.YOURSET_BROWSER_ENDPOINT = browserService.endpoint;
  }
  env.SUPABASE_NETWORK_ID = network;
  call(cli, [
    "--network-id",
    network,
    "start",
    "-x",
    "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  const names = call(docker, [
    "ps",
    "--filter",
    "name=_yourset-insights",
    "--format",
    "{{.Names}}",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!names.length) throw Error("No local containers");
  for (const name of names) {
    const c = JSON.parse(call(docker, ["inspect", name]))[0];
    for (const bs of Object.values(c.NetworkSettings.Ports ?? {}))
      for (const b of bs ?? [])
        if (b.HostIp !== "127.0.0.1") throw Error("non_loopback_port");
  }
  console.log("PASS actual product-service Docker bindings: loopback only");
  const child = spawn(process.execPath, [`tests/product-slice/${suite}.mjs`], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  process.exitCode = await new Promise((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} catch (e) {
  console.error(
    "Local product run blocked:",
    e.message?.includes("Command failed")
      ? "service command failed (details suppressed)"
      : e.message,
  );
  process.exitCode = 1;
} finally {
  if (owned) {
    let failed = false;
    for (const dispose of [
      () => browserService?.stop(),
      () => call(cli, ["stop", "--no-backup"]),
      () => call(docker, ["network", "rm", network]),
    ]) {
      try {
        dispose();
      } catch {
        failed = true;
      }
    }
    try {
      const leftovers =
        call(docker, [
          "ps",
          "-a",
          "--filter",
          "name=_yourset-insights",
          "--format",
          "{{.Names}}",
        ])
          .toString()
          .trim() +
        call(docker, [
          "volume",
          "ls",
          "--filter",
          "name=_yourset-insights",
          "--format",
          "{{.Name}}",
        ])
          .toString()
          .trim();
      if (leftovers) failed = true;
    } catch {
      failed = true;
    }
    if (failed) {
      console.error("Product cleanup incomplete");
      process.exitCode = 1;
    } else
      console.log(
        "PASS cleanup: disposable product containers, volumes and network removed",
      );
  }
}
