#!/usr/bin/env node
// Offline smoke test: checks Firebase configuration PRESENCE only. Never prints values, never calls the network.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const results = [];
const check = (name, ok, hint = "") => results.push({ name, ok, hint });

function envKeys(file) {
  const p = resolve(root, file);
  if (!existsSync(p)) return null;
  const present = new Set();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim().replace(/^["']|["']$/g, "").length > 0) present.add(m[1]);
  }
  return present;
}

const local = envKeys(".env.local");
const example = envKeys(".env.example");
check(".env.local exists (optional; code ships public defaults)", local !== null, "cp .env.example .env.local");
const has = (k) => Boolean(local?.has(k));

const siteKey = has("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY");
const debug = has("VITE_FIREBASE_APPCHECK_DEBUG_TOKEN");
check("App Check provider configured (reCAPTCHA Enterprise site key OR localhost debug token)", siteKey || debug,
  "set VITE_RECAPTCHA_ENTERPRISE_SITE_KEY for production; debug token only for localhost");
check("reCAPTCHA Enterprise site key set (required for the hosted build)", siteKey, "see docs/firebase-setup.md step 3");

try {
  const out = execFileSync("git", ["check-ignore", ".env.local"], { cwd: root, encoding: "utf8" }).trim();
  check(".env.local is git-ignored", out === ".env.local");
} catch {
  check(".env.local is git-ignored", false, "add .env.local to .gitignore");
}
try {
  const tracked = execFileSync("git", ["ls-files", ".env.local", ".env"], { cwd: root, encoding: "utf8" }).trim();
  check("no .env file is tracked by git", tracked === "");
} catch {
  check("no .env file is tracked by git", false, "git unavailable");
}
check(".env.example has no filled-in debug token", !example?.has("VITE_FIREBASE_APPCHECK_DEBUG_TOKEN"));

try {
  const tpl = JSON.parse(readFileSync(resolve(root, "remoteconfig.template.json"), "utf8"));
  const keys = Object.keys(tpl.parameters ?? {}).sort().join(",");
  check("remoteconfig.template.json has exactly the guarded keys", keys === "cloud_model_name,max_cloud_output_tokens,playbook_id", keys);
} catch {
  check("remoteconfig.template.json valid", false);
}
try {
  const fb = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8"));
  check("firebase.json: hosting public=dist", fb.hosting?.public === "dist");
  check("firebase.json: remoteconfig template wired", fb.remoteconfig?.template === "remoteconfig.template.json");
} catch {
  check("firebase.json valid", false);
}
check("dist/ built (needed for firebase deploy --only hosting)", existsSync(resolve(root, "dist/index.html")), "npm run build");

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.hint ? `  -> ${r.hint}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed. (Offline: console-side state such as App Check enforcement cannot be verified here.)`);
process.exit(failed ? 1 : 0);
