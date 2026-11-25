import { MdbListAccount } from "../../../data/repository/mdbListAccount.js";
import { registerMdbListAccountActions } from "./settingsMdbListAccount.js";
import { MDBLIST_PROVIDER_SETTINGS } from "../../../data/local/mdbListSettingsStore.js";
import {
  beginReorder,
  cancelReorder,
  confirmReorder,
  createReorderSession,
  isReordering,
  moveReorderBy
} from "../../components/reorderSession.js";
/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function renderMdblistIntegrationDetail(model) {
  const { MdbListSettingsStore, mdbListRepository, t, maskValue } = internals;

  registerMdbListAccountActions.call(this);
  const toggleMdbListSetting = (field) => {
    MdbListSettingsStore.set({ [field]: !MdbListSettingsStore.get()[field] });
  };
  this.actionMap.set("integration:mdblist:enabled", () => {
    MdbListSettingsStore.set({ enabled: !MdbListSettingsStore.get().enabled });
  });
  this.actionMap.set("integration:mdblist:key", () => {
    this.openTextDialog({
      title: t("settings.integration.mdblist.dialog.title"),
      value: MdbListSettingsStore.get().apiKey || "",
      placeholder: t("settings.integration.mdblist.dialog.placeholder"),
      returnFocusKey: "integration:mdblist:key",
      clearLabel: t("common.clear", {}, t("action_clear", {}, "Clear")),
      onClear: () => {
        MdbListSettingsStore.set({ apiKey: "" });
        return true;
      },
      onSubmit: async (value) => {
        const trimmed = String(value || "").trim();
        if (trimmed) {
          if (this.textDialog) {
            this.textDialog.statusMessage = t("action_saving", {}, "Saving...");
            this.textDialog.statusKind = "info";
            await this.render({ refreshModel: false });
          }
          const valid = await mdbListRepository.validateApiKey(trimmed);
          if (!valid) {
            if (this.textDialog) {
              this.textDialog.statusMessage = t("settings.integration.mdblist.invalidApiKey");
              this.textDialog.statusKind = "error";
            }
            return false;
          }
        }
        MdbListSettingsStore.set({ apiKey: trimmed });
        return true;
      }
    });
  });
  [
    ["trakt", "showTrakt"],
    ["imdb", "showImdb"],
    ["tmdb", "showTmdb"],
    ["letterboxd", "showLetterboxd"],
    ["tomatoes", "showTomatoes"],
    ["audience", "showAudience"],
    ["metacritic", "showMetacritic"],
    ["mal", "showMal"]
  ].forEach(([provider, field]) => {
    this.actionMap.set(`integration:mdblist:${provider}`, () => toggleMdbListSetting(field));
  });

  this.actionMap.set("integration:mdblist:hero", () => toggleMdbListSetting("showOnHero"));
  const ratingOrder = model.mdbList.ratingOrder;
  const movingProvider = this.mdbReorderSession?.movingKey || "";
  ratingOrder.forEach((provider) => {
    const startKey = `integration:mdblist:reorder:${provider}`;
    this.actionMap.set(startKey, () => {
      if (!MdbListSettingsStore.get().enabled) return;
      this.mdbReorderSession = createReorderSession({ keys: [...MdbListSettingsStore.get().ratingOrder] });
      if (!beginReorder(this.mdbReorderSession, provider)) {
        this.mdbReorderSession = null;
        return;
      }
      this.contentFocusKey = `integration:mdblist:reorder:${provider}`;
      void this.render();
    });
    const doneKey = `integration:mdblist:done:${provider}`;
    this.actionMap.set(doneKey, () => {
      if (!this.mdbReorderSession) return;
      confirmReorder(this.mdbReorderSession);
      this.mdbReorderSession = null;
      this.contentFocusKey = `integration:mdblist:reorder:${provider}`;
      void this.render();
    });
  });
  const reorderButton = (provider, disabled) => {
    const isMoving = movingProvider === provider;
    const key = isMoving ? `integration:mdblist:done:${provider}` : `integration:mdblist:reorder:${provider}`;
    return `<button class="settings-action-row settings-mdb-order-reorder${disabled && !isMoving ? " is-disabled" : " settings-content-focusable focusable"}${isMoving ? " is-moving" : ""}" data-zone="content" ${this.registerAction(key, this.actionMap.get(key))} ${disabled && !isMoving ? 'disabled aria-disabled="true"' : ""} aria-label="${internals.escapeAttribute(isMoving ? t("collections_done", "Done") : t("cd_reorder", "Reorder"))}"><span class="material-icons" aria-hidden="true">${isMoving ? "check" : "reorder"}</span>${isMoving ? `<span class="reorder-done-label">${internals.escapeHtml(t("collections_done", "Done"))}</span>` : ""}</button>`;
  };

  return `
        ${this.renderSectionHeader({ labelKey: "settings.integration.mdblist.label", subtitleKey: "settings.integration.mdblist.subtitle" })}
        <div class="settings-group-card settings-group-card-fill">
          <div class="settings-stack">
            ${this.renderActionRow({
              focusKey: "integration:back",
              title: t("settings.integration.backToIntegrations.title"),
              subtitle: t("settings.integration.backToIntegrations.subtitle"),
              icon: "back"
            })}
            ${this.renderActionRow({ focusKey: "integration:mdblist:account", title: "MDBList", subtitle: MdbListAccount.connected() ? t("mdblist_connected_as", [MdbListAccount.user()?.name || t("mdblist_account_fallback")]) : t("mdblist_status_enter_code"), value: MdbListAccount.connected() ? t("debrid_disconnect") : t("servers_connect"), disabled: !MdbListAccount.configured() && !MdbListAccount.connected() })}
            ${!MdbListAccount.configured() ? `<p>${internals.escapeHtml(t("mdblist_missing_client"))}</p>` : ""}
            ${this.mdbListAccountMessage ? `<p>${internals.escapeHtml(this.mdbListAccountMessage)}</p>` : ""}
            ${MdbListAccount.connected() ? this.renderActionRow({ focusKey: "integration:mdblist:lists", title: t("mdblist_library_lists"), subtitle: t("mdblist_library_lists_description") }) : ""}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:enabled",
              title: t("settings.integration.mdblist.enable.title"),
              subtitle: t("settings.integration.mdblist.enable.subtitle"),
              checked: Boolean(model.mdbList.enabled)
            })}
            ${this.renderActionRow({
              focusKey: "integration:mdblist:key",
              title: t("settings.integration.mdblist.apiKey.title"),
              subtitle: t("settings.integration.mdblist.apiKey.subtitle"),
              value: maskValue(model.mdbList.apiKey, t("common.notSet")),
              disabled: !model.mdbList.enabled
            })}
            ${this.renderToggleRow({
              focusKey: "integration:mdblist:hero",
              title: t("mdblist_show_on_hero_title"),
              subtitle: t("mdblist_show_on_hero_subtitle"),
              checked: Boolean(model.mdbList.showOnHero),
              disabled: !model.mdbList.enabled
            })}
            <div class="settings-mdb-order-heading">
              <h3>${t("mdblist_rating_order_title")}</h3>
              <p>${t("mdblist_rating_order_subtitle")}</p>
            </div>
            ${ratingOrder
              .map(
                (provider, index) => `<div class="settings-mdb-order-row">
              ${this.renderToggleRow({ focusKey: `integration:mdblist:${provider}`, title: t(`settings.integration.mdblist.${provider}.title`), checked: model.mdbList[MDBLIST_PROVIDER_SETTINGS[provider]] !== false, disabled: !model.mdbList.enabled || Boolean(movingProvider) })}
              ${reorderButton(provider, !model.mdbList.enabled || movingProvider !== "" || ratingOrder.length < 2)}
            </div>`
              )
              .join("")}
          </div>
        </div>
      `;
}
