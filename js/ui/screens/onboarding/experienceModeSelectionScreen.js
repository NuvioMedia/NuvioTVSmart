import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ProfileSettingsSyncService } from "../../../core/profile/profileSettingsSyncService.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { I18n } from "../../../i18n/index.js";
import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { renderBrandWordmarkImage } from "../../components/brandWordmark.js";

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LAYOUTS = [
  { id: "modern", key: "layout_modern", fallback: "Modern" },
  { id: "grid", key: "layout_grid", fallback: "Grid" },
  { id: "classic", key: "layout_classic", fallback: "Classic" }
];

export const ExperienceModeSelectionScreen = {
  step: "mode",

  async mount() {
    this.container = document.getElementById("experienceModeSelection");
    this.step = "mode";
    ScreenUtils.show(this.container);
    this.render();
    this.onClickBound = this.onClick.bind(this);
    this.container.addEventListener("click", this.onClickBound);
    ScreenUtils.setInitialFocus(this.container);
  },

  render() {
    const isLayout = this.step === "layout";
    this.container.innerHTML = `
      <main class="experience-mode-screen">
        ${renderBrandWordmarkImage({ className: "experience-mode-logo" })}
        <h1>${escapeHtml(isLayout ? t("layout_selection_welcome", "Welcome to Nuvio") : t("experience_mode_choose_title", "Choose your Nuvio experience"))}</h1>
        <p>${escapeHtml(isLayout ? t("layout_selection_subtitle", "Choose how Nuvio should look on your TV.") : t("experience_mode_choose_subtitle", "Start simple or unlock every customization. You can switch anytime."))}</p>
        <div class="experience-mode-options ${isLayout ? "is-layout" : ""}">
          ${
            isLayout
              ? LAYOUTS.map(
                  (layout, index) =>
                    `<button class="experience-mode-card focusable" data-index="${index}" data-layout="${layout.id}"><strong>${escapeHtml(t(layout.key, layout.fallback))}</strong></button>`
                ).join("")
              : `
              <button class="experience-mode-card focusable" data-index="0" data-mode="ESSENTIAL"><strong>${escapeHtml(t("experience_mode_essential", "Essential"))}</strong><span>${escapeHtml(t("experience_mode_essential_card_subtitle", "Focused setup, add-ons, playback basics, Trakt, and account settings."))}</span></button>
              <button class="experience-mode-card focusable" data-index="1" data-mode="ADVANCED"><strong>${escapeHtml(t("experience_mode_advanced", "Advanced"))}</strong><span>${escapeHtml(t("experience_mode_advanced_card_subtitle", "Full settings, layout controls, catalog order, collections, plug-ins, and diagnostics."))}</span></button>
            `
          }
        </div>
      </main>`;
  },

  async chooseMode(mode) {
    const profileId = ProfileManager.getActiveProfileId();
    if (mode === "ADVANCED") {
      this.step = "layout";
      this.render();
      ScreenUtils.setInitialFocus(this.container);
      return;
    }
    LayoutPreferences.setForProfile(profileId, { homeLayout: "modern", hasChosenLayout: true });
    ExperienceModeStore.setForProfile(profileId, { mode: "ESSENTIAL" });
    await ProfileSettingsSyncService.push(profileId);
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    await Router.navigate(
      addons.length ? "home" : "essentialAddonSetup",
      {},
      {
        replaceHistory: true,
        skipStackPush: true
      }
    );
  },

  async chooseLayout(layout) {
    const profileId = ProfileManager.getActiveProfileId();
    LayoutPreferences.setForProfile(profileId, { homeLayout: layout, hasChosenLayout: true });
    ExperienceModeStore.setForProfile(profileId, { mode: "ADVANCED" });
    await ProfileSettingsSyncService.push(profileId);
    await Router.navigate(
      "home",
      { forceReload: true },
      { replaceHistory: true, skipStackPush: true }
    );
  },

  async onClick(event) {
    const node = event.target.closest("[data-mode], [data-layout]");
    if (!node) return;
    if (node.dataset.mode) await this.chooseMode(node.dataset.mode);
    if (node.dataset.layout) await this.chooseLayout(node.dataset.layout);
  },

  // FocusEngine owns Back: as on Android TV, the layout step leaves onboarding like the mode step.
  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (code === 37 || code === 39) {
      event.preventDefault();
      ScreenUtils.moveFocus(this.container, code === 37 ? -1 : 1);
    } else if (code === 13) {
      event.preventDefault();
      this.container.querySelector(".focusable.focused")?.click();
    }
  },

  cleanup() {
    this.container?.removeEventListener("click", this.onClickBound);
    ScreenUtils.hide(this.container);
  }
};
