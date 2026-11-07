import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { matchPlayerBadges } from "../../../core/streams/streamBadgeRules.js";
import { formatAudioCodecName, getAuthoritativeAudioCodecValue } from "../../../core/player/audioTrackCodecMetadata.js";
import { isHdrMediaInfo } from "../../../core/player/hdrSubtitleStyle.js";
import { resolveStreamFilename } from "./streamFilename.js";

export function playbackMatchText(info = {}, languages = []) {
  const tokens = [];
  const width = Number(info.videoWidth),
    height = Number(info.videoHeight);
  if (width > 0 && height > 0) {
    tokens.push(
      ...(width >= 3800 || height >= 2100
        ? ["2160p", "4K", "UHD"]
        : width >= 2500 || height >= 1400
          ? ["1440p", "2K"]
          : width >= 1900 || height >= 1000
            ? ["1080p", "FHD"]
            : width >= 1260 || height >= 700
              ? ["720p"]
              : [`${height}p`, "SD"])
    );
  }
  const codec = String(info.videoCodec || "");
  if (/dvh[1e]|dva[1v]|dolby.?vision/i.test(codec)) tokens.push("DV", "DoVi", "Dolby Vision");
  if (/h26[5]|h\.265|hev[1c]|hvc1|dvh[1e]/i.test(codec)) tokens.push("HEVC", "H.265", "H265", "x265");
  else if (/avc|h26[4]|h\.264|dva[1v]/i.test(codec)) tokens.push("AVC", "H.264", "H264", "x264");
  else if (/av01|av1/i.test(codec)) tokens.push("AV1");
  else if (/vp09|vp9/i.test(codec)) tokens.push("VP9");
  else if (codec) tokens.push(codec);
  const hdr = [...(info.hdr || [])];
  if (/dvh[1e]|dva[1v]|dolby.?vision/i.test(codec) && !hdr.includes("DV")) hdr.push("DV");
  if (hdr.includes("DV")) tokens.push("DV", "DoVi", "Dolby Vision");
  if (hdr.includes("HDR10")) tokens.push("HDR", "HDR10");
  if (hdr.includes("HLG")) tokens.push("HDR", "HLG");
  const bitDepth = info.bitDepth || (hdr.length ? 10 : null);
  if (bitDepth > 0) tokens.push(`${bitDepth}bit`);
  const audio = formatAudioCodecName(info.audioCodec);
  const profile = String(info.audioProfile || "").toUpperCase();
  if (audio.startsWith("E-AC-3")) tokens.push("DD+", "DDP", "EAC3");
  else if (audio === "AC-3") tokens.push("DD", "AC3");
  else if (audio.startsWith("DTS")) {
    tokens.push("DTS");
    if (audio.includes("HD") || profile.includes("DTS-HD")) tokens.push("DTS-HD");
    if (profile.includes("MA")) tokens.push("DTS-HD MA");
    if (profile.includes("DTS:X")) tokens.push("DTS:X");
  } else if (audio) tokens.push(audio);
  if (audio.endsWith("JOC") || /ATMOS/.test(profile) || audio.includes("Atmos")) tokens.push("Atmos");
  const channels = { 1: "1.0", 2: "2.0", 6: "5.1", 8: "7.1" }[info.audioChannels];
  if (channels) tokens.push(channels);
  tokens.push(...languages.filter(Boolean));
  return [...new Set(tokens)].join(" ");
}

const REFINE_DTS_HD_MA = /dts-?hd[ ._-]?ma\b|master[ ._-]?audio/i;
const REFINE_DTS_X = /\bdts[ ._:-]?x\b/i;
const REFINE_HDR10_PLUS = /\bhdr10\+/i;

// Adds details the decoder cannot report but the filename confirms, only on top of a decoder-confirmed base format.
export function refinePlaybackText(decoderText = "", metadata = []) {
  if (!decoderText.trim() || !metadata.length) return decoderText;
  const joined = metadata.join(" ");
  const extra = [];
  const hasEac3OrTruehd = /DD\+|DDP|EAC3|TrueHD/.test(decoderText);
  if (hasEac3OrTruehd && !decoderText.includes("Atmos") && /atmos/i.test(joined)) extra.push("Atmos");
  if (decoderText.includes("DTS-HD") && !decoderText.includes("DTS-HD MA") && REFINE_DTS_HD_MA.test(joined)) extra.push("DTS-HD MA");
  if (decoderText.includes("DTS") && !decoderText.includes("DTS:X") && REFINE_DTS_X.test(joined)) extra.push("DTS:X");
  if (decoderText.includes("HDR10") && !decoderText.includes("HDR10+") && REFINE_HDR10_PLUS.test(joined)) extra.push("HDR10+");
  return extra.length ? `${decoderText} ${extra.join(" ")}` : decoderText;
}

// AVPlay and <video> expose no colour info, so an HDR-capable codec takes its dynamic range from the filename.
export function metadataDynamicRange(videoCodec, metadata = []) {
  if (!/h26[5]|h\.265|hev[1c]|hvc1|dvh[1e]|av01|av1|vp09|vp9/i.test(String(videoCodec || ""))) return [];
  const text = metadata.join(" ").replace(/[._]/g, " ");
  const hdr = [];
  if (/\b(dv|dovi|dolby ?vision)\b/i.test(text)) hdr.push("DV");
  if (/\bhdr(10)?\b|\bhdr10(\+|plus)/i.test(text)) hdr.push("HDR10");
  if (/\bhlg\b/i.test(text)) hdr.push("HLG");
  return hdr;
}

export function readPlaybackMediaInfo(controller) {
  const video = controller.video;
  let videoInfo = {},
    audio = {},
    hdr = null;
  const usingAvPlay = controller.isUsingAvPlay?.();
  if (usingAvPlay) {
    const streams = controller.getAvPlay()?.getCurrentStreamInfo?.() || [];
    const extra = (type) => {
      const track = streams.find((entry) => String(entry.type).toUpperCase() === type);
      return controller.parseAvPlayExtraInfo(track?.extra_info || track?.extraInfo) || {};
    };
    const avVideo = extra("VIDEO"),
      avAudio = extra("AUDIO");
    const pick = (source, keys) => controller.pickAvPlayExtraValue(source, keys);
    const dimensions = controller.getAvPlayVideoDimensions?.();
    videoInfo = {
      width: dimensions?.width,
      height: dimensions?.height,
      codec: pick(avVideo, ["codec", "video_codec", "fourCC", "codec_name"]),
      bitDepth: Number(pick(avVideo, ["bit_depth", "bitDepth"])) || null
    };
    const selectedAudio =
      controller.avplayAudioTracks?.find((track) => track.avplayTrackIndex === controller.selectedAvPlayAudioTrackIndex) || {};
    const range = String(pick(avVideo, ["hdr_type", "hdr", "HDRType"]) || "").toUpperCase();
    if (range === "HDR10" || range === "HLG" || range === "DV") hdr = [range];
    audio = {
      ...selectedAudio,
      codec: pick(avAudio, ["codec", "audio_type", "fourCC", "audio_codec"]) || selectedAudio.codec,
      codecProfile: pick(avAudio, ["profile", "codec_profile"]) || selectedAudio.codecProfile,
      channels: pick(avAudio, ["channels", "audio_channel", "audio_channel_count"]) || selectedAudio.channels,
      language: pick(avAudio, ["language", "lang", "track_lang"]) || selectedAudio.language
    };
  } else if (controller.hlsInstance) {
    const hls = controller.hlsInstance;
    const level = hls.levels?.[hls.currentLevel] || {};
    videoInfo = { width: level.width, height: level.height, codec: level.videoCodec };
    if (level.videoRange) hdr = level.videoRange === "PQ" ? ["HDR10"] : level.videoRange === "HLG" ? ["HLG"] : [];
    const selected = hls.audioTracks?.[hls.audioTrack];
    // A muxed level's audio codec is authoritative only without alternate audio tracks.
    audio = selected
      ? { ...selected, codec: selected.audioCodec || selected.codec }
      : hls.audioTracks?.length
        ? {}
        : { codec: level.audioCodec };
  } else if (controller.dashInstance) {
    const dash = controller.dashInstance;
    const representation = dash.getCurrentRepresentationForType?.("video") || {};
    videoInfo = { width: representation.width, height: representation.height, codec: representation.codecs };
    const track = dash.getCurrentTrackFor?.("audio") || {};
    const audioRepresentation = dash.getCurrentRepresentationForType?.("audio") || {};
    audio = { ...track, codec: audioRepresentation.codecs || track.codec, channels: track.audioChannelConfiguration?.[0]?.value };
  } else {
    audio = Array.from(video?.audioTracks || []).find((track) => track.enabled || track.selected) || {};
  }
  const channels = String(audio.channels || audio.channelCount || "");
  return {
    videoWidth: usingAvPlay ? videoInfo.width : video?.videoWidth || videoInfo.width,
    videoHeight: usingAvPlay ? videoInfo.height : video?.videoHeight || videoInfo.height,
    videoCodec: videoInfo.codec,
    bitDepth: videoInfo.bitDepth,
    hdr,
    audioCodec: getAuthoritativeAudioCodecValue(audio),
    audioProfile: audio.codecProfile || audio.profile || (/JOC/i.test(channels) ? "Atmos" : ""),
    audioChannels: channels === "5.1" ? 6 : channels === "7.1" ? 8 : channels === "2.0" ? 2 : Number(channels.split("/")[0]),
    language: audio.language || audio.lang || ""
  };
}

const states = new WeakMap();

/** Whether the playing video is HDR/Dolby Vision, from the decoder first and the source name after. */
export function readPlaybackHdrState(screen, controller) {
  try {
    const info = readPlaybackMediaInfo(controller);
    const stream = screen?.getCurrentStreamCandidate?.() || null;
    const metadata = [
      resolveStreamFilename(stream, screen?.initialFilenameStreamCandidate, screen?.params?.filename),
      stream?.raw?.name || stream?.label
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const hdr = Array.isArray(info.hdr) && info.hdr.length ? info.hdr : metadataDynamicRange(info.videoCodec, metadata);
    return isHdrMediaInfo({ videoCodec: info.videoCodec, hdr });
  } catch (_) {
    return false;
  }
}

export function syncPlayerPlaybackBadges(screen, controller, renderChip, languageLabel) {
  const node = screen.uiRefs?.playbackBadges;
  if (!node) return;
  let state = states.get(screen);
  if (!state || state.node !== node) {
    state = { node, visible: false };
    states.set(screen, state);
  }
  const visible = Boolean(screen.controlsVisible && !screen.loadingVisible && !screen.bufferingActive);
  if (!visible) {
    state.visible = false;
    node.hidden = true;
    return;
  }
  if (!state.visible) {
    state.settings = StreamBadgeSettingsStore.snapshot();
    state.key = null;
  }
  state.visible = true;
  if (!state.settings.showInPlayer) {
    node.hidden = true;
    return;
  }
  try {
    const video = controller.video;
    const hls = controller.hlsInstance;
    const audioTrack = hls?.audioTracks?.[hls.audioTrack];
    const level = hls?.levels?.[hls.currentLevel];
    const key = JSON.stringify([
      controller.playbackEngine,
      controller.avplayUrl,
      video?.currentSrc,
      video?.videoWidth,
      video?.videoHeight,
      screen.currentStreamIndex,
      screen.selectedAudioTrackIndex,
      controller.selectedAvPlayAudioTrackIndex,
      controller.hlsInstance?.audioTrack,
      controller.hlsInstance?.currentLevel,
      level?.videoCodec,
      level?.videoRange,
      audioTrack?.audioCodec,
      audioTrack?.lang,
      audioTrack?.channels,
      controller.dashInstance?.getCurrentTrackFor?.("audio")?.id,
      controller.dashInstance?.getCurrentRepresentationForType?.("video")?.id,
      Array.from(video?.audioTracks || []).findIndex((track) => track.enabled || track.selected)
    ]);
    if (state.key === key && state.hls === controller.hlsInstance && state.dash === controller.dashInstance) return;
    state.hls = controller.hlsInstance;
    state.dash = controller.dashInstance;
    state.key = key;
    const info = readPlaybackMediaInfo(controller);
    const stream = screen.getCurrentStreamCandidate?.();
    const meta = [
      resolveStreamFilename(stream, screen.initialFilenameStreamCandidate, screen.params?.filename),
      stream?.raw?.name || stream?.label
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!info.hdr) info.hdr = metadataDynamicRange(info.videoCodec, meta);
    const text = playbackMatchText(info, [info.language, info.language ? languageLabel({ language: info.language }) : ""]);
    const badges = matchPlayerBadges(refinePlaybackText(text, meta), meta, state.settings.playerRules);
    const html = badges
      .filter((badge) => badge.imageURL)
      .map(renderChip)
      .join("");
    if (node.innerHTML !== html) node.innerHTML = html;
    node.hidden = !html;
  } catch (_) {
    state.key = null;
    node.hidden = true;
  }
}
