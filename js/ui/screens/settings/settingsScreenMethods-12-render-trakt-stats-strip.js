/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods12() {
  const {
    Router,
    ScreenUtils,
    renderMemberBrandWordmark,
    bindRootSidebarEvents,
    renderRootSidebar,
    getLatestAppUpdate,
    showAppUpdatePrompt,
    CURRENT_APP_VERSION,
    SETTINGS_VERSION_LABEL,
    PRIVACY_URL,
    SECTION_META,
    clamp,
    t,
    escapeHtml,
    syncLayoutPreviewMetricsSoon,
    labelForTraktContinueWatchingDays,
    labelForTraktWatchProgressSource,
    labelForTraktLibrarySource,
    labelForTraktComments,
    updateSettingsScrollIndicatorsSoon,
    bindSettingsScrollIndicators,
    getVisibleSections,
    getSettingsSectionById,
    updateSettingsRailIndicators,
    updateSettingsRailIndicatorsSoon,
    captureSettingsScrollState,
    restoreSettingsScrollState
  } = internals;

  return {
    renderTraktStatsStrip(stats, isLoading) {
      const values = isLoading
        ? ["...", "...", "...", "..."]
        : [
            stats?.moviesWatched ?? "-",
            stats?.showsWatched ?? "-",
            stats?.episodesWatched ?? "-",
            stats?.totalWatchedHours == null ? "-" : `${stats.totalWatchedHours}h`
          ];
      const labels = [
        t("trakt_stat_movies", {}, "Movies"),
        t("trakt_stat_shows", {}, "Shows"),
        t("trakt_stat_episodes", {}, "Episodes"),
        t("trakt_stat_watched_hours", {}, "Watched Hours")
      ];
      return `
          <div class="settings-trakt-stats">
            <div class="settings-trakt-stats-label">${escapeHtml(t("trakt_cached_label", {}, "Cached"))}</div>
            <div class="settings-trakt-stats-line" aria-hidden="true"></div>
            <div class="settings-trakt-stats-row">
              ${values
                .map(
                  (value, index) => `
                <div class="settings-trakt-stat">
                  <strong>${escapeHtml(value)}</strong>
                  <span>${escapeHtml(labels[index])}</span>
                </div>
              `
                )
                .join("")}
            </div>
            <div class="settings-trakt-stats-line" aria-hidden="true"></div>
          </div>
        `;
    },
    renderTraktOptions(settings) {
      return `
          <div class="settings-stack settings-trakt-options-stack">
            ${this.renderActionRow({
              focusKey: "trakt:librarySource",
              title: t("trakt_library_source_title", {}, "Library Source"),
              subtitle: t("trakt_library_source_subtitle", {}, "Choose which library to use for saving and viewing your collection"),
              value: labelForTraktLibrarySource(settings.librarySourceMode)
            })}
            ${this.renderActionRow({
              focusKey: "trakt:watchProgress",
              title: t("trakt_watch_progress_title", {}, "Watch Progress"),
              subtitle: t("trakt_watch_progress_subtitle", {}, "Choose which progress source powers resume and continue watching"),
              value: labelForTraktWatchProgressSource(settings.watchProgressSource)
            })}
            ${this.renderActionRow({
              focusKey: "trakt:cwWindow",
              title: t("trakt_continue_watching_window", {}, "Continue Watching Window"),
              subtitle: t("trakt_continue_watching_subtitle", {}, "Trakt history considered for continue watching"),
              value: labelForTraktContinueWatchingDays(settings.continueWatchingDaysCap)
            })}
            ${this.renderActionRow({
              focusKey: "trakt:comments",
              title: t("trakt_comments_title", {}, "Comments"),
              subtitle: t("trakt_comments_subtitle", {}, "Show Trakt reviews on metadata pages"),
              value: labelForTraktComments(settings.showMetaComments)
            })}
          </div>
        `;
    },
    renderTraktLauncher() {
      this.actionMap.set("trakt:open", () => Router.navigate("trakt"));
      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "trakt"))}
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "trakt:open",
                title: t("settings.tracking.openSettings", {}, "Tracking"),
                subtitle: t("settings.tracking.openSettingsSubtitle", {}, "Connect Trakt or Simkl and choose library and progress sources.")
              })}
            </div>
          </div>
        `;
    },
    renderAboutSection(model = this.model) {
      this.actionMap.set("about:privacy", () => {
        window.open?.(PRIVACY_URL, "_blank");
      });
      this.actionMap.set("about:supporters", () => Router.navigate("supportersContributors"));
      this.actionMap.set("about:licenses", () => Router.navigate("licensesAttributions"));
      this.actionMap.set("about:checkUpdates", async () => {
        this.aboutUpdateStatus = t("update_checking", {}, "Checking for updates…");
        await this.render({ refreshModel: false });
        try {
          const update = await getLatestAppUpdate({ currentVersion: CURRENT_APP_VERSION });
          this.aboutUpdateStatus = update ? String(update.tag || "") : t("update_latest_version", {}, "You’re using the latest version.");
          if (update) showAppUpdatePrompt(update);
        } catch (_) {
          this.aboutUpdateStatus = t("update_error_check_failed", {}, "Update check failed");
        }
        await this.render({ refreshModel: false });
      });
      this.actionMap.set("about:debugConsole", () => Router.navigate("debugConsole"));

      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "about"))}
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-about-brand">
              ${renderMemberBrandWordmark({
                access: model?.memberAccess,
                imageClass: "settings-about-logo",
                wrapperClass: "settings-about-wordmark"
              })}
              <p class="settings-about-copy">${t("settings.about.madeWithLove")}</p>
              <p class="settings-about-copy">${t("settings.about.version", { version: SETTINGS_VERSION_LABEL })}</p>
              <p class="settings-about-copy">${t("settings.about.portedBy")}</p>
            </div>
            <div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "about:checkUpdates",
                title: t("about_check_updates", {}, "Check for updates"),
                subtitle:
                  this.aboutUpdateStatus || t("about_check_updates_subtitle", {}, "Check the latest release for manual installation")
              })}
              ${this.renderActionRow({
                focusKey: "about:privacy",
                title: t("settings.about.privacyPolicy.title"),
                subtitle: t("settings.about.privacyPolicy.subtitle"),
                external: true
              })}
              ${this.renderActionRow({
                focusKey: "about:supporters",
                title: t("settings.about.supporters.title"),
                subtitle: t("settings.about.supporters.subtitle")
              })}
              ${this.renderActionRow({
                focusKey: "about:licenses",
                title: t("about_licenses_attributions", {}, "Licenses & Attribution"),
                subtitle: t("licenses_attributions_section_data", {}, "Data & services")
              })}
              ${this.renderActionRow({
                focusKey: "about:debugConsole",
                title: t("about_debug_console_title", {}, "Console debug"),
                subtitle: t("about_debug_console_subtitle", {}, "Show latest error/warning events"),
                leadingIcon: "terminal"
              })}
            </div>
          </div>
        `;
    },
    renderSection(section, model) {
      if (section.id === "account") return this.renderAccountSection(model);
      if (section.id === "profiles") return this.renderProfilesSection(model);
      if (section.id === "appearance") return this.renderAppearanceSection(model);
      if (section.id === "layout") return this.renderLayoutSection(model);
      if (section.id === "contentDiscovery") return this.renderContentDiscoverySection();
      if (section.id === "plugins") return this.renderPluginsSection(model);
      if (section.id === "integration") return this.renderIntegrationSection(model);
      if (section.id === "streams") return this.renderStreamsSection(model);
      if (section.id === "playback") return this.renderPlaybackSection(model);
      if (section.id === "trakt") return this.renderTraktLauncher(model);
      if (section.id === "advanced") return this.renderAdvancedSection(model);
      return this.renderAboutSection(model);
    },
    async render({ refreshModel = true } = {}) {
      if (refreshModel || !this.model) {
        this.model = await this.collectModel();
      }
      this.layoutPrefs = this.model.layout;
      this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
      this.visibleSections = getVisibleSections(this.model);
      this.actionMap = new Map();
      if (!this.visibleSections.length) {
        this.visibleSections = [SECTION_META.find((item) => item.id === "appearance") || SECTION_META[0]];
      }
      if (!this.visibleSections.some((section) => section.id === this.activeSection)) {
        this.setActiveSection(this.visibleSections[0]?.id || "appearance");
      }
      this.navIndex = clamp(
        Number.isFinite(this.navIndex) ? this.navIndex : this.visibleSections.findIndex((item) => item.id === this.activeSection),
        0,
        this.visibleSections.length - 1
      );
      const section =
        getSettingsSectionById(this.activeSection) ||
        this.visibleSections.find((item) => item.id === this.activeSection) ||
        this.visibleSections[0];
      this.ensureExpandedState(section.id);
      this.persistUiState();

      this.ensureShell();

      const shell = this.container.querySelector(".settings-shell");
      if (shell) {
        shell.dataset.settingsStyle = String(this.model.theme.settingsUiStyle || "CLASSIC").toLowerCase();
        const enterClass = ScreenUtils.routeEnterClass(this, this.settingsRouteEnterPending, " settings-route-enter");
        shell.classList.toggle("settings-route-enter", enterClass === " settings-route-enter");
        shell.classList.toggle("tizen-fade-enter", enterClass === " tizen-fade-enter");
        if (enterClass === " settings-route-enter") {
          // Restart the enter animation. Skipped on fast-path runtimes: the
          // read forces a sync layout on every settings open.
          void shell.offsetWidth;
        }
      }

      const rootSidebarSlot = this.container.querySelector("[data-settings-root-sidebar]");
      const navSlot = this.container.querySelector("[data-settings-nav]");
      const contentSlot = this.container.querySelector("[data-settings-content]");
      const dialogSlot = this.container.querySelector("[data-settings-dialog]");

      const rootSidebarHtml = renderRootSidebar({
        selectedRoute: "settings",
        profile: this.sidebarProfile,
        layout: this.layoutPrefs,
        expanded: Boolean(this.sidebarExpanded),
        pillIconOnly: Boolean(this.pillIconOnly)
      });
      if (rootSidebarSlot && rootSidebarSlot.innerHTML !== rootSidebarHtml) {
        rootSidebarSlot.innerHTML = rootSidebarHtml;
      }

      const navHtml = this.renderNav();
      if (navSlot && navSlot.innerHTML !== navHtml) {
        navSlot.innerHTML = navHtml;
      }
      if (navSlot && this.railScrollNode !== navSlot) {
        if (this.railScrollNode && this.handleRailScrollBound) {
          this.railScrollNode.removeEventListener("scroll", this.handleRailScrollBound);
        }
        this.handleRailScrollBound = () => {
          this.railScrollTop = Number(navSlot.scrollTop || 0);
          updateSettingsRailIndicators(navSlot);
        };
        navSlot.addEventListener("scroll", this.handleRailScrollBound, { passive: true });
        this.railScrollNode = navSlot;
      }
      if (navSlot && Number.isFinite(this.restoreRailScrollTop)) {
        if (navSlot.settingsScrollAnimationFrame) {
          cancelAnimationFrame(navSlot.settingsScrollAnimationFrame);
          navSlot.settingsScrollAnimationFrame = null;
        }
        navSlot.scrollTop = clamp(this.restoreRailScrollTop, 0, Math.max(0, navSlot.scrollHeight - navSlot.clientHeight));
        this.railScrollTop = Number(navSlot.scrollTop || 0);
        this.restoreRailScrollTop = null;
      }
      updateSettingsRailIndicatorsSoon(navSlot);
      updateSettingsScrollIndicatorsSoon(navSlot);

      const sectionChanged = this.renderedSectionId !== section.id;
      const previousScrollState = !sectionChanged ? captureSettingsScrollState(contentSlot) : null;
      this.renderedSectionId = section.id;
      if (contentSlot) {
        contentSlot.innerHTML = this.renderSection(section, this.model);
        if (previousScrollState) {
          restoreSettingsScrollState(contentSlot, previousScrollState);
        }
        if (sectionChanged) {
          contentSlot.classList.remove("is-section-transitioning");
          void contentSlot.offsetWidth;
          contentSlot.classList.add("is-section-transitioning");
        } else {
          contentSlot.classList.remove("is-section-transitioning");
        }
      }

      const dialogHtml = this.optionDialog ? this.renderOptionDialog() : this.renderTextDialog();
      if (dialogSlot && dialogSlot.innerHTML !== dialogHtml) {
        dialogSlot.innerHTML = dialogHtml;
      }
      if (dialogSlot && typeof this.optionDialog?.onRender === "function") {
        this.optionDialog.onRender(dialogSlot);
      }
      this.bindTextDialogEvents();

      bindRootSidebarEvents(this.container, {
        currentRoute: "settings",
        onSelectedAction: () => this.closeSidebarToNav(),
        onExpandSidebar: () => this.openSidebar()
      });
      ScreenUtils.indexFocusables(this.container);
      bindSettingsScrollIndicators(this.container);
      this.settingsRouteEnterPending = false;
      this.applyFocus();
      syncLayoutPreviewMetricsSoon(this.container);
      updateSettingsRailIndicatorsSoon(navSlot);
      updateSettingsScrollIndicatorsSoon(contentSlot);
    }
  };
}
