import assert from "node:assert/strict";
import { test } from "node:test";
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { customPosterForItem } = await import("../js/core/poster/customPoster.js");
const { facts } = await import("../js/core/debrid/debridStreamPresentationHelpers-02-has-token.js");
const { createSettingsScreenMethods02 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-02-render-action-row.js");
const { createSettingsScreenMethods03 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-03-render-text-dialog.js");
const { createMetaDetailsScreenMethods18 } =
  await import("../js/ui/screens/detail/metaDetailsScreenMethods-18-stop-trailer-progress-timer.js");

test("encoded shape overrides landscape artwork and preserves original fallback", () => {
  const item = { id: "tt1234", type: "movie", poster: "original", landscapePoster: "wide" };
  const settings = {
    customPosterUrlPattern: "https://posters.test/%7Bshape%7D/{imdb_id}",
    customPosterEnabledScreens: ["home"]
  };
  const result = customPosterForItem(item, "home", "landscape", settings);
  assert.equal(result.poster, "https://posters.test/landscape/tt1234");
  assert.equal(result.rawPosterUrl, "original");
  assert.equal(result.rawLandscapePosterUrl, "wide");
  assert.equal(
    customPosterForItem(item, "home", "landscape", {
      ...settings,
      customPosterUrlPattern: "https://posters.test/{imdb_id}"
    }),
    item
  );
});

test("language matching removes only media titles and keeps genuine repeated tags", () => {
  const languages = (description, title, parsed = {}) =>
    facts({ description, clientResolve: { title, stream: { raw: { parsed } } } }).languages;
  assert.deepEqual(
    languages("The.French.Dispatch.2021.1080p.BluRay.x264.mkv", "The French Dispatch"),
    []
  );
  assert.deepEqual(languages("The.Italian.Job.2003.ENG.x264.mkv", "The Italian Job"), ["EN"]);
  assert.deepEqual(languages("The Italian Job 2003 ITA AC3", "The Italian Job"), ["IT"]);
  assert.deepEqual(languages("French.2020.FRENCH.1080p", "French"), ["FR"]);
  assert.deepEqual(
    languages("The.French.Dispatch.ITA.mkv", "", { parsedTitle: "The French Dispatch" }),
    ["IT"]
  );
  assert.deepEqual(
    languages("The.French.Dispatch", "The French Dispatch", { languages: ["french"] }),
    ["FR"]
  );
  assert.equal(
    facts({
      description: "The.French.Dispatch.1080p.HEVC",
      clientResolve: { title: "The French Dispatch" }
    }).resolution,
    "P1080"
  );
});

test("settings expose switch/radio state and URL fields stay LTR", () => {
  const s = {
    ...createSettingsScreenMethods02(),
    ...createSettingsScreenMethods03(),
    actionMap: new Map(),
    registerAction: () => ""
  };
  assert.match(
    s.renderToggleRow({ title: "Enabled", checked: true }),
    /role="switch" aria-checked="true"/
  );
  assert.match(s.renderToggleRow({ title: "Disabled", checked: false }), /aria-checked="false"/);
  s.openTextDialog({ title: "Server address", inputType: "url", value: "https://server.test" });
  const html = s.renderTextDialog();
  assert.match(html, /type="url"/);
  assert.match(html, /dir="ltr"/);
  assert.match(html, /aria-label="Server address"/);
});

test("trailer errors restore details both before and after its first frame", () => {
  for (const ready of [false, true]) {
    const listeners = new Map();
    const screen = {
      ...createMetaDetailsScreenMethods18(),
      isTrailerPlaying: true,
      trailerVisualReady: ready,
      trailerPlaybackMode: "manual",
      detachTrailerMediaListeners() {},
      stopTrailerPlayback() {
        this.stopped = true;
      }
    };
    screen.bindTrailerVideoEvents({
      addEventListener: (name, handler) => listeners.set(name, handler)
    });
    listeners.get("error")();
    assert.equal(screen.stopped, true);
  }
});

const { QrCodeGenerator } = await import("../js/core/qr/qrCodeGenerator.js");
test("QR generation draws modules once, clips before drawing and avoids pixel readback", () => {
  globalThis.qrcode = () => ({
    addData() {},
    make() {},
    getModuleCount: () => 2,
    isDark: (row, col) => row === col
  });
  const calls = [];
  const context = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) =>
          calls.push([name, ...args]),
      set: () => true
    }
  );
  QrCodeGenerator.generate({ getContext: () => context }, "https://login.test", 100);
  assert.equal(calls.filter(([name]) => name === "fillRect").length, 3);
  assert.ok(
    calls.findIndex(([name]) => name === "clip") < calls.findIndex(([name]) => name === "fillRect")
  );
  assert.ok(!calls.some(([name]) => name === "getImageData" || name === "putImageData"));
  assert.deepEqual(calls.filter(([name]) => name === "fillRect").slice(1), [
    ["fillRect", 40, 40, 10, 10],
    ["fillRect", 50, 50, 10, 10]
  ]);
});

const { watchProgressRepository } =
  await import("../js/data/repository/watchProgressRepository.js");
const { WatchProgressStore } = await import("../js/data/local/watchProgressStore.js");
const { metaRepository } = await import("../js/data/repository/metaRepository.js");
test("progress hydration shares requests, retries failures three times and caches successes", async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  const original = metaRepository.getMetaFromAllAddons;
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  const item = (id) => ({
    contentId: id,
    contentType: "movie",
    positionMs: 10000,
    durationMs: 100000,
    updatedAt: now
  });
  try {
    WatchProgressStore.replaceForProfile("1", [item("tt100")]);
    let calls = 0;
    metaRepository.getMetaFromAllAddons = async () => {
      calls++;
      return null;
    };
    await watchProgressRepository.getRecent();
    await watchProgressRepository.getRecent();
    assert.equal(calls, 1);
    now += 2000;
    await watchProgressRepository.getRecent();
    now += 4000;
    await watchProgressRepository.getRecent();
    now += 50000;
    await watchProgressRepository.getRecent();
    assert.equal(calls, 3);
    WatchProgressStore.replaceForProfile("1", [item("tt200")]);
    let finish;
    metaRepository.getMetaFromAllAddons = () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const first = watchProgressRepository.getRecent();
    const second = watchProgressRepository.getRecent();
    await Promise.resolve();
    assert.equal(calls, 4);
    finish({ status: "success", data: { name: "Known movie" } });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a[0].enrichedMeta.name, "Known movie");
    assert.equal(b[0].enrichedMeta.name, "Known movie");
    await watchProgressRepository.getRecent();
    assert.equal(calls, 4);
  } finally {
    metaRepository.getMetaFromAllAddons = original;
    Date.now = originalNow;
  }
});

const { MediaServerRepository } = await import("../js/data/mediaserver/mediaServerRepository.js");
test("server title fallback survives expired details and still requires exact provider IDs", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = MediaServerRepository.fromBase;
  const originalCached = metaRepository.getCachedMeta;
  const originalMeta = metaRepository.getMetaFromAllAddons;
  const connection = {
    id: "fixture",
    address: "https://server.test",
    providerId: "jellyfin",
    enabled: true,
    remoteUserId: "user",
    libraries: [{ selected: true, id: "movies", kind: "movie" }]
  };
  MediaServerRepository.fromBase = () => connection;
  metaRepository.getCachedMeta = () => null;
  let metadataReads = 0;
  metaRepository.getMetaFromAllAddons = async () => {
    metadataReads++;
    return { status: "success", data: { name: "A Movie" } };
  };
  const requests = [];
  let matchedId = "tt900";
  globalThis.fetch = async (value) => {
    const url = new URL(value);
    requests.push(url);
    const body =
      url.pathname === "/Items"
        ? {
            Items: url.searchParams.has("searchTerm")
              ? [{ Id: "movie", ProviderIds: { Imdb: matchedId } }]
              : []
          }
        : { Id: "movie", MediaSources: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    await MediaServerRepository.streams("nuvio-server://fixture", "movie", "tt900");
    assert.equal(metadataReads, 1);
    assert.ok(requests.some((url) => url.searchParams.get("searchTerm") === "A Movie"));
    assert.ok(requests.some((url) => url.pathname === "/Items/movie"));
    requests.length = 0;
    matchedId = "tt999";
    await MediaServerRepository.streams("nuvio-server://fixture", "movie", "tt900");
    assert.equal(metadataReads, 1, "retain the title across detail cache expiry");
    assert.ok(
      !requests.some((url) => url.pathname === "/Items/movie"),
      "same title with different provider identity must never play"
    );
  } finally {
    globalThis.fetch = originalFetch;
    MediaServerRepository.fromBase = originalBase;
    metaRepository.getCachedMeta = originalCached;
    metaRepository.getMetaFromAllAddons = originalMeta;
  }
});

test("selection dialogs expose checked state while confirmation actions remain buttons", () => {
  const s = { ...createSettingsScreenMethods02(), actionMap: new Map(), registerAction: () => "" };
  s.openOptionDialog({
    title: "Confirm",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" }
    ]
  });
  const actions = s.renderOptionDialog();
  assert.match(actions, /role="button"/);
  assert.ok(!actions.includes("aria-checked"));
  s.openOptionDialog({
    title: "Choose",
    selectedId: "yes",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" }
    ]
  });
  assert.match(s.renderOptionDialog(), /role="radio" aria-checked="true"/);
  assert.match(
    s.renderActionRow({ title: "Memory", value: "2 GB" }),
    /<bdi class="settings-row-value" dir="ltr">2 GB<\/bdi>/
  );
});
