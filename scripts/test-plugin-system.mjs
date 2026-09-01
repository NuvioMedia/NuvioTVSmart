import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import vm from "node:vm";
import { createPluginHttpServer } from "../services/plugin-http.cjs";
import {
  PLUGIN_REPOSITORY_TYPES,
  absoluteAnimeEpisodeNumber,
  canonicalizePluginUrl,
  cleanLocalPluginVideoId,
  isPluginShortCode,
  isLocalPluginVideoId,
  isExternalDexRepository,
  isExecutablePluginRepository,
  isExecutableScraper,
  normalizePluginManifest,
  normalizePluginState,
  pluginSupportsType,
  resolvePluginSeasonEpisode,
  sanitizePluginRepositoryInput
} from "../js/core/player/pluginModels.js";
import { parseTmdbIdInput, TmdbService } from "../js/core/tmdb/tmdbService.js";
import { TmdbSettingsStore } from "../js/data/local/tmdbSettingsStore.js";
import {
  normalizePluginHeaders,
  validatePluginFetchRequest,
  validatePluginUrl
} from "../js/core/player/pluginSecurity.js";
import { mapPluginStreamGroup } from "../js/core/player/pluginStreamMapping.js";
import { PluginExecutionFlight } from "../js/core/player/pluginExecutionFlight.js";
import { buildStreamResumeIdentity } from "../js/core/streams/streamResumeIdentity.js";
import {
  ANDROID_PLUGIN_MANAGEMENT_USER_AGENT,
  PluginManager,
  androidResultString,
  resultToStream
} from "../js/core/player/pluginManager.js";
import { PluginStore } from "../js/data/local/pluginStore.js";
import { PluginCodeStore } from "../js/data/local/pluginCodeStore.js";
import { PluginRuntime } from "../js/core/player/pluginRuntime.js";
import { PluginServiceClient } from "../js/platform/pluginServiceClient.js";
import { Platform } from "../js/platform/index.js";
import { buildPluginPushRows, mapRemotePluginRows } from "../js/core/profile/pluginSyncService.js";

const root = new URL("..", import.meta.url);
const execFileAsync = promisify(execFile);

if (!globalThis.localStorage) {
  const testStorage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return testStorage.has(String(key)) ? testStorage.get(String(key)) : null;
    },
    setItem(key, value) {
      testStorage.set(String(key), String(value));
    },
    removeItem(key) {
      testStorage.delete(String(key));
    },
    clear() {
      testStorage.clear();
    }
  };
}

function testModelsAndSecurity() {
  assert.equal(
    canonicalizePluginUrl("https://example.com/repo?channel=stable", { manifest: true }),
    "https://example.com/repo/manifest.json?channel=stable"
  );
  assert.equal(
    sanitizePluginRepositoryInput("stremio://example.com/repo"),
    "https://example.com/repo"
  );
  assert.equal(isPluginShortCode("cspr"), true);
  assert.equal(isPluginShortCode("0094"), true);
  assert.equal(isPluginShortCode("https://example.com/repo"), false);
  assert.equal(isPluginShortCode("example.com/repo"), false);
  assert.equal(isLocalPluginVideoId("kitsu:6448:68"), true);
  assert.equal(isLocalPluginVideoId("anilist:12345:12"), true);
  assert.equal(isLocalPluginVideoId("mal:63375:68"), true);
  assert.equal(isLocalPluginVideoId("anidb:123:12"), false);
  assert.equal(cleanLocalPluginVideoId("kitsu:6448:68"), "kitsu:6448");
  assert.equal(cleanLocalPluginVideoId("kitsu:6448:2147483648"), "kitsu:6448:2147483648");
  assert.equal(cleanLocalPluginVideoId("mal:63375:68"), "mal:63375:68");
  assert.equal(absoluteAnimeEpisodeNumber("anidb:123:12"), 12);
  assert.equal(absoluteAnimeEpisodeNumber("mal:9223372036854775807:68"), 68);
  assert.equal(absoluteAnimeEpisodeNumber("mal:9223372036854775808:68"), null);
  assert.equal(absoluteAnimeEpisodeNumber("mal::12"), null);
  assert.equal(absoluteAnimeEpisodeNumber("mal:abc:12"), null);
  assert.equal(absoluteAnimeEpisodeNumber("mal:63375:ep12"), null);
  assert.deepEqual(resolvePluginSeasonEpisode("kitsu:6448:68", 2, 10), {
    season: null,
    episode: 68
  });
  assert.deepEqual(resolvePluginSeasonEpisode("tt1234567:2:10", 2, 10), {
    season: 2,
    episode: 10
  });
  const state = normalizePluginState({
    repositories: [{ url: "https://example.com/repo" }],
    scrapers: [{ id: "provider", repositoryId: "repo", filename: "provider.js" }]
  });
  assert.equal(state.repositories[0].type, PLUGIN_REPOSITORY_TYPES.UNKNOWN);
  assert.equal(isExecutablePluginRepository(state.repositories[0]), false);
  const dexState = normalizePluginState({
    repositories: [
      { id: "dex", url: "https://example.com/plugin.cs3", type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS }
    ],
    scrapers: [{ repositoryId: "dex", name: "DEX provider" }]
  });
  assert.equal(dexState.repositories[0].type, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX);
  assert.equal(dexState.scrapers[0].type, PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX);
  assert.equal(isExternalDexRepository(dexState.repositories[0]), true);
  assert.equal(isExecutablePluginRepository(dexState.repositories[0]), false);
  const firstPosition = normalizePluginState({
    scrapers: [{ repositoryId: "repo", name: "Stable provider" }]
  }).scrapers[0].id;
  const laterPosition = normalizePluginState({
    scrapers: [{ repositoryId: "other" }, { repositoryId: "repo", name: "Stable provider" }]
  }).scrapers[1].id;
  assert.equal(firstPosition, laterPosition);
  const legacyState = normalizePluginState({
    legacySources: [{ id: "old", urlTemplate: "https://legacy.example/{id}", enabled: true }]
  });
  assert.equal(legacyState.legacySources[0].enabled, true);
  assert.equal(legacyState.legacySources[0].executable, false);
  const duplicateState = normalizePluginState({
    repositories: [
      { url: "https://example.com/repo", type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS },
      { url: "https://example.com/repo", type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX }
    ],
    scrapers: [
      { id: "same", repositoryId: "repo", filename: "one.js" },
      { id: "same", repositoryId: "repo", filename: "two.js" }
    ]
  });
  assert.equal(duplicateState.repositories.length, 1);
  assert.equal(duplicateState.scrapers.length, 2);
  assert.notEqual(duplicateState.scrapers[0].id, duplicateState.scrapers[1].id);
  assert.equal(pluginSupportsType(["tv"], "series"), true);
  assert.equal(pluginSupportsType(["anime"], "series"), true);
  assert.equal(pluginSupportsType(["series"], "anime"), false);
  assert.equal(pluginSupportsType(["tv"], "tv"), true);
  assert.equal(pluginSupportsType(["anime"], "tv"), false);
  assert.equal(pluginSupportsType(["tv"], "other"), true);
  assert.equal(pluginSupportsType(["movie"], "series"), false);
  assert.equal(
    isExecutableScraper(
      {
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        enabled: true,
        manifestEnabled: true,
        supportedPlatforms: ["tizen"]
      },
      { type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS, url: "https://example.com/repo" },
      "webos"
    ),
    true
  );
  assert.equal(
    isExecutableScraper(
      {
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        enabled: true,
        manifestEnabled: false
      },
      { type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS, url: "https://example.com/repo" }
    ),
    true
  );
  assert.equal(
    isExecutableScraper(
      {
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        enabled: true,
        manifestEnabled: true,
        disabledPlatforms: ["tizen"]
      },
      { type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS, url: "https://example.com/repo" },
      "tizen"
    ),
    true
  );
  assert.equal(
    normalizePluginManifest(
      {
        name: "Fixture",
        version: "1",
        scrapers: [
          { id: "one", name: "One", version: "1", filename: "one.js" },
          { id: "one", name: "One", version: "1", filename: "one.js" }
        ]
      },
      "https://example.com/manifest.json"
    ).scrapers.length,
    1
  );
  assert.equal(
    normalizePluginManifest(
      { name: "Empty", version: "1", scrapers: [] },
      "https://example.com/manifest.json"
    ).scrapers.length,
    0
  );
  assert.equal(
    normalizePluginManifest({ name: "Missing version", scrapers: [] }, "https://example.com"),
    null
  );
  assert.equal(
    normalizePluginManifest(
      { name: "Missing scraper fields", version: "1", scrapers: [{ id: "one" }] },
      "https://example.com"
    ),
    null
  );
  assert.equal(normalizePluginManifest(null), null);
  // Android's OkHttp client accepts valid HTTP(S) targets without a public-
  // network policy. Web must not reject local/private hosts, credentials or
  // non-default ports before the request reaches the platform service.
  assert.equal(validatePluginUrl("http://127.0.0.1:2711").ok, true);
  assert.equal(validatePluginUrl("http://169.254.169.254/latest/meta-data").ok, true);
  assert.equal(validatePluginUrl("http://[::ffff:127.0.0.1]/secret").ok, true);
  assert.equal(validatePluginUrl("https://user:pass@example.com/feed.json").ok, true);
  assert.equal(validatePluginUrl("https://example.com:8443/feed.json").ok, true);
  assert.equal(validatePluginUrl("https://example.com/feed.json").ok, true);
  const headers = normalizePluginHeaders({
    Host: "127.0.0.1",
    Authorization: "Bearer test",
    "Content-Length": "1",
    "Accept-Encoding": "gzip"
  });
  assert.equal(headers.Host, "127.0.0.1");
  assert.equal(headers["Content-Length"], "1");
  assert.equal(headers.Authorization, "Bearer test");
  assert.equal(headers["Accept-Encoding"], undefined);
  assert.equal(
    headers["User-Agent"],
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  );
  assert.equal(
    normalizePluginHeaders({ Authorization: "Bearer test" }, { addDefaultUserAgent: false })[
      "User-Agent"
    ],
    undefined
  );
  const normalizedPatch = validatePluginFetchRequest({
    url: "https://example.com:8443",
    method: "PATCH"
  });
  assert.equal(normalizedPatch.ok, true);
  assert.equal(normalizedPatch.method, "GET");
  assert.equal(
    validatePluginFetchRequest(
      { url: "https://example.com", body: "123456789" },
      { maxBodyBytes: 8 }
    ).ok,
    false
  );
}

async function testRuntimeArtifactsAndContracts() {
  const cryptoSource = await readFile(new URL("node_modules/crypto-js/crypto-js.js", root), "utf8");
  assert.equal(
    createHash("sha256").update(cryptoSource).digest("hex"),
    "ee02257ffbaf0a9b481c7039b0f3bb20c360c9674fe4be8b38ae709b2ea59bbe"
  );
  const secureRandomSection = cryptoSource.slice(
    cryptoSource.indexOf("var cryptoSecureRandomInt"),
    cryptoSource.indexOf("var cryptoSecureRandomInt") + 1200
  );
  assert.equal(secureRandomSection.includes("Math.random"), false);
  assert.equal(ANDROID_PLUGIN_MANAGEMENT_USER_AGENT, "NuvioTV/1.0");

  assert.deepEqual(parseTmdbIdInput("603:2:4"), { idPart: "603", kind: "numeric" });
  assert.deepEqual(parseTmdbIdInput("movie:603/extra"), {
    idPart: "603",
    kind: "numeric"
  });
  assert.deepEqual(parseTmdbIdInput("series:tt0133093:1:1"), {
    idPart: "tt0133093",
    kind: "imdb"
  });
  assert.deepEqual(parseTmdbIdInput("TMDB:603"), { idPart: "TMDB", kind: "unknown" });
  // Numeric IDs must bypass Web settings/API-key gates exactly as Android does.
  // Exercise both settings states; the store must not be consulted in this
  // branch, and the configured API key must not be required either.
  const previousTmdbSettingsGet = TmdbSettingsStore.get;
  try {
    for (const enabled of [false, true]) {
      TmdbSettingsStore.get = () => ({ enabled });
      assert.equal(await TmdbService.ensureTmdbId("tmdb:603", "movie"), "603");
      assert.equal(await TmdbService.ensureTmdbId("603", "tv"), "603");
    }
  } finally {
    TmdbSettingsStore.get = previousTmdbSettingsGet;
  }

  assert.equal(
    androidResultString({ key: "value", nested: [1, "two"] }),
    "{key=value, nested=[1, two]}"
  );
  assert.equal(androidResultString("[object Object]"), null);
  assert.equal(androidResultString({ nested: ["[object Object]"] }), null);
  assert.equal(androidResultString({}), "{}");

  const scraper = {
    id: "scraper-1",
    name: "Android scraper",
    logo: "https://logo.example"
  };
  const mapped = resultToStream(
    {
      url: { url: "https://cdn.example/stream.m3u8" },
      title: "",
      name: "Provider result",
      quality: "1080p",
      size: "1.2 GB",
      language: "Italian",
      infoHash: 123,
      headers: { Referer: "https://provider.example", Numeric: 1 },
      link: "https://wrong.example/link",
      streamUrl: "https://wrong.example/stream",
      subtitles: [{ url: "https://cdn.example/sub.vtt", lang: "it", id: 7, name: "Provider" }]
    },
    scraper
  );
  assert.deepEqual(mapped, {
    title: "Provider result",
    name: "Provider result - 1080p",
    url: "https://cdn.example/stream.m3u8",
    description: "1.2 GB • Italian",
    quality: "1080p",
    qualityValue: 1080,
    infoHash: "123",
    addonName: "Android scraper",
    addonLogo: null,
    behaviorHints: {
      notWebReady: null,
      bingeGroup: null,
      countryWhitelist: null,
      proxyHeaders: {
        request: { Referer: "https://provider.example" },
        response: null
      }
    },
    subtitles: [
      {
        id: "7",
        url: "https://cdn.example/sub.vtt",
        lang: "it",
        addonName: "Provider",
        addonLogo: null,
        isStreamProvided: true
      }
    ]
  });
  assert.equal(
    resultToStream({ url: "https://cdn.example/stream", title: "[object Object]" }, scraper).title,
    "Unknown"
  );
  assert.deepEqual(
    resultToStream({ url: "https://cdn.example/stream", title: undefined }, scraper),
    {
      title: "Unknown",
      name: "Unknown",
      url: "https://cdn.example/stream",
      description: null,
      quality: null,
      qualityValue: -1,
      infoHash: null,
      addonName: "Android scraper",
      addonLogo: null,
      behaviorHints: null,
      subtitles: []
    }
  );
  assert.equal(
    resultToStream({ url: "https://cdn.example/stream", link: "https://wrong.example" }, scraper)
      .url,
    "https://cdn.example/stream"
  );
  assert.equal(resultToStream({ url: { url: "[object Object]" } }, scraper).url, "[object Object]");
}

async function testRawScraperTestContract() {
  const previousState = PluginStore.get();
  const previousWorker = globalThis.Worker;
  const previousAllowBrowser = globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__;
  const previousEnsureRuntime = PluginManager.ensureRuntime;
  const previousExecutePlugin = PluginRuntime.executePlugin;
  const scraperId = "raw-test-scraper";
  const repositoryId = "raw-test-repository";
  try {
    globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = true;
    globalThis.Worker = function WorkerStub() {};
    PluginStore.replace(
      normalizePluginState({
        repositories: [
          {
            id: repositoryId,
            url: "https://example.com/plugins/manifest.json",
            name: "Raw test repository",
            type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
            enabled: true
          }
        ],
        scrapers: [
          {
            id: scraperId,
            repositoryId,
            type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
            name: "Raw test scraper",
            filename: "raw.js",
            supportedTypes: ["movie"],
            codeAvailable: true,
            enabled: true
          }
        ],
        settings: { pluginsEnabled: true, groupStreamsByRepository: false }
      })
    );
    await PluginCodeStore.save(
      scraperId,
      "module.exports.getStreams = function(){ return []; };",
      {},
      { maxBytes: 1024 * 1024 }
    );
    PluginManager.ensureRuntime = async () => true;
    PluginRuntime.executePlugin = async () => [
      { url: "https://cdn.example/raw", title: "Raw title", quality: "720p" }
    ];
    const testResult = await PluginManager.testScraper(scraperId, { tmdbId: "603" });
    assert.deepEqual(testResult.results, [
      { url: "https://cdn.example/raw", title: "Raw title", quality: "720p" }
    ]);
    assert.equal(testResult.results[0].addonName, undefined);
  } finally {
    PluginManager.ensureRuntime = previousEnsureRuntime;
    PluginRuntime.executePlugin = previousExecutePlugin;
    await PluginCodeStore.remove(scraperId);
    PluginStore.replace({ ...previousState, syncDirty: false });
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
    if (previousAllowBrowser === undefined)
      delete globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__;
    else globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = previousAllowBrowser;
  }
}

async function testPluginCodeCacheContract() {
  await PluginCodeStore.clearAll();

  const legacyProbe = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const calls = [];
     const values = new Map([['pluginCodeCache', '{"entries":{"large":{"code":"x"}}}']]);
     globalThis.localStorage = {
       getItem: (key) => values.get(String(key)) ?? null,
       setItem: (key, value) => values.set(String(key), String(value)),
       removeItem: (key) => { calls.push(String(key)); values.delete(String(key)); }
     };
     await import('./js/data/local/pluginCodeStore.js');
     console.log(JSON.stringify({ value: values.get('pluginCodeCache') ?? null, calls }));`
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" }
  );
  assert.deepEqual(
    JSON.parse(legacyProbe.stdout.trim()),
    {
      value: null,
      calls: ["pluginCodeCache"]
    },
    "legacy pluginCodeCache must be removed without being parsed or migrated"
  );

  const originalSetItem = globalThis.localStorage.setItem;
  const writes = [];
  globalThis.localStorage.setItem = (key, value) => {
    writes.push([String(key), String(value)]);
    return originalSetItem.call(globalThis.localStorage, key, value);
  };
  try {
    const saveResult = PluginCodeStore.save("async-provider", "éé", {}, { maxBytes: 8 });
    assert.equal(typeof saveResult.then, "function", "cache save must be asynchronous");
    assert.equal(await saveResult, true);
    const getResult = PluginCodeStore.get("async-provider");
    assert.equal(typeof getResult.then, "function", "cache get must be asynchronous");
    assert.equal((await getResult).code, "éé");
    assert.deepEqual(writes, [], "plugin source code must never be persisted in localStorage");

    await PluginCodeStore.clearAll();
    await PluginCodeStore.save("old", "1234", {}, { maxBytes: 4 });
    await PluginCodeStore.save("new", "5678", {}, { maxBytes: 4 });
    assert.equal(await PluginCodeStore.get("old"), null, "LRU quota should evict the oldest entry");
    assert.equal((await PluginCodeStore.get("new")).code, "5678");
    assert.equal(
      await PluginCodeStore.totalBytes(),
      4,
      "quota accounting should reflect evictions"
    );

    await PluginCodeStore.clearAll();
    await PluginCodeStore.save("profile-one-old", "1111", {}, { profile: "1", maxBytes: 4 });
    await PluginCodeStore.save("profile-one-new", "2222", {}, { profile: "1", maxBytes: 4 });
    await PluginCodeStore.save("profile-two-old", "3333", {}, { profile: "2", maxBytes: 4 });
    await PluginCodeStore.save("profile-two-new", "4444", {}, { profile: "2", maxBytes: 4 });
    assert.equal(await PluginCodeStore.get("profile-one-old", "1"), null);
    assert.equal((await PluginCodeStore.get("profile-one-new", "1")).code, "2222");
    assert.equal(await PluginCodeStore.get("profile-two-old", "2"), null);
    assert.equal((await PluginCodeStore.get("profile-two-new", "2")).code, "4444");
    assert.equal(await PluginCodeStore.totalBytes("1"), 4);
    assert.equal(await PluginCodeStore.totalBytes("2"), 4);

    await PluginCodeStore.clearAll();
    await PluginCodeStore.save("same-provider", "profile-one", {}, { profile: "1" });
    await PluginCodeStore.save("same-provider", "profile-two", {}, { profile: "2" });
    assert.equal((await PluginCodeStore.get("same-provider", "1")).code, "profile-one");
    assert.equal((await PluginCodeStore.get("same-provider", "2")).code, "profile-two");
    assert.equal(await PluginCodeStore.clearProfile("2"), true);
    assert.equal(await PluginCodeStore.get("same-provider", "2"), null);
    assert.equal((await PluginCodeStore.get("same-provider", "1")).code, "profile-one");
    assert.equal(
      await PluginCodeStore.clearProfile("1"),
      false,
      "primary profile cannot be cleared by profile deletion"
    );
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
    await PluginCodeStore.clearAll();
  }
}

async function testPluginCodeCacheFailureFallbacks() {
  const runProbe = async (failure) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
         const database = {
           objectStoreNames: { contains: () => true },
           transaction() {
             const transaction = { objectStore: () => ({ put() {}, get() {}, delete() {}, clear() {} }) };
             queueMicrotask(() => transaction.onabort?.());
             return transaction;
           }
         };
         globalThis.indexedDB = {
           open() {
             const request = { result: ${failure === "transaction" ? "database" : "null"} };
             queueMicrotask(() => request.${failure === "open" ? "onerror" : "onsuccess"}?.());
             return request;
           }
         };
         const warnings = [];
         console.warn = (...args) => warnings.push(args.join(' '));
         const { PluginCodeStore } = await import('./js/data/local/pluginCodeStore.js');
         const saved = await PluginCodeStore.save('fallback-provider', 'fallback-code');
         const entry = await PluginCodeStore.get('fallback-provider');
         const removed = await PluginCodeStore.remove('fallback-provider');
         const hidden = await PluginCodeStore.get('fallback-provider');
         const cleared = await PluginCodeStore.clearAll();
         console.log(JSON.stringify({ saved, code: entry?.code ?? null, removed, hidden, cleared, warnings: warnings.length }));`
      ],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" }
    );
    return JSON.parse(stdout.trim().split("\n").at(-1));
  };

  const expected = {
    saved: true,
    code: "fallback-code",
    removed: false,
    hidden: null,
    cleared: false,
    warnings: 2
  };
  assert.deepEqual(
    await runProbe("open"),
    expected,
    "open failure must use usable memory fallback and report unverified persistent cleanup"
  );
  assert.deepEqual(
    await runProbe("transaction"),
    expected,
    "transaction failure must use usable memory fallback and report unverified persistent cleanup"
  );
}

async function testPluginCodeCacheProfileBoundedEnumeration() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
       globalThis.IDBKeyRange = {
         bound: (lower, upper, lowerOpen = false, upperOpen = false) => ({ lower, upper, lowerOpen, upperOpen })
       };
       const records = new Map([
         ['1:plugin_a', { key: '1:plugin_a', code: 'aa', bytes: 2, lastUsedAt: 1 }],
         ['2:plugin_b', { key: '2:plugin_b', code: 'bbbb', bytes: 4, lastUsedAt: 2 }]
       ]);
       const ranges = [];
       const visited = [];
       const request = (result) => { const r = { result }; queueMicrotask(() => r.onsuccess?.()); return r; };
       const store = {
         get: (key) => request(records.get(key)),
         put: (value) => { records.set(value.key, value); return request(value.key); },
         delete: (key) => { records.delete(key); return request(undefined); },
         clear: () => { records.clear(); return request(undefined); },
         openCursor(range) {
           ranges.push(range ?? null);
           const keys = [...records.keys()].sort().filter((key) =>
             !range || (key >= range.lower && key <= range.upper));
           const r = {};
           let index = 0;
           const step = () => {
             if (index >= keys.length) { r.result = null; r.onsuccess?.(); return; }
             const key = keys[index++];
             visited.push(key);
             r.result = { key, value: records.get(key), continue: () => queueMicrotask(step) };
             r.onsuccess?.();
           };
           queueMicrotask(step);
           return r;
         }
       };
       const database = {
         objectStoreNames: { contains: () => true },
         transaction() {
           const tx = { objectStore: () => store };
           setTimeout(() => tx.oncomplete?.(), 0);
           return tx;
         }
       };
       globalThis.indexedDB = { open() { const r = { result: database }; queueMicrotask(() => r.onsuccess?.()); return r; } };
       const { PluginCodeStore } = await import('./js/data/local/pluginCodeStore.js');
       const total = await PluginCodeStore.totalBytes('1');
       const saved = await PluginCodeStore.save('extra', 'zz', {}, { profile: '1', maxBytes: 1024 });
       const cleared = await PluginCodeStore.clear('1');
       const remaining = [...records.keys()];
       console.log(JSON.stringify({ total, saved, cleared, ranges, visited, remaining }));`
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" }
  );
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(result.total, 2, "totalBytes must count only the effective profile");
  assert.equal(result.saved, true);
  assert.equal(result.cleared, true);
  assert.equal(
    result.ranges.length,
    3,
    "save, clear, and totalBytes each enumerate the profile once"
  );
  for (const range of result.ranges) {
    assert.deepEqual(
      range,
      { lower: "1:", upper: "1:\uffff", lowerOpen: false, upperOpen: false },
      "profile enumeration must use a prefix-bounded key range"
    );
  }
  assert.equal(
    result.visited.some((key) => key.startsWith("2:")),
    false,
    "another profile's records must never be visited"
  );
  assert.deepEqual(
    result.remaining,
    ["2:plugin_b"],
    "clearing one profile must leave other profiles' persistent records intact"
  );
}

async function testPluginManagerAwaitsCacheRemoval() {
  const previousState = PluginStore.get();
  const originalRemove = PluginCodeStore.remove;
  let release;
  let settled = false;
  PluginStore.replace(
    normalizePluginState({
      repositories: [
        {
          id: "await-repository",
          url: "https://example.com/repo",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        }
      ],
      scrapers: [
        {
          id: "await-provider",
          repositoryId: "await-repository",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        }
      ]
    })
  );
  PluginCodeStore.remove = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    const removal = PluginManager.removeRepository("await-repository").then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    assert.equal(settled, false, "repository removal must await asynchronous cache deletion");
    release(true);
    assert.equal(await removal, true);
  } finally {
    PluginCodeStore.remove = originalRemove;
    PluginStore.replace({ ...previousState, syncDirty: false });
  }
}

async function testTypedRepositoryReconciliationAwaitsCleanup() {
  const previousState = PluginStore.get();
  const originalFetch = PluginServiceClient.fetch;
  const originalRemove = PluginCodeStore.remove;
  const releases = [];
  let settled = false;
  PluginStore.replace(
    normalizePluginState({
      repositories: [
        {
          id: "typed-dex-repository",
          url: "https://example.com/typed-dex",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        },
        {
          id: "typed-legacy-repository",
          url: "https://example.com/typed-legacy",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        }
      ],
      scrapers: [
        {
          id: "typed-dex-provider",
          repositoryId: "typed-dex-repository",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        },
        {
          id: "typed-legacy-provider",
          repositoryId: "typed-legacy-repository",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS
        }
      ]
    })
  );
  await PluginCodeStore.save("typed-dex-provider", "cached-code");
  await PluginCodeStore.save("typed-legacy-provider", "cached-code");
  PluginServiceClient.fetch = async () => ({
    ok: true,
    status: 200,
    body: JSON.stringify({ plugins: [{ name: "External provider" }] }),
    truncated: false
  });
  PluginCodeStore.remove = () => new Promise((resolve) => releases.push(resolve));
  try {
    const reconciliation = PluginManager.reconcileWithRemoteRepoUrls([
      { url: "https://example.com/typed-dex", repoType: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX },
      { url: "https://example.com/typed-legacy", repoType: PLUGIN_REPOSITORY_TYPES.LEGACY }
    ]).then((value) => {
      settled = true;
      return value;
    });
    for (let attempt = 0; attempt < 10 && releases.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(settled, false, "typed JS-to-DEX reconciliation must await cache cleanup");
    assert.equal(releases.length, 1, "the first typed transition must await cache cleanup");
    releases.shift()(true);
    for (let attempt = 0; attempt < 10 && releases.length < 1; attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(releases.length, 1, "the second typed transition must await cache cleanup");
    releases.shift()(true);
    const reconciled = await reconciliation;
    assert.equal(
      reconciled.repositories.find((entry) => entry.id === "typed-dex-repository").type,
      PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
    );
    assert.equal(
      reconciled.repositories.find((entry) => entry.id === "typed-legacy-repository").type,
      PLUGIN_REPOSITORY_TYPES.LEGACY
    );
    assert.equal(reconciled.scrapers.length, 1, "DEX metadata should be reconciled after cleanup");
  } finally {
    PluginServiceClient.fetch = originalFetch;
    PluginCodeStore.remove = originalRemove;
    PluginStore.replace({ ...previousState, syncDirty: false });
  }
}

async function testAndroidFetchResponseContract() {
  const previousPlatformOverride = globalThis.__NUVIO_PLATFORM__;
  const previousAllowBrowser = globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__;
  const previousPlatform = Platform.current;
  try {
    globalThis.__NUVIO_PLATFORM__ = "browser";
    globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = true;
    Platform.current = null;
    const response = await PluginServiceClient.fetch({
      url: "ftp://example.com/resource",
      androidResponseContract: true
    });
    assert.deepEqual(response, {
      returnValue: true,
      ok: false,
      status: 0,
      statusText: "Only HTTP(S) URLs are allowed",
      url: "ftp://example.com/resource",
      body: "",
      headers: {},
      truncated: false
    });
    await assert.rejects(
      PluginServiceClient.fetch({ url: "ftp://example.com/resource" }),
      /Only HTTP\(S\) URLs are allowed/
    );
  } finally {
    Platform.current = previousPlatform;
    if (previousPlatformOverride === undefined) delete globalThis.__NUVIO_PLATFORM__;
    else globalThis.__NUVIO_PLATFORM__ = previousPlatformOverride;
    if (previousAllowBrowser === undefined)
      delete globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__;
    else globalThis.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = previousAllowBrowser;
    PluginServiceClient.resetHealthCache();
  }
}

async function testPluginUiContract() {
  const source = await readFile(new URL("js/ui/screens/plugin/pluginsScreen.js", root), "utf8");
  assert.equal(source.includes("plugins-message-overlay"), true);
  assert.equal(
    source.includes('duration = kind === "success" ? 3000 : kind === "error" ? 5000 : 0'),
    true
  );
  assert.equal(source.includes('data-action="toggle-global"'), true);
  assert.equal(source.includes('data-action="toggle-group"'), true);
  assert.equal(source.includes("toggleIndicator({ checked: model.pluginsEnabled })"), true);
  assert.equal(
    source.includes("toggleIndicator({ checked: model.groupStreamsByRepository })"),
    true
  );
  // These were Web-only rendered surfaces and must not return while the
  // Android-shaped screen remains the source of truth.
  for (const removedClass of [
    "plugins-runtime-card",
    "plugins-profile-badge",
    "plugins-preserved-card",
    "plugins-footer-note"
  ]) {
    assert.equal(source.includes(removedClass), false);
  }
}

function testDexSyncRoundTripContract() {
  const state = normalizePluginState({
    repositories: [
      {
        id: "js-repository",
        url: "https://js.example/repository",
        name: "JS repository",
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        enabled: true
      },
      {
        id: "dex-repository",
        url: "https://dex.example/repository.cs3",
        name: "DEX repository",
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        enabled: true
      }
    ],
    scrapers: [
      {
        id: "js-provider",
        repositoryId: "js-repository",
        type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
        enabled: false
      },
      {
        id: "dex-provider",
        repositoryId: "dex-repository",
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        enabled: true
      }
    ],
    settings: { pluginsEnabled: false },
    syncDirty: true
  });
  const dex = state.repositories.find((repository) => repository.id === "dex-repository");
  assert.equal(isExternalDexRepository(dex), true);
  assert.equal(isExecutablePluginRepository(dex), false);

  // Web push row -> typed cloud RPC payload. DEX must remain present and
  // must not inherit or alter the global pluginsEnabled setting.
  const pushedRows = buildPluginPushRows(state);
  const pushedDex = pushedRows.find(
    (row) => row.repo_type === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
  );
  assert.deepEqual(pushedDex, {
    url: "https://dex.example/repository.cs3",
    name: "DEX repository",
    enabled: true,
    sort_order: 1,
    repo_type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
  });
  assert.equal("pluginsEnabled" in pushedDex, false);
  assert.equal(state.settings.pluginsEnabled, false);
  assert.equal(
    buildPluginPushRows({
      repositories: [
        {
          url: "https://dex.example/stale.cs3",
          name: "Stale DEX",
          type: PLUGIN_REPOSITORY_TYPES.NUVIO_JS,
          enabled: true
        }
      ]
    })[0].repo_type,
    PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
  );

  // Typed cloud row -> Web pull model -> the Android RemotePluginInfo shape.
  const pulledDex = mapRemotePluginRows(pushedRows).find(
    (repository) => repository.repoType === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
  );
  assert.deepEqual(
    {
      url: pulledDex.url,
      name: pulledDex.name,
      enabled: pulledDex.enabled,
      repoType: pulledDex.repoType
    },
    {
      url: "https://dex.example/repository.cs3",
      name: "DEX repository",
      enabled: true,
      repoType: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX
    }
  );
  assert.deepEqual(
    { url: pulledDex.url, repoType: pulledDex.repoType },
    { url: "https://dex.example/repository.cs3", repoType: "EXTERNAL_DEX" }
  );
}

async function testDexReconciliationSafety() {
  const previousState = PluginStore.get();
  const dexState = normalizePluginState({
    repositories: [
      {
        id: "dex-reconciliation",
        url: "https://dex.example/reconciliation.cs3",
        name: "Protected DEX",
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        enabled: true,
        metadata: { source: "android" }
      }
    ],
    scrapers: [
      {
        id: "dex-reconciliation-provider",
        repositoryId: "dex-reconciliation",
        type: PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX,
        name: "Protected provider",
        enabled: true
      }
    ],
    syncDirty: false
  });
  try {
    PluginStore.replace(dexState);
    assert.equal(await PluginManager.removeRepository("dex-reconciliation"), false);
    assert.equal(PluginManager.setRepositoryEnabled("dex-reconciliation", false), false);
    assert.equal(PluginStore.get().repositories[0].enabled, true);
    // A partial/legacy cloud response contains another opaque row but omits
    // the DEX. Web must retain the DEX repository, its flag and its metadata.
    const reconciled = await PluginManager.reconcileWithRemoteRepoUrls(
      [{ url: "https://future.example/repository", repoType: "FUTURE_REPOSITORY" }],
      { removeMissingLocal: true }
    );
    const dex = reconciled.repositories.find((entry) => entry.id === "dex-reconciliation");
    assert.ok(dex);
    assert.equal(dex.enabled, true);
    assert.deepEqual(dex.metadata, { source: "android" });
    assert.ok(
      reconciled.scrapers.some(
        (entry) => entry.repositoryId === "dex-reconciliation" && entry.type === "EXTERNAL_DEX"
      )
    );
  } finally {
    PluginStore.replace({ ...previousState, syncDirty: false });
  }
}

function testPluginStreamBoundary() {
  const mapped = mapPluginStreamGroup({
    sourceId: "provider-1",
    sourceName: "Provider",
    sourceLogo: "https://cdn.example/logo.png",
    streams: [
      {
        url: "https://cdn.example/stream.m3u8",
        streamOrigin: { kind: "plugin", sourceProviderId: "wrong" }
      }
    ],
    streamOrigin: { kind: "plugin", sourceProviderId: "wrong" }
  });
  assert.equal(mapped.streamOrigin, undefined);
  assert.equal(mapped.sourceProviderId, "provider-1");
  assert.equal(mapped.streams[0].streamOrigin, undefined);
  assert.equal(mapped.streams[0].sourceProviderId, "provider-1");
  assert.equal(mapped.streams[0].addonName, "Provider");

  // streamOrigin is intentionally removed at the plugin boundary. Once the
  // Android-equivalent owner fields exist, it must not alter resume identity.
  const streamWithOrigin = {
    ...mapped.streams[0],
    infoHash: "ABC123",
    streamOrigin: { kind: "plugin", sourceProviderId: "different-provider" }
  };
  const streamWithoutOrigin = { ...streamWithOrigin };
  delete streamWithoutOrigin.streamOrigin;
  assert.equal(
    buildStreamResumeIdentity(streamWithOrigin),
    buildStreamResumeIdentity(streamWithoutOrigin)
  );
}

async function testPluginExecutionFlight() {
  const flight = new PluginExecutionFlight();
  const firstController = new AbortController();
  const secondController = new AbortController();
  let executions = 0;
  let executionSignal = null;
  let release;
  const sharedTask = (signal) => {
    executions += 1;
    executionSignal = signal;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const first = flight.run("same-request", sharedTask, {
    signal: firstController.signal,
    abortedValue: []
  });
  const second = flight.run("same-request", sharedTask, {
    signal: secondController.signal,
    abortedValue: []
  });
  await Promise.resolve();
  firstController.abort();
  assert.deepEqual(await first, []);
  assert.equal(executions, 1);
  assert.equal(executionSignal.aborted, false);
  release(["shared-result"]);
  assert.deepEqual(await second, ["shared-result"]);

  const abortFlight = new PluginExecutionFlight();
  const thirdController = new AbortController();
  const fourthController = new AbortController();
  let underlyingAborted = false;
  const abortableTask = (signal) =>
    new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          underlyingAborted = true;
          resolve([]);
        },
        { once: true }
      );
    });
  const third = abortFlight.run("cancelled-request", abortableTask, {
    signal: thirdController.signal,
    abortedValue: []
  });
  const fourth = abortFlight.run("cancelled-request", abortableTask, {
    signal: fourthController.signal,
    abortedValue: []
  });
  await Promise.resolve();
  thirdController.abort();
  fourthController.abort();
  assert.deepEqual(await third, []);
  assert.deepEqual(await fourth, []);
  assert.equal(underlyingAborted, true);
}

async function listen(server, host = "127.0.0.1") {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function testNetworkService() {
  const service = createPluginHttpServer({ port: 0, logger: { warn() {} } });
  const target = http.createServer((request, response) => {
    if (request.url === "/data") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, items: [{ url: "https://cdn.example/stream" }] }));
      return;
    }
    if (request.url === "/echo") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            method: request.method,
            userAgent: request.headers["user-agent"] || "",
            acceptEncoding: request.headers["accept-encoding"] || "",
            contentType: request.headers["content-type"] || "",
            contentLength: request.headers["content-length"] || "",
            transferEncoding: request.headers["transfer-encoding"] || "",
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      });
      return;
    }
    if (request.url === "/large") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("x".repeat(4096));
      return;
    }
    if (request.url === "/status-404") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("missing");
      return;
    }
    if (request.url === "/status-500") {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("broken");
      return;
    }
    if (request.url === "/latin1") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=ISO-8859-1" });
      response.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
      return;
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/redirect" });
      response.end();
      return;
    }
    if (request.url === "/slow") {
      request.once("close", () => {
        try {
          response.destroy();
        } catch (_) {}
      });
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  const targetPort = await listen(target);
  const originalLookup = dns.lookup;
  const originalRequest = http.request;
  dns.lookup = function (hostname, options, callback) {
    if (String(hostname) === "fixture.public.test") {
      const cb = typeof options === "function" ? options : callback;
      if (typeof options === "function") cb(null, "198.51.100.10");
      else cb(null, [{ address: "198.51.100.10", family: 4 }]);
      return;
    }
    return originalLookup.call(dns, hostname, options, callback);
  };
  http.request = function (options, callback) {
    if (options && ["198.51.100.10", "2001:db8::1"].includes(options.hostname)) {
      return originalRequest.call(
        http,
        { ...options, hostname: "127.0.0.1", port: targetPort },
        callback
      );
    }
    return originalRequest.call(http, options, callback);
  };
  let port;
  try {
    port = await listen(service);
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthPayload = await health.json();
    assert.equal(healthPayload.returnValue, true);
    assert.equal(healthPayload.protocolVersion, 1);
    assert.equal(healthPayload.networkBoundary, true);

    const capabilities = await fetch(`${baseUrl}/capabilities`);
    assert.equal((await capabilities.json()).jsPluginCapability, true);
    const diagnostics = await fetch(`${baseUrl}/diagnostics`);
    assert.equal((await diagnostics.json()).returnValue, true);
    const cacheClear = await postJson(`${baseUrl}/cache/clear`, {});
    assert.equal((await cacheClear.json()).cleared, true);

    const executed = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-execute",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/data",
      method: "GET",
      maxResponseBytes: 1024
    });
    assert.equal(executed.status, 200);
    const executedPayload = await executed.json();
    assert.equal(executedPayload.ok, true);
    assert.equal(executedPayload.truncated, false);
    assert.equal(JSON.parse(executedPayload.body).items[0].url, "https://cdn.example/stream");

    const publicIpv6 = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-public-ipv6",
      scraperId: "fixture-scraper",
      url: "http://[2001:db8::1]/data",
      method: "GET",
      maxResponseBytes: 1024
    });
    assert.equal(publicIpv6.status, 200);
    assert.equal((await publicIpv6.json()).ok, true);

    const truncated = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-large",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/large",
      method: "GET",
      maxResponseBytes: 1024
    });
    const truncatedPayload = await truncated.json();
    assert.equal(truncatedPayload.returnValue, true);
    assert.equal(truncatedPayload.ok, true);
    assert.equal(truncatedPayload.status, 200);
    assert.equal(truncatedPayload.truncated, true);
    assert.equal(Buffer.byteLength(truncatedPayload.body), 1024);

    // HTTP error responses remain responses with their real status. Only a
    // transport/validation failure maps to Android's status=0 contract.
    const http404 = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-http-404",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/status-404",
      method: "GET"
    });
    const http404Payload = await http404.json();
    assert.equal(http404Payload.returnValue, true);
    assert.equal(http404Payload.ok, false);
    assert.equal(http404Payload.status, 404);
    assert.equal(http404Payload.truncated, false);
    assert.equal(http404Payload.body, "missing");

    const http500 = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-http-500",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/status-500",
      method: "GET"
    });
    const http500Payload = await http500.json();
    assert.equal(http500Payload.returnValue, true);
    assert.equal(http500Payload.ok, false);
    assert.equal(http500Payload.status, 500);
    assert.equal(http500Payload.truncated, false);
    assert.equal(http500Payload.body, "broken");

    const redirect = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-redirect",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/redirect",
      method: "GET"
    });
    assert.equal(redirect.status, 502);

    const unknownCancel = await postJson(`${baseUrl}/cancel`, { requestId: "not-running" });
    assert.equal((await unknownCancel.json()).cancelled, false);

    const slowRequest = postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-cancel",
      scraperId: "fixture-scraper",
      url: "http://fixture.public.test/slow",
      method: "GET"
    });
    let active = false;
    for (let attempt = 0; attempt < 20 && !active; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const payload = await (await fetch(`${baseUrl}/diagnostics`)).json();
      active = Number(payload.activeRequests || 0) > 0;
    }
    assert.equal(active, true);
    const cancelled = await postJson(`${baseUrl}/cancel`, { requestId: "fixture-cancel" });
    assert.equal((await cancelled.json()).cancelled, true);
    const cancelledResult = await slowRequest;
    assert.equal(cancelledResult.status, 502);

    const localTarget = await postJson(`${baseUrl}/fetch`, {
      url: `http://127.0.0.1:${targetPort}/data`,
      method: "GET"
    });
    assert.equal(localTarget.status, 200);
    assert.equal((await localTarget.json()).ok, true);
    const credentialTarget = await postJson(`${baseUrl}/fetch`, {
      url: `http://user:pass@127.0.0.1:${targetPort}/data`,
      method: "GET"
    });
    assert.equal(credentialTarget.status, 200);
    assert.equal((await credentialTarget.json()).ok, true);

    const latin1Target = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-response-charset",
      scraperId: "fixture-scraper",
      url: `http://127.0.0.1:${targetPort}/latin1`,
      method: "GET"
    });
    assert.equal((await latin1Target.json()).body, "café");

    const postTarget = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-post-defaults",
      scraperId: "fixture-scraper",
      url: `http://127.0.0.1:${targetPort}/echo`,
      method: "POST",
      body: "a=1"
    });
    const postPayload = JSON.parse((await postTarget.json()).body);
    assert.deepEqual(postPayload, {
      method: "POST",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      acceptEncoding: "gzip",
      contentType: "application/x-www-form-urlencoded",
      contentLength: "3",
      transferEncoding: "",
      body: "a=1"
    });
    const managementTarget = await postJson(baseUrl + "/fetch", {
      requestId: "fixture-management-user-agent",
      scraperId: "fixture-scraper",
      url: "http://127.0.0.1:" + targetPort + "/echo",
      method: "GET",
      headers: { "User-Agent": ANDROID_PLUGIN_MANAGEMENT_USER_AGENT }
    });
    const managementPayload = JSON.parse((await managementTarget.json()).body);
    assert.equal(managementPayload.userAgent, "NuvioTV/1.0");
    const putTarget = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-put-defaults",
      scraperId: "fixture-scraper",
      url: `http://127.0.0.1:${targetPort}/echo`,
      method: "PUT",
      body: '{"a":1}'
    });
    const putPayload = JSON.parse((await putTarget.json()).body);
    assert.equal(putPayload.method, "PUT");
    assert.equal(
      putPayload.userAgent,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );
    assert.equal(putPayload.acceptEncoding, "gzip");
    assert.equal(putPayload.contentType, "application/json");
    assert.equal(putPayload.contentLength, "7");
    assert.equal(putPayload.transferEncoding, "");
    assert.equal(putPayload.body, '{"a":1}');
    const customContentType = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-content-type-case",
      scraperId: "fixture-scraper",
      url: `http://127.0.0.1:${targetPort}/echo`,
      method: "POST",
      headers: {
        "content-type": "application/custom",
        "content-length": "999",
        "transfer-encoding": "chunked"
      },
      body: "é"
    });
    const customContentTypePayload = JSON.parse((await customContentType.json()).body);
    assert.equal(customContentTypePayload.contentType, "application/custom");
    assert.equal(customContentTypePayload.contentLength, "2");
    assert.equal(customContentTypePayload.transferEncoding, "");
    assert.equal(customContentTypePayload.body, "é");
    const deleteTarget = await postJson(`${baseUrl}/fetch`, {
      requestId: "fixture-delete-no-body",
      scraperId: "fixture-scraper",
      url: `http://127.0.0.1:${targetPort}/echo`,
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "999",
        "Transfer-Encoding": "chunked"
      },
      body: "must-not-be-sent"
    });
    const deletePayload = JSON.parse((await deleteTarget.json()).body);
    assert.equal(deletePayload.method, "DELETE");
    assert.equal(
      deletePayload.userAgent,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );
    assert.equal(deletePayload.acceptEncoding, "gzip");
    assert.equal(deletePayload.contentType, "");
    assert.equal(deletePayload.contentLength, "");
    assert.equal(deletePayload.transferEncoding, "");
    assert.equal(deletePayload.body, "");

    const malformed = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json"
    });
    assert.equal(malformed.status, 400);
  } finally {
    dns.lookup = originalLookup;
    http.request = originalRequest;
    await close(service);
    await close(target);
  }

  const restarted = createPluginHttpServer({ port: 0, logger: { warn() {} } });
  const restartedPort = await listen(restarted);
  try {
    assert.equal(
      (await (await fetch(`http://127.0.0.1:${restartedPort}/health`)).json()).returnValue,
      true
    );
  } finally {
    await close(restarted);
  }
}

async function testRealManifestSnapshots() {
  const fixture = JSON.parse(
    await readFile(new URL("scripts/fixtures/plugins/real-repositories.json", root), "utf8")
  );
  assert.equal(fixture.capturedAt, "2026-08-31");
  assert.equal(fixture.repositories.length, 3);
  for (const repository of fixture.repositories) {
    assert.match(repository.manifestSha256, /^[a-f0-9]{64}$/);
    const manifest = normalizePluginManifest(
      {
        name: repository.name,
        version: "fixture",
        scrapers: repository.scrapers.map((scraper) => ({
          ...scraper,
          version: scraper.version || "fixture"
        }))
      },
      repository.manifestUrl
    );
    assert.equal(manifest.name, repository.name);
    assert.equal(manifest.scrapers.length, repository.scrapers.length);
    for (const scraper of manifest.scrapers) {
      assert.ok(scraper.filename);
      assert.ok(scraper.supportedTypes.length);
      assert.ok(
        pluginSupportsType(
          scraper.supportedTypes,
          scraper.supportedTypes.includes("tv") ? "series" : scraper.supportedTypes[0]
        )
      );
    }
  }
}

async function runWorker(request, responseBody = "") {
  const workerSource = await readFile(
    new URL("dist/assets/runtime/plugin-worker.js", root),
    "utf8"
  );
  const quickJsSource = await readFile(
    new URL("dist/assets/libs/quickjs-emscripten.global.js", root),
    "utf8"
  );
  let settled = false;
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const sandbox = {
    Array,
    ArrayBuffer,
    Date,
    Error,
    Promise,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    URLSearchParams,
    WebAssembly,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    clearTimeout,
    console: { log() {}, info() {}, warn() {}, error() {} },
    decodeURIComponent,
    encodeURIComponent,
    escape,
    setTimeout,
    unescape
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.postMessage = (message) => {
    if (message.type === "fetch") {
      setTimeout(() => {
        sandbox.onmessage({
          data: {
            type: "fetchResult",
            requestId: message.requestId,
            payload: {
              returnValue: true,
              ok: true,
              status: 200,
              statusText: "OK",
              url: message.payload.url,
              headers: { "content-type": "application/json" },
              body: responseBody
            }
          }
        });
      }, 5);
      return;
    }
    if (message.type === "cancel") {
      setTimeout(() => {
        sandbox.onmessage({
          data: {
            type: "fetchResult",
            requestId: message.requestId,
            error: "Plugin request cancelled"
          }
        });
      }, 0);
      return;
    }
    if ((message.type === "result" || message.type === "error") && !settled) {
      settled = true;
      resolveResult(message);
    }
  };
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (relativePath) => {
    assert.equal(relativePath, "../libs/quickjs-emscripten.global.js");
    vm.runInContext(quickJsSource, context, { filename: "quickjs-emscripten.global.js" });
  };
  vm.runInContext(workerSource, context, { filename: "plugin-worker.js" });
  sandbox.onmessage({ data: { ...request, type: "execute" } });
  let timeoutId = 0;
  try {
    return await Promise.race([
      resultPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Worker integration test timed out")), 15000);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function testWorkerRuntime() {
  const responseBody = JSON.stringify({ items: [{ url: "https://cdn.example/stream" }] });
  const compatible = await runWorker(
    {
      executionId: "test-compatible",
      scraperId: "test-scraper",
      filename: "test.js",
      args: { tmdbId: "123", mediaType: "movie", season: null, episode: null },
      quota: {
        maxCodeBytes: 1024 * 1024,
        maxResultsPerScraper: 25,
        memoryLimitBytes: 32 * 1024 * 1024
      },
      timeoutMs: 5000,
      code: `module.exports.getStreams = async function() {
      var response = await fetch("https://example.com/data");
      var body = await response.json();
      console.debug("android-compatible debug");
      if (btoa("é") !== "6Q==" || atob("6Q==") !== "é") throw new Error("Base64 compatibility mismatch");
      if (new URL("child", "https://example.com/path/index").href !== "https://example.com/path/child") throw new Error("URL compatibility mismatch");
      var params = new URLSearchParams("?a=1&a=2");
      params.append("a", "3");
      params.set("b", "hello world");
      if (params.getAll("a").length !== 1 || params.get("a") !== "3" || params.get("b") !== "hello world" || params.toString() !== "a=3&b=hello%20world") throw new Error("URL bridge mismatch");
      if (typeof Headers !== "undefined" || typeof Response !== "undefined" || typeof Cheerio !== "undefined") throw new Error("Android-only globals leaked");
      if (typeof cheerio !== "object" || typeof cheerio.load !== "function" || typeof require !== "function") throw new Error("Android module globals missing");
      var $ = cheerio.load("<div><span class='title'>Movie</span><b>Extra</b></div>");
      if ($("div").children().length !== 2 || $("span").parent().length !== 0 || $("div").find("span").get(0).text() !== "Movie") throw new Error("Cheerio Android semantics mismatch");
      var whitespace = cheerio.load("<div>  One <span> two </span>\\n  three </div>");
      if (whitespace("div").text() !== "One two three") throw new Error("Jsoup text normalization mismatch");
      var implicitTable = cheerio.load("<table><tr><td>One</td></tr></table>");
      if (implicitTable("tbody tr td").text() !== "One") throw new Error("Jsoup table parsing mismatch");
      var malformed = cheerio.load("<section><p title='x' data-empty=''>A &amp; B");
      if (malformed("section p").text() !== "A & B" || malformed("p").attr("title") !== "x" || malformed("p").attr("data-empty") !== undefined) throw new Error("HTML/entity compatibility mismatch");
      if (malformed(".missing").length !== 0 || malformed(".missing").text() !== "" || malformed(".missing").attr("title") !== undefined) throw new Error("Empty selection compatibility mismatch");
      var crypto = require("crypto-js");
      if (globalThis.CryptoJS !== crypto) throw new Error("CryptoJS global/module identity mismatch");
      var digestVectors = {
        MD5: "900150983cd24fb0d6963f7d28e17f72",
        SHA1: "a9993e364706816aba3e25717850c26c9cd0d89d",
        SHA224: "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7",
        SHA256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        SHA384: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
        SHA512: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        SHA3: "18587dc2ea106b9a1563e32b3312421ca164c7f1f07bc922a9c83d77cea3a1e5d0c69910739025372dc14ac9642629379540c17e2a65b19d77aa511a9d00bb96",
        RIPEMD160: "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc"
      };
      Object.keys(digestVectors).forEach(function(name) {
        if (typeof crypto[name] !== "function" || crypto[name]("abc").toString() !== digestVectors[name]) throw new Error("CryptoJS digest mismatch: " + name);
      });
      if (crypto.HmacSHA256("The quick brown fox jumps over the lazy dog", "key").toString() !== "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8") throw new Error("CryptoJS HMAC mismatch");
      if (crypto.PBKDF2("password", "salt", {keySize: 8, iterations: 1}).toString() !== "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b") throw new Error("CryptoJS PBKDF2 mismatch");
      if (crypto.EvpKDF("password", "salt", {keySize: 8, iterations: 1}).toString() !== "b305cadbb3bce54f3aa59c64fec00deafbd28d83f3c683b3302442f40407b2b2") throw new Error("CryptoJS EvpKDF mismatch");
      if (crypto.enc.Hex.stringify(crypto.enc.Utf8.parse("abc")) !== "616263") throw new Error("CryptoJS Hex encoder mismatch");
      if (crypto.enc.Base64.stringify(crypto.enc.Utf8.parse("Hello, world!")) !== "SGVsbG8sIHdvcmxkIQ==") throw new Error("CryptoJS Base64 encoder mismatch");
      var base64urlValue = crypto.enc.Base64url.stringify(crypto.enc.Utf8.parse("Hello, world!"));
      if (base64urlValue !== "SGVsbG8sIHdvcmxkIQ") throw new Error("CryptoJS Base64url encoder mismatch: " + base64urlValue);
      if (crypto.enc.Latin1.stringify(crypto.enc.Hex.parse("636166e9")) !== "café") throw new Error("CryptoJS Latin1 encoder mismatch");
      if (crypto.enc.Utf16.parse("abc").toString(crypto.enc.Utf16) !== "abc") throw new Error("CryptoJS Utf16 encoder mismatch");
      if (crypto.enc.Utf16LE.parse("abc").toString(crypto.enc.Utf16LE) !== "abc") throw new Error("CryptoJS Utf16LE encoder mismatch");
      ["WordArray", "CipherParams", "Base", "BufferedBlockAlgorithm", "Hasher", "Cipher", "StreamCipher", "BlockCipherMode", "BlockCipher", "SerializableCipher", "PasswordBasedCipher"].forEach(function(name) {
        if (typeof crypto.lib[name] !== "object" && typeof crypto.lib[name] !== "function") throw new Error("CryptoJS core API missing: " + name);
      });
      ["CBC", "CFB", "CTR", "CTRGladman", "OFB", "ECB"].forEach(function(name) {
        if (!crypto.mode[name]) throw new Error("CryptoJS mode missing: " + name);
      });
      ["Pkcs7", "AnsiX923", "Iso10126", "Iso97971", "ZeroPadding", "NoPadding"].forEach(function(name) {
        if (!crypto.pad[name]) throw new Error("CryptoJS padding missing: " + name);
      });
      ["AES", "DES", "TripleDES", "RC4", "RC4Drop", "Rabbit", "RabbitLegacy", "Blowfish"].forEach(function(name) {
        if (typeof crypto[name] !== "object" && typeof crypto[name] !== "function") throw new Error("CryptoJS cipher missing: " + name);
      });
      var key = crypto.enc.Hex.parse("000102030405060708090a0b0c0d0e0f");
      var iv = crypto.enc.Hex.parse("101112131415161718191a1b1c1d1e1f");
      function aesRoundTrip(modeName, paddingName) {
        var options = {mode: crypto.mode[modeName], padding: crypto.pad[paddingName]};
        if (modeName !== "ECB") options.iv = iv;
        var cipher = crypto.AES.encrypt("Message", key, options);
        var clear = crypto.AES.decrypt(cipher, key, options).toString(crypto.enc.Utf8);
        if (clear !== "Message") throw new Error("CryptoJS AES mode/padding mismatch: " + modeName + "/" + paddingName);
      }
      [["CBC", "Pkcs7"], ["CBC", "AnsiX923"], ["CBC", "Iso97971"], ["CBC", "ZeroPadding"], ["CFB", "NoPadding"], ["CTR", "NoPadding"], ["CTRGladman", "NoPadding"], ["OFB", "NoPadding"], ["ECB", "Pkcs7"]].forEach(function(pair) { aesRoundTrip(pair[0], pair[1]); });
      var desKey = crypto.enc.Hex.parse("0123456789abcdef");
      var desIv = crypto.enc.Hex.parse("1234567890abcdef");
      var desCipher = crypto.DES.encrypt("Message", desKey, {iv: desIv, mode: crypto.mode.CBC, padding: crypto.pad.Pkcs7});
      if (crypto.DES.decrypt(desCipher, desKey, {iv: desIv, mode: crypto.mode.CBC, padding: crypto.pad.Pkcs7}).toString(crypto.enc.Utf8) !== "Message") throw new Error("CryptoJS DES mismatch");
      var tripleKey = crypto.enc.Hex.parse("0123456789abcdeffedcba98765432100f1e2d3c4b5a6978");
      var tripleCipher = crypto.TripleDES.encrypt("Message", tripleKey, {iv: desIv, mode: crypto.mode.CBC, padding: crypto.pad.Pkcs7});
      if (crypto.TripleDES.decrypt(tripleCipher, tripleKey, {iv: desIv, mode: crypto.mode.CBC, padding: crypto.pad.Pkcs7}).toString(crypto.enc.Utf8) !== "Message") throw new Error("CryptoJS TripleDES mismatch");
      ["RC4", "RC4Drop", "RabbitLegacy"].forEach(function(name) {
        var streamCipher = crypto[name].encrypt("Message", key);
        if (crypto[name].decrypt(streamCipher, key).toString(crypto.enc.Utf8) !== "Message") throw new Error("CryptoJS stream cipher mismatch: " + name);
      });
      try {
        crypto.lib.WordArray.random(8);
        throw new Error("CryptoJS secure-random fallback unexpectedly available");
      } catch (randomError) {
        if (String(randomError && randomError.message || randomError).indexOf("Native crypto module") < 0) throw randomError;
      }
      var provider = crypto.SHA256("test").toString();
      var quality = new URL(response.url).hostname === "example.com" ? "1080" : "720";
      var eachText = "";
      $(".title").each(function() { eachText += $(this).text(); });
      if (eachText !== "Movie") throw new Error("Cheerio callback mismatch");
      return [{ url: body.items[0].url, title: $(".title").text(), quality: quality, provider: provider }];
    };`
    },
    responseBody
  );
  assert.equal(compatible.type, "result", compatible.error || "worker returned no result");
  assert.deepEqual(JSON.parse(JSON.stringify(compatible.results)), [
    {
      url: "https://cdn.example/stream",
      title: "Movie",
      quality: "1080",
      provider: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  ]);

  const dynamicEvaluation = await runWorker({
    executionId: "test-dynamic-evaluation",
    filename: "unsafe.js",
    args: { tmdbId: "123", mediaType: "movie" },
    quota: {
      maxCodeBytes: 1024 * 1024,
      maxResultsPerScraper: 25,
      memoryLimitBytes: 32 * 1024 * 1024
    },
    timeoutMs: 5000,
    code: `module.exports.getStreams = function(){
      var factory = new Function("return [{url: 'https://cdn.example/eval'}];");
      return eval("factory()") ;
    };`
  });
  assert.equal(
    dynamicEvaluation.type,
    "result",
    dynamicEvaluation.error || "dynamic evaluation compatibility failed"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(dynamicEvaluation.results)), [
    { url: "https://cdn.example/eval" }
  ]);

  const realProviderMarker = await runWorker({
    executionId: "test-real-provider-marker",
    filename: "providers/anime-sama.js",
    args: { tmdbId: "123", mediaType: "tv", season: 1, episode: 2 },
    quota: {
      maxCodeBytes: 1024 * 1024,
      maxResultsPerScraper: 25,
      memoryLimitBytes: 32 * 1024 * 1024
    },
    timeoutMs: 5000,
    code: `module.exports.getStreams = function(tmdbId, mediaType, season, episode) {
      var deobfuscationMarker = "eval(function(p,a,c,k,e,d)";
      return [{ url: "https://cdn.example/episode.m3u8", title: tmdbId + ":" + mediaType, quality: season + "x" + episode, marker: deobfuscationMarker }];
    };`
  });
  assert.equal(
    realProviderMarker.type,
    "result",
    realProviderMarker.error || "real-provider compatibility marker failed"
  );
  assert.equal(JSON.parse(JSON.stringify(realProviderMarker.results))[0].quality, "1x2");

  const internalAbort = await runWorker({
    executionId: "test-internal-abort",
    filename: "abort.js",
    args: { tmdbId: "123", mediaType: "movie" },
    quota: {
      maxCodeBytes: 1024 * 1024,
      maxResultsPerScraper: 25,
      memoryLimitBytes: 32 * 1024 * 1024
    },
    timeoutMs: 5000,
    code: `module.exports.getStreams = async function() {
      var controller = new AbortController();
      var request = fetch("https://example.com/slow", { signal: controller.signal });
      controller.abort();
      try { await request; } catch (error) { return []; }
      throw new Error("AbortController did not cancel the fetch");
    };`
  });
  assert.equal(internalAbort.type, "result", internalAbort.error || "internal abort failed");
  assert.deepEqual(JSON.parse(JSON.stringify(internalAbort.results)), []);

  const timedOut = await runWorker({
    executionId: "test-timeout",
    filename: "timeout.js",
    args: { tmdbId: "123", mediaType: "movie" },
    quota: {
      maxCodeBytes: 1024 * 1024,
      maxResultsPerScraper: 25,
      memoryLimitBytes: 32 * 1024 * 1024
    },
    timeoutMs: 150,
    code: "module.exports.getStreams = function(){ while (true) {} };"
  });
  assert.equal(timedOut.type, "error");
}

async function main() {
  testModelsAndSecurity();
  await testRuntimeArtifactsAndContracts();
  await testPluginCodeCacheContract();
  await testPluginCodeCacheFailureFallbacks();
  await testPluginCodeCacheProfileBoundedEnumeration();
  await testPluginManagerAwaitsCacheRemoval();
  await testTypedRepositoryReconciliationAwaitsCleanup();
  await testRawScraperTestContract();
  await testAndroidFetchResponseContract();
  await testPluginUiContract();
  testDexSyncRoundTripContract();
  await testDexReconciliationSafety();
  testPluginStreamBoundary();
  await testPluginExecutionFlight();
  await testRealManifestSnapshots();
  await testNetworkService();
  await testWorkerRuntime();
  console.log("plugin system tests passed");
}

await main();
