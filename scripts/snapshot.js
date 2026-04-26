#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/snapshot.js <log-file> --step <n> [options]
 *
 * Options:
 *   --step,   -s  <n>          Step number to capture (required)
 *   --output, -o  <path>       Output image path (default: screenshot.png)
 *   --width       <px>         Viewport width  (default: 1920)
 *   --height      <px>         Viewport height (default: 1080)
 *   --port        <n>          App server port (default: 3000)
 *   --no-ui                    Hide all UI panels (map only)
 *
 * The app must be built (`npm run build`) before running this script.
 * If no server is running on --port, this script starts one automatically.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    step:     { type: "string",  short: "s" },
    output:   { type: "string",  short: "o", default: "screenshot.png" },
    width:    { type: "string",  default: "1920" },
    height:   { type: "string",  default: "1080" },
    port:     { type: "string",  default: "3000" },
    "no-ui":  { type: "boolean", default: false },
  },
});

const logFile = positionals[0];
if (!logFile) {
  console.error("Usage: node scripts/snapshot.js <log-file> --step <n> [--output <path>]");
  process.exit(1);
}
if (!values.step) {
  console.error("--step is required");
  process.exit(1);
}

const logPath = resolve(logFile);
if (!existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

// ── Local file server ──────────────────────────────────────────────────────
const logData = readFileSync(logPath);
const fileServer = createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(logData.length),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(logData);
});
await new Promise((r) => fileServer.listen(0, "127.0.0.1", r));
const filePort = fileServer.address().port;
const fileUrl = `http://127.0.0.1:${filePort}/log`;

// ── App server ─────────────────────────────────────────────────────────────
const appPort = parseInt(values.port, 10);

async function isServerUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    return res.status < 500;
  } catch {
    return false;
  }
}

let appProc = null;
if (!(await isServerUp(appPort))) {
  const buildDir = resolve(ROOT, "build");
  if (!existsSync(buildDir)) {
    console.error("App is not built. Run: npm run build");
    fileServer.close();
    process.exit(1);
  }
  console.log(`Starting app server on port ${appPort}…`);
  appProc = spawn("node", [resolve(ROOT, "server.js")], {
    env: { ...process.env, PORT: String(appPort), PUBLIC_DIRECT_FETCH: "true" },
    stdio: "pipe",
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerUp(appPort)) break;
  }
  if (!(await isServerUp(appPort))) {
    console.error("Failed to start app server");
    appProc.kill();
    fileServer.close();
    process.exit(1);
  }
}

// ── Screenshot ─────────────────────────────────────────────────────────────
const qs = new URLSearchParams({
  autoload: fileUrl,
  step: values.step,
  ...(values["no-ui"] ? { screenshot: "true" } : {}),
});
const appUrl = `http://127.0.0.1:${appPort}/?${qs}`;

const w = parseInt(values.width, 10);
const h = parseInt(values.height, 10);

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=swiftshader",      // headless 環境でも WebGL を有効化
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    `--window-size=${w},${h}`,
  ],
});
const page = await browser.newPage();
await page.setViewportSize({ width: w, height: h });

console.log(`Loading ${logPath} at step ${values.step}…`);
await page.goto(appUrl);
await page.waitForSelector('.app[data-loaded="true"]', { timeout: 120_000 });
// deck.gl が WebGL フレームを描画しきるまで待機
await page.waitForTimeout(1000);

await page.screenshot({ path: values.output });
console.log(`Saved: ${values.output}`);

await browser.close();
fileServer.close();
if (appProc) appProc.kill();
