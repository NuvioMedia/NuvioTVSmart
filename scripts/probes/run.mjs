// Runs the mobile-web probe suite against a fresh build:
//   npm run test:mobile-web
// Starts scripts/serve.mjs on PORT (default 4173), waits for it, runs
// regression.mjs and pwa-check.mjs, then shuts the server down. Exit code is
// the worst probe exit code.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.PORT || 4173);
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", () => {});
server.stderr.on("data", (d) => process.stderr.write(d));

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + "/", { method: "GET" });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "scripts", "probes", name)], {
      env: { ...process.env, BASE_URL: baseUrl },
      stdio: "inherit"
    });
    child.on("exit", (code) => resolve(code || 0));
  });
}

let worst = 0;
try {
  if (!(await waitForServer())) {
    console.error("probe runner: server did not come up on " + baseUrl);
    process.exitCode = 2;
  } else {
    worst = Math.max(worst, await run("regression.mjs"));
    worst = Math.max(worst, await run("pwa-check.mjs"));
    process.exitCode = worst;
  }
} finally {
  server.kill("SIGTERM");
}
