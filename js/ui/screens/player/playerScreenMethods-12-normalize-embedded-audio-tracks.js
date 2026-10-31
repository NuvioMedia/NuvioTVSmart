/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods12() {
  const {
    PlayerController,
    mapAudioTrackNativeIndexes,
    Environment,
    TizenCapabilities,
    t,
    cleanDisplayText,
    getTx3gSubtitleSupportMessage,
    getBitmapSubtitleSupportMessage,
    isBitmapSubtitleSupportReason,
    getAudioTrackSupportState,
    normalizeTrackLanguageCode,
    getUsableAudioTrackLanguageValue,
    inferAudioTrackLanguageKey,
    getMeaningfulTrackLabel,
    parseHlsAttributeList,
    resolveUrl
  } = internals;

  return {
    normalizeEmbeddedAudioTracks(rawTracks = []) {
      const audioTracks = rawTracks.filter(
        (track) => String(track?.type || track?.track || track?.codecType || "").toLowerCase() === "audio"
      );
      const supportStates = audioTracks.map((track) => getAudioTrackSupportState(track));
      const nativeTrackIndexes = mapAudioTrackNativeIndexes(
        supportStates.map((support) => support.supported),
        { filterUnsupported: Environment.isWebOS() }
      );
      return audioTracks.map((track, index) => {
        const sourceTrackId = Number(track?.id);
        const support = supportStates[index];
        const rawLanguage = getUsableAudioTrackLanguageValue(track);
        const inferredLanguage = inferAudioTrackLanguageKey(track);
        return {
          id: `embedded-audio-${index}`,
          embeddedTrackIndex: index,
          sourceTrackId: Number.isFinite(sourceTrackId) ? sourceTrackId : -1,
          nativeTrackIndex: nativeTrackIndexes[index],
          supported: support.supported,
          unsupportedReason: support.unsupportedReason,
          label: getMeaningfulTrackLabel(track),
          name: cleanDisplayText(track?.name),
          title: cleanDisplayText(track?.title),
          language:
            inferredLanguage ||
            normalizeTrackLanguageCode(rawLanguage) ||
            String(rawLanguage || "")
              .trim()
              .toLowerCase(),
          lang: cleanDisplayText(rawLanguage),
          codec: cleanDisplayText(track?.codec || track?.audioCodec),
          codecs: cleanDisplayText(track?.codecs || track?.codec_id || track?.codec_tag_string),
          audioCodec: cleanDisplayText(track?.audioCodec || track?.codec),
          codecProfile: cleanDisplayText(track?.codecProfile || track?.profile || track?.codec_profile),
          mimeType: cleanDisplayText(track?.mimeType || track?.mime_type),
          sampleMimeType: cleanDisplayText(track?.sampleMimeType || track?.sample_mime_type),
          format: cleanDisplayText(track?.format || track?.format_name || track?.format_long_name),
          channels: track?.channels || track?.channelCount || "",
          channelCount: track?.channelCount || track?.channels || "",
          sampleRate: Number(track?.sampleRate || track?.audioSampleRate || track?.sample_rate || 0) || 0,
          raw: track
        };
      });
    },
    getUnavailableTrackMessage(kind = "audio") {
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if (!usingAvPlay && this.isCurrentSourceLikelyMkv()) {
        if (kind === "subtitle") {
          if (Environment.isTizen()) {
            return t("player_tizen_mkv_subtitles_unavailable", {}, "Embedded MKV subtitles are not exposed by this TV's web player.");
          }
          return Environment.isWebOS()
            ? "No embedded subtitle tracks detected."
            : "MKV internal subtitles are not exposed by the web player.";
        }
        if (Environment.isTizen()) {
          return t("player_tizen_mkv_audio_unavailable", {}, "Embedded MKV audio tracks are not exposed by this TV's web player.");
        }
        return Environment.isWebOS()
          ? "No embedded audio tracks detected."
          : "MKV internal audio tracks are not exposed by the web player.";
      }
      return kind === "subtitle" ? "No subtitle tracks available." : "No audio tracks available.";
    },
    isTizenDashAudioSwitchingUnsupported() {
      return TizenCapabilities.isDashAudioSwitchingUnsupported({
        dashManifest: this.isCurrentSourceLikelyDash(),
        usingAvPlay: typeof PlayerController.isUsingAvPlay === "function" && PlayerController.isUsingAvPlay()
      });
    },
    isTizenDashSubtitleSwitchingUnsupported() {
      return Boolean(
        Environment.isTizen() &&
        this.isCurrentSourceLikelyDash() &&
        typeof PlayerController.isUsingAvPlay === "function" &&
        PlayerController.isUsingAvPlay()
      );
    },
    getAudioDialogSupportNotice() {
      return this.isTizenDashAudioSwitchingUnsupported()
        ? t("player_audio_tizen_dash_unsupported", {}, "Changing DASH audio tracks is not supported on this TV.")
        : "";
    },
    getSubtitleDialogSupportNotice() {
      const notices = [];
      if (this.embeddedTextSubtitleSupportNotice) {
        notices.push(this.embeddedTextSubtitleSupportNotice);
      }
      if (
        !this.embeddedTextSubtitleSupportNotice &&
        this.embeddedSubtitleTracks.some((track) => track?.unsupportedReason === "tizen-tx3g")
      ) {
        notices.push(getTx3gSubtitleSupportMessage("tizen-tx3g"));
      }
      if (this.embeddedBitmapSubtitleSupportNotice) {
        notices.push(this.embeddedBitmapSubtitleSupportNotice);
      } else if (this.embeddedSubtitleTracks.some((track) => isBitmapSubtitleSupportReason(track?.unsupportedReason))) {
        notices.push(getBitmapSubtitleSupportMessage());
      }
      if (TizenCapabilities.isAdvancedSubtitleStylingLimited()) {
        notices.push(
          t("player_subtitle_tizen_advanced_unsupported", {}, "Advanced subtitle styling may not be fully supported on this TV.")
        );
      }
      if (this.isTizenDashSubtitleSwitchingUnsupported()) {
        notices.push(
          t("player_subtitle_tizen_dash_unsupported", {}, "Subtitle switching for DASH streams may not be supported by this TV.")
        );
      }
      return notices.join(" ");
    },
    getVideoTextTrackList() {
      const video = PlayerController.video;
      if (!video) {
        return null;
      }
      return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
    },
    getVideoAudioTrackList() {
      const video = PlayerController.video;
      if (!video) {
        return null;
      }
      return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
    },
    collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
      const mapSubtitles = (candidate) => {
        const stream = candidate?.raw || candidate || null;
        const rawSubtitles = Array.isArray(stream?.subtitles) ? stream.subtitles : [];
        return rawSubtitles
          .filter((subtitle) => Boolean(subtitle?.url))
          .map((subtitle, index) => {
            const headers = subtitle.headers || subtitle.behaviorHints?.proxyHeaders?.request;
            return {
              id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
              url: subtitle.url,
              lang: subtitle.lang || "unknown",
              ...(headers ? { headers } : {}),
              addonName: candidate?.addonName || "Stream",
              addonLogo: candidate?.addonLogo || null
            };
          });
      };

      const current = mapSubtitles(streamCandidate);
      if (current.length) {
        return current;
      }

      return this.streamCandidates.reduce((items, candidate) => {
        const mapped = mapSubtitles(candidate);
        if (mapped.length) {
          items.push(...mapped);
        }
        return items;
      }, []);
    },
    mergeSubtitleCandidates(primary = [], secondary = []) {
      const merged = [];
      const seen = new Set();
      [...(primary || []), ...(secondary || [])].forEach((subtitle) => {
        if (!subtitle?.url) {
          return;
        }
        const key = `${String(subtitle.url).trim()}::${String(subtitle.lang || "")
          .trim()
          .toLowerCase()}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push(subtitle);
      });
      return merged;
    },
    getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
      const requestHeaders =
        streamCandidate?.raw?.behaviorHints?.proxyHeaders?.request || streamCandidate?.behaviorHints?.proxyHeaders?.request;
      if (!requestHeaders || typeof requestHeaders !== "object") {
        return {};
      }
      return { ...requestHeaders };
    },
    parseHlsManifestTracks(manifestText, manifestUrl) {
      const lines = String(manifestText || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const audioTracks = [];
      const subtitleTracks = [];
      const variants = [];
      let pendingVariantAttributes = null;

      lines.forEach((line) => {
        if (line.startsWith("#EXT-X-MEDIA:")) {
          const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
          const mediaType = String(attributes.TYPE || "").toUpperCase();
          const groupId = String(attributes["GROUP-ID"] || "").trim();
          const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
          const language = String(attributes.LANGUAGE || "").trim();
          const channels = String(attributes.CHANNELS || "").trim();
          const characteristics = String(attributes.CHARACTERISTICS || "").trim();
          const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
          const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
          const forced = String(attributes.FORCED || "").toUpperCase() === "YES";
          const autoselect = String(attributes.AUTOSELECT || "").toUpperCase() === "YES";
          const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;

          if (mediaType === "AUDIO") {
            audioTracks.push({
              id: trackId,
              groupId,
              name: name || `Audio ${audioTracks.length + 1}`,
              language,
              channels,
              characteristics,
              uri,
              isDefault,
              forced,
              autoselect
            });
            return;
          }

          if (mediaType === "SUBTITLES") {
            subtitleTracks.push({
              id: trackId,
              groupId,
              name: name || `Subtitle ${subtitleTracks.length + 1}`,
              language,
              characteristics,
              uri,
              isDefault,
              forced,
              autoselect
            });
            return;
          }
          return;
        }

        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
          return;
        }

        if (line.startsWith("#")) {
          return;
        }

        if (!pendingVariantAttributes) {
          return;
        }

        variants.push({
          uri: resolveUrl(manifestUrl, line),
          audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
          subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
          codecs: String(pendingVariantAttributes.CODECS || "").trim(),
          bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
          resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
        });
        pendingVariantAttributes = null;
      });

      const codecsByAudioGroup = new Map();
      variants.forEach((variant) => {
        const groupId = cleanDisplayText(variant?.audioGroupId);
        const codecs = cleanDisplayText(variant?.codecs);
        if (!groupId || !codecs) {
          return;
        }
        const existing = codecsByAudioGroup.get(groupId) || [];
        if (!existing.includes(codecs)) {
          existing.push(codecs);
          codecsByAudioGroup.set(groupId, existing);
        }
      });
      audioTracks.forEach((track) => {
        const codecs = codecsByAudioGroup.get(cleanDisplayText(track?.groupId));
        if (codecs?.length) {
          track.codecs = codecs.join(", ");
        }
      });

      return {
        audioTracks,
        subtitleTracks,
        variants
      };
    }
  };
}
