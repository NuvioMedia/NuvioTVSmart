import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { buildTizenPlaybackProxyUrl } from "../js/platform/tizen/tizenPlaybackProxy.js";
import { nodeTooOldForEngineFs } from "../js/platform/tizen/tizenEngineFsService.js";

// The plugin service proxies header-restricted streams on TVs that cannot run
// EngineFS, with the URL format the app already builds for EngineFS.
const require = createRequire(import.meta.url);
const { createPluginHttpServer } = require("../services/plugin-http.cjs");

// EngineFS loads from Node 8.10; unknown versions keep the normal startup.
assert.equal(nodeTooOldForEngineFs("4.4.3"), true);
assert.equal(nodeTooOldForEngineFs("v8.9.4"), true);
assert.equal(nodeTooOldForEngineFs("8.10.0"), false);
assert.equal(nodeTooOldForEngineFs("16.20.2"), false);
assert.equal(nodeTooOldForEngineFs(""), false);

const REFERER = "https://vixsrc.to/embed/1?a=1&b=%2F";
const seen = [];
const origin = http.createServer((request, response) => {
  seen.push({ url: request.url, referer: request.headers.referer, range: request.headers.range });
  if (request.headers.referer !== REFERER) {
    response.writeHead(403);
    return response.end();
  }
  if (request.url === "/redirect/master.m3u8") {
    response.writeHead(302, { Location: "/hls/master.m3u8?token=x" });
    return response.end();
  }
  if (request.url === "/hls/master.m3u8?token=x") {
    response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    return response.end(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg-1.ts\nhttps://other.invalid/seg-2.ts\n'
    );
  }
  if (request.url === "/hls/seg-1.ts") {
    response.writeHead(206, { "Content-Type": "video/mp2t", "Content-Range": "bytes 0-3/4" });
    return response.end("abcd");
  }
  response.writeHead(404);
  response.end();
});
const service = createPluginHttpServer({ port: 0, logger: null });

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await listen(origin);
await listen(service);
const originUrl = `http://127.0.0.1:${origin.address().port}`;
const serviceUrl = `http://127.0.0.1:${service.address().port}`;

try {
  const playlistUrl = buildTizenPlaybackProxyUrl(serviceUrl, `${originUrl}/redirect/master.m3u8`, {
    Referer: REFERER
  });
  const playlist = await fetch(playlistUrl);
  assert.equal(playlist.status, 200);
  const body = await playlist.text();
  const lines = body.split("\n");
  assert.ok(lines[1].startsWith(`#EXT-X-KEY:METHOD=AES-128,URI="/proxy/`), lines[1]);
  assert.ok(lines[2].startsWith("/proxy/") && lines[2].endsWith("/hls/seg-1.ts"), lines[2]);
  assert.ok(lines[3].startsWith("/proxy/") && lines[3].endsWith("/seg-2.ts"), lines[3]);

  const segment = await fetch(`${serviceUrl}${lines[2]}`, { headers: { Range: "bytes=0-3" } });
  assert.equal(segment.status, 206);
  assert.equal(segment.headers.get("content-range"), "bytes 0-3/4");
  assert.equal(await segment.text(), "abcd");
  assert.equal(seen.at(-1).range, "bytes=0-3");
  assert.ok(seen.every((entry) => entry.referer === REFERER));

  const health = await (await fetch(`${serviceUrl}/health`)).json();
  assert.equal(health.nodeVersion, process.versions.node);
  assert.equal(health.playbackProxy, true);
  console.log("plugin playback proxy test passed");
} finally {
  service.close();
  origin.close();
}
