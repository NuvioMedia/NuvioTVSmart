import { PlayerController } from "../../../core/player/playerController.js";
import { I18n } from "../../../i18n/index.js";
import { resolveStreamFilename } from "./streamFilename.js";
import { detectHdrFormatTitle, isHdrActive } from "../../../core/player/hdrColorCalibration.js";
const t = (key) => I18n.t(key);
const text = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const positive = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
export function isStreamInfoKey(event) {
  return (
    event?.key === "Info" ||
    event?.keyName === "Info" ||
    [457, 165].includes(Number(event?.keyCode))
  );
}
export function buildStreamInfo(screen, controller = PlayerController) {
  const stream = screen.getCurrentStreamCandidate?.() || {};
  const raw = stream.raw || {};
  const hint = { ...raw.behaviorHints, ...stream.behaviorHints };
  const audio = (screen.getAudioEntries?.() || []).find((entry) => entry.selected);
  const builtIn = (screen.getSubtitleEntries?.("builtIn") || []).find(
    (entry) => entry.selected && entry.id !== "subtitle-off" && entry.id !== "off"
  );
  const addon = (screen.getSubtitleEntries?.("addons") || []).find((entry) => entry.selected);
  const subtitle = screen.selectedAddonSubtitleId ? addon : builtIn;
  const dimensions = controller.isUsingAvPlay?.() ? controller.getAvPlayVideoDimensions?.() : null;
  const video = controller.video;
  const size = positive(hint.videoSize || stream.videoSize || raw.videoSize);
  const isHdr = isHdrActive(stream, video?.hdrInfo, screen.params?.filename);
  const hdrFormat = isHdr ? detectHdrFormatTitle(stream, video?.hdrInfo, screen.params?.filename) : null;
  return {
    addonName: stream.addonName || raw.addonName,
    streamName: stream.name || stream.title,
    streamDescription: stream.description || raw.description,
    filename: resolveStreamFilename(
      stream,
      screen.initialFilenameStreamCandidate,
      screen.params?.filename
    ),
    fileSize: size,
    videoWidth: positive(dimensions?.width || video?.videoWidth),
    videoHeight: positive(dimensions?.height || video?.videoHeight),
    videoCodec: stream.videoCodec || raw.videoCodec,
    videoFrameRate: positive(stream.frameRate || raw.frameRate),
    hdrFormat,
    fileBitrate: size && video?.duration > 0 ? (size * 8) / video.duration : null,
    audioName: audio?.label,
    audioCodec:
      audio?.track?.codec || audio?.track?.audioCodec || audio?.codec || audio?.raw?.codec,
    audioChannels:
      audio?.track?.channels ||
      audio?.track?.channelCount ||
      audio?.channels ||
      audio?.raw?.channels,
    audioSampleRate: positive(
      audio?.track?.sampleRate || audio?.sampleRate || audio?.raw?.sampleRate
    ),
    audioLanguage: audio?.track?.language || audio?.language || audio?.languageKey,
    subtitleName: subtitle?.name || subtitle?.label,
    subtitleCodec: subtitle?.track?.codec || subtitle?.codec || subtitle?.raw?.codec,
    subtitleLanguage: subtitle?.language || subtitle?.lang,
    subtitleSource: subtitle
      ? t(
          screen.selectedAddonSubtitleId
            ? "stream_info_subtitle_source_addon"
            : "stream_info_subtitle_source_embedded"
        )
      : null,
    playerEngine: controller.playbackEngine || (controller.isUsingAvPlay?.() ? "AVPlay" : "HTML5")
  };
}
export function renderStreamInfo(data) {
  const row = (key, value) =>
    value == null || value === ""
      ? ""
      : `<div class="stream-info-cell"><span>${text(t(key))}</span><strong>${text(value)}</strong></div>`;
  const section = (key, body) =>
    body
      ? `<section><h3>${text(t(key))}</h3><div class="stream-info-grid">${body}</div></section>`
      : "";
  const bytes = data.fileSize ? `${(data.fileSize / 1073741824).toFixed(2)} GB` : null;
  return (
    section(
      "stream_info_section_source",
      row(
        "stream_info_source",
        [data.addonName, data.streamName, data.streamDescription].filter(Boolean).join(" · ")
      ) + row("stream_info_player_engine", data.playerEngine)
    ) +
    section(
      "stream_info_section_file",
      row("stream_info_filename", data.filename) + row("stream_info_size", bytes)
    ) +
    section(
      "stream_info_section_video",
      row("stream_info_codec", data.videoCodec) +
        row("stream_info_hdr", data.hdrFormat) +
        row(
          "stream_info_resolution",
          data.videoWidth && data.videoHeight ? `${data.videoWidth} × ${data.videoHeight}` : null
        ) +
        row(
          "stream_info_frame_rate",
          data.videoFrameRate ? `${data.videoFrameRate.toFixed(3)} fps` : null
        ) +
        row(
          "stream_info_bitrate",
          data.fileBitrate ? `${(data.fileBitrate / 1e6).toFixed(2)} Mbps` : null
        )
    ) +
    section(
      "stream_info_section_audio",
      row("stream_info_name", data.audioName) +
        row("stream_info_codec", data.audioCodec) +
        row("stream_info_channels", data.audioChannels) +
        row(
          "stream_info_sample_rate",
          data.audioSampleRate ? `${data.audioSampleRate / 1000} kHz` : null
        ) +
        row("stream_info_language", data.audioLanguage)
    ) +
    section(
      "stream_info_section_subtitle",
      row("stream_info_name", data.subtitleName) +
        row("stream_info_codec", data.subtitleCodec) +
        row("stream_info_language", data.subtitleLanguage) +
        row("stream_info_source", data.subtitleSource)
    )
  );
}
export const StreamInfoMethods = {
  showStreamInfo() {
    if (
      this.streamInfoVisible ||
      this.isStartupErrorVisible() ||
      this.isExternalFrameMode() ||
      this.isPostPlayVisible()
    )
      return;
    this.streamInfoRestore = {
      controlsVisible: this.controlsVisible,
      controlFocusZone: this.controlFocusZone,
      controlFocusIndex: this.controlFocusIndex
    };
    this.streamInfoVisible = true;
    this.clearControlsAutoHide();
    this.setControlsVisible(false, { focus: false });
    const overlay = document.createElement("div");
    overlay.className = "player-stream-info-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", t("cd_stream_info"));
    overlay.tabIndex = -1;
    overlay.innerHTML = renderStreamInfo(buildStreamInfo(this));
    this.container.appendChild(overlay);
    this.streamInfoOverlay = overlay;
    overlay.addEventListener("click", () => this.closeStreamInfo());
    overlay.focus();
  },
  closeStreamInfo({ restore = true } = {}) {
    if (!this.streamInfoVisible) return;
    this.streamInfoVisible = false;
    this.streamInfoOverlay?.remove();
    this.streamInfoOverlay = null;
    const state = this.streamInfoRestore;
    this.streamInfoRestore = null;
    if (!restore) return;
    if (state) {
      this.controlFocusZone = state.controlFocusZone;
      this.controlFocusIndex = state.controlFocusIndex;
      this.setControlsVisible(state.controlsVisible, { focus: state.controlsVisible });
    }
    this.resetControlsAutoHide();
  }
};
