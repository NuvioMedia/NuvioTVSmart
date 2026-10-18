/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";
import { TizenPlaybackSettingsStore } from "../../../data/local/tizenPlaybackSettingsStore.js";

export function createSettingsScreenMethods05() {
  const {
    LocalStore,
    ThemeStore,
    ThemeManager,
    ThemeColors,
    MemberAccessRepository,
    availableThemeIds,
    areCustomThemeColorsSolid,
    encodeCustomThemeColors,
    parseCustomThemeColor,
    resolveCustomThemeColors,
    LayoutPreferences,
    ExperienceModeStore,
    ProfileManager,
    Platform,
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
      if (Platform.isTizen() && !isEssential) {
        this.actionMap.set("advanced:alwaysUsePlaybackProxy", () => {
          TizenPlaybackSettingsStore.set({
            alwaysUsePlaybackProxy: !TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy
          });
        });
      }

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
          ${
            Platform.isTizen()
              ? `
          <div class="settings-group-heading">
            <div class="settings-group-title">${escapeHtml(t("advanced_section_playback", {}, "Playback"))}</div>
          </div>
          <div class="settings-group-card"><div class="settings-stack">
            ${this.renderToggleRow({
              focusKey: "advanced:alwaysUsePlaybackProxy",
              title: t("advanced_always_use_playback_proxy", {}, "Always use playback proxy"),
              subtitle: t(
                "advanced_always_use_playback_proxy_subtitle",
                {},
                "Use the built-in proxy on this TV for remote streams. Off uses automatic routing. Applies to the next stream."
              ),
              checked: TizenPlaybackSettingsStore.get().alwaysUsePlaybackProxy
            })}
          </div></div>`
              : ""
          }
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
    openCustomThemeEditorDialog(model = {}) {
      const theme = model.theme || ThemeStore.get();
      const access = model.memberAccess || MemberAccessRepository.getCurrentAccess();
      const allowGradient = Boolean(access?.tier);
      const colors = resolveCustomThemeColors(theme.customThemeColors, allowGradient);
      this.customThemeDraft = {
        colors,
        allowGradient,
        gradientEnabled: allowGradient && !areCustomThemeColorsSolid(colors),
        access
      };
      this.showCustomThemeEditorDialog();
    },
    showCustomThemeEditorDialog(focusId = null) {
      const draft = this.customThemeDraft;
      if (!draft) return;

      const visibleColors = draft.gradientEnabled ? draft.colors : [draft.colors[1], draft.colors[1], draft.colors[1]];
      const previewPalette = ThemeColors.getPalette("CUSTOM", visibleColors);
      const gradient = areCustomThemeColorsSolid(visibleColors)
        ? visibleColors[1]
        : `linear-gradient(90deg, ${visibleColors[0]} 0%, ${visibleColors[1]} 50%, ${visibleColors[2]} 100%)`;
      const title = draft.gradientEnabled
        ? t("custom_theme_title", {}, "Your custom gradient")
        : t("custom_theme_solid_title", {}, "Your custom color");
      const subtitle = draft.gradientEnabled
        ? t("custom_theme_subtitle", {}, "Choose three colors for your theme. Select a color to edit it.")
        : t("custom_theme_solid_subtitle", {}, "Choose a color for your theme.");
      const options = [];

      if (draft.allowGradient) {
        options.push({
          id: "mode",
          label: `${t("custom_theme_mode", {}, "Mode")}: ${t(
            draft.gradientEnabled ? "custom_theme_mode_gradient" : "custom_theme_mode_solid",
            {},
            draft.gradientEnabled ? "Gradient" : "Single color"
          )}`
        });
      }

      const colorIndexes = draft.gradientEnabled ? [0, 1, 2] : [1];
      colorIndexes.forEach((index) => {
        const colorName = t(`custom_theme_color_${index + 1}`, {}, `Color ${index + 1}`);
        options.push({ id: `color:${index}`, label: `${colorName}: ${draft.colors[index]}` });
      });
      options.push(
        { id: "save", label: t("custom_theme_save", {}, "Save theme") },
        { id: "cancel", label: t("common.cancel", {}, "Cancel") }
      );

      const previewLabel = escapeHtml(t("custom_theme_preview", {}, "PREVIEW"));
      const messageHtml = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0 8px;">
        <span style="font-size:16px;letter-spacing:0.08em;opacity:0.75;">${previewLabel}</span>
        <span style="display:block;height:20px;border-radius:999px;background:${gradient};"></span>
        <span style="display:inline-block;align-self:flex-start;padding:8px 12px;border:2px solid ${
          previewPalette["--focus-color"]
        };border-radius:10px;background:${visibleColors[1]};color:${
          previewPalette["--on-secondary"]
        };">${escapeHtml(t("custom_theme_preview_ring", {}, "Focused Item"))}</span>
      </div>`;

      this.openOptionDialog({
        title,
        messageHtml: `${messageHtml}<div class="settings-text-dialog-message">${escapeHtml(subtitle)}</div>`,
        options,
        selectedId: focusId || (draft.allowGradient ? "mode" : "color:1"),
        returnFocusKey: "appearance:theme:CUSTOM",
        dialogClassName: "settings-theme-custom-dialog",
        onSelect: (option) => {
          if (option.id === "mode") {
            draft.gradientEnabled = !draft.gradientEnabled;
            this.showCustomThemeEditorDialog("mode");
            return false;
          }
          if (String(option.id).startsWith("color:")) {
            const index = Number(String(option.id).slice("color:".length));
            this.openTextDialog({
              title: t("custom_theme_hex_title", {}, "Hex color"),
              value: draft.colors[index].slice(1),
              placeholder: "RRGGBB",
              returnFocusKey: "appearance:theme:CUSTOM",
              saveLabel: t("custom_theme_use_color", {}, "Use color"),
              onSubmit: (value) => {
                const color = parseCustomThemeColor(value);
                if (!color) {
                  if (this.textDialog) {
                    this.textDialog.statusMessage = t("custom_theme_hex_hint", {}, "Enter a six-character hex color (0–9, A–F).");
                    this.textDialog.statusKind = "error";
                  }
                  return false;
                }
                draft.colors[index] = color;
                this.showCustomThemeEditorDialog(`color:${index}`);
                return false;
              }
            });
            if (this.textDialog) this.textDialog.restoreCustomThemeEditor = true;
            return false;
          }
          if (option.id === "save") {
            const currentAccess = MemberAccessRepository.getCurrentAccess();
            const colors = resolveCustomThemeColors(
              draft.gradientEnabled ? draft.colors : [draft.colors[1], draft.colors[1], draft.colors[1]],
              Boolean(currentAccess?.tier)
            );
            ThemeStore.set({
              themeName: "CUSTOM",
              accentColor: colors[1],
              customThemeColors: encodeCustomThemeColors(colors)
            });
            ThemeManager.apply({ enforceAccess: true, access: currentAccess });
          }
          return true;
        },
        onClose: () => {
          this.customThemeDraft = null;
        }
      });
    },
    renderAppearanceSection(model) {
      const availableIds = new Set(availableThemeIds(model?.memberAccess));
      const themeOptions = THEME_OPTIONS.filter((theme) => availableIds.has(theme.id));
      themeOptions.forEach((theme) => {
        this.actionMap.set(`appearance:theme:${theme.id}`, () => {
          if (theme.id === "CUSTOM") {
            this.openCustomThemeEditorDialog(model);
            return;
          }
          ThemeStore.set({ themeName: theme.id, accentColor: theme.color });
          ThemeManager.apply({ enforceAccess: true, access: model?.memberAccess });
        });
      });

      const customColors = resolveCustomThemeColors(model.theme.customThemeColors, Boolean(model?.memberAccess?.tier));
      const renderedThemeOptions = themeOptions.map((theme) => {
        if (theme.id !== "CUSTOM") return theme;
        const customPalette = ThemeColors.getPalette("CUSTOM", customColors);
        return {
          ...theme,
          customThemeColors: customColors,
          color: customPalette["--secondary-color"],
          onColor: customPalette["--on-secondary"]
        };
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
                ${renderedThemeOptions
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
