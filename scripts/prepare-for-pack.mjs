#!/usr/bin/env node
/**
 * Cross-platform build step for publish / git installs.
 * Skips rebuild when .next is already present (fast local npm install).
 * Set FORCE_BUILD=1 to always rebuild (used by prepublishOnly).
 */
import { spawnSync } from "child_process";
import { existsSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildId = join(root, ".next", "BUILD_ID");
const force = process.env.FORCE_BUILD === "1" || process.argv.includes("--force");

function walkDeleteMaps(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkDeleteMaps(full);
    else if (name.endsWith(".map")) {
      try {
        unlinkSync(full);
      } catch {
        // ignore
      }
    }
  }
}

if (!force && existsSync(buildId)) {
  process.exit(0);
}

console.log(force ? "Building package (forced)..." : "Building package (.next missing)...");
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build"],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

walkDeleteMaps(join(root, ".next"));
console.log("Build ready.");
