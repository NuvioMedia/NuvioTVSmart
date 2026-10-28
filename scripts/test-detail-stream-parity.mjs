import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";

const files = [
  [
    "stream/streamScreenHelpers-02-flatten-streams.js",
    "getStreamHeadline, getStreamDescriptionLines"
  ],
  [
    "detail/metaDetailsScreenMethods-10-get-episode-card-presentation.js",
    "createMetaDetailsScreenMethods10"
  ],
  [
    "detail/metaDetailsScreenMethods-11-sync-rendered-episode-track.js",
    "createMetaDetailsScreenMethods11"
  ],
  ["stream/streamScreenMethods-06-apply-addon-filter-dom-state.js", "createStreamScreenMethods06"],
  [
    "stream/streamScreenMethods-08-build-web-os-native-player-launch-parameters.js",
    "createStreamScreenMethods08"
  ],
  ["../../data/local/layoutPreferences.js", "LayoutPreferences"],
  [
    "home/homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms.js",
    "buildModernHomeSizingStyle"
  ],
  ["stream/streamScreenMethods-01-cancel-scheduled-render.js", "createStreamScreenMethods01"],
  [
    "detail/metaDetailsScreenMethods-12-get-episode-hold-menu-options.js",
    "createMetaDetailsScreenMethods12"
  ],
  ["detail/metaDetailsScreenMethods-14-move-episode-focus.js", "createMetaDetailsScreenMethods14"],
  [
    "detail/metaDetailsScreenMethods-15-refresh-episode-playback-state.js",
    "createMetaDetailsScreenMethods15"
  ],
  [
    "detail/metaDetailsScreenMethods-16-render-comments-section.js",
    "createMetaDetailsScreenMethods16"
  ],
  [
    "stream/streamScreenMethods-07-restore-stream-virtual-scroll-position.js",
    "createStreamScreenMethods07"
  ],
  ["stream/streamScreenMethods-09-render.js", "createStreamScreenMethods09"]
];
const bundle = await build({
  stdin: {
    contents: files
      .map(([file, name]) => `export {${name}} from './js/ui/screens/${file}';`)
      .join("\n"),
    resolveDir: process.cwd()
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "subject",
  plugins: [
    {
      name: "fixtures",
      setup(b) {
        b.onLoad(
          {
            filter:
              /(?:(?:metaDetailsScreenMethods-(?:10|11|12|14|15|16)|streamScreenMethods-(?:01|06|07|08|09)|streamScreenHelpers-02)-[^/]+|layoutPreferences|homeScreenHelpers-01-modern-sidebar-pill-auto-collapse-ms)\.js$/
          },
          async ({ path }) => {
            let contents = await readFile(path, "utf8");
            contents = contents.replace(
              /^import \* as internals from [^;]+;/gm,
              "const internals = fixtures;"
            );
            contents = contents.replace(
              /^import \{([\s\S]*?)\} from "([^"]+)";/gm,
              (all, names, source) =>
                /(?:episodeCardMetadata|watchProgress|streamDisplayText)\.js$/.test(source)
                  ? all
                  : `const {${names}} = fixtures;`
            );
            return { contents, loader: "js" };
          }
        );
      }
    }
  ]
});
let normalizeLayout;
const fixtures = {
  LayoutPreferences: { get: () => ({ posterCardCornerRadiusDp: 12 }) },
  Environment: { isWebOS: () => false },
  renderStreamBadges: (_stream, _enabled, settings) =>
    settings?.testBadges ? "<div>TEST-BADGES</div>" : "",
  resolveStreamBadgePlacement: (settings) => settings?.badgePlacement || "BOTTOM",
  createProfileScopedStore: ({ normalize }) => {
    normalizeLayout = normalize;
    return {};
  },
  LocalStore: { get: (_key, fallback) => fallback },
  normalizeDetailImdbRatingsVisibility: (value) => value,
  normalizeHomeImdbRatingsVisibility: (value) => value,
  t: (key, args = []) => key + (args.length ? ":" + args[0] : ""),
  escapeHtml: (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;"),
  normalizeType: (value) => (["tv", "series"].includes(value) ? "series" : "movie"),
  normalizeEpisodeCode: (season, episode) => (season && episode ? `S${season} E${episode}` : ""),
  localizedGenreText: (value) => value || "",
  DebridSettingsStore: { get: () => ({}) },
  StreamBadgeSettingsStore: { snapshot: () => ({}) },
  isPerformanceConstrainedRuntime: () => false,
  contentTextDirection: () => "ltr",
  ScreenUtils: { indexFocusables() {} }
};
const context = vm.createContext({ fixtures, console });
vm.runInContext(bundle.outputFiles[0].text, context);
const api = context.subject;
fixtures.getStreamHeadline = api.getStreamHeadline;
fixtures.getStreamDescriptionLines = api.getStreamDescriptionLines;
for (const webos of [false, true]) {
  fixtures.Environment.isWebOS = () => webos;
  for (const newline of ["\n", "\r\n"]) {
    const name = ["4K ⚡", "⟨Web-dl⟩", "★★★★★"].join(newline);
    assert.equal(api.getStreamHeadline({ name }), name);
    assert.equal(api.getStreamHeadline({ title: name }), name);
    assert.equal(api.getStreamHeadline({ description: name }), name);
  }
  assert.equal(api.getStreamHeadline({ name: " \n4K\n★★★★★\n " }), "4K\n★★★★★");
  assert.equal(api.getStreamHeadline({ name: " ", title: "Title" }), "Title");
  assert.equal(api.getStreamHeadline({ addonName: "Addon" }), "Addon");
  assert.equal(api.getStreamHeadline({}), "Unknown source");
  assert.equal(api.getStreamHeadline({ name: "𝟒K\n★★★★★" }), webos ? "4K\n★★★★★" : "𝟒K\n★★★★★");
}
fixtures.Environment.isWebOS = () => false;
const streamCss = await readFile("css/components-50.css", "utf8");
assert.match(streamCss, /\.stream-route-card-heading\s*\{[^}]*white-space:\s*pre-line;/);
assert.equal(normalizeLayout({ posterCardCornerRadiusDp: 0 }).posterCardCornerRadiusDp, 0);
assert.equal(normalizeLayout({ posterCardCornerRadiusDp: "bad" }).posterCardCornerRadiusDp, 12);
assert.equal(normalizeLayout({ posterCardCornerRadiusDp: null }).posterCardCornerRadiusDp, 12);
assert.ok(
  api
    .buildModernHomeSizingStyle({ posterCardCornerRadiusDp: 0 })
    .includes("--home-poster-radius:0px")
);
const episodes = [
  { id: "special", season: 0 },
  { id: "seen", season: 1 },
  { id: "unseen", season: 1 },
  { id: "current", season: 2 },
  { id: "later", season: 3 }
];
let writes;
const detail = {
  ...api.createMetaDetailsScreenMethods12(),
  ...api.createMetaDetailsScreenMethods14(),
  ...api.createMetaDetailsScreenMethods15(),
  episodes,
  seasonHoldMenu: { season: 2, optionIndex: 1 },
  isEpisodeMarkedWatched: (e) => e.id === "seen",
  closeSeasonHoldMenu() {
    this.seasonHoldMenu = null;
  },
  syncEpisodePlaybackDom() {},
  async setEpisodesWatchedState(targets, watched) {
    writes = { ids: targets.map((e) => e.id), watched };
    return true;
  }
};
assert.deepEqual(
  Array.from(detail.getPreviousSeasonEpisodes(2), (e) => e.id),
  ["seen", "unseen"]
);
assert.equal(detail.getSeasonHoldMenuOptions()[1].action, "markPreviousSeasonsWatched");
await detail.activateSeasonHoldMenuOption();
assert.deepEqual(Array.from(writes.ids), ["unseen"]);
assert.equal(writes.watched, true);
detail.seasonHoldMenu = { season: 1 };
assert.equal(
  detail.getSeasonHoldMenuOptions().length,
  1,
  "specials must not enable previous-season actions"
);
detail.setEpisodesWatchedState = async () => {
  throw new Error("offline");
};
await assert.rejects(() => detail.markPreviousSeasonsWatched(2), /offline/);
detail.setEpisodesWatchedState = async () => false;
assert.equal(
  await detail.markPreviousSeasonsWatched(2),
  false,
  "ignore stale profile/route completions"
);
const virtualGap = api.createStreamScreenMethods01().getStreamVirtualRowGap;
assert.equal(virtualGap.call({ isLegacyWebOsRoute: () => false }), 40);
assert.equal(virtualGap.call({ isLegacyWebOsRoute: () => true }), 10);

const header = api.createStreamScreenMethods07().getHeaderMeta;
for (const [runtime, expected] of [
  [22, "22m"],
  [60, "1h"],
  [109, "1h 49m"],
  [0, ""],
  [null, ""],
  [Infinity, ""],
  ["bad", ""]
]) {
  assert.equal(header.call({ params: { itemType: "series", runtime } }).detailLine, expected);
}
assert.equal(
  header.call({ params: { itemType: "movie", genres: "Drama", year: "2026" } }).detailLine,
  "Drama • 2026"
);
const resumeParams = { resumePositionMs: 120000, resumeDurationMs: 3600000 };
assert.equal(header.call({ params: resumeParams }).resumeLabel, "stream_resume_from_time:2:00");
assert.equal(
  header.call({ params: { resumeProgressPercent: 42 } }).resumeLabel,
  "stream_resume_from_percent:42"
);
assert.equal(
  header.call({ params: { ...resumeParams, startFromBeginning: true } }).resumeLabel,
  ""
);
assert.equal(header.call({ params: { resumeProgressPercent: 100 } }).resumeLabel, "");

function renderState(error, overrides = {}) {
  const state = {
    params: {},
    streams: [],
    sourceChips: [],
    error,
    focusState: { zone: "card", row: 0 },
    container: { querySelector: () => null },
    getHeaderMeta: () => ({ title: "Title" }),
    getBackdropUrl: () => "",
    buildSourceChipMarkup: () => "",
    getFilteredStreams: () => [],
    hasPendingSourceLoads: () => false,
    shouldUseStreamVirtualization: () => false,
    renderContinueWatchingResumeOverlay: () => "",
    renderAutoPlayOverlay: () => ""
  };
  for (const name of [
    "cancelScheduledRender",
    "restoreScrollPosition",
    "hydrateVisibleStreamBadges",
    "bindAddonLogoFallbacks",
    "applyFocus",
    "bindListScrollState"
  ])
    state[name] = () => {};
  Object.assign(state, overrides);
  api.createStreamScreenMethods09().render.call(state);
  return state.container.innerHTML;
}
const errorMarkup = renderState("<offline>");
assert.ok(errorMarkup.includes("&lt;offline>"), "provider errors must remain escaped");
assert.ok(errorMarkup.includes('data-action="refreshStreams"'));
assert.ok(
  errorMarkup.includes('data-card-action="play"'),
  "retry must use the keyboard-accessible row path"
);
assert.ok(renderState("").includes("stream_no_streams_hint"));
const retry = { dataset: { action: "refreshStreams", cardAction: "play" } };
const row = {
  dataset: { streamRow: "0" },
  querySelector: (selector) => (selector.includes('"play"') ? retry : null)
};
const rows = api
  .createStreamScreenMethods06()
  .getCardRows.call({ container: { querySelectorAll: () => [row] } });
assert.equal(api.createStreamScreenMethods06().resolveCardActionForRow(rows[0]), retry);
const renderCard = api.createStreamScreenMethods08().renderStreamCard;
const stream = {
  id: "one",
  name: "Stream",
  description: "Description",
  addonName: "Addon",
  pluginSourceName: "<Provider>"
};
let stableListApplied = false;
renderState(null, {
  streams: [stream],
  getFilteredStreams: () => [stream],
  renderStreamCard: () => "<article></article>",
  renderStableStreamEmptyState: () => "",
  renderStableStreamLoadingRow: () => "",
  applyAddonFilterDomState() {
    stableListApplied = true;
  }
});
assert.equal(stableListApplied, true, "modern TVs must retain keyed cards on filter changes");
for (const placement of ["TOP", "BOTTOM"]) {
  const html = renderCard.call({ isCardActionFocused: () => false }, stream, 0, true, {
    testBadges: true,
    badgePlacement: placement
  });
  assert.ok(html.includes("&lt;Provider>"));
  assert.ok(html.includes('data-stream-key="0"'), "the first card must keep its zero key");
  assert.equal(
    html.indexOf("TEST-BADGES") < html.indexOf('class="stream-route-card-heading"'),
    placement === "TOP"
  );
}

const filterRows = [0, 1, 2].map((index) => {
  const card = { dataset: {}, style: {} };
  return {
    dataset: { streamKey: String(index) },
    style: {},
    card,
    querySelector: () => card,
    querySelectorAll: () => []
  };
});
const filterList = {
  querySelectorAll: () => filterRows,
  querySelector: (selector) => (selector.includes("loading-row") ? loadingFilterRow : null),
  appendChild() {
    assert.fail("filter changes must not move already ordered cards");
  }
};
const loadingFilterRow = { style: {} };
const sourceA = {},
  sourceB = {};
const allSources = [sourceA, sourceB, sourceA];
const filterState = {
  container: { querySelector: () => filterList, querySelectorAll: () => [] },
  hasPendingSourceLoads: () => false
};
for (const [filter, visible, expectedRows] of [
  ["A", [sourceA, sourceA], [0, -1, 1]],
  ["all", [], [0, 1, 2]],
  ["B", [sourceB], [-1, 0, -1]],
  ["A", [sourceA, sourceA], [0, -1, 1]]
]) {
  filterState.addonFilter = filter;
  assert.equal(
    api
      .createStreamScreenMethods06()
      .applyAddonFilterDomState.call(filterState, visible, allSources),
    true
  );
  assert.deepEqual(
    filterRows.map((row) => Number(row.dataset.streamRow)),
    expectedRows
  );
  assert.deepEqual(
    filterRows.map((row) => row.hidden),
    expectedRows.map((index) => index < 0)
  );
}
filterState.addonFilter = "empty";
filterState.hasPendingSourceLoads = (filter) => filter === "all";
api.createStreamScreenMethods06().applyAddonFilterDomState.call(filterState, [], allSources);
assert.equal(
  loadingFilterRow.hidden,
  false,
  "an empty filter must retain loading feedback while sources resolve"
);
filterState.hasPendingSourceLoads = () => false;
api.createStreamScreenMethods06().applyAddonFilterDomState.call(filterState, [], allSources);
assert.equal(loadingFilterRow.hidden, true);

const filenameMarkup = renderCard.call(
  { isCardActionFocused: () => false },
  { ...stream, description: "📁 The.Substance_2024-2160p.mkv <unsafe>" },
  0,
  false,
  {}
);
assert.ok(filenameMarkup.includes("The.<wbr>Substance_<wbr>2024-<wbr>2160p.<wbr>mkv"));
assert.ok(filenameMarkup.includes("&lt;unsafe>"), "wrap opportunities must preserve escaping");
assert.ok(filenameMarkup.replaceAll("<wbr>", "").includes("📁 The.Substance_2024-2160p.mkv"));
const multilineMarkup = renderCard.call(
  { isCardActionFocused: () => true },
  { ...stream, name: "4K ⚡\n<Web-dl>\n★★★★★" },
  0,
  false,
  {},
  { virtualized: true, virtualRowGap: 40 }
);
assert.ok(multilineMarkup.includes('dir="ltr">4K ⚡\n&lt;Web-dl>\n★★★★★</div>'));
assert.ok(multilineMarkup.includes('style="margin-bottom:40px"'));
assert.ok(multilineMarkup.includes('data-action="playStream"'));

let isFocusable = false,
  role;
const preview = { clientHeight: 384, scrollHeight: 600 };
const more = { hidden: true };
const description = {
  classList: {
    toggle: (_name, on) => {
      isFocusable = on;
    }
  },
  setAttribute: (_key, value) => {
    role = value;
  },
  removeAttribute: () => {
    role = undefined;
  },
  querySelector: (selector) => (selector.includes("preview") ? preview : more)
};
const chrome = {
  container: {
    querySelector: (selector) => (selector === ".series-detail-description" ? description : null)
  },
  refreshPreviewWatchedBadges: () => Promise.resolve(),
  observeEpisodeThumbnails() {}
};
api.createMetaDetailsScreenMethods16().bindDetailChrome.call(chrome);
assert.equal(isFocusable, true);
assert.equal(role, "button");
assert.equal(more.hidden, false);
preview.scrollHeight = 384;
api.createMetaDetailsScreenMethods16().bindDetailChrome.call(chrome);
assert.equal(isFocusable, false);
assert.equal(more.hidden, true);

let dialogConfig,
  focused = false;
fixtures.NuvioDialog = class {
  constructor(config) {
    dialogConfig = config;
  }
  mount() {}
  destroy() {}
};
context.document = {
  createElement: () => ({
    focus() {
      focused = true;
    }
  }),
  body: {}
};
const synopsis = {
  meta: { name: "Long title", description: "<literal text>" },
  focusDetailDescriptor() {},
  animateScroll() {}
};
api.createMetaDetailsScreenMethods16().openSynopsis.call(synopsis);
assert.equal(
  dialogConfig.content().textContent,
  "<literal text>",
  "description must remain plain text"
);
assert.equal(focused, true);
dialogConfig.onDismiss();
assert.equal(synopsis.synopsisDialog, null);
console.log(
  "Detail/stream parity passed: previous seasons, write failures, runtime, retry, empty hint and full synopsis."
);

// A matched party source is plain text; a separately shared link keeps its attribution.
for (const shared of [false, true]) {
  const html = renderCard.call(
    { isCardActionFocused: () => false, isPartySourceStream: () => true },
    { ...stream, name: "عنوان طويل ".repeat(12), partyShared: shared, partyHostName: "Host" },
    0
  );
  assert.equal(html.includes("stream-route-party-source"), !shared);
  assert.equal(html.includes("stream-route-party-label"), shared);
  assert.equal(html.includes("is-party-marked"), shared);
  assert(!html.includes("stream-route-party-chip"));
  if (!shared) assert(html.includes('class="stream-route-party-source" dir="auto"'));
}
fixtures.escapeAttribute = fixtures.escapeHtml;
fixtures.renderWatchedBadgeGlyph = () => "✓";
const episodeRenderer = api.createMetaDetailsScreenMethods10().renderEpisodeCard;
for (const isWatched of [false, true])
  for (const isUnavailable of [false, true]) {
    const html = episodeRenderer.call(
      {
        getEpisodeCardPresentation: () => ({
          isWatched,
          isUnavailable,
          progressRatio: 0,
          title: "Episode",
          overview: "Overview",
          thumbnail: "",
          metaParts: ""
        })
      },
      { id: "ep", episode: 1 },
      0
    );
    assert.equal(html.includes("series-episode-status complete"), isWatched);
    assert.equal(html.includes("series-episode-status idle"), !isWatched && !isUnavailable);
    assert.equal(html.includes('class="series-episode-unavailable"'), isUnavailable);
  }

// In-place watched updates follow the same unavailable/idle rules as initial rendering.
class EpisodeNode {
  constructor() {
    this.className = "";
    this.classList = { toggle() {} };
  }
  querySelector(selector) {
    return this.children?.[selector] || null;
  }
  appendChild(node) {
    this.children ||= {};
    this.children[".series-episode-status"] = node;
    node.parent = this;
  }
  remove() {
    delete this.parent.children[".series-episode-status"];
  }
}
context.HTMLElement = EpisodeNode;
context.document = { createElement: () => new EpisodeNode() };
fixtures.escapeSelectorValue = (value) => value;
const cardNode = new EpisodeNode(),
  thumbNode = new EpisodeNode();
cardNode.children = {
  ".series-episode-thumb": thumbNode,
  ".series-episode-image": new EpisodeNode(),
  ".series-episode-copy": new EpisodeNode()
};
const updateState = {
  container: { querySelector: () => cardNode },
  episodeProgressMap: new Map(),
  isEpisodeMarkedWatched: () => false
};
const syncBadge = api.createMetaDetailsScreenMethods11().syncEpisodeCardWatchedDom;
for (const watched of [false, true, false])
  for (const available of [true, false]) {
    updateState.isEpisodeMarkedWatched = () => watched;
    syncBadge.call(updateState, { id: "ep", season: 1, episode: 1, available });
    const status = thumbNode.querySelector(".series-episode-status");
    assert.equal(
      status?.className || "",
      watched ? "series-episode-status complete" : available ? "series-episode-status idle" : ""
    );
  }

const unified = renderState(null, {
  getHeaderMeta: () => ({ title: "Movie", resumeLabel: "Resume 12:34" })
});
const shellStart = unified.indexOf('class="stream-route-panel-shell"');
const headerStart = unified.indexOf('class="stream-route-panel-header"');
assert(shellStart >= 0 && headerStart > shellStart);
assert(unified.indexOf('class="stream-route-resume-label"') > headerStart);
assert(unified.indexOf('class="stream-route-chip-wrap"') > headerStart);
assert(unified.indexOf('class="stream-route-panel"') > headerStart);
