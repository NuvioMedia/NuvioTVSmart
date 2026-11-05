/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";

export function createPlayerScreenMethods14() {
  const { PlayerController, Environment, uniqueNonEmptyValues } = internals;

  return {
    async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
      const currentCandidate = this.getCurrentStreamCandidate();
      const masterUrl = playbackUrl || currentCandidate?.url || "";
      const runtimeUrl = String(PlayerController.video?.currentSrc || "").trim();
      const loadToken = (this.manifestLoadToken || 0) + 1;
      this.manifestLoadAbortController?.abort?.();
      const manifestLoadAbortController = typeof AbortController === "function" ? new AbortController() : null;
      this.manifestLoadAbortController = manifestLoadAbortController;
      const clearManifestLoadAbortController = () => {
        if (this.manifestLoadAbortController === manifestLoadAbortController) {
          this.manifestLoadAbortController = null;
        }
      };
      this.manifestLoadToken = loadToken;
      this.manifestLoading = true;

      this.manifestAudioTracks = [];
      this.manifestSubtitleTracks = [];
      this.manifestVariants = [];
      this.manifestMasterUrl = masterUrl;
      this.selectedManifestAudioTrackId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.refreshTrackDialogs();

      // hls.js/dash.js already fetched this manifest and expose the resulting
      // tracks. Fetching it again competes with the player on live providers
      // that allow a single connection, which is common for IPTV channels.
      if (PlayerController.hlsInstance || PlayerController.dashInstance) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
        return;
      }

      const probeUrl = masterUrl || runtimeUrl || playbackUrl || "";
      const runtimeMimeType = runtimeUrl && runtimeUrl === probeUrl ? PlayerController.currentPlaybackMediaSourceType : null;
      let probeMimeType =
        runtimeMimeType ||
        (typeof PlayerController.guessMediaMimeType === "function" ? PlayerController.guessMediaMimeType(probeUrl) : null);
      const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
      const shouldVerifyRemoteManifestType =
        !runtimeMimeType &&
        Environment.isWebOS() &&
        typeof PlayerController.isRemoteDirectHttpSource === "function" &&
        PlayerController.isRemoteDirectHttpSource(probeUrl) &&
        ((typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType)) ||
          (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType)));

      if (shouldVerifyRemoteManifestType) {
        const verifiedMimeType =
          typeof PlayerController.probeRemoteMediaSourceType === "function"
            ? await PlayerController.probeRemoteMediaSourceType(probeUrl, headers)
            : null;
        if (loadToken !== this.manifestLoadToken) {
          return;
        }
        if (!verifiedMimeType) {
          clearManifestLoadAbortController();
          this.manifestLoading = false;
          this.refreshTrackDialogs();
          return;
        }
        probeMimeType = verifiedMimeType;
      }

      const isAdaptiveManifest =
        (typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType)) ||
        (typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType));

      if (!isAdaptiveManifest) {
        if (loadToken === this.manifestLoadToken) {
          clearManifestLoadAbortController();
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
        return;
      }

      if (!masterUrl) {
        if (loadToken === this.manifestLoadToken) {
          clearManifestLoadAbortController();
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
        return;
      }

      try {
        const isFetchableManifestUrl = (value) => /^https?:\/\//i.test(String(value || "").trim());
        const fetchManifestText = async (url, requestHeaders = {}) => {
          const normalizedUrl = String(url || "").trim();
          if (!isFetchableManifestUrl(normalizedUrl)) {
            throw new Error("Manifest URL is not an HTTP(S) resource");
          }
          const response = await fetch(normalizedUrl, {
            method: "GET",
            headers: requestHeaders,
            ...(manifestLoadAbortController ? { signal: manifestLoadAbortController.signal } : {})
          });
          const text = await response.text();
          return {
            text,
            finalUrl: response.url || normalizedUrl
          };
        };

        const urlCandidates = uniqueNonEmptyValues([masterUrl, runtimeUrl, playbackUrl, this.activePlaybackUrl]).filter(
          isFetchableManifestUrl
        );
        let selectedParsed = null;
        let selectedMasterUrl = masterUrl;

        for (const candidateUrl of urlCandidates) {
          let fetchedManifest = null;
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, headers);
          } catch (_) {
            try {
              fetchedManifest = await fetchManifestText(candidateUrl, {});
            } catch (_) {
              fetchedManifest = null;
            }
          }

          if (loadToken !== this.manifestLoadToken) {
            return;
          }
          if (!fetchedManifest) {
            continue;
          }

          const parsed = this.parseManifestTracks(fetchedManifest.text, fetchedManifest.finalUrl || candidateUrl);
          const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
          if (hasTracks) {
            selectedParsed = parsed;
            selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
            break;
          }

          if (!selectedParsed && parsed.variants.length > 0) {
            selectedParsed = parsed;
            selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          }

          if (parsed.variants.length > 0) {
            const variant = parsed.variants[0];
            if (!variant?.uri) {
              continue;
            }
            try {
              const variantFetched = await fetchManifestText(variant.uri, headers);
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(variantFetched.text, variantFetched.finalUrl || variant.uri);
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetched.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              }
            } catch (_) {
              try {
                const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
                if (loadToken !== this.manifestLoadToken) {
                  return;
                }
                const nestedParsed = this.parseManifestTracks(
                  variantFetchedNoHeaders.text,
                  variantFetchedNoHeaders.finalUrl || variant.uri
                );
                if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                  selectedParsed = nestedParsed;
                  selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                  break;
                }
                if (!selectedParsed && nestedParsed.variants.length > 0) {
                  selectedParsed = nestedParsed;
                  selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                }
              } catch (_) {
                // Ignore nested manifest failures.
              }
            }
          }
        }

        if (!selectedParsed) {
          return;
        }

        this.manifestMasterUrl = selectedMasterUrl || masterUrl;
        this.manifestAudioTracks = selectedParsed.audioTracks;
        this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
        this.manifestVariants = selectedParsed.variants;
        this.selectedManifestAudioTrackId =
          selectedParsed.audioTracks.find((track) => track.isDefault)?.id || selectedParsed.audioTracks[0]?.id || null;
        this.selectedManifestSubtitleTrackId = selectedParsed.subtitleTracks.find((track) => track.isDefault)?.id || null;
        this.refreshTrackDialogs();
        this.promoteHlsManifestSubtitlePlayback(selectedMasterUrl || masterUrl);
      } catch (_error) {
        // Ignore parsing failures on providers that block manifest fetch.
      } finally {
        if (loadToken === this.manifestLoadToken) {
          clearManifestLoadAbortController();
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
      }
    },
    promoteHlsManifestSubtitlePlayback(manifestUrl = this.manifestMasterUrl) {
      if (Environment.isTizen()) {
        return false;
      }
      const targetUrl = String(manifestUrl || this.activePlaybackUrl || "").trim();
      if (!targetUrl || !this.manifestSubtitleTracks.length) {
        return false;
      }
      if (String(PlayerController.playbackEngine || "") === "hls.js") {
        return false;
      }
      if (typeof PlayerController.canUseHlsJs !== "function" || !PlayerController.canUseHlsJs()) {
        return false;
      }
      if (this.hlsManifestSubtitlePromotionUrls.has(targetUrl)) {
        return false;
      }
      this.hlsManifestSubtitlePromotionUrls.add(targetUrl);
      void this.playStreamByUrl(targetUrl, {
        preservePanel: true,
        preservePlaybackState: true,
        resetSilentAudioState: false,
        forceEngine: "hls.js"
      });
      return true;
    },
    pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
      if (!this.manifestVariants.length) {
        return null;
      }

      const byAudio = audioGroupId
        ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId)
        : this.manifestVariants.slice();
      const candidatePool = byAudio.length ? byAudio : this.manifestVariants;

      let scopedCandidates = candidatePool;
      if (subtitleGroupId) {
        const bySubtitle = candidatePool.filter((variant) => variant.subtitleGroupId === subtitleGroupId);
        if (bySubtitle.length) {
          scopedCandidates = bySubtitle;
        }
      } else if (subtitleGroupId === null) {
        const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
        if (withoutSubtitle.length) {
          scopedCandidates = withoutSubtitle;
        }
      }

      const capabilityProbe =
        typeof PlayerController.getPlaybackCapabilities === "function" ? PlayerController.getPlaybackCapabilities() : null;
      const supports = (key, fallback = true) => {
        if (!capabilityProbe) {
          return fallback;
        }
        return Boolean(capabilityProbe[key]);
      };

      const scoreVariant = (variant) => {
        if (!variant) {
          return Number.NEGATIVE_INFINITY;
        }
        let score = 0;
        const codecs = String(variant.codecs || "").toLowerCase();
        const resolution = String(variant.resolution || "").toLowerCase();
        const bandwidth = Number(variant.bandwidth || 0);

        const resolutionMatch = resolution.match(/^(\d+)\s*x\s*(\d+)$/i);
        const width = Number(resolutionMatch?.[1] || 0);
        const height = Number(resolutionMatch?.[2] || 0);
        if (width >= 3840 || height >= 2160) score += 60;
        else if (width >= 1920 || height >= 1080) score += 40;
        else if (width >= 1280 || height >= 720) score += 20;
        else if (width > 0 || height > 0) score += 8;

        if (Number.isFinite(bandwidth) && bandwidth > 0) {
          score += Math.min(30, Math.round((bandwidth / 1000000) * 3));
        }

        if (codecs.includes("dvh1") || codecs.includes("dvhe")) {
          score += supports("dolbyVision", true) ? 18 : -100;
        }
        if (codecs.includes("hvc1") || codecs.includes("hev1")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 14 : -90;
        }
        if (codecs.includes("av01")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (codecs.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -60;
        }
        if (codecs.includes("ec-3") || codecs.includes("eac3")) {
          score += supports("audioEac3", true) ? 10 : -50;
        }
        if (codecs.includes("ac-3") || codecs.includes("ac3")) {
          score += supports("audioAc3", true) ? 6 : -35;
        }

        return score;
      };

      return scopedCandidates.slice().sort((left, right) => scoreVariant(right) - scoreVariant(left))[0] || null;
    }
  };
}
