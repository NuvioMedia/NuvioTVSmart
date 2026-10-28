import { saveReusableStreamLink } from "../../../core/streams/streamLinkReuse.js";
/* eslint-disable no-unused-vars */
import * as internals from "./streamScreen.js";

export function createStreamScreenMethods08() {
  const {
    ScreenUtils,
    contentTextDirection,
    getCachedAddonLogoDisplayUrl,
    hasFailedAddonLogo,
    normalizeAddonLogoUrl,
    requestAddonLogo,
    resolveAddonLogo,
    Environment,
    WebOsLunaService,
    renderLoadingIndicator,
    t,
    isPerformanceConstrainedRuntime,
    escapeHtml,
    buildWebOsDlnaProtocolInfo,
    normalizeExternalLaunchFileName,
    getAddonBadgeLabel,
    getStreamHeadline,
    getStreamDescriptionLines,
    renderStreamBadges,
    hasStreamBadges,
    resolveStreamBadgePlacement
  } = internals;

  return {
    buildWebOsNativePlayerLaunchParameters(stream = {}) {
      const appId = String(this.webOsNativePlayerAppId || "").trim();
      const launchUrl = this.getWebOsNativeLaunchUrl(stream);
      if (!appId || !launchUrl) {
        return null;
      }
      const filename = normalizeExternalLaunchFileName(
        stream?.behaviorHints?.filename ||
          stream?.raw?.behaviorHints?.filename ||
          stream?.title ||
          stream?.name ||
          this.params?.itemTitle ||
          this.params?.playerTitle
      );
      const mimeType = this.resolveStreamMimeType(stream, launchUrl);
      return {
        id: appId,
        params: {
          payload: [
            {
              fullPath: launchUrl,
              artist: "",
              subtitle: "",
              dlnaInfo: {
                flagVal: 4096,
                cleartextSize: "-1",
                contentLength: "-1",
                opVal: 1,
                protocolInfo: buildWebOsDlnaProtocolInfo(mimeType),
                duration: 0
              },
              mediaType: "VIDEO",
              thumbnail: "",
              deviceType: "DMR",
              album: "",
              fileName: filename,
              lastPlayPosition: -1
            }
          ]
        }
      };
    },
    async openStreamInNativePlayer(streamId) {
      if (!Environment.isWebOS() || !this.webOsNativePlayerAppId || !WebOsLunaService.isAvailable()) {
        return;
      }
      if (this.nativePlayerPendingStreamId) {
        return;
      }
      const selected =
        this.getFilteredStreams().find((stream) => stream.id === streamId) || this.streams.find((stream) => stream.id === streamId) || null;
      if (!selected) {
        return;
      }

      const linkContext = { params: { ...this.params }, streamLinkCacheProfileId: this.streamLinkCacheProfileId };
      this.nativePlayerPendingStreamId = streamId;
      this.requestRender({ delayMs: 0 });
      try {
        const result = await this.resolveStreamForNativePlayer(selected);
        if (result?.status !== "success" || !result.stream) {
          this.showStreamToast(t("player_external_launch_unavailable", {}, "This stream cannot be opened in Native Player"));
          return;
        }

        this.replaceStreamInList(streamId, result.stream);
        const launchParameters = this.buildWebOsNativePlayerLaunchParameters(result.stream);
        if (!launchParameters) {
          this.requestRender({ delayMs: 0 });
          this.showStreamToast(t("player_external_launch_unavailable", {}, "This stream cannot be opened in Native Player"));
          return;
        }

        await WebOsLunaService.request("luna://com.webos.applicationManager", {
          method: "launch",
          parameters: launchParameters
        });
        saveReusableStreamLink(linkContext, result.stream, {
          url: this.getWebOsNativeLaunchUrl(result.stream),
          headers: this.getStreamRequestHeaders(result.stream)
        });
        this.showStreamToast(t("player_external_launching_media_player", {}, "Opening Native Player"));
      } catch (error) {
        console.warn("Failed to open stream in native player", { streamId, error });
        this.showStreamToast(t("player_external_launch_failed", {}, "Could not open Native Player"));
      } finally {
        this.nativePlayerPendingStreamId = "";
        this.requestRender({ delayMs: 0 });
      }
    },
    buildSourceChipMarkup() {
      return [
        `<button class="stream-route-chip focusable" data-action="refreshStreams" aria-label="${escapeHtml(t("cd_refresh", {}, "Refresh"))}"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg></button>`,
        this.renderChip("all", this.addonFilter === "all", "success"),
        ...this.getOrderedFilterNames().map((name) => {
          const chip = this.sourceChips.find((entry) => entry.name === name) || {
            name,
            status: "success"
          };
          return this.renderChip(name, this.addonFilter === name, chip.status);
        })
      ].join("");
    },
    refreshSourceChipsOnly() {
      const selectedFilter = String(this.addonFilter || "all");
      const availableFilters = this.getOrderedFilterNames();
      let filterReset = false;
      if (selectedFilter !== "all" && !availableFilters.includes(selectedFilter)) {
        // An error chip can disappear after the user selected it. Do not leave
        // the state pointing at a filter that no longer has a chip or rows.
        this.addonFilter = "all";
        this.listScrollTop = 0;
        const allStreams = this.getFilteredStreams("all");
        this.focusState = allStreams.length ? { zone: "card", row: 0, action: "play" } : { zone: "filter", index: 1 };
        this.streamVirtualFocusReset = true;
        this.streamVirtualPreferredIndex = allStreams.length ? 0 : null;
        filterReset = true;
      }
      const track = this.container?.querySelector?.(".stream-route-chip-track");
      if (!track) {
        return false;
      }
      const markup = this.buildSourceChipMarkup();
      const markupChanged = track.innerHTML !== markup;
      if (markupChanged) {
        track.innerHTML = markup;
        this.renderedMarkup = null;
        this._filteredStreamsCache = null;
        this.streamFocusDomCache = null;
        // New chip nodes need the same indexes assigned during a full render for
        // generic focus helpers; StreamScreen's own focus state is then reapplied.
        ScreenUtils.indexFocusables(this.container, ".focusable:not([hidden])");
        if (this.focusState?.zone === "filter") {
          this.applyFocus();
        }
      }
      if (filterReset || !this.renderedStreamListStable || this.renderedStreamListStreams !== this.streams) {
        this.renderedMarkup = null;
        return false;
      }
      const allStreams = this.getFilteredStreams("all");
      const filtered = this.getFilteredStreams();
      if (!this.applyAddonFilterDomState(filtered, allStreams)) {
        this.renderedMarkup = null;
        return false;
      }
      this.renderedStreamListSourceChips = this.sourceChips;
      return true;
    },
    renderChip(name, selected, status) {
      const chipStatus = String(status || "success");
      const classes = ["stream-route-chip", "focusable", selected ? "selected" : "", chipStatus !== "success" ? chipStatus : ""]
        .filter(Boolean)
        .join(" ");
      const spinner = chipStatus === "loading" ? renderLoadingIndicator({ className: "stream-route-chip-spinner" }) : "";
      return `
          <button class="${classes}" data-action="setFilter" data-addon="${escapeHtml(name)}" aria-selected="${selected ? "true" : "false"}">
            ${spinner}
            <span dir="${contentTextDirection(name === "all" ? t("common.all", {}, "All") : name)}">${escapeHtml(name === "all" ? t("common.all", {}, "All") : name)}</span>
          </button>
        `;
    },
    renderStreamCard(
      stream,
      index,
      streamBadgesEnabled = true,
      badgeSettings = null,
      { streamKey = index, virtualized = false, virtualRowGap = null, virtualLast = false } = {}
    ) {
      const headline = getStreamHeadline(stream);
      const pluginSourceName = String(stream.pluginSourceName || "").trim();
      const partyShared = Boolean(stream.partyShared);
      const partySource = !partyShared && Boolean(this.isPartySourceStream?.(stream));
      const lazyBadges = isPerformanceConstrainedRuntime() && hasStreamBadges(stream, streamBadgesEnabled, badgeSettings);
      const badges = lazyBadges
        ? `<div class="stream-route-card-badges stream-route-card-badges-lazy" data-lazy-stream-badges data-stream-badge-row="${index}" data-badges-hydrated="false" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}"></div>`
        : renderStreamBadges(stream, streamBadgesEnabled, badgeSettings);
      const showAddonLogo = badgeSettings?.showAddonLogo === true;
      const badgePlacement = resolveStreamBadgePlacement(badgeSettings);
      const topBadges = badgePlacement === "TOP" ? badges : "";
      const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
      // Filename punctuation needs wrap opportunities to avoid an icon-only first line.
      const descriptionLines = getStreamDescriptionLines(stream);
      let addonIdentity = "";
      if (showAddonLogo) {
        const addonLogoUrl = normalizeAddonLogoUrl(stream.addonLogo) || resolveAddonLogo(stream.addonName, this.addonLogoLookup);
        const cachedAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
        let displayAddonLogoUrl = cachedAddonLogoUrl || "";
        if (addonLogoUrl && !displayAddonLogoUrl && !hasFailedAddonLogo(addonLogoUrl)) {
          requestAddonLogo(addonLogoUrl, () => this.requestRender({ delayMs: 160 }));
          if (Environment.isWebOS()) {
            displayAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
          }
        }
        const addonBadgeLabel = escapeHtml(getAddonBadgeLabel(stream.addonName || ""));
        // Tizen fast path: the old branch forced eager+sync decode on
        // constrained runtimes (a decode storm mid-transition). Lazy+async
        // everywhere: near-viewport logos still resolve immediately.
        const addonLogoLoading = "lazy";
        const addonLogoDecoding = "async";
        const addonBadge = displayAddonLogoUrl
          ? `<img src="${escapeHtml(displayAddonLogoUrl)}" alt="${escapeHtml(stream.addonName || "Addon")}" data-addon-logo="${escapeHtml(addonLogoUrl)}" decoding="${addonLogoDecoding}" loading="${addonLogoLoading}" referrerpolicy="no-referrer" /><span hidden>${addonBadgeLabel}</span>`
          : `<span>${addonBadgeLabel}</span>`;
        addonIdentity = `
              <div class="stream-route-card-side">
                <div class="stream-route-addon-badge">${addonBadge}</div>
                <div class="stream-route-addon-name" dir="${contentTextDirection(stream.addonName || "Addon")}">${escapeHtml(stream.addonName || "Addon")}</div>
              </div>`;
      }

      const virtualRowStyle =
        virtualized && Number.isFinite(Number(virtualRowGap))
          ? ` style="margin-bottom:${virtualLast ? 0 : Math.max(0, Number(virtualRowGap))}px"`
          : "";
      return `
          <div class="stream-route-card-row${partyShared ? " is-party-shared" : ""}" data-stream-key="${escapeHtml(String(streamKey))}" data-stream-row="${index}"${virtualRowStyle}>
            ${partyShared ? `<div class="stream-route-party-label">${escapeHtml(t("party_shared_by", [stream.partyHostName || ""], "Shared by %1$s"))}</div>` : ""}
            <article class="stream-route-card stream-route-card-action focusable${partyShared ? " is-party-marked" : ""}${this.isCardActionFocused(index, "play") ? " focused" : ""}"
                     data-action="playStream"
                     data-card-action="play"
                     data-stream-id="${escapeHtml(stream.id)}"
                     data-stream-row="${index}">
              <div class="stream-route-card-copy">
                ${topBadges || ""}
                <div class="stream-route-card-heading" dir="${contentTextDirection(headline)}">${escapeHtml(headline)}</div>
                ${partySource ? `<div class="stream-route-party-source" dir="auto">${escapeHtml(t("party_source", {}, "Party's source"))}</div>` : ""}
                ${pluginSourceName && pluginSourceName !== stream.addonName ? `<div class="stream-route-plugin-source" dir="${contentTextDirection(pluginSourceName)}">${escapeHtml(pluginSourceName)}</div>` : ""}
                ${descriptionLines.map((line, lineIndex) => `<div class="stream-route-card-line${lineIndex > 0 ? " secondary" : ""}" dir="${contentTextDirection(line)}">${escapeHtml(line).replace(/([._-])(?=\S)/g, "$1<wbr>")}</div>`).join("")}
                ${bottomBadges || ""}
              </div>
              ${addonIdentity}
            </article>
          </div>
        `;
    },
    renderLoadingCards(count = 3) {
      return `
          <div class="stream-route-card-row">
            <div class="stream-route-card skeleton">
              <div class="stream-route-card-copy">
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
              </div>
            </div>
          </div>
        `.repeat(count);
    },
    renderStableStreamLoadingRow() {
      return `
          <div class="stream-route-card-row" data-stream-loading-row hidden style="display:none">
            <div class="stream-route-card skeleton">
              <div class="stream-route-card-copy">
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
                <div class="stream-route-skeleton-line"></div>
              </div>
            </div>
          </div>
        `;
    },
    renderStableStreamEmptyState() {
      return `<div class="stream-route-empty" data-stream-empty hidden style="display:none"><p>${escapeHtml(t("sources_no_streams", {}, "No streams found"))}</p><p>${escapeHtml(t("stream_no_streams_hint"))}</p></div>`;
    }
  };
}
