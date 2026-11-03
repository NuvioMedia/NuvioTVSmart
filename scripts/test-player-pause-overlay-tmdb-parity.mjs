import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { cleanDisplayText } from "../js/ui/screens/player/playerScreenHelpers-02-language-code-aliases.js";
import {
  extractPauseOverlayCast,
  extractReleaseYear
} from "../js/ui/screens/player/playerScreenHelpers-03-normalize-web-os-html-subtitle-text.js";
import {
  isSeriesItemType,
  normalizeItemType
} from "../js/ui/screens/player/playerScreenHelpers-08-track-list-to-array.js";

const SCENE_ID = "tt23148340";
const TMDB_ID = "213562";

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key),
  clear: () => stored.clear()
};

const addonMeta = () => ({
  id: SCENE_ID,
  type: "series",
  name: "Crystal Lake",
  description: "English addon description",
  videos: [
    {
      id: `${SCENE_ID}:1:1`,
      season: 1,
      episode: 1,
      title: "Camp Crystal",
      overview: "Camp Crystal Lake's idyllic summer is cut short by Jason's death."
    }
  ],
  cast: []
});

const tmdbEnrichment = () => ({
  name: "Crystal Lake",
  overview: "Svensk seriebeskrivning",
  original_name: "Crystal Lake",
  original_language: "en",
  videos: { results: [] },
  images: { logos: [] },
  production_companies: [],
  networks: [],
  spoken_languages: [{ iso_639_1: "en" }],
  aggregate_credits: {
    cast: [{ id: 1, name: "Linda Cardellini", roles: [{ character: "Pam" }] }],
    crew: []
  }
});

const tmdbSeason = () => ({
  episodes: [
    {
      episode_number: 1,
      name: "Camp Crystal (sv)",
      overview: "Pam kan inte acceptera att Jason är död.",
      still_path: null,
      runtime: 52
    }
  ]
});

async function setup({ settings, metaRepository }) {
  const calls = [];
  const fixtures = {
    settings,
    TmdbSettingsStore: { get: () => settings },
    normalizeTmdbLanguageCode: (value) => value || "en",
    Platform: { isWebOS: () => false },
    PluginServiceClient: { fetch: async () => ({ ok: false }) },
    metaRepository,
    cleanDisplayText,
    extractPauseOverlayCast,
    extractReleaseYear,
    normalizeItemType,
    isSeriesItemType
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      export { createPlayerScreenMethods19 } from './js/ui/screens/player/playerScreenMethods-19-refresh-loading-overlay-progress.js';
      `
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
              filter: /(?:config|tmdbSettingsStore|pluginServiceClient)\.js$|platform\/index\.js$/
            },
            ({ path }) => {
              const contents = path.endsWith("config.js")
                ? 'export const TMDB_API_KEY = "fixture-key";'
                : path.endsWith("tmdbSettingsStore.js")
                  ? "export const { TmdbSettingsStore, normalizeTmdbLanguageCode } = fixtures;"
                  : path.endsWith("pluginServiceClient.js")
                    ? "export const { PluginServiceClient } = fixtures;"
                    : "export const { Platform } = fixtures;";
              return { contents, loader: "js" };
            }
          );
          b.onLoad({ filter: /playerScreenMethods-19-[^/]+\.js$/ }, async ({ path }) => ({
            contents: (await readFile(path, "utf8")).replace(
              /^import \* as internals from [^;]+;/m,
              "const internals = fixtures;"
            ),
            loader: "js"
          }));
        }
      }
    ]
  });
  const context = vm.createContext({
    fixtures,
    URL,
    AbortController,
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      const parsed = new URL(url);
      calls.push(parsed);
      const data = await respond(parsed);
      return { ok: data !== null, json: async () => data };
    }
  });
  vm.runInContext(bundle.outputFiles[0].text, context);

  function respond(url) {
    if (url.pathname.endsWith(`/tv/${TMDB_ID}/season/1`)) {
      return settings.useEpisodes === false ? null : tmdbSeason();
    }
    if (url.pathname.endsWith(`/tv/${TMDB_ID}/videos`)) {
      return { results: [] };
    }
    if (url.pathname.endsWith(`/tv/${TMDB_ID}`)) {
      return url.searchParams.get("language") === "en-US" ? tmdbEnrichment() : tmdbEnrichment();
    }
    return null;
  }

  const methods = context.subject.createPlayerScreenMethods19();
  const player = {
    ...methods,
    params: {
      itemId: SCENE_ID,
      itemType: "series",
      imdbId: SCENE_ID,
      tmdbId: TMDB_ID,
      season: 1,
      episode: 1,
      playerTitle: "Crystal Lake"
    },
    episodes: [],
    renders: 0,
    isExternalFrameMode: () => false,
    renderPauseOverlay() {
      this.renders += 1;
    },
    getDisplayEpisodeTitle() {
      return "Camp Crystal";
    }
  };
  return { player, calls };
}

const baseSettings = {
  enabled: true,
  language: "sv-SE",
  useArtwork: true,
  useBasicInfo: true,
  useEpisodes: true,
  useCredits: true
};

test("pause overlay replaces the English addon synopsis with the TMDB translation", async () => {
  const { player } = await setup({
    settings: { ...baseSettings },
    metaRepository: {
      getMetaFromAllAddons: async () => ({ status: "success", data: addonMeta() })
    }
  });

  await player.hydratePauseOverlayMeta();

  assert.equal(player.pauseOverlayMeta.description, "Pam kan inte acceptera att Jason är död.");
  assert.equal(player.pauseOverlayMeta.episodeTitle, "Camp Crystal (sv)");
  assert.equal(player.pauseOverlayMeta.cast[0]?.name, "Linda Cardellini");
  assert.equal(player.renders, 1);
});

test("pause overlay keeps localized TMDB metadata when the addon lookup fails", async () => {
  const { player } = await setup({
    settings: { ...baseSettings },
    metaRepository: {
      getMetaFromAllAddons: async () => {
        throw new Error("addon unavailable");
      }
    }
  });

  await player.hydratePauseOverlayMeta();

  assert.equal(player.pauseOverlayMeta.description, "Pam kan inte acceptera att Jason är död.");
});

test("pause overlay keeps addon metadata when TMDB enrichment is disabled", async () => {
  const { player, calls } = await setup({
    settings: { ...baseSettings, enabled: false },
    metaRepository: {
      getMetaFromAllAddons: async () => ({ status: "success", data: addonMeta() })
    }
  });

  await player.hydratePauseOverlayMeta();

  assert.equal(
    player.pauseOverlayMeta.description,
    "Camp Crystal Lake's idyllic summer is cut short by Jason's death."
  );
  assert.equal(calls.length, 0);
});

test("pause overlay ignores TMDB season metadata when episode enrichment is disabled", async () => {
  const { player } = await setup({
    settings: { ...baseSettings, useEpisodes: false },
    metaRepository: {
      getMetaFromAllAddons: async () => ({ status: "success", data: addonMeta() })
    }
  });

  await player.hydratePauseOverlayMeta();

  assert.equal(
    player.pauseOverlayMeta.description,
    "Camp Crystal Lake's idyllic summer is cut short by Jason's death."
  );
});
