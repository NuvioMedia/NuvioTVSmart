/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods40() {
  const {
    PlayerController,
    formatAudioCodecName,
    getAuthoritativeAudioCodecValue,
    localMediaTracksRepository,
    Environment,
    trackListToArray,
    createTrackDialogCache
  } = internals;

  return {
    async waitForInitialEmbeddedTrackBootstrap(timeoutMs = 900) {
      const pending = this.initialEmbeddedTrackBootstrapPromise;
      if (!pending || typeof pending.then !== "function") {
        return;
      }
      try {
        await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, Math.max(150, Number(timeoutMs || 0))))]);
      } catch (_) {
        // Ignore bootstrap probe failures and continue playback startup.
      }
    },
    async loadEmbeddedSubtitleTracks() {
      const probeUrl = this.getTrackProbeUrl();
      if (probeUrl && this.embeddedTrackRequestPromise && this.embeddedTrackRequestUrl === probeUrl && this.embeddedSubtitleLoading) {
        return this.embeddedTrackRequestPromise;
      }

      const requestToken = (this.embeddedSubtitleLoadToken || 0) + 1;
      const preserveExistingTracks = Boolean(
        probeUrl &&
        probeUrl === this.lastEmbeddedTrackProbeUrl &&
        (this.embeddedSubtitleTracks.length > 0 || this.embeddedAudioTracks.length > 0)
      );
      this.embeddedSubtitleLoadToken = requestToken;
      this.embeddedSubtitleLoading = true;
      this.embeddedAudioLoading = true;
      if (!preserveExistingTracks) {
        this.embeddedSubtitleTracks = [];
        this.embeddedAudioTracks = [];
        this.selectedEmbeddedSubtitleTrackIndex = -1;
        this.selectedEmbeddedAudioTrackIndex = -1;
      }
      this.refreshTrackDialogs();

      const requestPromise = (async () => {
        const canLoadSubtitleTracks = this.canDiscoverEmbeddedSubtitleTracks();
        const canLoadAudioTracks = this.canDiscoverEmbeddedAudioTracks();
        if (!canLoadSubtitleTracks && !canLoadAudioTracks) {
          return;
        }

        const capabilityPromise =
          Environment.isWebOS() && typeof PlayerController.refreshWebOsDeviceInfo === "function"
            ? PlayerController.refreshWebOsDeviceInfo()
            : Promise.resolve();
        const [, tracks] = await Promise.all([capabilityPromise, localMediaTracksRepository.getTracks(probeUrl)]);
        if (requestToken !== this.embeddedSubtitleLoadToken) {
          return;
        }

        this.lastEmbeddedTrackProbeUrl = probeUrl;
        this.embeddedSubtitleTracks = canLoadSubtitleTracks ? this.normalizeEmbeddedSubtitleTracks(tracks) : [];
        this.embeddedAudioTracks = canLoadAudioTracks ? this.normalizeEmbeddedAudioTracks(tracks) : [];
        this.warmBitmapSubtitleSharedResources();
        const selectedEmbeddedSubtitleTrack =
          typeof PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex === "function"
            ? PlayerController.getSelectedWebOsEmbeddedSubtitleTrackIndex()
            : -1;
        const selectedEmbeddedAudioTrack =
          typeof PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex === "function"
            ? PlayerController.getSelectedWebOsEmbeddedAudioTrackIndex()
            : -1;
        this.selectedEmbeddedSubtitleTrackIndex = Number.isFinite(selectedEmbeddedSubtitleTrack) ? selectedEmbeddedSubtitleTrack : -1;
        this.selectedEmbeddedAudioTrackIndex = Number.isFinite(selectedEmbeddedAudioTrack) ? selectedEmbeddedAudioTrack : -1;
        this.refreshTrackDialogs();
      })()
        .catch((error) => {
          console.warn("Embedded subtitle discovery failed", error);
          if (requestToken !== this.embeddedSubtitleLoadToken) {
            return;
          }
          if (!preserveExistingTracks) {
            this.embeddedSubtitleTracks = [];
            this.embeddedAudioTracks = [];
            this.selectedEmbeddedSubtitleTrackIndex = -1;
            this.selectedEmbeddedAudioTrackIndex = -1;
          }
          this.refreshTrackDialogs();
        })
        .finally(() => {
          if (requestToken === this.embeddedSubtitleLoadToken) {
            this.embeddedSubtitleLoading = false;
            this.embeddedAudioLoading = false;
            this.refreshTrackDialogs();
          }
          if (this.embeddedTrackRequestPromise === requestPromise) {
            this.embeddedTrackRequestPromise = null;
            this.embeddedTrackRequestUrl = "";
          }
        });

      this.embeddedTrackRequestPromise = requestPromise;
      this.embeddedTrackRequestUrl = probeUrl;
      return requestPromise;
    },
    disableEmbeddedSubtitleSelection() {
      this.clearEmbeddedSubtitleCueRefreshTimers();
      this.clearWebOsEmbeddedTextSubtitleOverlay({ dispose: true });
      const hadBitmapSelection = Boolean(this.bitmapSubtitleTrack);
      this.clearBitmapSubtitleOverlay({ dispose: true });
      if (hadBitmapSelection) {
        if (Environment.isTizen()) {
          PlayerController.setAvPlaySubtitleTrack?.(-1);
          this.selectedSubtitleTrackIndex = -1;
        } else {
          PlayerController.setWebOsEmbeddedSubtitleTrack?.(-1);
        }
      } else if (this.selectedEmbeddedSubtitleTrackIndex >= 0) {
        if (Environment.isTizen() && typeof PlayerController.setAvPlaySubtitleTrack === "function") {
          PlayerController.setAvPlaySubtitleTrack(-1);
        } else if (typeof PlayerController.setWebOsEmbeddedSubtitleTrack === "function") {
          PlayerController.setWebOsEmbeddedSubtitleTrack(-1);
        }
      }
      this.selectedEmbeddedSubtitleTrackIndex = -1;
    },
    getTextTracks() {
      const trackList = this.getVideoTextTrackList();
      if (!trackList) {
        return [];
      }
      try {
        return trackListToArray(trackList);
      } catch (_) {
        return [];
      }
    },
    getAudioTracks() {
      const trackList = this.getVideoAudioTrackList();
      if (!trackList) {
        return [];
      }
      try {
        return trackListToArray(trackList);
      } catch (_) {
        return [];
      }
    },
    getEmbeddedAudioTrack(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return null;
      }
      return this.embeddedAudioTracks[targetIndex] || null;
    },
    ensureEmbeddedTrackLookupCache() {
      const cache = this.trackDialogCache || (this.trackDialogCache = createTrackDialogCache());
      if (
        cache.embeddedAudioByNativeIndex &&
        cache.embeddedAudioByEmbeddedIndex &&
        cache.embeddedSubtitleByNativeIndex &&
        cache.embeddedSubtitleByEmbeddedIndex
      ) {
        return cache;
      }

      const embeddedAudioByNativeIndex = new Map();
      const embeddedAudioByEmbeddedIndex = new Map();
      const embeddedSubtitleByNativeIndex = new Map();
      const embeddedSubtitleByEmbeddedIndex = new Map();

      (this.embeddedAudioTracks || []).forEach((track, index) => {
        const nativeTrackIndex = Number(track?.nativeTrackIndex);
        const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
        if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
          embeddedAudioByNativeIndex.set(nativeTrackIndex, track);
        }
        if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
          embeddedAudioByEmbeddedIndex.set(embeddedTrackIndex, track);
        } else {
          embeddedAudioByEmbeddedIndex.set(index, track);
        }
      });

      (this.embeddedSubtitleTracks || []).forEach((track, index) => {
        const nativeTrackIndex = Number(track?.nativeTrackIndex);
        const embeddedTrackIndex = Number(track?.embeddedTrackIndex);
        if (Number.isFinite(nativeTrackIndex) && nativeTrackIndex >= 0) {
          embeddedSubtitleByNativeIndex.set(nativeTrackIndex, track);
        }
        if (Number.isFinite(embeddedTrackIndex) && embeddedTrackIndex >= 0) {
          embeddedSubtitleByEmbeddedIndex.set(embeddedTrackIndex, track);
        } else {
          embeddedSubtitleByEmbeddedIndex.set(index, track);
        }
      });

      cache.embeddedAudioByNativeIndex = embeddedAudioByNativeIndex;
      cache.embeddedAudioByEmbeddedIndex = embeddedAudioByEmbeddedIndex;
      cache.embeddedSubtitleByNativeIndex = embeddedSubtitleByNativeIndex;
      cache.embeddedSubtitleByEmbeddedIndex = embeddedSubtitleByEmbeddedIndex;
      return cache;
    },
    getEmbeddedAudioTrackForAvPlayTrack(track, fallbackIndex = -1) {
      if (!Environment.isTizen()) {
        return null;
      }
      const avplayTracks = typeof PlayerController.getAvPlayAudioTracks === "function" ? PlayerController.getAvPlayAudioTracks() : [];
      if (!avplayTracks.length) {
        return null;
      }

      const avplayTrackIndex = Number(track?.avplayTrackIndex);
      let avplayOrdinal = avplayTracks.findIndex((entry) => Number(entry?.avplayTrackIndex) === avplayTrackIndex);
      if (avplayOrdinal < 0 && Number.isFinite(Number(fallbackIndex))) {
        avplayOrdinal = Number(fallbackIndex);
      }
      if (avplayOrdinal < 0 || avplayOrdinal >= avplayTracks.length) {
        return null;
      }

      // Tizen /tracks returns every container audio stream, while AVPlay only
      // exposes the subset supported by the device. Match by canonical codec
      // and occurrence; an ordinal across the full container list is unsafe.
      const getCanonicalCodec = (entry) => formatAudioCodecName(getAuthoritativeAudioCodecValue(entry));
      const avplayCodec = getCanonicalCodec(track) || getCanonicalCodec(avplayTracks[avplayOrdinal]);
      if (!avplayCodec) {
        return null;
      }

      const avplayCodecTracks = avplayTracks.filter((entry) => getCanonicalCodec(entry) === avplayCodec);
      const embeddedCodecTracks = (this.embeddedAudioTracks || []).filter((entry) => getCanonicalCodec(entry) === avplayCodec);
      if (embeddedCodecTracks.length !== avplayCodecTracks.length) {
        return null;
      }

      const avplayCodecOrdinal = avplayTracks.slice(0, avplayOrdinal).filter((entry) => getCanonicalCodec(entry) === avplayCodec).length;
      const matched = embeddedCodecTracks[avplayCodecOrdinal];
      // Browser MKV metadata must agree on both codec occurrence and full-container stream index.
      if (matched?.raw?.containerStreamIndex !== undefined && matched.raw.containerStreamIndex !== avplayTrackIndex) {
        return null;
      }
      return matched || null;
    },
    getEmbeddedAudioTrackByNativeIndex(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return null;
      }
      const directTrack = this.ensureEmbeddedTrackLookupCache().embeddedAudioByNativeIndex.get(targetIndex) || null;
      if (!Environment.isTizen()) {
        return directTrack;
      }

      const avplayTracks = typeof PlayerController.getAvPlayAudioTracks === "function" ? PlayerController.getAvPlayAudioTracks() : [];
      if (!avplayTracks.length) {
        return directTrack;
      }
      const avplayTrack = avplayTracks.find((track) => Number(track?.avplayTrackIndex) === targetIndex);
      return avplayTrack ? this.getEmbeddedAudioTrackForAvPlayTrack(avplayTrack) : null;
    },
    getEmbeddedAudioTrackByEmbeddedIndex(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return null;
      }
      return this.ensureEmbeddedTrackLookupCache().embeddedAudioByEmbeddedIndex.get(targetIndex) || null;
    },
    getEmbeddedSubtitleTrackByNativeIndex(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return null;
      }
      const directTrack = this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByNativeIndex.get(targetIndex) || null;
      const rawTizenAvPlayIndex = directTrack?.raw?.index;
      const hasExplicitTizenAvPlayIndex =
        rawTizenAvPlayIndex !== undefined && rawTizenAvPlayIndex !== null && Number.isFinite(Number(rawTizenAvPlayIndex));
      if (directTrack && (!Environment.isTizen() || hasExplicitTizenAvPlayIndex)) {
        return directTrack;
      }
      if (!Environment.isTizen()) {
        return null;
      }

      // Tizen's /tracks metadata currently has no AVPlay stream index. Both
      // lists preserve the source text-stream order, so resolve the AVPlay raw
      // index to the corresponding local text ordinal only when direct mapping
      // is unavailable.
      const avplayTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function" ? PlayerController.getAvPlaySubtitleTracks() : [];
      const avplayOrdinal = avplayTracks.findIndex((track) => Number(track?.avplayTrackIndex) === targetIndex);
      return avplayOrdinal >= 0 ? this.embeddedSubtitleTracks[avplayOrdinal] || null : null;
    },
    getEmbeddedSubtitleTrackByEmbeddedIndex(index) {
      const targetIndex = Number(index);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return null;
      }
      return this.ensureEmbeddedTrackLookupCache().embeddedSubtitleByEmbeddedIndex.get(targetIndex) || null;
    }
  };
}
