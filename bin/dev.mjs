#!/usr/bin/env node

import { createServer } from "net";
import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { networkInterfaces } from "os";
import { randomInt } from "crypto";
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const startPort = parseInt(process.env.PORT || "3100", 10);
const MAX_ATTEMPTS = 20;

const WORDS = [
  "alpha","amber","apple","atlas","azure","birch","blaze","bloom","brave","brook",
  "cedar","charm","chess","climb","cloud","coral","crane","crisp","crown","dance",
  "delta","dream","drift","eagle","ember","fable","flame","flint","frost","gleam",
  "globe","grace","grove","haven","hazel","honey","ivory","jewel","karma","latch",
  "lemon","light","lotus","maple","marsh","melon","mirth","noble","north","oasis",
  "ocean","olive","orbit","pearl","petal","pilot","plume","prism","quail","quest",
  "raven","ridge","rover","royal","ruby","sage","shore","silk","slate","solar",
  "spark","spire","stone","storm","swift","thorn","tiger","torch","trail","trend",
  "trick","trout","tulip","ultra","umbra","unity","upper","urban","vault","verse",
  "vigor","vinyl","viola","viper","vivid","wagon","watch","wheat","whirl","width",
  "wired","yacht","zebra","zephyr",
];

function generateToken() {
  return `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}`;
}

function isPortAvailable(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once("error", () => res(false));
    srv.listen(port, "0.0.0.0", () => srv.close(() => res(true)));
  });
}

async function findPort(start) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const p = start + i;
    if (p > 65535) break;
    if (await isPortAvailable(p)) return p;
  }
  return null;
}

const port = await findPort(startPort);
if (!port) {
  console.error(`No available port found starting from ${startPort}`);
  process.exit(1);
}
if (port !== startPort) {
  console.log(`Port ${startPort} in use, using ${port}`);
}

const authToken = process.env.AUTH_TOKEN || "123";

// Make Cursor agent CLI findable even if the terminal PATH is stale (common on Windows).
if (process.platform === "win32" && process.env.LOCALAPPDATA) {
  const agentDir = resolve(process.env.LOCALAPPDATA, "cursor-agent");
  if (!process.env.PATH?.includes(agentDir)) {
    process.env.PATH = `${agentDir};${process.env.PATH || ""}`;
  }
}

const isStart = process.argv.includes("--start");
// Spawn Next via node + CLI entry (avoids Windows shell breaking on spaces in path)
const nextCli = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const args = isStart
  ? [nextCli, "start", "--hostname", "0.0.0.0", "--port", String(port)]
  : [nextCli, "dev", "--hostname", "0.0.0.0", "--port", String(port)];

const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((a) => a?.family === "IPv4" && !a.internal)?.address;

const localUrl = `http://localhost:${port}`;
const networkUrl = lanIp ? `http://${lanIp}:${port}` : null;
const authUrl = `${networkUrl || localUrl}?token=${authToken}`;

console.log(`\n  \x1b[2mLocal:\x1b[0m   ${localUrl}?token=${authToken}`);
if (networkUrl) {
  console.log(`  \x1b[2mNetwork:\x1b[0m ${authUrl}`);
}
console.log(`  \x1b[2mToken:\x1b[0m   ${authToken}\n`);

if (networkUrl) {
  console.log("  \x1b[2mScan to connect from your phone:\x1b[0m\n");
  qrcode.generate(authUrl, { small: true }, (code) => {
    console.log(code.split("\n").map((l) => "    " + l).join("\n") + "\n");
  });
}

const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, PORT: String(port), AUTH_TOKEN: authToken },
});

child.on("close", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
