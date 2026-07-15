#!/usr/bin/env node

import { spawn, execFileSync } from "child_process";
import { resolve, dirname, join, sep } from "path";
import { fileURLToPath } from "url";
import { networkInterfaces, homedir } from "os";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { randomInt } from "crypto";
import { createServer } from "net";
import http from "http";
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Make Cursor agent CLI findable even if the terminal PATH is stale (common on Windows).
if (process.platform === "win32" && process.env.LOCALAPPDATA) {
  const agentDir = resolve(process.env.LOCALAPPDATA, "cursor-agent");
  if (!process.env.PATH?.toLowerCase().includes(agentDir.toLowerCase())) {
    process.env.PATH = `${agentDir};${process.env.PATH || ""}`;
  }
}

const WORDS = [
  "alpha","amber","anvil","apple","arrow","atlas","azure","badge","baker","beach",
  "berry","blade","blaze","bloom","board","bonus","brave","brick","brook","brush",
  "cabin","cable","camel","candy","cedar","chain","chalk","charm","chase","chief",
  "cider","clamp","cliff","climb","clock","cloud","cobra","coral","crane","creek",
  "crest","cross","crown","crush","curve","delta","depth","diary","disco","dodge",
  "dozen","draft","dream","drift","drive","eagle","ember","equal","extra","fable",
  "fancy","feast","fiber","field","flame","flask","flint","flora","forge","frost",
  "fruit","gamma","ghost","giant","glade","gleam","globe","grace","grain","grape",
  "grasp","green","grove","guard","guide","haven","heart","hedge","honey","hover",
  "ivory","jewel","jolly","karma","kiosk","knack","label","lance","latch","lemon",
  "level","light","lilac","linen","logic","lotus","lunar","major","mango","maple",
  "marsh","match","medal","melon","might","minor","mixer","mocha","morse","mount",
  "noble","north","novel","ocean","olive","onion","orbit","omega","otter","oxide",
  "panel","patch","peach","pearl","pedal","penny","pilot","pixel","plant","plaza",
  "plume","plush","polar","pound","power","prism","proxy","pulse","quake","queen",
  "quest","quota","radar","raven","relay","ridge","river","robin","rodeo","royal",
  "ruler","salad","scale","scout","shade","shark","shell","shine","sigma","silk",
  "slate","slope","smoke","solar","sonic","south","spark","spice","spray","squad",
  "stack","stamp","steel","stern","stone","storm","sugar","surge","swift","tango",
  "tempo","theta","thorn","tiger","toast","topaz","torch","tower","trace","trail",
  "trend","trick","trout","tulip","ultra","umbra","unity","upper","urban","vault",
  "verse","vigor","vinyl","viola","viper","vivid","wagon","watch","wheat","whirl",
  "width","wired","yacht","zebra","zephyr",
];

function generateToken() {
  const a = WORDS[randomInt(WORDS.length)];
  const b = WORDS[randomInt(WORDS.length)];
  return `${a}-${b}`;
}

const MAX_STATUS_SCAN = 20;

function probeClr(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/info`, { timeout: 800 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({ port, workspace: data.workspace || "unknown", url: `http://127.0.0.1:${port}` });
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function projectKeyToWorkspace(key) {
  const parts = key.split("-");
  if (parts.length === 0 || !parts[0]) return null;

  let path;
  let i;

  if (/^[A-Za-z]$/.test(parts[0])) {
    path = parts[0].toUpperCase() + ":";
    i = 1;
  } else {
    path = sep + parts[0];
    i = 1;
  }

  while (i < parts.length) {
    let matched = false;
    for (let j = i; j < parts.length; j++) {
      const slice = parts.slice(i, j + 1);
      const names = [...new Set([slice.join("-"), slice.join(" ")])];
      for (const name of names) {
        const candidate = path.endsWith(":") ? path + sep + name : join(path, name);
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          path = candidate;
          i = j + 1;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return null;
  }
  return existsSync(path) ? path : null;
}

function discoverProjects() {
  const cursorDir = join(homedir(), ".cursor", "projects");
  const projects = [];
  try {
    const entries = readdirSync(cursorDir);
    for (const entry of entries) {
      if (!/^[A-Za-z]/.test(entry)) continue;
      if (/^\d+$/.test(entry)) continue;
      const transcripts = join(cursorDir, entry, "agent-transcripts");
      if (!existsSync(transcripts)) continue;
      const ws = projectKeyToWorkspace(entry);
      if (!ws) continue;
      const name = ws.split(sep).pop() || ws;
      projects.push({ name, path: ws });
    }
  } catch {
    // cursor projects dir doesn't exist
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-V")) {
  const pkg = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

if (args.includes("--status")) {
  const portStart = parseInt(process.env.PORT || "3100", 10);
  const portEnd = portStart + MAX_STATUS_SCAN;
  console.log(`\n  Checking ports ${portStart}-${portEnd - 1} for running CLR instances...\n`);
  let found = 0;
  const checks = [];
  for (let p = portStart; p < portEnd; p++) {
    checks.push(probeClr(p));
  }
  const results = await Promise.all(checks);
  for (const r of results) {
    if (!r) continue;
    found++;
    console.log(`  \x1b[32m●\x1b[0m  Port ${r.port}  \x1b[2m→\x1b[0m  ${r.workspace}`);
    console.log(`     \x1b[2m${r.url}\x1b[0m`);
  }
  if (found === 0) {
    console.log("  \x1b[2mNo running CLR instances found\x1b[0m");
  }
  console.log("");
  process.exit(0);
}

if (args.includes("--list") || args.includes("-l")) {
  const projects = discoverProjects();
  if (projects.length === 0) {
    console.log("\n  \x1b[2mNo Cursor projects found\x1b[0m\n");
  } else {
    console.log(`\n  Found ${projects.length} project${projects.length === 1 ? "" : "s"}:\n`);
    for (const p of projects) {
      console.log(`  \x1b[2m•\x1b[0m  ${p.name}  \x1b[2m→\x1b[0m  ${p.path}`);
    }
    console.log("");
  }
  process.exit(0);
}

if (args.includes("--update") || args.includes("-u")) {
  const pkg = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const updateSpec = pkg.clrUpdate || "cursor-local-remote@latest";
  console.log(`  Updating ${updateSpec}...\n`);
  try {
    execFileSync("npm", ["install", "-g", updateSpec], { stdio: "inherit", shell: true });
    console.log("\n  \x1b[32m✓ Updated successfully\x1b[0m");
  } catch {
    console.error("\n  \x1b[31m✗ Update failed\x1b[0m");
    process.exit(1);
  }
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  Cursor Local Remote - Control Cursor IDE from any device on your network

  Usage:
    clr [workspace] [options]

  Arguments:
    workspace    Path to your project folder (defaults to current directory)

  Options:
    -p, --port     Port to run on (default: 3100)
    -t, --token    Auth token (default: 123, or AUTH_TOKEN env)
    --host         Bind to specific host/IP (default: 0.0.0.0)
    --no-open      Don't auto-open the browser
    --no-qr        Don't show QR code in terminal
    --no-trust     Disable workspace trust (agent will ask before actions)
    -v, --verbose  Show all server and agent output

  Commands:
    -l, --list     List discovered Cursor projects
    --status       Check if CLR is already running
    -u, --update   Update to the latest version
    -V, --version  Show version number
    -h, --help     Show this help

  Examples:
    clr                          # Start in current folder
    clr ~/projects/my-app        # Start for a specific project
    clr . --port 8080            # Use a different port
    clr --token my-secret        # Use a fixed auth token
    clr --host 127.0.0.1         # Bind to localhost only
    clr --no-trust               # Require agent to ask before actions
    clr --status                 # Check for running instances
    clr --list                   # Show all known projects
`);
  process.exit(0);
}

const positional = [];
let rawPort = process.env.PORT || "3100";
let noOpen = false;
let noQr = false;
let verbose = false;
let trust = process.env.CURSOR_TRUST !== "0";
let customToken = null;
let hostname = "0.0.0.0";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port" || a === "-p") {
    rawPort = args[++i] || rawPort;
  } else if (a === "--token" || a === "-t") {
    customToken = args[++i] || null;
  } else if (a === "--host") {
    hostname = args[++i] || hostname;
  } else if (a === "--no-open") {
    noOpen = true;
  } else if (a === "--no-qr") {
    noQr = true;
  } else if (a === "--verbose" || a === "-v") {
    verbose = true;
  } else if (a === "--trust") {
    trust = true;
  } else if (a === "--no-trust") {
    trust = false;
  } else if (!a.startsWith("-")) {
    positional.push(a);
  }
}

const portNum = parseInt(rawPort, 10);
if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
  console.error(`  Error: invalid port: ${rawPort}`);
  process.exit(1);
}
const workspace = positional[0] ? resolve(positional[0]) : process.cwd();

if (!existsSync(workspace)) {
  console.error(`  Error: workspace path does not exist: ${workspace}`);
  process.exit(1);
}

const MAX_PORT_ATTEMPTS = 20;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, hostname, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort) {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const candidate = startPort + i;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate)) return candidate;
  }
  return null;
}

function getLanIp() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

const availablePort = await findAvailablePort(portNum);
if (availablePort === null) {
  console.error(`  Error: no available port found starting from ${portNum}`);
  process.exit(1);
}
if (availablePort !== portNum) {
  console.log(`  \x1b[33mPort ${portNum} in use, using ${availablePort}\x1b[0m`);
}
const port = String(availablePort);

const lanIp = getLanIp();
const isLocalOnly = hostname === "127.0.0.1" || hostname === "localhost";
const localUrl = `http://localhost:${port}`;
const networkUrl = !isLocalOnly && lanIp ? `http://${lanIp}:${port}` : null;

const authToken = customToken || process.env.AUTH_TOKEN || "123";

const authUrl = `${localUrl}?token=${authToken}`;

console.log("");
console.log("\x1b[97m ██████╗██╗     ██████╗ ");
console.log("██╔════╝██║     ██╔══██╗");
console.log("██║     ██║     ██████╔╝");
console.log("██║     ██║     ██╔══██╗");
console.log("╚██████╗███████╗██║  ██║");
console.log(" ╚═════╝╚══════╝╚═╝  ╚═╝\x1b[0m");
console.log(`  \x1b[2mWorkspace:\x1b[0m   ${workspace}`);
console.log(`  \x1b[2mLocal:\x1b[0m       ${localUrl}`);
if (networkUrl) {
  console.log(`  \x1b[2mNetwork:\x1b[0m     \x1b[97m${networkUrl}\x1b[0m`);
}
console.log(`  \x1b[2mAuth token:\x1b[0m  \x1b[97m${authToken}\x1b[0m`);
console.log(`  \x1b[2mAuth link:\x1b[0m   \x1b[4m\x1b[97m${authUrl}\x1b[0m`);
if (verbose) {
  console.log(`  \x1b[2mVerbose:\x1b[0m     \x1b[33mon\x1b[0m`);
}
console.log("");

const qrUrl = networkUrl ? `${networkUrl}?token=${authToken}` : null;

if (!noQr && qrUrl) {
  console.log("  \x1b[2mScan to connect from your phone:\x1b[0m");
  console.log("");
  qrcode.generate(qrUrl, { small: true }, (code) => {
    const indented = code.split("\n").map((l) => "    " + l).join("\n");
    console.log(indented);
    console.log("");
    console.log("  \x1b[2mPress Ctrl+C to stop\x1b[0m");
    console.log("");
  });
}

function openBrowser() {
  if (noOpen) return;
  try {
    const openCmd = process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
    execFileSync(openCmd, [`${localUrl}?token=${authToken}`], { stdio: "ignore" });
  } catch {
    // silently fail if browser can't open
  }
}

// Spawn Next via node + CLI entry (avoids Windows shell breaking on spaces in path)
const nextCli = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const isBuilt = existsSync(resolve(projectRoot, ".next", "BUILD_ID"));

const nextArgs = isBuilt
  ? [nextCli, "start", "--hostname", hostname, "--port", port]
  : [nextCli, "dev", "--hostname", hostname, "--port", port];

const child = spawn(process.execPath, nextArgs, {
  cwd: projectRoot,
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    CURSOR_WORKSPACE: workspace,
    CURSOR_TRUST: trust ? "1" : "",
    PORT: port,
    AUTH_TOKEN: authToken,
    CLR_VERBOSE: verbose ? "1" : "",
  },
});

let ready = false;
child.stdout.on("data", (data) => {
  const text = data.toString();
  if (verbose) {
    process.stdout.write("  \x1b[2m[next]\x1b[0m " + text);
  }
  if (!ready && (text.includes("Ready") || text.includes("ready"))) {
    console.log("  \x1b[32m✓ Ready\x1b[0m");
    ready = true;
    openBrowser();
  }
});

child.stderr.on("data", (data) => {
  const text = data.toString().trim();
  if (!text) return;
  if (verbose) {
    process.stderr.write("  \x1b[2m[server]\x1b[0m " + text + "\n");
  } else if (text.includes("Error") || text.includes("error")) {
    process.stderr.write("  " + text + "\n");
  }
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});

let exiting = false;

function shutdown(signal) {
  if (exiting) {
    process.exit(1);
  }
  exiting = true;
  child.kill(signal);
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", () => shutdown("SIGTERM"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
