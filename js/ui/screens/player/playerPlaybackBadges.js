import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { matchStreamBadges } from "../../../core/streams/streamBadgeRules.js";
import { formatAudioCodecName, getAuthoritativeAudioCodecValue } from "../../../core/player/audioTrackCodecMetadata.js";

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

export function readPlaybackMediaInfo(controller) {
  const video = controller.video;
  let videoInfo = {},
    audio = {},
    hdr = [];
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
    videoInfo = {
      width: pick(avVideo, ["width", "video_width"]),
      height: pick(avVideo, ["height", "video_height"]),
      codec: pick(avVideo, ["codec", "video_codec", "fourCC", "codec_name"]),
      bitDepth: Number(pick(avVideo, ["bit_depth", "bitDepth"])) || null
    };
    const selectedAudio =
      controller.avplayAudioTracks?.find((track) => track.avplayTrackIndex === controller.selectedAvPlayAudioTrackIndex) || {};
    const range = String(pick(avVideo, ["hdr_type", "hdr", "HDRType"]) || "").toUpperCase();
    hdr = range === "HDR10" || range === "HLG" || range === "DV" ? [range] : [];
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
    if (level.videoRange === "PQ") hdr = ["HDR10"];
    if (level.videoRange === "HLG") hdr = ["HLG"];
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
    const text = playbackMatchText(info, [info.language, info.language ? languageLabel({ language: info.language }) : ""]);
    const badges = text ? matchStreamBadges({ name: text }, state.settings.playerRules) : [];
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
