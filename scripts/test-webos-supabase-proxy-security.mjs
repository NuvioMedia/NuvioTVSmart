import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const https = require("https");

const recordedUpstreamHeaders = [];
const originalHttpsRequest = https.request;

https.request = (options, cb) => {
  recordedUpstreamHeaders.push({
    hostname: options.hostname,
    path: options.path,
    headers: { ...(options.headers || {}) }
  });
  const upstreamReq = new EventEmitter();
  upstreamReq.setTimeout = () => {};
  upstreamReq.destroy = () => {};
  upstreamReq.write = () => {};
  upstreamReq.end = () => {
    const res = new EventEmitter();
    res.resume = () => {};
    res.destroy = () => {};
    if (options.hostname === "api.torbox.app") {
      res.statusCode = 302;
      res.headers = { location: "https://www.premiumize.me/api/item/listall" };
      cb(res);
      res.emit("end");
    } else {
      res.statusCode = 200;
      res.headers = { "content-type": "application/json" };
      cb(res);
      res.emit("data", Buffer.from('{"ok":true}'));
      res.emit("end");
    }
  };
  return upstreamReq;
};

const { SUPABASE_PROXY_PATH, createSupabaseProxyHandler } = require(
  path.join(rootDir, "services", "webos", "src", "supabaseProxy.js")
);
const handler = createSupabaseProxyHandler();

test("supabaseProxy strips Authorization/apikey across cross-origin redirects and settles once on oversized body", async () => {
  try {
    recordedUpstreamHeaders.length = 0;
    const req = new EventEmitter();
    req.method = "POST";
    req.url = SUPABASE_PROXY_PATH;
    req.destroy = () => {};
    let responseDone;
    const donePromise = new Promise((resolve) => {
      responseDone = resolve;
    });
    const res = {
      headersSent: false,
      writeHead(statusCode) {
        this.statusCode = statusCode;
        this.headersSent = true;
      },
      end(body) {
        responseDone({ statusCode: this.statusCode, body: String(body || "") });
      }
    };

    const handled = handler(req, res);
    assert.equal(handled, true);
    const payload = JSON.stringify({
      url: "https://api.torbox.app/v1/api/torrents/mylist",
      method: "GET",
      headers: {
        Authorization: "Bearer secret-token",
        apikey: "anon-secret",
        Accept: "application/json"
      }
    });
    req.emit("data", Buffer.from(payload));
    req.emit("end");
    const result = await Promise.race([
      donePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("supabaseProxy timed out")), 3000)
      )
    ]);
    assert.equal(result.statusCode, 200);
    assert.equal(recordedUpstreamHeaders.length, 2);
    assert.equal(recordedUpstreamHeaders[1].hostname, "www.premiumize.me");
    assert.equal(recordedUpstreamHeaders[1].headers.Authorization, undefined);
    assert.equal(recordedUpstreamHeaders[1].headers.authorization, undefined);
    assert.equal(recordedUpstreamHeaders[1].headers.apikey, undefined);

    // Oversized body (> 2 MiB) followed by end/error must write headers only once.
    const bigReq = new EventEmitter();
    bigReq.method = "POST";
    bigReq.url = SUPABASE_PROXY_PATH;
    let destroyCalls = 0;
    bigReq.destroy = () => {
      destroyCalls += 1;
    };
    let headCalls = 0;
    let endCalls = 0;
    const bigRes = {
      headersSent: false,
      writeHead(code) {
        headCalls += 1;
        this.statusCode = code;
        this.headersSent = true;
      },
      end() {
        endCalls += 1;
      }
    };
    handler(bigReq, bigRes);
    bigReq.emit("data", Buffer.alloc(1024 * 1024));
    bigReq.emit("data", Buffer.alloc(1024 * 1024));
    bigReq.emit("data", Buffer.alloc(1024));
    bigReq.emit("end");
    bigReq.emit("error", new Error("late stream error"));
    assert.equal(destroyCalls, 1);
    assert.equal(headCalls, 1);
    assert.equal(endCalls, 1);
  } finally {
    https.request = originalHttpsRequest;
  }
});
