import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http = require("node:http");
const net = require("node:net");
const dns = require("node:dns");
const { createPluginHttpServer } = require("../services/plugin-http.cjs");

const MOCK_PUBLIC_IP = "93.184.216.34";
const MOCK_LAN_IP = "192.168.1.50";

function postFetch(servicePort, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: servicePort,
        path: "/fetch",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body, "utf8")
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          } catch (error) {
            reject(new Error(`Invalid JSON response (${res.statusCode}): ${text}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function listenServer(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

test("plugin-http blocks outbound SSRF targets, unsafe DNS resolutions, and 3xx redirects while allowing public and LAN fetches", async () => {
  let internalHits = 0;
  let externalHits = 0;

  const internalServer = http.createServer((req, res) => {
    internalHits += 1;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("internal-secret");
  });

  let internalPort = 0;
  const externalServer = http.createServer((req, res) => {
    externalHits += 1;
    if (req.url === "/redirect-loopback") {
      res.writeHead(302, { Location: `http://127.0.0.1:${internalPort}/secret` });
      res.end();
      return;
    }
    if (req.url === "/redirect-localhost") {
      res.writeHead(301, { Location: `http://localhost:${internalPort}/secret` });
      res.end();
      return;
    }
    if (req.url === "/redirect-metadata") {
      res.writeHead(307, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (req.url === "/redirect-rebind") {
      res.writeHead(302, { Location: `http://rebind.public.test:${internalPort}/secret` });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("external-ok");
  });

  const pluginServer = createPluginHttpServer({
    port: 0,
    logger: { warn() {} }
  });

  const origLookup = dns.lookup;
  const origConnect = net.Socket.prototype.connect;
  const dnsMap = new Map();

  try {
    internalPort = await listenServer(internalServer);
    const externalPort = await listenServer(externalServer);
    const pluginPort = await listenServer(pluginServer);

    dns.lookup = function (hostname, options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      const key = String(hostname || "").toLowerCase();
      if (dnsMap.has(key)) {
        const records = dnsMap.get(key);
        if (options && options.all) {
          process.nextTick(() => callback(null, records));
        } else {
          const first = records[0];
          process.nextTick(() => callback(null, first.address, first.family || 4));
        }
        return;
      }
      return origLookup.call(this, hostname, options, callback);
    };

    net.Socket.prototype.connect = function (...args) {
      const opts = Array.isArray(args[0]) ? args[0][0] : args[0];
      if (opts && typeof opts === "object") {
        const targetHost = opts.host || opts.hostname;
        if (targetHost === MOCK_PUBLIC_IP || targetHost === MOCK_LAN_IP) {
          opts.host = "127.0.0.1";
          opts.hostname = "127.0.0.1";
        }
      }
      return origConnect.apply(this, args);
    };

    const blockedUrls = [
      `http://127.0.0.1:${internalPort}/secret`,
      `http://127.0.1.1:${internalPort}/secret`,
      `http://0.0.0.0:${internalPort}/secret`,
      `http://0.1.2.3:${internalPort}/secret`,
      `http://localhost:${internalPort}/secret`,
      `http://localhost.:${internalPort}/secret`,
      `http://sub.localhost:${internalPort}/secret`,
      `http://sub.localhost.:${internalPort}/secret`,
      `http://[::1]:${internalPort}/secret`,
      `http://[::]:${internalPort}/secret`,
      `http://[0:0:0:0:0:0:0:1]:${internalPort}/secret`,
      `http://[::ffff:127.0.0.1]:${internalPort}/secret`,
      `http://[::ffff:7f00:1]:${internalPort}/secret`,
      `http://[::ffff:a9fe:a9fe]:${internalPort}/secret`,
      `http://[::127.0.0.1]:${internalPort}/secret`,
      `http://[::169.254.169.254]:${internalPort}/secret`,
      "http://169.254.169.254/latest/meta-data/",
      "http://[fe80::1]/latest/meta-data/",
      "http://[febf::1]/latest/meta-data/",
      `http://0x7f000001:${internalPort}/secret`,
      `http://2130706433:${internalPort}/secret`,
      `http://0177.0.0.1:${internalPort}/secret`
    ];

    for (let i = 0; i < blockedUrls.length; i += 1) {
      const url = blockedUrls[i];
      const res = await postFetch(pluginPort, {
        requestId: `blocked-direct-${i}`,
        url
      });
      assert.equal(res.status, 403, `Expected 403 for ${url}, got ${res.status}`);
      assert.equal(res.json.returnValue, false, `Expected returnValue=false for ${url}`);
    }

    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await postFetch(pluginPort, {
        requestId: `blocked-method-${method}`,
        method,
        url: `http://127.0.0.1:${internalPort}/secret`,
        body: method === "DELETE" ? "" : "payload=1"
      });
      assert.equal(res.status, 403, `Expected 403 for ${method} loopback`);
      assert.equal(res.json.returnValue, false);
    }

    // DNS lookup stub tests
    const dnsCases = [
      ["dns-loopback-v4.test", [{ address: "127.0.0.1", family: 4 }]],
      ["dns-loopback-v6.test", [{ address: "::1", family: 6 }]],
      ["dns-mapped-dotted.test", [{ address: "::ffff:127.0.0.1", family: 6 }]],
      ["dns-mapped-hex.test", [{ address: "::ffff:7f00:1", family: 6 }]],
      ["dns-compat.test", [{ address: "::127.0.0.1", family: 6 }]],
      ["dns-linklocal-zone.test", [{ address: "fe80::1%eth0", family: 6 }]],
      ["dns-unspecified.test", [{ address: "0.0.0.0", family: 4 }]],
      [
        "dns-dual-record.test",
        [
          { address: MOCK_PUBLIC_IP, family: 4 },
          { address: "127.0.0.1", family: 4 }
        ]
      ],
      ["dns-invalid-record.test", [{ address: "not-an-ip", family: 4 }]]
    ];

    for (const [host, records] of dnsCases) {
      dnsMap.set(host, records);
      const res = await postFetch(pluginPort, {
        requestId: `dns-${host}`,
        url: `http://${host}:${internalPort}/secret`
      });
      assert.equal(res.status, 502, `Expected 502 for DNS case ${host}, got ${res.status}`);
      assert.equal(res.json.returnValue, false, `Expected returnValue=false for ${host}`);
    }
    assert.equal(externalHits, 0, "dual-record DNS containing blocked IP must fail closed");

    // 3xx redirect tests from mocked external public IP server (distinct hostnames so host circuit breaker is not tripped)
    dnsMap.set("redirect-loopback.public.test", [{ address: MOCK_PUBLIC_IP, family: 4 }]);
    dnsMap.set("redirect-localhost.public.test", [{ address: MOCK_PUBLIC_IP, family: 4 }]);
    dnsMap.set("redirect-metadata.public.test", [{ address: MOCK_PUBLIC_IP, family: 4 }]);
    dnsMap.set("redirect-rebind.public.test", [{ address: MOCK_PUBLIC_IP, family: 4 }]);
    dnsMap.set("allowed.public.test", [{ address: MOCK_PUBLIC_IP, family: 4 }]);
    dnsMap.set("rebind.public.test", [{ address: "127.0.0.1", family: 4 }]);

    for (const [host, redirectPath] of [
      ["redirect-loopback.public.test", "/redirect-loopback"],
      ["redirect-localhost.public.test", "/redirect-localhost"],
      ["redirect-metadata.public.test", "/redirect-metadata"],
      ["redirect-rebind.public.test", "/redirect-rebind"]
    ]) {
      const res = await postFetch(pluginPort, {
        requestId: `redirect-${redirectPath}`,
        url: `http://${host}:${externalPort}${redirectPath}`
      });
      assert.equal(
        res.status,
        502,
        `Expected 502 for blocked redirect ${redirectPath}, got ${res.status}`
      );
      assert.equal(res.json.returnValue, false);
    }

    // Repeated direct blocked requests must not trip circuit breaker (must keep returning 403, not 503)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const repeated = await postFetch(pluginPort, {
        requestId: `repeated-blocked-${attempt}`,
        url: `http://127.0.0.1:${internalPort}/secret`
      });
      assert.equal(repeated.status, 403);
      assert.equal(repeated.json.returnValue, false);
    }

    // Positive allowed public fetch
    const publicOk = await postFetch(pluginPort, {
      requestId: "allowed-public-200",
      url: `http://allowed.public.test:${externalPort}/ok`
    });
    assert.equal(publicOk.status, 200);
    assert.equal(publicOk.json.returnValue, true);
    assert.equal(publicOk.json.status, 200);
    assert.equal(publicOk.json.body, "external-ok");

    // Positive allowed RFC1918 LAN fetch (self-hosted addons/plugins must keep working)
    const lanOk = await postFetch(pluginPort, {
      requestId: "allowed-lan-200",
      url: `http://${MOCK_LAN_IP}:${externalPort}/lan-addon`
    });
    assert.equal(lanOk.status, 200);
    assert.equal(lanOk.json.returnValue, true);
    assert.equal(lanOk.json.status, 200);
    assert.equal(lanOk.json.body, "external-ok");

    assert.equal(externalHits, 6, "Only the 4 redirect probes and 2 allowed fetches hit external");
    assert.equal(internalHits, 0, "Internal loopback server must never receive any request");
  } finally {
    dns.lookup = origLookup;
    net.Socket.prototype.connect = origConnect;
    await closeServer(pluginServer);
    await closeServer(externalServer);
    await closeServer(internalServer);
  }
});
