/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods41() {
  const {
    Environment,
    buildSubtitleRequestHeaders,
    subtitleLabel,
    cleanDisplayText,
    normalizeComparableText,
    isGenericSubtitleTrackLabel,
    getEmbeddedSubtitleSupportState,
    getAudioTrackSupportState,
    normalizeTrackLanguageCode,
    inferTrackLanguageCodeFromText,
    getTrackLanguageValue,
    getUsableAudioTrackLanguageValue,
    isForcedSubtitleTrack
  } = internals;

  return {
    buildSubtitleTrackSignature(track = {}, fallbackIndex = -1) {
      const normalizedLanguage =
        normalizeTrackLanguageCode(track?.language || track?.lang || track?.srclang || "") ||
        String(track?.language || track?.lang || track?.srclang || "")
          .trim()
          .toLowerCase();
      const normalizedLabel = cleanDisplayText(track?.label || track?.name || "")
        .trim()
        .toLowerCase();
      if (normalizedLanguage || normalizedLabel) {
        return `${normalizedLanguage}|${normalizedLabel}`;
      }
      return `subtitle-${fallbackIndex}`;
    },
    dedupeBuiltInSubtitleTracks(builtInTracks = [], embeddedSubtitleTracks = []) {
      if (!Environment.isWebOS() || !embeddedSubtitleTracks.length || !builtInTracks.length) {
        return builtInTracks;
      }

      const embeddedNativeIndexes = new Set(
        embeddedSubtitleTracks.map((track) => Number(track?.nativeTrackIndex)).filter((index) => Number.isFinite(index) && index >= 0)
      );
      const embeddedSignatures = new Set(embeddedSubtitleTracks.map((track, index) => this.buildSubtitleTrackSignature(track, index)));

      return builtInTracks.filter((track, index) => {
        if (embeddedNativeIndexes.has(index)) {
          return false;
        }
        const signature = this.buildSubtitleTrackSignature(track, index);
        return !embeddedSignatures.has(signature);
      });
    },
    getEmbeddedSubtitleTrackForAvPlayTrack(track, fallbackIndex = track?.avplayTrackIndex) {
      const extraInfo = track?.extraInfo && typeof track.extraInfo === "object" ? track.extraInfo : {};
      const rawTextTrackNumber = extraInfo.track_num ?? extraInfo.trackNumber ?? extraInfo.track_number;
      const avplayTextTrackNumber =
        rawTextTrackNumber === null || rawTextTrackNumber === undefined || rawTextTrackNumber === "" ? NaN : Number(rawTextTrackNumber);
      // AVPlay's TEXT track_num is the container text ordinal. Prefer it over
      // the exposed-list position: when AVPlay omits a track, the position
      // shifts and the wrong local metadata would supply the language.
      const embeddedTrackByTextOrdinal =
        Number.isInteger(avplayTextTrackNumber) && avplayTextTrackNumber >= 0
          ? this.getEmbeddedSubtitleTrackByEmbeddedIndex(avplayTextTrackNumber)
          : null;
      const targetIndex = Number(fallbackIndex);
      return embeddedTrackByTextOrdinal || this.getEmbeddedSubtitleTrackByNativeIndex(Number.isFinite(targetIndex) ? targetIndex : -1);
    },
    mergeAvPlaySubtitleTrackMetadata(track, index) {
      const avplayTrackIndex = Number(track?.avplayTrackIndex);
      const embeddedTrack = this.getEmbeddedSubtitleTrackForAvPlayTrack(
        track,
        Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index
      );
      const support = getEmbeddedSubtitleSupportState({
        ...embeddedTrack,
        ...track,
        codec: track?.codec || embeddedTrack?.codec,
        format: track?.format || embeddedTrack?.format
      });
      if (!embeddedTrack) {
        return {
          ...track,
          supported: support.supported,
          unsupportedReason: support.unsupportedReason
        };
      }
      const rawAvplayLanguage = getTrackLanguageValue(track);
      const rawEmbeddedLanguage = getTrackLanguageValue(embeddedTrack);
      const avplayLanguageCode = normalizeTrackLanguageCode(rawAvplayLanguage) || inferTrackLanguageCodeFromText(rawAvplayLanguage);
      const embeddedLanguageCode = normalizeTrackLanguageCode(rawEmbeddedLanguage) || inferTrackLanguageCodeFromText(rawEmbeddedLanguage);
      const avplayLanguage = avplayLanguageCode ? rawAvplayLanguage : "";
      const embeddedLanguage = embeddedLanguageCode ? rawEmbeddedLanguage : "";
      const languageMatches = !avplayLanguageCode || !embeddedLanguageCode || avplayLanguageCode === embeddedLanguageCode;
      const avplayLabel = cleanDisplayText(track?.label || track?.name || track?.title);
      const embeddedLabel = cleanDisplayText(embeddedTrack?.label || embeddedTrack?.name || embeddedTrack?.title);
      const meaningfulEmbeddedLabel = isGenericSubtitleTrackLabel(embeddedLabel) ? "" : embeddedLabel;
      const useEmbeddedLabel = Boolean(
        meaningfulEmbeddedLabel && (!avplayLabel || isGenericSubtitleTrackLabel(avplayLabel)) && languageMatches
      );
      const displayLabel = (useEmbeddedLabel ? meaningfulEmbeddedLabel : avplayLabel || meaningfulEmbeddedLabel) || subtitleLabel(index);
      const selectedLanguage = avplayLanguage || embeddedLanguage;
      const bitmapSubtitle = Boolean(embeddedTrack?.bitmapSubtitle);
      const embeddedCodec = cleanDisplayText(embeddedTrack?.codec);
      return {
        ...track,
        label: displayLabel,
        name: cleanDisplayText(track?.name) && !isGenericSubtitleTrackLabel(track.name) ? track.name : displayLabel,
        // AVPlay's extra_info.track_lang is the authoritative Samsung language.
        // Local /tracks metadata only fills gaps and must not replace it with
        // placeholders such as "unknown" or "und".
        language: selectedLanguage,
        lang: track?.lang || selectedLanguage,
        codec: bitmapSubtitle ? embeddedCodec || track?.codec || "" : track?.codec || embeddedTrack?.codec || "",
        format: track?.format || embeddedTrack?.format || "",
        // Keep the container identity available for the software VobSub path:
        // AVPlay reports this track as text/plain and cannot draw its bitmaps.
        bitmapSubtitle,
        bitmapSubtitleFormat: embeddedTrack?.bitmapSubtitleFormat || null,
        sourceTrackId: Number(embeddedTrack?.sourceTrackId) || -1,
        supported: support.supported,
        unsupportedReason: embeddedTrack?.unsupportedReason || support.unsupportedReason || null,
        forced: isForcedSubtitleTrack(track) || isForcedSubtitleTrack(embeddedTrack),
        secondary: embeddedTrack.secondary || String(selectedLanguage || "").toUpperCase()
      };
    },
    mergeEmbeddedAudioTrackMetadata(track, index) {
      let embeddedTrack = this.getEmbeddedAudioTrackByNativeIndex(index) || this.getEmbeddedAudioTrack(index);
      const trackLanguage = getUsableAudioTrackLanguageValue(track);
      let embeddedTrackLanguage = getUsableAudioTrackLanguageValue(embeddedTrack);
      const explicitLanguage = normalizeTrackLanguageCode(trackLanguage);
      let embeddedLanguage = normalizeTrackLanguageCode(embeddedTrackLanguage);
      if (explicitLanguage && embeddedLanguage && explicitLanguage !== embeddedLanguage) {
        const languageMatchedTrack = (this.embeddedAudioTracks || []).find(
          (candidate) => normalizeTrackLanguageCode(candidate?.language || candidate?.lang || "") === explicitLanguage
        );
        if (languageMatchedTrack) {
          embeddedTrack = languageMatchedTrack;
          embeddedTrackLanguage = getUsableAudioTrackLanguageValue(embeddedTrack);
          embeddedLanguage = normalizeTrackLanguageCode(embeddedTrackLanguage);
        }
      }
      if (!embeddedTrack) {
        return {
          ...track,
          ...getAudioTrackSupportState(track)
        };
      }
      const support = getAudioTrackSupportState(embeddedTrack);
      const embeddedLabel = cleanDisplayText(embeddedTrack.label);
      const trackLabel = cleanDisplayText(track?.label || track?.name);
      const useEmbeddedLabel = Boolean(embeddedLabel && (!explicitLanguage || !embeddedLanguage || explicitLanguage === embeddedLanguage));
      return {
        ...track,
        label: useEmbeddedLabel ? embeddedLabel : trackLabel || "",
        name: cleanDisplayText(track?.name || (useEmbeddedLabel ? embeddedLabel : "")) || track?.name || "",
        language: trackLanguage || embeddedTrackLanguage,
        lang: trackLanguage || embeddedTrackLanguage,
        codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
        codecs: embeddedTrack.codecs || track?.codecs || "",
        audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
        codecProfile: embeddedTrack.codecProfile || track?.codecProfile || track?.profile || "",
        mimeType: embeddedTrack.mimeType || track?.mimeType || "",
        sampleMimeType: embeddedTrack.sampleMimeType || track?.sampleMimeType || "",
        format: embeddedTrack.format || track?.format || "",
        channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
        channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
        sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0,
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        raw: embeddedTrack.raw || track?.raw || null
      };
    },
    mergeAvPlayAudioTrackMetadata(track, index) {
      const avplayTrackIndex = Number(track?.avplayTrackIndex);
      const tizenEmbeddedTrack = Environment.isTizen() ? this.getEmbeddedAudioTrackForAvPlayTrack(track, index) : null;
      let embeddedTrack = Environment.isTizen()
        ? tizenEmbeddedTrack
        : this.getEmbeddedAudioTrackByNativeIndex(Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index) ||
          this.getEmbeddedAudioTrack(index);
      const hasVerifiedTizenMetadataMatch = Boolean(tizenEmbeddedTrack);
      const avplayLanguage = getUsableAudioTrackLanguageValue(track);
      let embeddedTrackLanguage = getUsableAudioTrackLanguageValue(embeddedTrack);
      const explicitLanguage = normalizeTrackLanguageCode(avplayLanguage);
      let embeddedLanguage = normalizeTrackLanguageCode(embeddedTrackLanguage);
      if (!hasVerifiedTizenMetadataMatch && explicitLanguage && embeddedLanguage && explicitLanguage !== embeddedLanguage) {
        const languageMatchedTrack = (this.embeddedAudioTracks || []).find(
          (candidate) => normalizeTrackLanguageCode(candidate?.language || candidate?.lang || "") === explicitLanguage
        );
        if (languageMatchedTrack) {
          embeddedTrack = languageMatchedTrack;
          embeddedTrackLanguage = getUsableAudioTrackLanguageValue(embeddedTrack);
          embeddedLanguage = normalizeTrackLanguageCode(embeddedTrackLanguage);
        }
      }
      if (!embeddedTrack) {
        return {
          ...track,
          ...getAudioTrackSupportState(track)
        };
      }
      const support = getAudioTrackSupportState(embeddedTrack);
      const embeddedLabel = cleanDisplayText(embeddedTrack.label);
      const trackLabel = cleanDisplayText(track?.label || track?.name);
      const useEmbeddedLabel = Boolean(
        embeddedLabel && (hasVerifiedTizenMetadataMatch || !explicitLanguage || !embeddedLanguage || explicitLanguage === embeddedLanguage)
      );
      return {
        ...track,
        label: useEmbeddedLabel ? embeddedLabel : trackLabel || "",
        name: cleanDisplayText(track?.name || (useEmbeddedLabel ? embeddedLabel : "")) || track?.name || "",
        language: hasVerifiedTizenMetadataMatch ? embeddedTrackLanguage || avplayLanguage : avplayLanguage || embeddedTrackLanguage,
        lang: hasVerifiedTizenMetadataMatch ? embeddedTrackLanguage || avplayLanguage : avplayLanguage || embeddedTrackLanguage,
        codec: embeddedTrack.codec || track?.codec || track?.audioCodec || "",
        codecs: embeddedTrack.codecs || track?.codecs || "",
        audioCodec: embeddedTrack.audioCodec || track?.audioCodec || track?.codec || "",
        codecProfile: embeddedTrack.codecProfile || track?.codecProfile || track?.profile || "",
        mimeType: embeddedTrack.mimeType || track?.mimeType || "",
        sampleMimeType: embeddedTrack.sampleMimeType || track?.sampleMimeType || "",
        format: embeddedTrack.format || track?.format || "",
        channels: embeddedTrack.channels || track?.channels || track?.channelCount || "",
        channelCount: embeddedTrack.channelCount || track?.channelCount || track?.channels || "",
        sampleRate: embeddedTrack.sampleRate || track?.sampleRate || track?.audioSampleRate || 0,
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        raw: embeddedTrack.raw || track?.raw || null
      };
    },
    mergeHlsAudioTrackMetadata(track, index) {
      const hlsTrackLanguage = getUsableAudioTrackLanguageValue(track);
      const hlsLanguage = normalizeTrackLanguageCode(hlsTrackLanguage);
      const hlsName = cleanDisplayText(track?.name || track?.label || "");
      const manifestTrack =
        this.manifestAudioTracks.find((entry) => {
          const manifestLanguage = normalizeTrackLanguageCode(getUsableAudioTrackLanguageValue(entry));
          const manifestName = cleanDisplayText(entry?.name || entry?.label || "");
          if (hlsLanguage && manifestLanguage && hlsLanguage === manifestLanguage) {
            return true;
          }
          if (hlsName && manifestName && normalizeComparableText(hlsName) === normalizeComparableText(manifestName)) {
            return true;
          }
          return false;
        }) ||
        this.manifestAudioTracks[index] ||
        null;
      if (!manifestTrack) {
        return {
          ...track,
          ...getAudioTrackSupportState(track)
        };
      }
      const manifestTrackLanguage = getUsableAudioTrackLanguageValue(manifestTrack);
      const mergedTrack = {
        ...track,
        label: cleanDisplayText(manifestTrack.label || manifestTrack.name) || track?.label || track?.name || "",
        name: cleanDisplayText(manifestTrack.name || manifestTrack.label) || track?.name || track?.label || "",
        language: manifestTrackLanguage || hlsTrackLanguage,
        lang: manifestTrackLanguage || hlsTrackLanguage,
        channels: manifestTrack.channels || track?.channels || track?.channelCount || "",
        channelCount: manifestTrack.channels || track?.channelCount || track?.channels || "",
        characteristics: manifestTrack.characteristics || track?.characteristics || "",
        isDefault: Boolean(manifestTrack.isDefault) || Boolean(track?.isDefault) || Boolean(track?.default),
        autoselect: Boolean(manifestTrack.autoselect) || Boolean(track?.autoselect),
        uri: manifestTrack.uri || track?.url || track?.uri || null
      };
      return {
        ...mergedTrack,
        ...getAudioTrackSupportState(mergedTrack)
      };
    },
    revokeExternalSubtitleObjectUrls() {
      if (!Array.isArray(this.externalSubtitleObjectUrls) || !this.externalSubtitleObjectUrls.length) {
        return;
      }
      this.externalSubtitleObjectUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {
          // Best effort.
        }
      });
      this.externalSubtitleObjectUrls = [];
    },
    clearMountedExternalSubtitleTracks() {
      this.externalTrackNodes.forEach((node) => node.remove());
      this.externalTrackNodes = [];
      // External subtitle selection is being torn down; retire the ASS
      // renderer so no overlay, instance, or timer outlives the tracks.
      this.destroyAssSubtitleRenderer();
      this.revokeExternalSubtitleObjectUrls();
    },
    getSubtitleRequestHeaders(subtitleUrl, { subtitleHeaders = {}, originalSubtitleUrl = subtitleUrl } = {}) {
      const streamCandidate = this.getCurrentStreamCandidate();
      const streamUrl = this.activePlaybackUrl || streamCandidate?.raw?.url || streamCandidate?.url || "";
      return buildSubtitleRequestHeaders(subtitleUrl, {
        streamUrl,
        streamHeaders: this.getCurrentStreamRequestHeaders(streamCandidate),
        subtitleHeaders,
        originalSubtitleUrl
      });
    },
    isLikelySrtSubtitleUrl(url) {
      const value = String(url || "").toLowerCase();
      return value.includes(".srt") || value.includes("format=srt");
    }
  };
}
