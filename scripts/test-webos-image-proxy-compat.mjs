import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadCommonJsWithMocks(source, filename, mocks) {
  const mod = { exports: {} };
  const fn = vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`,
    {
      Buffer,
      console,
      process,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      URL
    },
    { filename }
  );
  const customRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) {
      return mocks[id];
    }
    return require(id);
  };
  fn(mod.exports, customRequire, mod, filename, ".");
  return mod.exports;
}

test("imageProxy uses 2-argument transport.get and handles malformed redirect Location safely", async () => {
  const source = await readFile(
    new URL("../services/webos/src/imageProxy.js", import.meta.url),
    "utf8"
  );
  const getCalls = [];
  let mode = "not-found";

  const fakeTransport = {
    get(options, callback) {
      getCalls.push({ argCount: arguments.length, options, cbType: typeof callback });
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.abort = () => {};
      req.destroy = () => {};
      queueMicrotask(() => {
        const res = new EventEmitter();
        res.resume = () => {};
        if (mode === "bad-redirect") {
          res.statusCode = 302;
          res.headers = { location: "http://[::1" };
        } else {
          res.statusCode = 404;
          res.headers = {};
        }
        callback(res);
      });
      return req;
    }
  };

  const imageProxy = loadCommonJsWithMocks(source, "imageProxy.js", {
    http: fakeTransport,
    https: fakeTransport
  });

  const handler = imageProxy.createImageProxyHandler();
  const invoke = (reqUrl) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 0,
        headers: {},
        body: "",
        writeHead(status, headers) {
          this.statusCode = status;
          this.headers = headers || {};
        },
        end(chunk) {
          this.body = String(chunk || "");
          resolve({ statusCode: this.statusCode, body: this.body });
        }
      };
      handler({ method: "GET", url: reqUrl }, res);
    });

  const res404 = await invoke("/image-proxy?url=https%3A%2F%2Fi.imgur.com%2Fsample.png");
  assert.equal(res404.statusCode, 502);
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0].argCount, 2);
  assert.equal(typeof getCalls[0].options, "object");
  assert.equal(getCalls[0].options.hostname, "i.imgur.com");
  assert.equal(getCalls[0].options.path, "/sample.png");

  mode = "bad-redirect";
  const resBadRedirect = await invoke("/image-proxy?url=https%3A%2F%2Fi.imgur.com%2Fredirect.png");
  assert.equal(resBadRedirect.statusCode, 502);
  assert.equal(getCalls.length, 2);
  assert.equal(getCalls[1].argCount, 2);
});
