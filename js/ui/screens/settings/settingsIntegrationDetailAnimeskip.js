/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderAnimeskipIntegrationDetail(model) {
  const { AnimeSkipSettingsStore, t, maskValue } = internals;

  this.actionMap.set("integration:animeskip:enabled", () => {
    AnimeSkipSettingsStore.set({ enabled: !AnimeSkipSettingsStore.get().enabled });
  });
  this.actionMap.set("integration:animeskip:id", () => {
    this.openTextDialog({
      title: t("settings.integration.animeskip.clientId.prompt"),
      value: AnimeSkipSettingsStore.get().clientId || "",
      returnFocusKey: "integration:animeskip:id",
      onSubmit: (value) => {
        AnimeSkipSettingsStore.set({ clientId: String(value).trim() });
        return true;
      }
    });
  });

  return `
      ${this.renderSectionHeader({ labelKey: "settings.integration.animeskip.label", subtitleKey: "settings.integration.animeskip.subtitle" })}
      <div class="settings-group-card settings-group-card-fill">
        <div class="settings-stack">
          ${this.renderActionRow({
            focusKey: "integration:back",
            title: t("settings.integration.backToIntegrations.title"),
            subtitle: t("settings.integration.backToIntegrations.subtitle"),
            icon: "back"
          })}
          ${this.renderToggleRow({
            focusKey: "integration:animeskip:enabled",
            title: t("settings.integration.animeskip.enable.title"),
            subtitle: t("settings.integration.animeskip.enable.subtitle"),
            checked: Boolean(model.animeSkip.enabled)
          })}
          ${this.renderActionRow({
            focusKey: "integration:animeskip:id",
            title: t("settings.integration.animeskip.clientId.title"),
            subtitle: t("settings.integration.animeskip.clientId.subtitle"),
            value: maskValue(model.animeSkip.clientId, t("common.notSet")),
            disabled: !model.animeSkip.enabled
          })}
        </div>
      </div>
    `;
}
