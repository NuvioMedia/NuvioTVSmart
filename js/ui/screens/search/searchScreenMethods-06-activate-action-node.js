/* eslint-disable no-unused-vars */
import * as internals from "./searchScreen.js";

export function createSearchScreenMethods06() {
  const {
    Router,
    ScreenUtils,
    Platform,
    resetDpadRepeat,
    activateLegacySidebarAction,
    getRootSidebarNodes,
    isSelectedSidebarAction,
    isRootSidebarNode,
    setModernSidebarPillIconOnly,
    clamp
  } = internals;

  return {
    activateActionNode(node) {
      if (!node) return;
      if (Date.now() < Number(this.activationGuardUntil || 0)) return;
      const action = String(node.dataset.action || "");
      if (!action) return;

      if (action === "openDetail") this.openDetailFromNode(node);
      if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(node);
      if (action === "openDiscover" && this.layoutPrefs?.discoverLocation === "in_search") Router.navigate("discover");
      if (action === "openVoice") this.handleVoiceSearch();
      if (action === "runRecentSearch") void this.runRecentSearchFromNode(node);
      if (action === "clearSearchHistory") this.clearSearchHistory();
      if (action === "removeRecentSearch") this.removeRecentSearchFromNode(node);
    },
    ensureVoiceRecognition() {
      if (this.voiceRecognition || !this.voiceSearchSupported) {
        return this.voiceRecognition;
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (typeof SpeechRecognition !== "function") {
        return null;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.lang = navigator.language || "en-US";

      recognition.onresult = async (event) => {
        const recognized = String(event.results?.[0]?.[0]?.transcript || "").trim();
        this.voiceSearchActive = false;
        this.syncVoiceButtonState();
        if (!recognized) {
          this.showSearchToast("No speech detected. Try again.");
          return;
        }
        this.query = recognized;
        this.mode = this.query.length >= 2 ? "search" : "idle";
        this.pendingAutoFocusResults = this.mode === "search";
        this.loadToken = (this.loadToken || 0) + 1;
        this.renderLoading();
        await this.reloadRows();
        this.rememberCurrentSearchIfValid();
      };

      recognition.onerror = (event) => {
        this.voiceSearchActive = false;
        this.syncVoiceButtonState();
        const errorCode = String(event?.error || "");
        if (errorCode === "aborted") return;
        if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
          this.showSearchToast("Microphone permission is required for voice search.");
          return;
        }
        if (errorCode === "no-speech") {
          this.showSearchToast("No speech detected. Try again.");
          return;
        }
        this.showSearchToast("Voice recognition failed. Try again.");
      };

      recognition.onend = () => {
        this.voiceSearchActive = false;
        this.syncVoiceButtonState();
      };

      this.voiceRecognition = recognition;
      return recognition;
    },
    handleVoiceSearch() {
      const recognition = this.ensureVoiceRecognition();
      if (!recognition) {
        this.showSearchToast("Voice search is unavailable on this device.");
        return;
      }

      try {
        if (this.voiceSearchActive) {
          recognition.stop();
          return;
        }
        this.voiceSearchActive = true;
        this.syncVoiceButtonState();
        recognition.start();
      } catch (_) {
        this.voiceSearchActive = false;
        this.syncVoiceButtonState();
        this.showSearchToast("Voice search is unavailable on this device.");
      }
    },
    syncVoiceButtonState() {
      const button = this.container?.querySelector(".search-voice-btn");
      if (!button) return;
      button.classList.toggle("listening", Boolean(this.voiceSearchActive));
    },
    showSearchToast(message) {
      if (!this.container) return;
      const shell = this.container.querySelector(".search-screen-shell");
      if (!shell) return;
      let toast = shell.querySelector(".search-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "search-toast";
        shell.appendChild(toast);
      }
      toast.textContent = String(message || "").trim();
      toast.classList.add("visible");

      if (this.searchToastTimer) {
        clearTimeout(this.searchToastTimer);
      }
      this.searchToastTimer = setTimeout(() => {
        toast?.classList.remove("visible");
      }, 2600);
    },
    openDetailFromNode(node) {
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || node.dataset.catalogType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled",
        fallbackPoster: node.dataset.posterSrc || "",
        fallbackBackground: node.dataset.backdropSrc || "",
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogType: node.dataset.catalogType || node.dataset.itemType || "movie",
        returnToSearchOnBack: true
      });
    },
    openCatalogSeeAllFromNode(node) {
      const rowIndex = Math.max(0, Number(node?.dataset?.rowIndex || 0));
      const sourceRow = this.rows?.[rowIndex] || null;
      Router.navigate("catalogSeeAll", {
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogId: node.dataset.catalogId || "",
        catalogName: node.dataset.catalogName || "",
        type: node.dataset.catalogType || "movie",
        initialItems: Array.isArray(sourceRow?.initialItems)
          ? sourceRow.initialItems
          : Array.isArray(sourceRow?.items)
            ? sourceRow.items
            : [],
        initialNextSkip: Number(sourceRow?.nextSkip || 0),
        initialHasMore: Boolean(sourceRow?.hasMore),
        supportsSkip: sourceRow?.supportsSkip !== false,
        skipStep: Number(sourceRow?.skipStep || 100),
        extraArgs: sourceRow?.extraArgs && typeof sourceRow.extraArgs === "object" ? { ...sourceRow.extraArgs } : {}
      });
    },
    async onKeyDown(event) {
      const code = Number(event?.keyCode || 0);
      if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
        event.preventDefault?.();
        return;
      }
      const currentFocusedNode = this.container?.querySelector(".focusable.focused") || null;
      const isPosterHoldTarget = this.isPosterHoldTarget(currentFocusedNode);
      if (!isPosterHoldTarget || code !== 13) {
        this.cancelPendingPosterHold();
      }

      if (Platform.isBackEvent(event)) {
        event.preventDefault?.();
        if (this.focusZone === "sidebar") {
          Platform.exitApp();
        } else {
          await this.openSidebar();
        }
        return;
      }

      const nativeCode = Number(event?.originalKeyCode || code);
      if (Platform.isTizen() && (nativeCode === 65376 || nativeCode === 65385)) {
        const input = this.container?.querySelector("#searchInput");
        if (input && this.isSearchInputEditingActive(event)) {
          // Samsung's IME reports its Done/Cancel keys instead of the remote
          // Enter/Back. End the editing session before returning to the D-pad
          // graph, as Android does on IME Done, so the keyboard cannot keep
          // swallowing the next Back press.
          this.imeDismissed = true;
          if (nativeCode === 65376) {
            this.cancelScheduledInputSearch();
            await this.runSearchFromInput(input, { autoFocusResults: true, rememberToHistory: true });
          } else {
            input.blur?.();
          }
          return;
        }
      }

      if (this.keepSearchInputEditingKey(event, code)) {
        return;
      }
      if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
        if (code === 40) {
          this.pillIconOnly = true;
          setModernSidebarPillIconOnly(this.container, true);
        } else if (code === 38) {
          this.pillIconOnly = false;
          setModernSidebarPillIconOnly(this.container, false);
        }
      }

      if (this.focusZone === "sidebar") {
        const current = this.container?.querySelector(".focusable.focused") || null;
        const nodes = getRootSidebarNodes(this.container, this.layoutPrefs);
        if (code === 38 || code === 40 || code === 39) {
          event.preventDefault?.();
        }
        if (code === 38 || code === 40) {
          const focusedIndex = Math.max(0, nodes.indexOf(current));
          const nextIndex = clamp(focusedIndex + (code === 38 ? -1 : 1), 0, Math.max(0, nodes.length - 1));
          const nextNode = nodes[nextIndex] || current;
          if (nextNode) {
            this.sidebarFocusIndex = nextIndex;
            this.focusNode(current, nextNode);
          }
          return;
        }
        if (code === 39) {
          await this.closeSidebarToContent();
          return;
        }
        if (code === 13 && current && isRootSidebarNode(current)) {
          event.preventDefault?.();
          activateLegacySidebarAction(String(current.dataset.action || ""), "search");
          if (isSelectedSidebarAction(String(current.dataset.action || ""), "search")) {
            await this.closeSidebarToContent();
          }
          return;
        }
      }

      if (code === 13 && isPosterHoldTarget) {
        event.preventDefault?.();
        if (!event?.repeat && !this.hasPendingPosterHold(currentFocusedNode)) {
          this.startPendingPosterHold(currentFocusedNode);
        }
        return;
      }

      const dpadResult = this.handleSearchDpad(event);
      if (dpadResult === "sidebar") {
        await this.openSidebar();
        return;
      }
      if (dpadResult) {
        return;
      }

      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }

      if (code !== 13) return;
      const current = this.container.querySelector(".focusable.focused");
      if (!current) return;

      const action = String(current.dataset.action || "");
      if (
        action === "openDiscover" ||
        action === "openVoice" ||
        action === "openDetail" ||
        action === "openCatalogSeeAll" ||
        action === "runRecentSearch" ||
        action === "clearSearchHistory" ||
        action === "removeRecentSearch"
      ) {
        this.activateActionNode(current);
      }
      if (action === "searchInput") {
        const input = this.container?.querySelector("#searchInput");
        if (input) {
          input.focus();
        }
      }
    },
    onKeyUp(event) {
      if ([37, 38, 39, 40].includes(Number(event?.keyCode || 0))) {
        resetDpadRepeat(this);
      }
      if (this.suppressHoldMenuEnterUntilKeyUp) {
        this.suppressHoldMenuEnterUntilKeyUp = false;
        if (Number(event?.keyCode || 0) === 13) {
          event?.preventDefault?.();
          return;
        }
      }
      if (Number(event?.keyCode || 0) !== 13) {
        return;
      }
      const current = this.container?.querySelector(".search-result-card.focusable.focused") || null;
      if (this.completePendingPosterHold(current, event)) {
        event?.preventDefault?.();
      }
    },
    consumeBackRequest() {
      return this.closePosterOptionsMenu();
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      this.cancelActiveSearchRequests();
      resetDpadRepeat(this);
      this.cancelScheduledRender();
      this.cancelPendingPosterHold();
      this.posterOptionsMenu = null;
      this.posterOptionsController?.destroy?.({ restoreFocus: false });
      this.posterOptionsController = null;
      this.pendingPosterOptionsFocusId = "";
      this.suppressHoldMenuEnterUntilKeyUp = false;
      if (this.searchToastTimer) {
        clearTimeout(this.searchToastTimer);
        this.searchToastTimer = null;
      }
      this.cancelScheduledInputSearch();
      if (this.voiceRecognition) {
        try {
          this.voiceRecognition.onresult = null;
          this.voiceRecognition.onerror = null;
          this.voiceRecognition.onend = null;
          this.voiceRecognition.stop();
        } catch (_) {
          // Ignore stop failures from inactive recognizers.
        }
        this.voiceRecognition = null;
      }
      this.voiceSearchActive = false;
      ScreenUtils.hide(this.container);
    }
  };
}
