/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods05() {
  const {
    LocalStore,
    ThemeStore,
    ThemeManager,
    availableThemeIds,
    LayoutPreferences,
    ExperienceModeStore,
    DevicePerformancePreferences,
    ProfileManager,
    isFastHorizontalNavigationEnabled,
    CW_DISPLAY_SNAPSHOT_KEY,
    CW_ENRICHMENT_CACHE_KEY,
    I18n,
    THEME_OPTIONS,
    FONT_OPTIONS,
    LANGUAGE_OPTIONS,
    SECTION_META,
    t,
    escapeHtml,
    labelForFont,
    labelForLanguage,
    settingsScrollIndicatorMarkup
  } = internals;

  return {
    renderAdvancedSection(model) {
      this.actionMap.set("advanced:fastHorizontalNavigation", () => {
        LayoutPreferences.set({
          fastHorizontalNavigationEnabled: !isFastHorizontalNavigationEnabled()
        });
      });
      const performanceModeOptions = [
        {
          id: "auto",
          labelKey: "advanced_performance_mode_auto",
          label: "Automatic"
        },
        {
          id: "performance",
          labelKey: "advanced_performance_mode_performance",
          label: "Performance"
        },
        {
          id: "quality",
          labelKey: "advanced_performance_mode_quality",
          label: "Quality"
        }
      ];
      const currentPerformanceMode = DevicePerformancePreferences.getMode();
      const currentPerformanceModeOption =
        performanceModeOptions.find((option) => option.id === currentPerformanceMode) || performanceModeOptions[0];
      this.actionMap.set("advanced:performanceMode", () => {
        this.openOptionDialog({
          title: t("advanced_performance_mode", {}, "Performance Mode"),
          message: t("advanced_performance_mode_dialog_message", {}, "The app restarts to apply the new mode."),
          options: performanceModeOptions,
          selectedId: currentPerformanceMode,
          returnFocusKey: "advanced:performanceMode",
          onSelect: (option) => {
            if (!option || option.id === DevicePerformancePreferences.getMode()) {
              return;
            }
            DevicePerformancePreferences.setMode(option.id);
            // Screens read the runtime profile while rendering and the root
            // classes are applied once at boot, so restart for a consistent state.
            setTimeout(() => {
              try {
                globalThis.location.reload();
              } catch (_) {}
            }, 150);
          }
        });
      });
      this.actionMap.set("advanced:rememberLastProfile", () => {
        ProfileManager.setRememberLastProfileEnabled(!ProfileManager.isRememberLastProfileEnabled());
      });
      const isEssential = model.experience?.mode === "ESSENTIAL";
      this.actionMap.set("advanced:switchExperience", () => {
        const targetMode = isEssential ? "ADVANCED" : "ESSENTIAL";
        this.openOptionDialog({
          title: t(
            targetMode === "ADVANCED" ? "experience_mode_confirm_advanced_title" : "experience_mode_confirm_essential_title",
            {},
            targetMode === "ADVANCED" ? "Switch to Advanced?" : "Switch to Essential?"
          ),
          message: t(
            targetMode === "ADVANCED" ? "experience_mode_confirm_advanced_subtitle" : "experience_mode_confirm_essential_subtitle",
            {},
            "Your saved settings stay unchanged and you can switch back anytime."
          ),
          options: [
            { id: "cancel", labelKey: "action_cancel" },
            { id: "confirm", labelKey: "profile_confirm" }
          ],
          selectedId: "confirm",
          returnFocusKey: "advanced:switchExperience",
          onSelect: (option) => {
            if (option.id === "confirm") ExperienceModeStore.set({ mode: targetMode });
          }
        });
      });
      this.actionMap.set("advanced:clearContinueWatchingCache", () => {
        LocalStore.remove(CW_ENRICHMENT_CACHE_KEY);
        LocalStore.remove(CW_DISPLAY_SNAPSHOT_KEY);
        this.advancedCacheCleared = true;
      });

      if (isEssential) {
        return `
            ${this.renderSectionHeader({
              ...SECTION_META.find((item) => item.id === "advanced"),
              subtitleKey: "experience_mode_switch_to_advanced_header_subtitle"
            })}
            <div class="settings-group-card"><div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "advanced:switchExperience",
                title: t("experience_mode_switch_to_advanced", {}, "Switch to Advanced"),
                subtitle: t(
                  "experience_mode_switch_to_advanced_subtitle",
                  {},
                  "Show full layout, plug-in, integration, catalog, collection, and tuning settings."
                ),
                value: t("experience_mode_essential", {}, "Essential")
              })}
            </div></div>`;
      }

      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "advanced"))}
          <div class="settings-group-heading"><div class="settings-group-title">${escapeHtml(t("experience_mode_group_title", {}, "Experience mode"))}</div></div>
          <div class="settings-group-card"><div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "advanced:switchExperience",
              title: t("experience_mode_switch_to_essential", {}, "Switch to Essential"),
              subtitle: t(
                "experience_mode_switch_to_essential_subtitle",
                {},
                "Hide advanced setup surfaces without changing your saved values."
              ),
              value: t("experience_mode_advanced", {}, "Advanced")
            })}
          </div></div>
          <div class="settings-group-heading">
            <div class="settings-group-title">${escapeHtml(t("advanced_section_performance", {}, "Performance & navigation"))}</div>
          </div>
          <div class="settings-group-card">
            <div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "advanced:performanceMode",
                title: t("advanced_performance_mode", {}, "Performance Mode"),
                subtitle: t(
                  "advanced_performance_mode_subtitle",
                  {},
                  "Performance turns off blur and heavy animations and loads rows in smaller batches. Automatic uses it on Samsung TVs."
                ),
                value: t(currentPerformanceModeOption.labelKey, {}, currentPerformanceModeOption.label)
              })}
              ${this.renderToggleRow({
                focusKey: "advanced:fastHorizontalNavigation",
                title: t("advanced_fast_horizontal_navigation", {}, "Fast Horizontal Navigation"),
                subtitle: t(
                  "advanced_fast_horizontal_navigation_subtitle",
                  {},
                  "Increase D-pad repeat speed in rows while keeping repeat throttling enabled."
                ),
                checked: Boolean(model.fastHorizontalNavigation)
              })}
              ${this.renderToggleRow({
                focusKey: "advanced:rememberLastProfile",
                title: t("advanced_remember_last_profile", {}, "Remember Last Profile"),
                subtitle: t("advanced_remember_last_profile_subtitle", {}, "Remember last selected profile at startup"),
                checked: ProfileManager.isRememberLastProfileEnabled()
              })}
            </div>
          </div>
          <div class="settings-group-heading">
            <div class="settings-group-title">${escapeHtml(t("advanced_section_cache", {}, "Cache"))}</div>
          </div>
          <div class="settings-group-card">
            <div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "advanced:clearContinueWatchingCache",
                title: t("advanced_clear_cw_cache", {}, "Clear Continue Watching Cache"),
                subtitle: this.advancedCacheCleared
                  ? t("advanced_clear_cw_cache_done", {}, "Cache cleared")
                  : t(
                      "advanced_clear_cw_cache_subtitle",
                      {},
                      "Remove cached thumbnails, titles, and enrichment data for Continue Watching"
                    ),
                icon: null,
                disabled: Boolean(this.advancedCacheCleared)
              })}
            </div>
          </div>
        `;
    },
    renderAppearanceSection(model) {
      const availableIds = new Set(availableThemeIds(model?.memberAccess));
      const themeOptions = THEME_OPTIONS.filter((theme) => availableIds.has(theme.id));
      themeOptions.forEach((theme) => {
        this.actionMap.set(`appearance:theme:${theme.id}`, () => {
          ThemeStore.set({ themeName: theme.id, accentColor: theme.color });
          ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
        });
      });

      this.actionMap.set("appearance:font", () => {
        this.openOptionDialog({
          title: t("appearance_font_dialog_title", {}, "Choose Font"),
          options: FONT_OPTIONS,
          selectedId: model.theme.fontFamily,
          returnFocusKey: "appearance:font",
          dialogClassName: "settings-appearance-dialog",
          onSelect: (option) => {
            ThemeStore.set({ fontFamily: option.id });
            ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
          }
        });
      });

      this.actionMap.set("appearance:language", () => {
        this.openOptionDialog({
          title: t("appearance_language_dialog_title", {}, "Choose Language"),
          options: LANGUAGE_OPTIONS,
          selectedId: model.theme.language,
          returnFocusKey: "appearance:language",
          dialogClassName: "settings-appearance-dialog",
          onSelect: async (option) => {
            ThemeStore.set({ language: option.id });
            await I18n.init();
            ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
            I18n.apply();
          }
        });
      });
      this.actionMap.set("appearance:amoled", () => {
        const nextAmoled = !ThemeStore.get().amoledMode;
        ThemeStore.set({
          amoledMode: nextAmoled,
          amoledSurfacesMode: nextAmoled ? Boolean(ThemeStore.get().amoledSurfacesMode) : false
        });
        ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
      });
      this.actionMap.set("appearance:amoledSurfaces", () => {
        ThemeStore.set({ amoledSurfacesMode: !ThemeStore.get().amoledSurfacesMode });
        ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
      });
      this.actionMap.set("appearance:settingsUiStyle", () => {
        const options = ["CLASSIC", "HORIZON", "ZEN"].map((id) => ({
          id,
          labelKey: `settings_style_${id.toLowerCase()}`
        }));
        this.openOptionDialog({
          title: t("appearance_settings_style", {}, "Settings style"),
          options,
          selectedId: model.theme.settingsUiStyle || "CLASSIC",
          returnFocusKey: "appearance:settingsUiStyle",
          onSelect: (option) => ThemeStore.set({ settingsUiStyle: option.id })
        });
      });

      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "appearance"))}
          <div class="settings-group-card settings-appearance-group-card settings-theme-grid-card">
            <div class="settings-group-heading">
              <div class="settings-group-title">${escapeHtml(t("appearance_color_theme", {}, "Color Theme"))}</div>
              <div class="settings-group-subtitle">${escapeHtml(t("appearance_color_theme_subtitle", {}, "Pick the accent color used across the app"))}</div>
            </div>
            <div class="settings-horizontal-scroll-frame">
              <div class="settings-theme-row">
                ${themeOptions
                  .map((theme) =>
                    this.renderThemeCard(theme, String(model.theme.themeName).toUpperCase() === theme.id, `appearance:theme:${theme.id}`)
                  )
                  .join("")}
              </div>
              ${settingsScrollIndicatorMarkup("horizontal")}
            </div>
            ${this.renderToggleRow({
              focusKey: "appearance:amoled",
              title: t("appearance_amoled_mode", {}, "AMOLED Mode"),
              subtitle: t("appearance_amoled_mode_subtitle", {}, "Use pure black for app backgrounds"),
              checked: Boolean(model.theme.amoledMode)
            })}
            ${
              model.theme.amoledMode
                ? this.renderToggleRow({
                    focusKey: "appearance:amoledSurfaces",
                    title: t("appearance_amoled_surfaces_mode", {}, "Pure Black Surfaces"),
                    subtitle: t("appearance_amoled_surfaces_mode_subtitle", {}, "Also make cards, panels, and containers pure black"),
                    checked: Boolean(model.theme.amoledSurfacesMode)
                  })
                : ""
            }
          </div>
          <div class="settings-group-card settings-appearance-group-card">
            <div class="settings-group-heading">
              <div class="settings-group-title">${escapeHtml(t("appearance_font_and_language", {}, "Font and Language"))}</div>
              <div class="settings-group-subtitle">${escapeHtml(t("appearance_font_and_language_subtitle", {}, "Choose the typeface and locale used throughout the app"))}</div>
            </div>
            <div class="settings-stack">
              ${this.renderActionRow({
                focusKey: "appearance:settingsUiStyle",
                title: t("appearance_settings_style", {}, "Settings style"),
                subtitle: t("appearance_settings_style_subtitle", {}, "Choose the layout used by Settings"),
                value: t(
                  `settings_style_${String(model.theme.settingsUiStyle || "CLASSIC").toLowerCase()}`,
                  {},
                  String(model.theme.settingsUiStyle || "CLASSIC")
                )
              })}
              ${this.renderActionRow({
                focusKey: "appearance:font",
                title: t("appearance_font", {}, "App Font"),
                subtitle: t("appearance_font_subtitle", {}, "Choose your preferred font"),
                value: labelForFont(model.theme.fontFamily)
              })}
              ${this.renderActionRow({
                focusKey: "appearance:language",
                title: t("appearance_language", {}, "App Language"),
                subtitle: t("appearance_language_subtitle", {}, "Override system language"),
                value: labelForLanguage(model.theme.language)
              })}
            </div>
          </div>
        `;
    }
  };
}
