import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("supabaseProxy settles callback once on invalid redirects, oversized responses, and timeouts", async () => {
  const source = await readFile(
    new URL("../services/webos/src/supabaseProxy.js", import.meta.url),
    "utf8"
  );

  let mode = "bad-redirect";
  let destroyedResponse = 0;
  let abortedRequest = 0;
  let callbackCount = 0;
  let lastResult = null;
  let timeoutHandler = null;

  const fakeTransport = {
    request(_opts, onResponse) {
      const req = new EventEmitter();
      req.write = () => {};
      req.abort = () => {
        abortedRequest += 1;
      };
      req.destroy = () => {
        abortedRequest += 1;
      };
      req.setTimeout = (_ms, fn) => {
        timeoutHandler = fn;
        return req;
      };
      req.end = () => {
        if (mode === "timeout") {
          queueMicrotask(() => {
            timeoutHandler();
            req.emit("error", new Error("late error"));
          });
          return;
        }
        const res = new EventEmitter();
        res.resume = () => {};
        res.destroy = () => {
          destroyedResponse += 1;
        };
        if (mode === "bad-redirect") {
          res.statusCode = 302;
          res.headers = { location: "http://[::1" };
          onResponse(res);
          return;
        }
        if (mode === "oversized") {
          res.statusCode = 200;
          res.headers = {};
          onResponse(res);
          res.emit("data", Buffer.alloc(11 * 1024 * 1024));
          res.emit("end");
        }
      };
      return req;
    }
  };

  const ctx = vm.createContext({ Buffer, console, process, URL, setTimeout, clearTimeout });
  const mod = { exports: {} };
  const fn = vm.runInNewContext(`(function (exports, require, module) {\n${source}\n})`, ctx);
  fn(
    mod.exports,
    (id) => {
      if (id === "http" || id === "https") return fakeTransport;
      if (id === "url") return { URL };
      throw new Error(`Unexpected require ${id}`);
    },
    mod
  );

  const handler = mod.exports.createSupabaseProxyHandler();
  const proxyPath = mod.exports.SUPABASE_PROXY_PATH || "/supabase-proxy";

  const runReq = () =>
    new Promise((resolve, reject) => {
      callbackCount = 0;
      destroyedResponse = 0;
      abortedRequest = 0;
      lastResult = null;
      const chunks = [];
      const req = new EventEmitter();
      req.method = "POST";
      req.url = proxyPath;
      req.headers = { "content-type": "application/json" };
      const res = {
        statusCode: 0,
        headers: {},
        headersSent: false,
        setHeader(name, value) {
          this.headers[name] = value;
        },
        writeHead(statusCode, headers = {}) {
          this.statusCode = statusCode;
          Object.assign(this.headers, headers);
          this.headersSent = true;
        },
        write(chunk) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
        end(chunk) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          callbackCount += 1;
          lastResult = {
            statusCode: this.statusCode,
            body: Buffer.concat(chunks).toString("utf8")
          };
          queueMicrotask(resolve);
        }
      };
      const handled = handler(req, res);
      if (handled === false) {
        reject(new Error(`Handler did not match ${proxyPath}`));
        return;
      }
      queueMicrotask(() => {
        req.emit(
          "data",
          Buffer.from(
            JSON.stringify({ method: "GET", url: "https://demo.supabase.co/rest/v1/profiles" })
          )
        );
        req.emit("end");
      });
    });

  mode = "bad-redirect";
  await runReq();
  assert.equal(callbackCount, 1);
  assert.equal(lastResult.statusCode, 502);

  mode = "oversized";
  await runReq();
  assert.equal(callbackCount, 1);
  assert.equal(destroyedResponse >= 1, true);
  assert.equal(abortedRequest >= 1, true);
  assert.equal(lastResult.statusCode, 502);

  mode = "timeout";
  await runReq();
  assert.equal(callbackCount, 1);
  assert.equal(lastResult.statusCode, 502);
  assert.match(lastResult.body || "", /timed out/i);
});
