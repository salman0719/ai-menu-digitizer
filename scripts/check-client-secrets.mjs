#!/usr/bin/env node
/**
 * Fail the build if a server-side secret reached a client bundle.
 *
 * Phase 1 verified this by hand; Step 11 adds auth and DB code, so it is now
 * a check that runs after `next build`. It never prints a secret — only the
 * env var name and the file that contains it.
 *
 * Usage: npm run secrets:check        (after npm run build)
 *        npm run secrets:check -- --all   (also scan .next/server)
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const STATIC_DIR = path.join(ROOT, ".next", "static");
const SERVER_DIR = path.join(ROOT, ".next", "server");
const ENV_FILES = [".env.local", ".env.production.local", ".env"];

const SECRET_KEY = /(_KEY|_SECRET|_TOKEN|DATABASE_URL|PASSWORD|CONNECTION_STRING)/i;
const PUBLIC_SECRET_NAME = /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|DATABASE)/i;
/** Values that are clearly documentation, not credentials. */
const PLACEHOLDER = /^(your[-_]|changeme|placeholder|example|test[-_]|xxx)/i;

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css", ".json", ".html", ".map"]);

function parseEnvFile(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.push([match[1], value]);
  }
  return entries;
}

/** Secret-looking values we must never find in a client bundle. */
async function collectSecrets() {
  const secrets = new Map(); // value -> env var name
  const add = (name, value) => {
    if (!name || typeof value !== "string") return;
    if (name.startsWith("NEXT_PUBLIC_")) return;
    if (!SECRET_KEY.test(name)) return;
    const trimmed = value.trim();
    if (trimmed.length < 8) return;
    if (PLACEHOLDER.test(trimmed)) return;
    secrets.set(trimmed, name);
  };

  for (const file of ENV_FILES) {
    const full = path.join(ROOT, file);
    if (!existsSync(full)) continue;
    for (const [name, value] of parseEnvFile(await readFile(full, "utf8"))) add(name, value);
  }
  // CI/deploy environments often inject values instead of shipping a file.
  for (const [name, value] of Object.entries(process.env)) add(name, value);

  return secrets;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

async function scanDir(dir, secrets) {
  let scanned = 0;
  const findings = [];
  for await (const file of walk(dir)) {
    scanned += 1;
    const text = await readFile(file, "utf8");
    const relative = path.relative(ROOT, file);
    for (const [value, name] of secrets) {
      if (text.includes(value)) findings.push({ name, file: relative });
    }
    const publicMatch = PUBLIC_SECRET_NAME.exec(text);
    if (publicMatch) findings.push({ name: publicMatch[0], file: relative });
  }
  return { scanned, findings };
}

async function main() {
  if (!existsSync(STATIC_DIR)) {
    console.error("No client bundle found. Run `npm run build` first.");
    process.exit(2);
  }

  const secrets = await collectSecrets();
  const targets = [STATIC_DIR];
  if (process.argv.includes("--all")) targets.push(SERVER_DIR);

  let scanned = 0;
  const findings = [];
  for (const dir of targets) {
    const result = await scanDir(dir, secrets);
    scanned += result.scanned;
    findings.push(...result.findings);
  }

  if (findings.length > 0) {
    console.error(`Secret leak: ${findings.length} finding(s) in client output.`);
    for (const finding of findings) {
      console.error(`  env ${finding.name} -> ${finding.file}`);
    }
    process.exit(1);
  }

  console.log(
    `Checked ${scanned} build file(s) for ${secrets.size} configured secret value(s): none found.`
  );
}

await main();
