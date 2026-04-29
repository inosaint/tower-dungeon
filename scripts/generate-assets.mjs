#!/usr/bin/env node
/**
 * Generate image assets via the OpenAI Images API and write them to ./assets.
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/generate-assets.mjs
 *   OPENAI_API_KEY=... OPENAI_IMAGE_MODEL=gpt-image-1 node scripts/generate-assets.mjs
 *   OPENAI_API_KEY=... node scripts/generate-assets.mjs --only wall,exit
 *   OPENAI_API_KEY=... node scripts/generate-assets.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const promptsPath = path.join(repoRoot, "assets", "prompts.json");
const outDir = path.join(repoRoot, "assets", "generated");
const logsDir = path.join(outDir, "_logs");
const envPath = path.join(repoRoot, ".env");

function loadDotEnvIfPresent() {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvIfPresent();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";

const DEFAULT_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
const DEFAULT_FORMAT = process.env.OPENAI_IMAGE_FORMAT || "png";
const DEFAULT_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "high";
const DEFAULT_BACKGROUND = process.env.OPENAI_IMAGE_BACKGROUND || "transparent";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    only: null,
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--only") {
      const v = argv[i + 1];
      if (!v) throw new Error("--only requires a comma-separated list");
      args.only = new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (arg.startsWith("--only=")) {
      const v = arg.slice("--only=".length);
      args.only = new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }
  return args;
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function openAiImageGenerate({ prompt, size, output_format, background, quality }) {
  const url = `${OPENAI_BASE_URL.replace(/\/$/, "")}/v1/images/generations`;
  const body = {
    model: OPENAI_IMAGE_MODEL,
    prompt,
    size,
    background,
    output_format,
    quality,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  if (!resp.ok) {
    const maybeJson = safeJsonParse(text);
    const details = maybeJson?.error?.message ? `: ${maybeJson.error.message}` : "";
    throw new Error(`OpenAI Images API error (${resp.status})${details}`);
  }

  const json = safeJsonParse(text);
  assertOk(json && typeof json === "object", "Unexpected non-JSON response from Images API");

  const item = json.data?.[0];
  assertOk(item, "Images API returned no data");

  if (typeof item.b64_json === "string") {
    return { kind: "base64", base64: item.b64_json };
  }
  if (typeof item.url === "string") {
    return { kind: "url", url: item.url };
  }

  throw new Error("Images API response missing b64_json/url");
}

async function fetchBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image URL (${resp.status})`);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

function decodeBase64ToBytes(base64) {
  return Buffer.from(base64, "base64");
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowStamp() {
  // Safe for filenames across platforms
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function writeText(filePath, text) {
  fs.writeFileSync(filePath, String(text ?? ""));
}

function readPromptsFile() {
  assertOk(fs.existsSync(promptsPath), `Missing prompts file: ${promptsPath}`);
  const raw = fs.readFileSync(promptsPath, "utf8");
  const json = JSON.parse(raw);
  assertOk(Array.isArray(json), "assets/prompts.json must be an array");
  return json;
}

function normalizePromptEntry(entry) {
  assertOk(entry && typeof entry === "object", "Invalid prompt entry (not an object)");
  assertOk(typeof entry.id === "string" && entry.id.trim(), "Prompt entry missing id");
  assertOk(typeof entry.filename === "string" && entry.filename.trim(), "Prompt entry missing filename");
  assertOk(typeof entry.prompt === "string" && entry.prompt.trim(), "Prompt entry missing prompt");
  return {
    id: entry.id.trim(),
    filename: entry.filename.trim(),
    prompt: entry.prompt.trim(),
    size: typeof entry.size === "string" && entry.size.trim() ? entry.size.trim() : DEFAULT_SIZE,
    output_format:
      typeof entry.output_format === "string" && entry.output_format.trim()
        ? entry.output_format.trim()
        : DEFAULT_FORMAT,
    background:
      typeof entry.background === "string" && entry.background.trim()
        ? entry.background.trim()
        : DEFAULT_BACKGROUND,
    quality: typeof entry.quality === "string" && entry.quality.trim() ? entry.quality.trim() : DEFAULT_QUALITY,
  };
}

async function main() {
  const args = parseArgs(process.argv);

  assertOk(OPENAI_API_KEY && OPENAI_API_KEY.trim(), "Set OPENAI_API_KEY in your environment first.");
  assertOk(fs.existsSync(promptsPath), `Create ${promptsPath} (see assets/prompts.example.json).`);

  const entries = readPromptsFile().map(normalizePromptEntry);
  const selected = args.only ? entries.filter((e) => args.only.has(e.id)) : entries;

  assertOk(selected.length > 0, "No prompts selected (check --only ids).");

  ensureDirSync(outDir);
  ensureDirSync(logsDir);

  const runId = `${nowStamp()}_${crypto.randomBytes(3).toString("hex")}`;
  const runLogPath = path.join(logsDir, `run_${runId}.json`);
  const runTextPath = path.join(logsDir, `run_${runId}.log`);
  const runLog = {
    runId,
    startedAt: new Date().toISOString(),
    cwd: repoRoot,
    model: OPENAI_IMAGE_MODEL,
    baseUrl: OPENAI_BASE_URL,
    defaults: {
      size: DEFAULT_SIZE,
      output_format: DEFAULT_FORMAT,
      quality: DEFAULT_QUALITY,
      background: DEFAULT_BACKGROUND,
    },
    args,
    promptsFile: path.relative(repoRoot, promptsPath),
    outputDir: path.relative(repoRoot, outDir),
    items: [],
  };
  writeJson(runLogPath, runLog);
  writeText(runTextPath, `runId=${runId}\n`);

  console.log(`Model: ${OPENAI_IMAGE_MODEL}`);
  console.log(`Prompts: ${selected.length}`);
  console.log(`Output: ${outDir}`);
  console.log(`Log: ${runLogPath}`);

  for (const e of selected) {
    const outPath = path.join(outDir, e.filename);
    if (!args.force && fs.existsSync(outPath)) {
      console.log(`- skip ${e.id} (exists)`);
      runLog.items.push({
        id: e.id,
        filename: e.filename,
        status: "skipped_exists",
        outPath: path.relative(repoRoot, outPath),
      });
      writeJson(runLogPath, runLog);
      continue;
    }

    console.log(`- gen  ${e.id} -> ${path.relative(repoRoot, outPath)}`);
    if (args.dryRun) continue;

    const itemLog = {
      id: e.id,
      filename: e.filename,
      outPath: path.relative(repoRoot, outPath),
      request: {
        model: OPENAI_IMAGE_MODEL,
        prompt: e.prompt,
        size: e.size,
        output_format: e.output_format,
        background: e.background,
        quality: e.quality,
      },
      response: null,
      output: null,
      status: "started",
      startedAt: new Date().toISOString(),
    };
    runLog.items.push(itemLog);
    writeJson(runLogPath, runLog);

    try {
      const result = await openAiImageGenerate(e);
      itemLog.response =
        result.kind === "base64"
          ? { kind: "base64" }
          : { kind: "url", url: result.url };

      const bytes = result.kind === "base64" ? decodeBase64ToBytes(result.base64) : await fetchBytes(result.url);
      fs.writeFileSync(outPath, bytes);

      itemLog.output = {
        bytes: bytes.length,
        sha256: sha256Hex(bytes),
      };
      itemLog.status = "ok";
      itemLog.finishedAt = new Date().toISOString();

      // Heuristic: if the file is tiny, it's almost certainly an error image/blank.
      if (bytes.length < 10_000) {
        itemLog.warning = "Very small output file; may be blank or an error image.";
      }
    } catch (err) {
      itemLog.status = "error";
      itemLog.finishedAt = new Date().toISOString();
      itemLog.error = { message: err?.message || String(err) };

      // Also write a focused error file for quick sharing
      const errPath = path.join(logsDir, `error_${runId}_${e.id}.txt`);
      writeText(errPath, err?.stack || String(err));
      throw err;
    } finally {
      writeJson(runLogPath, runLog);
      fs.appendFileSync(runTextPath, `item ${e.id}: ${itemLog.status}\n`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
