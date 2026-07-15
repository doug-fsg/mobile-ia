#!/usr/bin/env node
/**
 * Cross-platform build for publish / git installs.
 *
 * - Uses local next via node (avoids broken `npx next` on Windows).
 * - Skips rebuild when .next already exists (unless --force).
 * - On normal prepare: never fail the npm install (warnings only).
 * - On --force (prepublishOnly): fail hard if build fails.
 */
import { spawnSync } from "child_process";
import { existsSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildId = join(root, ".next", "BUILD_ID");
const force = process.env.FORCE_BUILD === "1" || process.argv.includes("--force");
const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");

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
        // ignore locked files on Windows
      }
    }
  }
}

function failOrWarn(message, code = 1) {
  if (force) {
    console.error(message);
    process.exit(code);
  }
  console.warn(message);
  console.warn("Continuing without production build — `clr` will use next dev.");
  process.exit(0);
}

if (!force && existsSync(buildId)) {
  process.exit(0);
}

if (!existsSync(nextCli)) {
  failOrWarn(
    "prepare: local next binary not found (dependency install may have failed on Windows). Skipping build.",
  );
}

console.log(force ? "Building package (forced)..." : "Building package (.next missing)...");
const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
  windowsHide: true,
});

if (result.status !== 0) {
  failOrWarn(`prepare: next build failed with exit ${result.status ?? 1}`, result.status ?? 1);
}

walkDeleteMaps(join(root, ".next"));
console.log("Build ready.");
