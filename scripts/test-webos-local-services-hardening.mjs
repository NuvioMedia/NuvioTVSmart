import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const bitmapSubtitles = require(
  path.join(rootDir, "services", "webos", "src", "bitmapSubtitles.js")
);
const audioTranscode = require(path.join(rootDir, "services", "webos", "src", "audioTranscode.js"));

test("serverHost rejects non-loopback requests with 403 and allows loopback", async () => {
  const serverHostSrc = fs.readFileSync(
    path.join(rootDir, "services", "webos", "src", "serverHost.js"),
    "utf8"
  );
  const innerServers = [];
  const innerHttp = {
    createServer(listener) {
      const s = {
        _listener: listener,
        on(ev, cb) {
          if (ev === "request") this._listener = cb;
          return this;
        }
      };
      innerServers.push(s);
      return s;
    }
  };
  const webosSrcDir = path.join(rootDir, "services", "webos", "src");
  const webosRequire = createRequire(path.join(webosSrcDir, "serverHost.js"));
  const mod2 = { exports: {} };
  const fn2 = vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {\n${serverHostSrc}\n})`,
    { Buffer, console, process, setTimeout, clearTimeout, Promise, URL },
    { filename: "serverHost.js" }
  );
  const req2 = (id) => {
    if (id === "http") return innerHttp;
    if (id === "fs") return { readFileSync: () => "" };
    if (id === "module") {
      class FakeModule {
        _compile() {
          innerHttp.createServer((_req, res) => {
            res.writeHead(200);
            res.end("ok");
          });
        }
      }
      FakeModule._nodeModulePaths = () => [];
      return FakeModule;
    }
    if (id === "./imageProxy") return { createImageProxyHandler: () => () => false };
    if (id === "./supabaseProxy") return { createSupabaseProxyHandler: () => () => false };
    if (id === "./audioTranscode") return { handle: () => false };
    return webosRequire(id);
  };
  fn2(mod2.exports, req2, mod2, "serverHost.js", webosSrcDir);
  mod2.exports.bootLocalRuntime("dummy-runtime.js");

  let deniedStatus = 0;
  let deniedBody = "";
  innerServers[0]._listener(
    { url: "/", socket: { remoteAddress: "203.0.113.10" } },
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

  let allowedStatus = 0;
  let allowedBody = "";
  innerServers[0]._listener(
    { url: "/", socket: { remoteAddress: "::ffff:127.0.0.1" } },
    {
      headersSent: false,
      writeHead(code) {
        allowedStatus = code;
      },
      end(chunk) {
        allowedBody = String(chunk || "");
      }
    }
  );

  assert.equal(allowedStatus, 200);
  assert.equal(allowedBody, "ok");
});

test("bitmapSubtitles requestRange enforces maxBytes, handles aborted response, and respects cancelled context", async () => {
  await assert.rejects(
    () =>
      bitmapSubtitles._test.requestRange("http://127.0.0.1:1/subtitle.mks", 0, 63, 64, 0, {
        cancelled: true,
        requests: new Set()
      }),
    (error) => error && error.code === "REQUEST_SUPERSEDED"
  );

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.alloc(256, 0x41));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        bitmapSubtitles._test.requestRange(`http://127.0.0.1:${port}/oversize.mks`, 0, 63, 64, 0, {
          cancelled: false,
          requests: new Set()
        }),
      (error) => error && error.code === "RANGE_TOO_LARGE"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bitmapSubtitles requestRange rejects responses aborted mid-body", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(206, {
      "Content-Range": "bytes 0-1023/2048",
      "Content-Length": 1024
    });
    res.write(Buffer.alloc(16, 0x41));
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await assert.rejects(
      () =>
        bitmapSubtitles._test.requestRange(
          `http://127.0.0.1:${port}/aborted.mks`,
          0,
          1023,
          2048,
          0,
          {
            cancelled: false,
            requests: new Set()
          }
        ),
      (error) => error && error.code === "RANGE_ABORTED"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("imageProxy prunes cache entries beyond file and byte limits", () => {
  const src = fs.readFileSync(
    path.join(rootDir, "services", "webos", "src", "imageProxy.js"),
    "utf8"
  );
  const entries = [];
  for (let index = 0; index < 130; index += 1) {
    entries.push({
      name: `hash${String(index).padStart(4, "0")}.png`,
      size: 1024 * 1024,
      mtimeMs: index
    });
  }
  const removed = [];
  const fakeFs = {
    readdirSync: () => entries.map((entry) => entry.name),
    statSync: (filePath) => {
      const entry = entries.find((item) => item.name === path.basename(filePath));
      if (!entry) throw new Error("ENOENT");
      return { isFile: () => true, size: entry.size, mtimeMs: entry.mtimeMs };
    },
    unlinkSync: (filePath) => removed.push(path.basename(filePath))
  };
  const mod = { exports: {} };
  const fn = vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {\n${src}\n})`,
    { Buffer, console, process, setTimeout, clearTimeout, Promise, URL },
    { filename: "imageProxy.js" }
  );
  fn(
    mod.exports,
    (id) => (id === "fs" ? fakeFs : id === "os" ? { tmpdir: () => "/tmp" } : require(id)),
    mod,
    "imageProxy.js",
    "."
  );

  mod.exports._test.pruneCacheDir();

  // 130 x 1 MiB exceeds both the 128-file and 64 MiB limits, so the 66
  // oldest images (and their metadata) are removed.
  assert.equal(removed.length, 132);
  assert.ok(removed.includes("hash0000.png"));
  assert.ok(removed.includes("hash0000.json"));
  assert.ok(removed.includes("hash0065.png"));
  assert.ok(!removed.includes("hash0066.png"));
});

test("audioTranscode destroys static asset read stream when response closes", () => {
  let destroyedStreams = 0;
  const origCreateReadStream = fs.createReadStream;
  fs.createReadStream = () => {
    const stream = new EventEmitter();
    stream.pipe = () => stream;
    stream.destroy = () => {
      destroyedStreams += 1;
    };
    return stream;
  };
  try {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.end = () => {};
    const handled = audioTranscode.handle({ url: "/audio-transcode/assets/ffmpeg-core.js" }, res);
    assert.equal(handled, true);
    res.emit("close");
    assert.equal(destroyedStreams, 1, "closing response must destroy asset read stream");
  } finally {
    fs.createReadStream = origCreateReadStream;
  }
});

test("imageProxy destroys cached read stream on response close", () => {
  const src = fs.readFileSync(
    path.join(rootDir, "services", "webos", "src", "imageProxy.js"),
    "utf8"
  );
  let destroyedStreams = 0;
  const mod = { exports: {} };
  const fakeFs = {
    existsSync: () => true,
    mkdirSync: () => {},
    statSync: () => ({ isFile: () => true, size: 12 }),
    readFileSync: () => JSON.stringify({ contentType: "image/png" }),
    createReadStream: () => {
      const s = new EventEmitter();
      s.pipe = () => s;
      s.destroy = () => {
        destroyedStreams += 1;
      };
      return s;
    }
  };
  const fn = vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {\n${src}\n})`,
    { Buffer, console, process, setTimeout, clearTimeout, Promise, URL },
    { filename: "imageProxy.js" }
  );
  fn(mod.exports, (id) => (id === "fs" ? fakeFs : require(id)), mod, "imageProxy.js", ".");
  const handler = mod.exports.createImageProxyHandler();
  const res = new EventEmitter();
  res.writeHead = () => {};
  res.end = () => {};
  const handled = handler(
    { url: "/image-proxy?url=https%3A%2F%2Fi.imgur.com%2Fsample.png", method: "GET" },
    res
  );
  assert.equal(handled, true);
  res.emit("close");
  assert.equal(destroyedStreams, 1, "closing response must destroy cached image read stream");
});
