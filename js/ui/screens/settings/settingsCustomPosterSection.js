import { ProfileManager } from "../../../core/profile/profileManager.js";
import { openCustomPosterPhoneConfig } from "./customPosterPhoneConfig.js";
import { Platform } from "../../../platform/index.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import {
  CUSTOM_POSTER_SCREENS,
  toggleCustomPosterScreen
} from "../../../core/poster/customPosterScreens.js";
import { I18n } from "../../../i18n/index.js";
const t = (key, fallback) => I18n.t(key, {}, fallback);
export function renderCustomPosterSettings() {
  const settings = LayoutPreferences.get();
  const pid = ProfileManager.getActiveProfileId();
  const mount = this.settingsMountToken;
  const current = () =>
    this.isMounted &&
    this.activeSection === "layout" &&
    this.settingsMountToken === mount &&
    ProfileManager.getActiveProfileId() === pid;
  const phoneSupported = Platform.isWebOS() || Platform.isTizen();
  this.actionMap.set("layout:customPosterPhone", async () => {
    if (!current() || this.customPosterPhoneStarting) return;
    this.customPosterPhoneStarting = true;
    this.customPosterPhoneError = false;
    try {
      await openCustomPosterPhoneConfig(this);
    } catch (_) {
      if (current()) this.customPosterPhoneError = true;
    } finally {
      this.customPosterPhoneStarting = false;
    }
  });
  this.actionMap.set("layout:customPoster", () =>
    this.openTextDialog({
      title: t("web_custom_poster_label", "URL Pattern"),
      value: settings.customPosterUrlPattern,
      placeholder: t("web_custom_poster_placeholder"),
      returnFocusKey: "layout:customPoster",
      clearLabel: t("layout_custom_poster_clear"),
      onClear: () => {
        if (!current()) return false;
        LayoutPreferences.set({
          customPosterUrlPattern: "",
          customPosterEnabledScreens: CUSTOM_POSTER_SCREENS
        });
      },
      onSubmit: (value) => {
        if (!current()) return false;
        if (value.trim() && !/^https?:\/\//i.test(value.trim())) return false;
        LayoutPreferences.set({ customPosterUrlPattern: value.trim() });
      }
    })
  );
  const screens = CUSTOM_POSTER_SCREENS.filter((screen) => screen !== "tv_recommendations");
  screens.forEach((screen) => {
    this.actionMap.set(`layout:customPosterScreen:${screen}`, () => {
      if (!current()) return;
      LayoutPreferences.set({
        customPosterEnabledScreens: toggleCustomPosterScreen(
          LayoutPreferences.get().customPosterEnabledScreens,
          screen
        )
      });
    });
  });
  const phoneMarkup = phoneSupported
    ? this.renderActionRow({
        focusKey: "layout:customPosterPhone",
        title: t("layout_custom_poster_qr"),
        subtitle: this.customPosterPhoneError
          ? t("web_custom_poster_error_connection")
          : t("custom_poster_qr_instruction")
      })
    : "";
  const active = Boolean(settings.customPosterUrlPattern);
  const enabledScreens = settings.customPosterEnabledScreens || CUSTOM_POSTER_SCREENS;
  return (
    phoneMarkup +
    this.renderActionRow({
      focusKey: "layout:customPoster",
      title: t("web_custom_poster_label", "URL Pattern"),
      subtitle: t("layout_custom_poster_description"),
      value: active ? t("layout_custom_poster_active") : ""
    }) +
    (active
      ? `<div class="settings-section-label">${t("settings_card_depth_apply_to", "Apply to")}</div>` +
        screens
          .map((screen) =>
            this.renderToggleRow({
              focusKey: `layout:customPosterScreen:${screen}`,
              title: t(`layout_custom_poster_screen_${screen}`),
              checked: enabledScreens.includes(screen)
            })
          )
          .join("")
      : "")
  );
}
