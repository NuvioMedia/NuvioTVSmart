import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRuntimeEnvScript, readEnvProperties } from "./envProperties.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const mediaRuntimePath = path.join(rootDir, "services", "webos", "runtime", "media-http.cjs");
const mediaServerPorts = [2710, 2711, 2712, 2713, 2714];
const mediaProbeTimeoutMs = 1200;
let mediaRuntimeProcess = null;
let cachedMediaServerPort = mediaServerPorts[0];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
};

function getContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return Array.from(new Set(urls)).sort();
}

function resolveRequestPath(urlPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPathname || "/"));
  } catch (_) {
    return null;
  }
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) {
    return null;
  }
  const resolved = path.resolve(rootDir, normalized.replace(/^[\\/]+/, ""));
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    return null;
  }
  return resolved;
}

function resolveDistPathForRootFile(rootFilePath) {
  const relativePath = path.relative(rootDir, rootFilePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.join(distDir, relativePath);
}

async function resolveRequestFile(pathname) {
  const rootPath = resolveRequestPath(pathname);
  if (!rootPath) {
    return { invalid: true, filePath: "", fileStat: null };
  }
  const rootStat = await stat(rootPath).catch(() => null);
  const distPath = resolveDistPathForRootFile(rootPath);
  const distStat = distPath ? await stat(distPath).catch(() => null) : null;
  if (distStat?.isFile()) {
    return { filePath: distPath, fileStat: distStat };
  }

  return { filePath: rootPath, fileStat: rootStat };
}

function requestLocalMediaPath(
  portNumber,
  requestPath,
  { method = "GET", timeoutMs = mediaProbeTimeoutMs } = {}
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: portNumber,
        path: requestPath,
        method
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            port: portNumber,
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Local media request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function findLocalMediaServerPort() {
  const candidates = Array.from(new Set([cachedMediaServerPort, ...mediaServerPorts]));
  for (const candidatePort of candidates) {
    try {
      const result = await requestLocalMediaPath(candidatePort, "/settings", {
        timeoutMs: mediaProbeTimeoutMs
      });
      if (result.statusCode >= 200 && result.statusCode < 500) {
        cachedMediaServerPort = candidatePort;
        return candidatePort;
      }
    } catch (_) {
      // Try the next local media server port.
    }
  }
  return null;
}

async function ensureLocalMediaRuntime() {
  if (process.env.NUVIO_DISABLE_MEDIA_RUNTIME === "1") {
    return null;
  }
  const existingPort = await findLocalMediaServerPort();
  if (existingPort) {
    return existingPort;
  }
  mediaRuntimeProcess = spawn(process.execPath, [mediaRuntimePath], {
    cwd: rootDir,
    stdio: ["ignore", "inherit", "inherit"]
  });
  mediaRuntimeProcess.on("exit", (code, signal) => {
    mediaRuntimeProcess = null;
    if (code || signal) {
      console.warn(`Local media runtime exited (${signal || code}).`);
    }
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const portNumber = await findLocalMediaServerPort();
    if (portNumber) {
      return portNumber;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function proxyLocalMediaRequest(request, response, pathname) {
  const mediaPort = await findLocalMediaServerPort();
  if (!mediaPort) {
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ error: "Local media server unavailable" }));
    return true;
  }

  const proxied = await requestLocalMediaPath(mediaPort, pathname, {
    method: request.method || "GET",
    timeoutMs: 6000
  });
  response.writeHead(proxied.statusCode || 502, {
    "Cache-Control": "no-store",
    "Content-Type": proxied.headers["content-type"] || "application/json; charset=utf-8"
  });
  response.end(proxied.body);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/nuvio.env.js") {
      const { env } = await readEnvProperties({ rootDir });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/javascript; charset=utf-8"
      });
      response.end(buildRuntimeEnvScript(env));
      return;
    }

    if (requestUrl.pathname === "/settings" || requestUrl.pathname.startsWith("/tracks/")) {
      await proxyLocalMediaRequest(
        request,
        response,
        `${requestUrl.pathname}${requestUrl.search || ""}`
      );
      return;
    }

    let { invalid, filePath, fileStat } = await resolveRequestFile(requestUrl.pathname);

    if (invalid) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }

    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const fileContents = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath)
    });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error?.message || error}`);
  }
});

await ensureLocalMediaRuntime();

server.listen(port, host, async () => {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const mediaPort = await findLocalMediaServerPort();
  console.log(`Serving Nuvio TV from ${rootDir}`);
  console.log(`Local URL: http://${localHost}:${port}/`);
  for (const lanUrl of getLanUrls()) {
    console.log(`LAN URL: ${lanUrl}`);
  }
  console.log(
    mediaPort
      ? `Local media tracks endpoint: http://${localHost}:${port}/tracks/<media-url> -> 127.0.0.1:${mediaPort}`
      : "Local media tracks endpoint unavailable. Install/enable the media runtime to inspect internal tracks."
  );
  console.log(
    "Use one of the URLs above if you want to test the app over http(s) during development."
  );
});

function stopMediaRuntime() {
  if (!mediaRuntimeProcess) {
    return;
  }
  mediaRuntimeProcess.kill("SIGTERM");
  mediaRuntimeProcess = null;
}

process.on("SIGINT", () => {
  stopMediaRuntime();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopMediaRuntime();
  process.exit(0);
});
