import { Platform } from "../../platform/index.js";
import { PluginServiceClient } from "../../platform/pluginServiceClient.js";

const LATENCY_URL = "https://cloudflare.com/cdn-cgi/trace";
const FAST_HOME_URL = "https://fast.com";
const FAST_API_URL = "https://api.fast.com/netflix/speedtest/v2";
const LATENCY_ROUNDS = 3;
const DOWNLOAD_WINDOW_MS = 10000;
const DOWNLOAD_CONNECTIONS_PER_TARGET = 4;
const STREAM_WINDOW_MS = 4000;
const STREAM_CHUNK_BYTES = {
  BASELINE: 0,
  1: 1 * 1024 * 1024,
  4: 4 * 1024 * 1024,
  8: 8 * 1024 * 1024,
  16: 16 * 1024 * 1024
};

function now() {
  return Date.now();
}

function isTvPlatform() {
  return Platform.isTizen() || Platform.isWebOS();
}

async function nativeText(
  url,
  { headers = {}, maxBodyBytes = 1024 * 1024, timeoutMs = 15000 } = {}
) {
  if (isTvPlatform()) {
    const result = await PluginServiceClient.fetch({
      url,
      method: "GET",
      headers,
      maxBodyBytes,
      maxResponseBytes: maxBodyBytes,
      timeoutMs
    });
    if (!result?.ok) {
      throw new Error(`HTTP ${result?.status || 0}`);
    }
    return String(result.body || "");
  }
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

export function extractFastComScriptPath(html = "") {
  return /<script src="(\/app[^"]+\.js)"/.exec(String(html || ""))?.[1] || "";
}

export function extractFastComToken(script = "") {
  return /token:"([^"]+)"/.exec(String(script || ""))?.[1] || "";
}

export function extractFastComTargets(payload = {}) {
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  return targets
    .map((target) => String(target?.url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url));
}

export async function measureLatencyMs({ url = LATENCY_URL, rounds = LATENCY_ROUNDS } = {}) {
  let total = 0;
  let measured = 0;
  for (let index = 0; index < rounds; index += 1) {
    const startedAt = now();
    try {
      const response = await fetch(url, { cache: "no-store" });
      await response.arrayBuffer();
      total += now() - startedAt;
      measured += 1;
    } catch (_) {
      // A single failed round does not discard the others.
    }
  }
  return measured ? Math.round(total / measured) : 0;
}

async function fastComTargets() {
  const html = await nativeText(FAST_HOME_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    maxBodyBytes: 2 * 1024 * 1024
  });
  const scriptPath = extractFastComScriptPath(html);
  if (!scriptPath) {
    throw new Error("fast.com script path not found");
  }
  const script = await nativeText(`${FAST_HOME_URL}${scriptPath}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    maxBodyBytes: 4 * 1024 * 1024,
    timeoutMs: 30000
  });
  const token = extractFastComToken(script);
  if (!token) {
    throw new Error("fast.com token not found");
  }
  const payload = JSON.parse(
    await nativeText(`${FAST_API_URL}?https=true&token=${encodeURIComponent(token)}&urlCount=8`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      maxBodyBytes: 512 * 1024
    })
  );
  const targets = extractFastComTargets(payload);
  if (!targets.length) {
    throw new Error("fast.com returned no targets");
  }
  return targets;
}

async function readStreamForWindow(url, { headers = {}, deadline, signal, range = "" } = {}) {
  let bytes = 0;
  const requestHeaders = { ...headers };
  if (range) {
    requestHeaders.Range = range;
  }
  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      cache: "no-store",
      signal
    });
    if (!response.ok || !response.body) {
      return 0;
    }
    const reader = response.body.getReader();
    while (now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += Number(chunk.value?.byteLength) || 0;
    }
    try {
      await reader.cancel();
    } catch (_) {
      // Already closed.
    }
  } catch (_) {
    // Aborted at the deadline or the connection failed mid-stream.
  }
  return bytes;
}

async function measureParallelDownload(urls, { connectionsPerTarget = 1, deadline } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const workers = [];
  urls.forEach((url) => {
    for (let index = 0; index < connectionsPerTarget; index += 1) {
      workers.push(
        (async () => {
          let bytes = 0;
          while (now() < deadline) {
            const remaining = deadline - now();
            bytes += await readStreamForWindow(url, {
              deadline,
              signal: controller?.signal
            });
            if (remaining <= 0) {
              break;
            }
          }
          return bytes;
        })()
      );
    }
  });
  const results = await Promise.all(workers);
  return results.reduce((total, value) => total + value, 0);
}

export async function runNetworkSpeedTest({ onPhase = () => {} } = {}) {
  onPhase("latency");
  const latencyMs = await measureLatencyMs();
  onPhase("download");
  let bytes = 0;
  let elapsedMs = 1;
  try {
    const targets = await fastComTargets();
    const startedAt = now();
    bytes = await measureParallelDownload(targets, {
      connectionsPerTarget: DOWNLOAD_CONNECTIONS_PER_TARGET,
      deadline: startedAt + DOWNLOAD_WINDOW_MS
    });
    elapsedMs = Math.max(1, now() - startedAt);
  } catch (error) {
    return {
      latencyMs,
      downloadMbps: 0,
      error: String(error?.message || error || "Speed test failed")
    };
  }
  return {
    latencyMs,
    downloadMbps: (bytes * 8.0) / (elapsedMs * 1000.0),
    error: ""
  };
}

function mbpsForBytes(bytes, elapsedMs) {
  return (Number(bytes) * 8.0) / (Math.max(1, Number(elapsedMs)) * 1000.0);
}

async function runStreamPass(
  url,
  headers,
  { connections, chunkBytes, windowMs = STREAM_WINDOW_MS } = {}
) {
  const startedAt = now();
  const deadline = startedAt + windowMs;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const workers = [];
  const parallel = Math.max(1, Number(connections) || 1);
  for (let index = 0; index < parallel; index += 1) {
    workers.push(
      (async () => {
        let bytes = 0;
        let offset = index * chunkBytes;
        while (now() < deadline) {
          const range = chunkBytes > 0 ? `bytes=${offset}-${offset + chunkBytes - 1}` : "";
          bytes += await readStreamForWindow(url, {
            headers,
            deadline,
            signal: controller?.signal,
            range
          });
          offset += chunkBytes;
        }
        return bytes;
      })()
    );
  }
  const results = await Promise.all(workers);
  const bytes = results.reduce((total, value) => total + value, 0);
  return mbpsForBytes(bytes, now() - startedAt);
}

export async function runStreamSpeedTest(url, headers = {}, { onPhase = () => {} } = {}) {
  const target = String(url || "").trim();
  if (!target) {
    return { error: "no-stream" };
  }
  onPhase("BASELINE");
  const baselineMbps = await runStreamPass(target, headers, { connections: 1, chunkBytes: 0 });
  if (!(baselineMbps > 0)) {
    return { error: "connection" };
  }
  const parallelSpeeds = {};
  for (const connections of [1, 4, 8, 16]) {
    onPhase(`PARALLEL_${connections}`);
    parallelSpeeds[connections] = await runStreamPass(target, headers, {
      connections,
      chunkBytes: STREAM_CHUNK_BYTES[connections]
    });
  }
  return { baselineMbps, parallelSpeeds, error: "" };
}
