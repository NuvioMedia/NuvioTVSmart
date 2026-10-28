/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods01() {
  const {
    Router,
    ScreenUtils,
    addonRepository,
    LocalStore,
    TmdbSettingsStore,
    HomeCatalogStore,
    accentColorForTheme,
    ThemeStore,
    MemberAccessRepository,
    ThemeManager,
    resolveThemeName,
    PlayerSettingsStore,
    TorrentSettingsStore,
    LayoutPreferences,
    ExperienceModeStore,
    MdbListSettingsStore,
    AnimeSkipSettingsStore,
    DebridSettingsStore,
    StreamBadgeSettingsStore,
    ProfileManager,
    AuthManager,
    Platform,
    isFastHorizontalNavigationEnabled,
    PluginManager,
    TraktAuthService,
    TraktSettingsStore,
    getSidebarProfileState,
    SETTINGS_UI_STATE_KEY,
    SECTION_META,
    ROW_ICONS,
    escapeHtml,
    iconSvg,
    translateSectionCopy,
    renderSectionNavIcon,
    settingsScrollIndicatorMarkup,
    getSessionEmail,
    fetchAccountSyncOverview,
    createDefaultExpandedState,
    normalizeExpandedState,
    normalizeExpandedSections,
    readSettingsUiState,
    isAppearanceThemeFocusKey
  } = internals;

  return {
    getCurrentRailScrollTop() {
      const rail = this.container?.querySelector?.("[data-settings-nav]");
      if (rail) {
        this.railScrollTop = Number(rail.scrollTop || 0);
      }
      return Number.isFinite(this.railScrollTop) ? Math.max(0, this.railScrollTop) : 0;
    },
    ensureShell() {
      if (
        this.container?.querySelector?.(".settings-shell .settings-sidebar-frame") &&
        this.container?.querySelector?.(".settings-shell .settings-content-frame")
      ) {
        return;
      }
      this.container.innerHTML = `
          <div class="home-shell settings-shell">
            <div class="settings-root-sidebar-slot" data-settings-root-sidebar></div>
            <div class="settings-workspace">
              <div class="settings-sidebar-frame">
                <aside class="settings-sidebar" data-settings-nav></aside>
                ${settingsScrollIndicatorMarkup("vertical")}
              </div>
              <div class="settings-content-frame">
                <section class="settings-content" data-settings-content></section>
                ${settingsScrollIndicatorMarkup("vertical")}
              </div>
            </div>
            <div data-settings-dialog></div>
          </div>
        `;
    },
    async mount(_params = {}, navigationContext = {}) {
      this.container = document.getElementById("settings");
      ScreenUtils.show(this.container);
      this.settingsMountToken = (this.settingsMountToken || 0) + 1;
      const mountToken = this.settingsMountToken;
      if (!this.handleWheelBound) {
        this.handleWheelBound = this.handleWheelEvent.bind(this);
        this.container.addEventListener("wheel", this.handleWheelBound, { passive: false });
      }
      if (!this.handleClickBound) {
        this.handleClickBound = this.handleClickEvent.bind(this);
        this.container.addEventListener("click", this.handleClickBound);
      }
      this.settingsRouteEnterPending = true;
      const persistedUiState = readSettingsUiState();
      this.restoreRailScrollTop = persistedUiState.railScrollTop;
      this.railScrollTop = persistedUiState.railScrollTop;
      this.suppressNextRailFocusScroll = Boolean(navigationContext?.isBackNavigation);
      this.activeSection = persistedUiState.activeSection || this.activeSection || null;
      this.focusZone = "nav";
      this.sidebarFocusIndex = Number.isFinite(this.sidebarFocusIndex) ? this.sidebarFocusIndex : 0;
      this.navIndex = Number.isFinite(persistedUiState.navIndex)
        ? persistedUiState.navIndex
        : Number.isFinite(this.navIndex)
          ? this.navIndex
          : SECTION_META.findIndex((section) => section.id === this.activeSection);
      this.contentFocusKey = persistedUiState.contentFocusKey || this.contentFocusKey || null;
      this.appearanceThemeFocusKey = persistedUiState.appearanceThemeFocusKey || this.appearanceThemeFocusKey || null;
      this.pluginDraft = this.pluginDraft || "";
      this.integrationView = persistedUiState.integrationView || this.integrationView || "hub";
      this.expandedSections = normalizeExpandedSections(persistedUiState.expandedSections || this.expandedSections);
      this.streamBadgePreviewSourceUrl = null;
      this.advancedCacheCleared = false;
      this.optionDialog = this.optionDialog || null;
      this.textDialog = this.textDialog || null;
      this.debridAuthDialog = null;
      this.debridAuthPollTimer = null;
      this.dialogFocusIndex = Number.isFinite(this.dialogFocusIndex) ? this.dialogFocusIndex : 0;
      this.sidebarExpanded = false;
      this.pillIconOnly = false;
      const sidebarProfilePromise = getSidebarProfileState().catch((error) => {
        console.warn("Settings sidebar profile failed to load", error);
        return null;
      });
      try {
        this.sidebarProfile = await getSidebarProfileState({ cacheOnly: true });
        this.model = await this.collectModel({ cacheOnly: true });
      } catch (error) {
        console.warn("Settings cached model failed to load", error);
        this.sidebarProfile = this.sidebarProfile || null;
        this.model = this.model || (await this.collectModel({ cacheOnly: true }));
      }
      await this.render({ refreshModel: false });
      this.isMounted = true;
      this.memberAccessUnsubscribe = MemberAccessRepository.subscribe((access) => {
        if (!this.isMounted || !this.model) return;
        const previous = this.model.memberAccess || {};
        if (
          String(previous.tier || "") === String(access?.tier || "") &&
          JSON.stringify(previous.entitlements || []) === JSON.stringify(access?.entitlements || [])
        ) {
          return;
        }
        void this.render({ refreshModel: true });
      });

      // Android renders the settings surface from local state immediately and
      // refreshes remote membership/profile data independently. Keep the same
      // ordering on Smart TV so a slow Supabase/avatar request cannot hold the
      // Settings route or its focus rail.
      void (async () => {
        const [sidebarProfile, model] = await Promise.all([sidebarProfilePromise, this.collectModel()]);
        if (!this.isMounted || mountToken !== this.settingsMountToken || Router.getCurrent() !== "settings") {
          return;
        }
        if (sidebarProfile) {
          this.sidebarProfile = sidebarProfile;
        }
        this.model = model;
        await this.render({ refreshModel: false });
      })().catch((error) => {
        if (this.isMounted && mountToken === this.settingsMountToken && Router.getCurrent() === "settings") {
          console.warn("Settings background model refresh failed", error);
        }
      });
    },
    ensureExpandedState(sectionId) {
      this.expandedSections[sectionId] = normalizeExpandedState(sectionId, this.expandedSections[sectionId]);
    },
    persistUiState() {
      LocalStore.set(SETTINGS_UI_STATE_KEY, {
        activeSection: this.activeSection || null,
        navIndex: Number.isFinite(this.navIndex) ? this.navIndex : null,
        railScrollTop: this.getCurrentRailScrollTop(),
        contentFocusKey: this.contentFocusKey || null,
        appearanceThemeFocusKey: this.appearanceThemeFocusKey || null,
        integrationView: this.integrationView || "hub",
        expandedSections: normalizeExpandedSections(this.expandedSections)
      });
    },
    rememberAppearanceThemeFocusKey(focusKey = this.contentFocusKey) {
      if (!isAppearanceThemeFocusKey(focusKey)) {
        return;
      }
      if (this.appearanceThemeFocusKey === focusKey) {
        return;
      }
      this.appearanceThemeFocusKey = focusKey;
      this.persistUiState();
    },
    getAppearanceThemeFocusKey() {
      return this.appearanceThemeFocusKey || "appearance:theme:WHITE";
    },
    collapseExpandedSection(sectionId) {
      if (!sectionId) {
        return;
      }
      this.expandedSections[sectionId] = createDefaultExpandedState(sectionId);
    },
    setActiveSection(sectionId) {
      const nextSectionId = sectionId || null;
      if (nextSectionId !== "layout") this.closeCustomPosterPhoneConfig?.();
      if (this.activeSection === "trakt" && nextSectionId !== "trakt") this.stopTrackingWork?.();
      if (this.activeSection && this.activeSection !== nextSectionId) {
        this.rememberAppearanceThemeFocusKey();
        this.collapseExpandedSection(this.activeSection);
      }
      if (nextSectionId !== "contentDiscovery") {
        this.mediaServerDraft = null;
        this.mediaServersView = null;
      }
      this.activeSection = sectionId || null;
      this.contentFocusKey = this.activeSection === "appearance" ? this.getAppearanceThemeFocusKey() : null;
      this.persistUiState();
    },
    toggleExpandedSection(sectionId, groupId) {
      this.ensureExpandedState(sectionId);
      this.expandedSections[sectionId][groupId] = !this.expandedSections[sectionId][groupId];
      this.persistUiState();
    },
    registerAction(focusKey, action) {
      this.actionMap.set(focusKey, action);
      return `data-focus-key="${escapeHtml(focusKey)}"`;
    },
    async collectModel({ cacheOnly = false } = {}) {
      const authState = AuthManager.getAuthState();
      this.ensureAccountSyncOverview(authState);
      const [addons, profiles, memberAccess] = await Promise.all([
        addonRepository.getInstalledAddons(cacheOnly ? { cacheOnly: true } : {}),
        ProfileManager.getProfiles(),
        cacheOnly
          ? Promise.resolve(MemberAccessRepository.getCachedAccess())
          : MemberAccessRepository.getAccess().catch(() => MemberAccessRepository.getCurrentAccess())
      ]);
      const activeProfileId = ProfileManager.getActiveProfileId();
      const pluginSources = PluginManager.listPluginSources();
      const pluginSummary = PluginManager.getSummary();
      const storedTheme = ThemeStore.get();
      const resolvedThemeName = resolveThemeName(storedTheme.themeName, memberAccess);
      ThemeManager.apply({ enforceAccess: true, access: memberAccess });

      return {
        addons,
        profiles,
        activeProfileId,
        accountEmail: getSessionEmail(),
        pluginSources,
        pluginSummary,
        pluginsEnabled: PluginManager.pluginsEnabled,
        theme: {
          ...storedTheme,
          themeName: resolvedThemeName,
          accentColor: accentColorForTheme(resolvedThemeName)
        },
        memberAccess,
        player: PlayerSettingsStore.get(),
        torrent: TorrentSettingsStore.get(),
        layout: LayoutPreferences.get(),
        homeCatalog: HomeCatalogStore.get(),
        tmdb: TmdbSettingsStore.get(),
        mdbList: MdbListSettingsStore.get(),
        animeSkip: AnimeSkipSettingsStore.get(),
        streamBadgeSettings: StreamBadgeSettingsStore.get(),
        debrid: DebridSettingsStore.get(),
        trakt: this.collectTraktModel(),
        experience: ExperienceModeStore.get(),
        fastHorizontalNavigation: isFastHorizontalNavigationEnabled(),
        authState,
        accountSyncOverview: this.accountSyncOverview || null,
        accountSyncOverviewLoading: Boolean(this.accountSyncOverviewPromise)
      };
    },
    collectTraktModel() {
      const auth = TraktAuthService.getCurrentAuthState();
      const settings = TraktSettingsStore.get();
      const mode = auth.accessToken && auth.refreshToken ? "connected" : auth.deviceCode ? "awaiting_approval" : "disconnected";
      return {
        auth,
        settings,
        mode,
        credentialsConfigured: TraktAuthService.hasRequiredCredentials(),
        isLoading: Boolean(this.traktLoading),
        isStatsLoading: Boolean(this.traktStatsLoading),
        statusMessage: this.traktStatusMessage || null,
        errorMessage: this.traktErrorMessage || null,
        stats: this.traktStats || null
      };
    },
    ensureAccountSyncOverview(authState = AuthManager.getAuthState()) {
      if (authState !== "authenticated") {
        this.accountSyncOverview = null;
        this.accountSyncOverviewPromise = null;
        this.accountSyncOverviewLoaded = false;
        return;
      }
      if (this.accountSyncOverviewLoaded || this.accountSyncOverviewPromise) {
        return;
      }
      this.accountSyncOverviewPromise = fetchAccountSyncOverview()
        .then((overview) => {
          this.accountSyncOverview = overview;
        })
        .catch((error) => {
          console.warn("Account sync overview failed", error);
        })
        .finally(() => {
          this.accountSyncOverviewLoaded = true;
          this.accountSyncOverviewPromise = null;
          if (this.container && this.activeSection === "account") {
            void this.render();
          }
        });
    },
    renderNav() {
      return this.visibleSections
        .map(
          (item, index) => `
          <button class="settings-nav-item focusable${this.activeSection === item.id ? " selected" : ""}"
                  data-zone="nav" role="tab" aria-selected="${this.activeSection === item.id ? "true" : "false"}"
                  data-nav-index="${index}"
                  data-focus-key="nav:${item.id}"
                  data-section="${item.id}">
            <span class="settings-nav-leading">
              ${renderSectionNavIcon(item.id)}
              <span class="settings-nav-label-wrap">
                <span class="settings-nav-label">${escapeHtml(translateSectionCopy(item).label)}</span>
              </span>
            </span>
            ${iconSvg(ROW_ICONS.chevron, "settings-nav-chevron")}
          </button>
        `
        )
        .join("");
    },
    renderSectionHeader(section) {
      const copy = translateSectionCopy(section);
      return `
          <header class="settings-content-header">
            <h1 class="settings-title">${escapeHtml(copy.label)}</h1>
            <p class="settings-subtitle">${escapeHtml(copy.subtitle)}</p>
          </header>
        `;
    }
  };
}
