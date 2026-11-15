// The Tizen 5.5 Web Service runs Node 4.4.3, which has no WHATWG URL class.
// Run the same requests through plugin-http.cjs with and without URL and
// require identical upstream requests and results.
"use strict";

const assert = require("assert");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

if (process.argv[2] === "--child") {
  const urlModule = require("url");
  if (process.argv[3] === "legacy") delete urlModule.URL;
  const { createPluginHttpServer } = require(path.join(__dirname, "../services/plugin-http.cjs"));
  const seen = [];
  const upstream = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, host: request.headers.host });
    if (request.url === "/relative") {
      response.writeHead(302, { Location: "../next?a=1&b=%20x" });
      return response.end();
    }
    if (request.url === "/protocol-relative") {
      response.writeHead(301, { Location: `//127.0.0.1:${upstream.address().port}/final#frag` });
      return response.end();
    }
    response.end("ok");
  });
  const service = createPluginHttpServer({ port: 0 });
  const call = (payload) =>
    new Promise((resolve) => {
      const body = JSON.stringify(payload);
      const request = http.request(
        {
          host: "127.0.0.1",
          port: service.address().port,
          method: "POST",
          path: "/fetch",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode, ...JSON.parse(text) }));
        }
      );
      request.end(body);
    });
  upstream.listen(0, "127.0.0.1", () =>
    service.listen(0, "127.0.0.1", async () => {
      const base = `http://127.0.0.1:${upstream.address().port}`;
      const results = [];
      for (const url of [
        `${base}/relative`,
        `${base}/protocol-relative`,
        `${base}/path with space/é?q=1#hash`,
        `${base}/search?query=Amélie 日本&year=2001`,
        `HTTP://127.0.0.1:${upstream.address().port}/upper`,
        "http://localhost:80/".replace("80", String(upstream.address().port)),
        "ftp://example.com/file",
        "http://"
      ]) {
        const result = await call({ url, method: "POST", body: "x" });
        results.push({
          status: result.status,
          url: result.url,
          ok: result.ok,
          error: result.errorText
        });
      }
      process.stdout.write(
        JSON.stringify({ seen, results }).split(String(upstream.address().port)).join("PORT")
      );
      process.exit(0);
    })
  );
} else {
  const run = (mode) =>
    JSON.parse(execFileSync(process.execPath, [__filename, "--child", mode]).toString());
  const modern = run("modern");
  const legacy = run("legacy");
  assert.deepStrictEqual(legacy, modern);
  assert.equal(modern.seen.length, 8);
  assert.equal(modern.results[6].status, 502);
  assert.equal(modern.results[7].status, 502);
  console.log("plugin-http legacy runtime URL parity: ok");
}
