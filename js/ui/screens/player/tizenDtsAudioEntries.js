import { PlayerController } from "../../../core/player/playerController.js";
import {
  formatAudioCodecName,
  getAuthoritativeAudioCodecValue
} from "../../../core/player/audioTrackCodecMetadata.js";
import { canUseTizenDtsAudioConversion } from "../../../platform/tizen/tizenDtsAudioTranscoder.js";
import { formatAudioTrackDisplay } from "./playerScreenHelpers-07-detect-track-language-variant.js";
import { getWebOsAudioTrackCompatibilityText } from "./playerScreenHelpers-04-format-subtitle-codec-label.js";

// Tizen AVPlay omits DTS and TrueHD tracks on TVs that cannot decode them. As
// on webOS, those tracks are listed from the Matroska header and played through
// the AC3 conversion; every other track keeps its AVPlay entry.
const canonicalCodec = (track) => formatAudioCodecName(getAuthoritativeAudioCodecValue(track));
const AC3 = canonicalCodec({ codec: "A_AC3" });

function embeddedIndexOf(track, fallback) {
  const index = Number(track?.embeddedTrackIndex);
  return Number.isFinite(index) && index >= 0 ? index : fallback;
}
function isConvertible(track) {
  return /dts|true[\s_-]*hd/i.test(getWebOsAudioTrackCompatibilityText(track));
}
function embeddedEntry(track, index, selected, convertible) {
  const display = formatAudioTrackDisplay(track, index);
  const support = convertible
    ? { supported: false, canTryAudioConversion: true, unsupportedReason: "codec" }
    : { supported: true, canTryAudioConversion: false, unsupportedReason: null };
  return {
    id: `audio-embedded-${embeddedIndexOf(track, index)}`,
    label: display.label,
    secondary: display.secondary,
    languageText: display.languageText,
    metadata: display.metadata,
    selected,
    ...support,
    embeddedAudioTrackIndex: embeddedIndexOf(track, index),
    track: { ...track, ...support }
  };
}
function convertedPlayback() {
  const state = PlayerController.tizenDtsAudioState;
  return Boolean(
    state?.mediaUrl && !state.fallingBack && PlayerController.avplayUrl === state.mediaUrl
  );
}

export function withTizenConvertibleAudioEntries(screen, avplayEntries) {
  const embedded = screen.embeddedAudioTracks || [];
  if (!embedded.length || !canUseTizenDtsAudioConversion()) return avplayEntries;
  const state = PlayerController.tizenDtsAudioState;
  if (convertedPlayback()) {
    // AVPlay lists the projected track as AC3; keep the source list, like webOS.
    return embedded.map((track, index) =>
      embeddedEntry(
        track,
        index,
        embeddedIndexOf(track, index) === state.targetIndex,
        isConvertible(track)
      )
    );
  }
  const avplayTracks = PlayerController.getAvPlayAudioTracks?.() || [];
  const byEmbedded = new Map();
  avplayEntries.forEach((entry, index) => {
    const match = screen.getEmbeddedAudioTrackForAvPlayTrack(avplayTracks[index], index);
    if (match && !byEmbedded.has(match)) byEmbedded.set(match, entry);
  });
  if (!embedded.some((track) => !byEmbedded.has(track) && isConvertible(track)))
    return avplayEntries;
  const pending = state && !state.fallingBack ? state.targetIndex : -1;
  const entries = [];
  embedded.forEach((track, index) => {
    const entry = byEmbedded.get(track);
    if (entry) entries.push(pending >= 0 ? { ...entry, selected: false } : entry);
    else if (isConvertible(track))
      entries.push(embeddedEntry(track, index, embeddedIndexOf(track, index) === pending, true));
  });
  const listed = new Set(byEmbedded.values());
  avplayEntries.forEach((entry) => {
    if (!listed.has(entry)) entries.push(pending >= 0 ? { ...entry, selected: false } : entry);
  });
  return entries;
}

// AVPlay omits unsupported codecs and renumbers the rest, so a track is found
// by codec occurrence; on the converted file the target counts as AC3.
export function findTizenAvPlayAudioTrackIndex(screen, embeddedIndex, convertedIndex = -1) {
  const embedded = screen.embeddedAudioTracks || [];
  const codecOf = (track, index) =>
    embeddedIndexOf(track, index) === convertedIndex ? AC3 : canonicalCodec(track);
  const targetPosition = embedded.findIndex(
    (track, index) => embeddedIndexOf(track, index) === embeddedIndex
  );
  if (targetPosition < 0) return -1;
  const codec = codecOf(embedded[targetPosition], targetPosition);
  const sameCodec = embedded.filter((track, index) => codecOf(track, index) === codec);
  const avplayTracks = (PlayerController.getAvPlayAudioTracks?.() || []).filter(
    (track) => canonicalCodec(track) === codec
  );
  if (!codec || sameCodec.length !== avplayTracks.length) return -1;
  const index = Number(avplayTracks[sameCodec.indexOf(embedded[targetPosition])]?.avplayTrackIndex);
  return Number.isFinite(index) ? index : -1;
}

export function applyTizenConvertibleAudioTrack(screen, entry, { rememberSelection = false } = {}) {
  const embeddedIndex = Number(entry.embeddedAudioTrackIndex);
  const embeddedTrack = screen.getEmbeddedAudioTrackByEmbeddedIndex(embeddedIndex) || entry.track;
  const previousIndex = PlayerController.getSelectedAvPlayAudioTrackIndex?.();
  const refresh = () => {
    screen.invalidateTrackDialogCaches();
    screen.refreshTrackDialogs();
  };
  const select = (avplayIndex) => {
    if (
      Number.isFinite(avplayIndex) &&
      avplayIndex >= 0 &&
      PlayerController.setAvPlayAudioTrack(avplayIndex)
    ) {
      screen.selectedAudioTrackIndex = avplayIndex;
    }
    refresh();
  };
  const applied = PlayerController.setTizenAudioTrackWithDtsConversion({
    track: embeddedTrack,
    embeddedIndex,
    attempt: Boolean(entry.canTryAudioConversion),
    resumeAfterSwitch: Boolean(rememberSelection),
    selectTrack: (converted) =>
      select(findTizenAvPlayAudioTrackIndex(screen, embeddedIndex, converted ? embeddedIndex : -1)),
    // The original file has no audible DTS track: keep the track that played.
    selectFallback: () =>
      select(
        entry.canTryAudioConversion
          ? previousIndex
          : findTizenAvPlayAudioTrackIndex(screen, embeddedIndex)
      )
  });
  if (applied && rememberSelection)
    screen.rememberAudioTrackSelection(screen.getAudioTrackPreference(entry));
  refresh();
  return applied;
}
