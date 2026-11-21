import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import urlModule from "node:url";
import vm from "node:vm";
import { transform as esbuildTransform } from "esbuild";

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

test("bitmapSubtitles uses 2-arg http.request, supports Node 4 url without URL constructor, and avoids padEnd", async () => {
  const source = await readFile(
    new URL("../services/webos/src/bitmapSubtitles.js", import.meta.url),
    "utf8"
  );
  assert.equal(
    /\.padEnd\s*\(/.test(source),
    false,
    "bitmapSubtitles must remain Node 4/6 compatible"
  );

  const requestCalls = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/bad-redirect") {
      res.writeHead(302, { Location: "http://[::1" });
      res.end();
      return;
    }
    res.writeHead(416);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const wrappedHttp = {
      request(options, callback) {
        requestCalls.push({ argCount: arguments.length, options, cbType: typeof callback });
        return http.request(options, callback);
      }
    };

    const bitmapSubtitles = loadCommonJsWithMocks(source, "bitmapSubtitles.js", {
      url: { parse: urlModule.parse, resolve: urlModule.resolve },
      http: wrappedHttp
    });

    await assert.rejects(
      () =>
        bitmapSubtitles.prepareBitmapSubtitleSource({ url: `http://127.0.0.1:${port}/video.mkv` }),
      (err) => err && err.code === "RANGE_UNAVAILABLE"
    );
    assert.equal(requestCalls.length, 1);
    assert.equal(requestCalls[0].argCount, 2);
    assert.equal(typeof requestCalls[0].options, "object");
    assert.equal(requestCalls[0].options.hostname, "127.0.0.1");
    assert.equal(requestCalls[0].options.path, "/video.mkv");

    await assert.rejects(
      () =>
        bitmapSubtitles.prepareBitmapSubtitleSource({
          url: `http://127.0.0.1:${port}/bad-redirect`
        }),
      (err) => err && err.code === "INVALID_URL"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Tizen packaging transpiles bitmapSubtitles.js into ES5/Node 4-compatible CommonJS", async () => {
  const [pkgSource, bitmapSource] = await Promise.all([
    readFile(new URL("../scripts/package-tizen.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/webos/src/bitmapSubtitles.js", import.meta.url), "utf8")
  ]);
  assert.match(pkgSource, /esbuildTransform/);

  const transformed = await esbuildTransform(bitmapSource, {
    loader: "js",
    target: "es2015",
    format: "cjs"
  });
  assert.equal(/\basync\s+(?:function|\()/.test(transformed.code), false);
  assert.equal(/\b(?:const|let|class)\b/.test(transformed.code), false);

  const loaded = loadCommonJsWithMocks(transformed.code, "embedded-text-subtitle-parser.cjs", {});
  assert.equal(typeof loaded.getEmbeddedTextSubtitleWindow, "function");
  assert.equal(typeof loaded.getEmbeddedTextSubtitleTimeline, "function");
  assert.equal(typeof loaded.getBitmapSubtitleWindow, "function");
  assert.equal(typeof loaded.prepareBitmapSubtitleSource, "function");
});
