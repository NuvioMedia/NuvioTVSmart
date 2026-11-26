import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: rawPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.setTimeout(3000, () => req.destroy(new Error("HTTP request timed out")));
    req.on("error", reject);
  });
}

test("scripts/serve.mjs rejects malformed percent-encoding and dotfiles with HTTP 400", async () => {
  const port = await allocateFreePort();
  const child = spawn(process.execPath, [path.join(rootDir, "scripts", "serve.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NUVIO_DISABLE_MEDIA_RUNTIME: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        reject(new Error(`serve.mjs startup timed out. stdout=${stdout} stderr=${stderr}`));
      }, 8000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.includes("Serving Nuvio TV")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`serve.mjs exited early (${code}): ${stderr}`));
      });
    });

    const malformed = await rawGet(port, "/%E0%A4%A");
    assert.equal(malformed.statusCode, 400, "Malformed percent-encoding must return 400");

    const dotfile = await rawGet(port, "/.gitignore");
    assert.equal(dotfile.statusCode, 400, "Dotfile paths must return 400");
  } finally {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.killed) {
        child.once("exit", resolve);
        setTimeout(resolve, 1000);
      } else {
        resolve();
      }
    });
  }
});
