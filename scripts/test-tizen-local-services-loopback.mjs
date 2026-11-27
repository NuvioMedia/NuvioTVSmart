import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tx3gService = require(
  path.join(rootDir, "services", "tizen", "runtime", "tx3g-subtitle-service.cjs")
);
const customPosterConfig = require(path.join(rootDir, "services", "custom-poster-config.cjs"));
const { createPluginHttpServer } = require(path.join(rootDir, "services", "plugin-http.cjs"));
const engineServicePath = path.join(rootDir, "services", "tizen", "enginefs-service.js");

function runMockTx3gRequest(remoteAddress) {
  let statusCode = 0;
  let body = "";
  const request = { url: "/settings", method: "GET" };
  if (remoteAddress !== null) request.socket = { remoteAddress };
  tx3gService.handleRequest(request, {
    writeHead(code) {
      statusCode = code;
    },
    end(chunk) {
      body += chunk ? String(chunk) : "";
    }
  });
  return { statusCode, body: JSON.parse(body || "{}") };
}

test("tx3g-subtitle-service rejects non-loopback clients with 403 and allows loopback", () => {
  const remoteResult = runMockTx3gRequest("192.0.2.55");
  assert.equal(remoteResult.statusCode, 403);
  assert.equal(remoteResult.body.errorCode, "FORBIDDEN");

  const unknownResult = runMockTx3gRequest(null);
  assert.equal(unknownResult.statusCode, 403);

  const localResult = runMockTx3gRequest("127.0.0.1");
  assert.equal(localResult.statusCode, 200);
  assert.equal(localResult.body.tx3g, true);

  assert.equal(runMockTx3gRequest("::1").statusCode, 200);
  assert.equal(runMockTx3gRequest("::ffff:127.0.0.1").statusCode, 200);
  assert.equal(runMockTx3gRequest("::ffff:192.0.2.55").statusCode, 403);
});

test("custom-poster-config.stopAll() and plugin-http close tear down active sessions", async () => {
  assert.equal(typeof customPosterConfig.stopAll, "function");
  assert.equal(customPosterConfig.stopAll(), false);

  const started = await customPosterConfig.start({
    token: "b".repeat(64),
    pattern: "https://example.com/{id}"
  });
  assert.ok(started && Number(started.port) > 0);

  const pluginServer = createPluginHttpServer({
    port: 0,
    logger: { info() {}, warn() {}, error() {} }
  });
  await new Promise((resolve) => pluginServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => pluginServer.close(resolve));

  assert.equal(
    customPosterConfig.stopAll(),
    false,
    "closing plugin-http server must stop the active custom-poster-config session"
  );
});

test("enginefs-service wraps http servers with loopback guard and closes them on exit", () => {
  const createdServers = [];
  let closedCount = 0;
  let removeAllResponse = null;
  let removeAllRequests = 0;

  const fakeHttp = {
    createServer(listener) {
      const server = {
        _listener: listener,
        on(event, fn) {
          if (event === "request") {
            this._listener = fn;
          }
          return this;
        },
        listen() {
          return this;
        },
        close() {
          closedCount += 1;
        }
      };
      createdServers.push(server);
      return server;
    },
    get(_url, callback) {
      removeAllRequests += 1;
      removeAllResponse = {
        handlers: {},
        resume() {},
        on(event, fn) {
          this.handlers[event] = fn;
          return this;
        }
      };
      callback(removeAllResponse);
      return { on() {} };
    }
  };

  const serviceRequire = createRequire(engineServicePath);
  const fakeRequire = (id) => {
    if (id === "http") return fakeHttp;
    if (id === "net") return { createServer() {} };
    if (id === "dgram") return { createSocket() {} };
    if (id === "module") return null;
    if (id === "./runtime/node-runtime-compat.cjs") return function () {};
    if (id === "./runtime/playback-proxy-patch.cjs") return (code) => code;
    if (id === "./runtime/media-http.cjs") {
      const s = fakeHttp.createServer((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      s.on("request", (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      return {};
    }
    if (id === "./runtime/tx3g-subtitle-service.cjs") {
      return { start() {}, stop() {} };
    }
    return serviceRequire(id);
  };

  const engineSrc = readFileSync(engineServicePath, "utf8");
  const engineMod = { exports: {} };
  const cjsFactory = vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {\n${engineSrc}\n})`,
    { Buffer, console, process, setTimeout, clearTimeout },
    { filename: "enginefs-service.js" }
  );
  cjsFactory(
    engineMod.exports,
    fakeRequire,
    engineMod,
    engineServicePath,
    path.dirname(engineServicePath)
  );

  engineMod.exports.onStart();
  assert.equal(createdServers.length, 1);

  let deniedStatus = 0;
  let deniedBody = "";
  createdServers[0]._listener(
    { url: "/", socket: { remoteAddress: "198.51.100.12" } },
    {
      headersSent: false,
      writeHead(code) {
        deniedStatus = code;
      },
      end(chunk) {
        deniedBody = String(chunk || "");
      }
    }
  );
  assert.equal(deniedStatus, 403);
  assert.match(deniedBody, /Loopback/i);

  let unknownStatus = 0;
  createdServers[0]._listener(
    { url: "/" },
    {
      headersSent: false,
      writeHead(code) {
        unknownStatus = code;
      },
      end() {}
    }
  );
  assert.equal(unknownStatus, 403);

  engineMod.exports.onExit();
  assert.equal(removeAllRequests, 1);
  assert.equal(closedCount, 0, "keep the listener open until /removeAll responds");
  removeAllResponse.handlers.end();
  assert.equal(closedCount, 1);
});
