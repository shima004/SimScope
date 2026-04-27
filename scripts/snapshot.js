#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/snapshot.js <log-file> --step <spec> [options]
 *
 * Step spec examples:
 *   --step 50               単一ステップ
 *   --step 50,100,150       カンマ区切り
 *   --step 50-150           範囲（全ステップ）
 *   --step 50-150:10        範囲（10ステップごと）
 *
 * Options:
 *   --step,   -s  <spec>    キャプチャするステップ（必須）
 *   --output, -o  <path>    出力パス。複数ステップ時は {step} を使用
 *                           例: frame_{step}.png  (default: screenshot_{step}.png)
 *   --width       <px>      ビューポート幅  (default: 1920)
 *   --height      <px>      ビューポート高さ (default: 1080)
 *   --port        <n>       アプリサーバーポート (default: 3000)
 *   --no-ui                 UIパネルを非表示（マップのみ）
 *
 * アプリは事前にビルド済みである必要があります（npm run build）。
 * --port のサーバーが未起動の場合、自動起動します。
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    step:    { type: "string",  short: "s" },
    output:  { type: "string",  short: "o" },
    width:   { type: "string",  default: "1920" },
    height:  { type: "string",  default: "1080" },
    port:    { type: "string",  default: "3000" },
    "no-ui": { type: "boolean", default: false },
  },
});

// ── Step spec parser ───────────────────────────────────────────────────────
// 終端省略 (例: "0-:10") は open-ended とみなす
function parseSteps(spec) {
  const allSteps = new Set();
  let openEnded = false;

  for (const part of spec.split(",")) {
    const rangeMatch = part.match(/^(\d+)-(\d*)(?::(\d+))?$/);
    if (rangeMatch) {
      const from  = parseInt(rangeMatch[1], 10);
      const toStr = rangeMatch[2];
      const inc   = parseInt(rangeMatch[3] ?? "1", 10);
      const to    = toStr ? parseInt(toStr, 10) : 99999;
      if (!toStr) openEnded = true;
      for (let s = from; s <= to; s += inc) allSteps.add(s);
    } else {
      const n = parseInt(part.trim(), 10);
      if (!isNaN(n)) allSteps.add(n);
    }
  }

  const sorted = [...allSteps].sort((a, b) => a - b);
  return { sorted, openEnded };
}

// ── Validation ─────────────────────────────────────────────────────────────
const logFile = positionals[0];
if (!logFile) {
  console.error("Usage: node scripts/snapshot.js <log-file> --step <spec> [--output <path>]");
  process.exit(1);
}
if (!values.step) {
  console.error("--step is required");
  process.exit(1);
}

const { sorted: rawSteps, openEnded } = parseSteps(values.step);
if (rawSteps.length === 0) {
  console.error("No valid steps parsed from --step");
  process.exit(1);
}

const logPath = resolve(logFile);
if (!existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

// 出力パステンプレート（実際の steps は後で確定）
const multiStep = rawSteps.length > 1 || openEnded;
const outputTemplate = values.output ?? (multiStep ? "screenshot_{step}.png" : "screenshot.png");
function outputPath(step) {
  const pad = String(step).padStart(4, "0");
  return outputTemplate.replace(/\{step\}/g, pad);
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

// ── Browser ────────────────────────────────────────────────────────────────
const w = parseInt(values.width, 10);
const h = parseInt(values.height, 10);

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    `--window-size=${w},${h}`,
  ],
});
const page = await browser.newPage();
await page.setViewportSize({ width: w, height: h });

// 初回ロード（最初のステップでページを開く）
const qs = new URLSearchParams({
  autoload: fileUrl,
  step: String(rawSteps[0]),
  ...(values["no-ui"] ? { screenshot: "true" } : {}),
});
console.log(`Loading ${logPath}…`);
await page.goto(`http://127.0.0.1:${appPort}/?${qs}`);
await page.waitForSelector('.app[data-loaded="true"]', { timeout: 120_000 });
await page.waitForTimeout(1000);

// actualMax を取得してステップリストを確定
const actualMax = await page.evaluate(() => window.__simscope_maxStep());
let steps = rawSteps.filter((s) => s <= actualMax);
// 範囲がactualMaxを超えていた場合、末尾に actualMax を追加
if ((openEnded || rawSteps.at(-1) > actualMax) && !steps.includes(actualMax)) {
  steps.push(actualMax);
}
console.log(`Max step: ${actualMax} / Capturing ${steps.length} step(s)`);

// ── Capture each step ──────────────────────────────────────────────────────
for (const step of steps) {
  // 2ステップ目以降は seekTo で移動
  if (step !== rawSteps[0]) {
    await page.evaluate((s) => window.__simscope_seekTo(s), step);
    await page.waitForTimeout(500);
  }

  const out = outputPath(step);
  // 出力先ディレクトリを作成
  const dir = dirname(resolve(out));
  mkdirSync(dir, { recursive: true });

  await page.screenshot({ path: out });
  console.log(`Saved: ${out}  (step ${step})`);
}

await browser.close();
fileServer.close();
if (appProc) appProc.kill();
