const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const vm = require("node:vm");
const path = require("node:path");

async function main() {
  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        payload: body ? JSON.parse(body) : null
      });
      response.end(
        body.includes('"invalidJson":true')
          ? "invalid JSON"
          : request.url === "/diagnostics"
            ? JSON.stringify({
                returnValue: true,
                protocolVersion: 1,
                recentEvents: [
                  { event: "fetch transport error", details: { error: { code: "ETIMEDOUT" } } }
                ]
              })
            : JSON.stringify({
                returnValue: true,
                body: "manifest",
                cancelled: request.url === "/cancel"
              })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const legacy of [true, false]) {
      const handlers = {};
      function Service() {
        this.register = (name, handler) => {
          handlers[name] = handler;
        };
      }
      const transport = {
        // Node 8 forwards only (options, cb) to ClientRequest. A three-argument
        // call would pass the options object as a response listener and throw.
        request(options, callback) {
          if (legacy) {
            assert.equal(arguments.length, 2, "Node 8 request signature");
            assert.equal(typeof callback, "function");
          }
          assert.equal(options.hostname, "127.0.0.1");
          assert.equal(options.port, 2721);
          return http.request({ ...options, port: server.address().port }, callback);
        }
      };
      vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "../services/webos/plugin/src/index.js"), "utf8"),
        {
          require(name) {
            if (name === "webos-service") return Service;
            if (name === "http") return transport;
            if (name === "../../../plugin-http.cjs")
              return { createPluginHttpServer: () => ({ listening: true }) };
            throw new Error(`Unexpected dependency: ${name}`);
          },
          console,
          Buffer
        }
      );
      async function call(method, payload) {
        return Promise.race([
          new Promise((resolve) => handlers[method]({ payload, respond: resolve })),
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error("Forwarding timed out")), 2000);
            timer.unref();
          })
        ]);
      }
      const payload = {
        requestId: "issue-1026",
        url: "https://example.com/manifest.json",
        headers: { Accept: "application/json" }
      };
      assert.equal((await call("fetch", payload)).body, "manifest");
      assert.equal((await call("cancel", { requestId: payload.requestId })).cancelled, true);
      const invalid = await call("fetch", { invalidJson: true });
      assert.equal(invalid.returnValue, false);
      assert.equal(invalid.errorText, "Invalid local plugin response");
      const calls = received.slice(-3);
      assert.deepEqual(
        calls.map((entry) => entry.path),
        ["/fetch", "/cancel", "/fetch"]
      );
      for (const entry of calls) {
        assert.equal(entry.method, "POST");
        assert.equal(entry.headers["content-type"], "application/json");
      }
      assert.deepEqual(calls[0].payload, payload);
      assert.deepEqual(calls[1].payload, { requestId: payload.requestId });
      const diagnostics = await call("diagnostics", {});
      assert.equal(diagnostics.recentEvents[0].event, "fetch transport error");
      assert.equal(diagnostics.recentEvents[0].details.error.code, "ETIMEDOUT");
      assert.equal(received.at(-1).method, "GET");
      assert.equal(received.at(-1).path, "/diagnostics");
      assert.equal(received.at(-1).payload, null);
    }
    console.log("webOS plugin forwarding tests passed (Node 8 contract and current Node)");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
