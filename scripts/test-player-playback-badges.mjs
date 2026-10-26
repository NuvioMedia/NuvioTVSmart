import assert from "node:assert/strict";
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const { StreamBadgeSettingsStore: store, normalizeStreamBadgeSettings } =
  await import("../js/data/local/streamBadgeSettingsStore.js");
const {
  playbackMatchText: text,
  readPlaybackMediaInfo: info,
  syncPlayerPlaybackBadges: sync
} = await import("../js/ui/screens/player/playerPlaybackBadges.js");
const { stream_badge_settings: cloud } =
  await import("../js/core/profile/profileSettingsSyncFeature-stream-badge-settings.js");
assert.equal(normalizeStreamBadgeSettings({}).showInPlayer, false);
const filter = (name, pattern) => ({
  name,
  pattern,
  imageURL: `https://fixture.invalid/${name}.png`
});
const rules = {
  imports: [
    { sourceUrl: "streams", isActive: true, filters: [filter("stream-only", "1080p")] },
    {
      sourceUrl: "player",
      isActive: false,
      filters: [
        filter("actual-video", "1080p"),
        filter("hevc", "HEVC"),
        filter("aac", "AAC"),
        filter("ddp", "DDP"),
        filter("french", "fra"),
        filter("atmos", "Atmos")
      ]
    }
  ]
};
store.set({ rules, showInPlayer: true, playerBadgeSource: "player" }, { silentSync: true });
const settings = store.snapshot();
assert.equal(settings.rules.imports.find((entry) => entry.isActive).sourceUrl, "streams");
assert.equal(settings.playerRules.imports.find((entry) => entry.isActive).sourceUrl, "player");
assert.equal(store.get().rules.imports.find((entry) => entry.isActive).sourceUrl, "streams");
assert.equal(cloud.export("1").show_badges_in_player, true);
assert.equal(cloud.export("1").player_badge_source, "player");
assert.equal(
  cloud.project({ show_badges_in_player: true, player_badge_source: "player" }).player_badge_source,
  "player"
);
cloud.import("1", { show_badges_in_player: false, player_badge_source: "streams" });
assert.equal(store.get().showInPlayer, false);
assert.equal(store.get().playerBadgeSource, "streams");
cloud.import("1", { show_badges_in_player: true, player_badge_source: "player" });
store.setPlayerBadgeSource("deleted-pack");
assert.equal(
  store.snapshot().playerRules.imports.find((entry) => entry.isActive).sourceUrl,
  "streams"
);
store.setPlayerBadgeSource("player");

assert.equal(text({}), "");
for (const [dimensions, expected] of [
  [{ videoWidth: 3840, videoHeight: 1600 }, "2160p"],
  [{ videoWidth: 1920, videoHeight: 800 }, "1080p"],
  [{ videoWidth: 1280, videoHeight: 720 }, "720p"]
])
  assert(text(dimensions).includes(expected));
assert.match(
  text({ videoCodec: "hvc1.2.4", hdr: ["HDR10"], audioCodec: "ec-3-joc", audioChannels: 6 }),
  /HEVC.*HDR10.*10bit.*DDP.*Atmos.*5\.1/
);
assert.match(
  text({ videoCodec: "dvh1.05", audioCodec: "dts-hd", audioProfile: "DTS-HD MA DTS:X" }),
  /Dolby Vision.*HEVC.*DTS-HD MA.*DTS:X/
);
assert.match(
  text({ audioCodec: "aac", audioChannels: 2 }, ["ita", "Italian"]),
  /AAC 2\.0 ita Italian/
);

const node = { innerHTML: "", hidden: true };
const screen = {
  uiRefs: { playbackBadges: node },
  controlsVisible: true,
  selectedAudioTrackIndex: 0,
  params: { filename: "Film.2160p.Atmos.HEVC.mkv" }
};
const controller = {
  playbackEngine: "hls.js",
  video: { currentSrc: "actual", videoWidth: 1920, videoHeight: 800 },
  hlsInstance: {
    currentLevel: 0,
    audioTrack: 0,
    levels: [{ width: 1920, height: 800, videoCodec: "avc1", audioCodec: "ec-3" }],
    audioTracks: [
      { audioCodec: "mp4a.40.2", lang: "ita", channels: 2 },
      { audioCodec: "ec-3-joc", lang: "fra", channels: 6 }
    ]
  }
};
const chip = (badge) => `<img alt="${badge.name}">`;
const language = (track) => track.language;
sync(screen, controller, chip, language);
assert(node.innerHTML.includes("actual-video"));
assert(node.innerHTML.includes("aac"));
assert(
  !node.innerHTML.includes("stream-only") &&
    !node.innerHTML.includes("atmos") &&
    !node.innerHTML.includes("hevc")
);
assert.equal(node.hidden, false);
controller.hlsInstance.audioTrack = 1;
sync(screen, controller, chip, language);
assert(!node.innerHTML.includes('alt="aac"'));
assert(
  node.innerHTML.includes("ddp") &&
    node.innerHTML.includes("atmos") &&
    node.innerHTML.includes("french")
);
controller.hlsInstance.levels[0].videoCodec = "hvc1";
controller.video.videoWidth = 3840;
sync(screen, controller, chip, language);
assert(node.innerHTML.includes("hevc"));
screen.bufferingActive = true;
sync(screen, controller, chip, language);
assert.equal(node.hidden, true);
screen.bufferingActive = false;
sync(screen, controller, chip, language);
assert.equal(node.hidden, false);
// Stable ticks reuse metadata/matches; switching engine must clear previous codec badges.
controller.hlsInstance = null;
controller.playbackEngine = "html5";
controller.video.audioTracks = [{ enabled: true, language: "eng", codec: "aac" }];
sync(screen, controller, chip, language);
assert(!node.innerHTML.includes("hevc") && !node.innerHTML.includes("atmos"));
let reads = 0;
Object.defineProperty(controller.video.audioTracks[0], "codec", {
  get() {
    reads++;
    return "aac";
  }
});
sync(screen, controller, chip, language);
assert.equal(reads, 0);
screen.controlsVisible = false;
sync(screen, controller, chip, language);
store.setShowInPlayer(false);
screen.controlsVisible = true;
sync(screen, controller, chip, language);
assert.equal(node.hidden, true);
// No selected alternate track means no guessed audio codec from the default variant.
assert.equal(
  info({
    video: {},
    hlsInstance: {
      currentLevel: 0,
      levels: [{ audioCodec: "ec-3" }],
      audioTracks: [{ codec: "aac" }],
      audioTrack: -1
    }
  }).audioCodec,
  ""
);
const av = {
  isUsingAvPlay: () => true,
  video: { videoWidth: 1280, videoHeight: 720 },
  getAvPlay: () => ({
    getCurrentStreamInfo: () => [
      { type: "VIDEO", extra_info: { width: 3840, height: 2160, codec: "HEVC", hdr: "HDR10" } },
      { type: "AUDIO", extra_info: { codec: "aac", channels: 2, language: "ita" } }
    ]
  }),
  parseAvPlayExtraInfo: (value) => value,
  pickAvPlayExtraValue: (value, keys) => keys.map((key) => value[key]).find((item) => item != null)
};
assert.match(text(info(av)), /2160p.*HEVC.*HDR10.*AAC.*2\.0/);
const dash = {
  video: {},
  dashInstance: {
    getCurrentRepresentationForType: (type) =>
      type === "video" ? { width: 1920, height: 1080, codecs: "avc1" } : { codecs: "mp4a.40.2" },
    getCurrentTrackFor: () => ({ lang: "de", audioChannelConfiguration: [{ value: "2" }] })
  }
};
assert.match(text(info(dash), [info(dash).language]), /1080p.*AVC.*AAC.*2\.0 de/);
console.log(
  "Player badges passed: independent packs/cloud, actual metadata, selected audio, engine changes, defaults and stable ticks"
);
// The settings controls change the player choice without activating a stream pack.
const { createSettingsScreenMethods09 } =
  await import("../js/ui/screens/settings/settingsScreenMethods-09-render-integration-section.js");
const rows = [];
const settingsScreen = {
  actionMap: new Map(),
  renderSectionHeader: () => "",
  renderToggleRow: (row) => {
    rows.push(row);
    return "";
  },
  renderActionRow: (row) => {
    rows.push(row);
    return "";
  },
  openOptionDialog(dialog) {
    this.dialog = dialog;
  }
};
createSettingsScreenMethods09().renderStreamsSection.call(settingsScreen, {
  streamBadgeSettings: store.get()
});
assert(rows.some((row) => row.focusKey === "streams:toggle:playerBadges"));
settingsScreen.actionMap.get("streams:toggle:playerBadges")();
assert.equal(store.get().showInPlayer, true);
settingsScreen.actionMap.get("streams:playerBadgeSource")();
settingsScreen.dialog.onSelect({ id: "player" });
assert.equal(store.get().playerBadgeSource, "player");
assert.equal(store.get().rules.imports.find((entry) => entry.isActive).sourceUrl, "streams");
settingsScreen.dialog.onSelect({ id: "" });
assert.equal(store.get().playerBadgeSource, "");
