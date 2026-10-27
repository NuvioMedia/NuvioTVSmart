/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods02() {
  const {
    ThemeColors,
    isContentRtl,
    ROW_ICONS,
    clamp,
    t,
    escapeHtml,
    renderLayoutPreviewMarkup,
    renderLayoutPreviewPlaceholderMarkup,
    iconSvg,
    translateOptionLabel,
    subtitleLanguageOptionCode,
    addonKindsLabel
  } = internals;

  return {
    renderActionRow({
      focusKey,
      title,
      subtitle = "",
      value = "",
      icon = "chevron",
      leadingIcon = "",
      leadingIconSrc = "",
      external = false,
      classes = "",
      disabled = false,
      planned = false
    }) {
      const inert = disabled || planned;
      const trailing = external ? "external" : icon;
      const tailContent = [
        planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : "",
        value ? `<bdi class="settings-row-value" dir="${isContentRtl(String(value)) ? "rtl" : "ltr"}">${escapeHtml(value)}</bdi>` : "",
        trailing ? iconSvg(ROW_ICONS[trailing], `settings-row-icon${external ? " is-external" : ""}`) : ""
      ]
        .filter(Boolean)
        .join("");
      return `
          <button class="settings-action-row settings-content-focusable focusable${classes ? ` ${classes}` : ""}${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
                  data-zone="content"
                  aria-disabled="${inert ? "true" : "false"}"
                  ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
                  data-role="action">
            ${leadingIconSrc ? `<img class="settings-row-leading-image" src="${escapeHtml(leadingIconSrc)}" alt="" aria-hidden="true">` : leadingIcon ? `<span class="settings-row-leading-icon material-icons" aria-hidden="true">${escapeHtml(leadingIcon)}</span>` : ""}
            <span class="settings-row-copy">
              <span class="settings-row-title">${escapeHtml(title)}</span>
              ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
            </span>
            ${tailContent ? `<span class="settings-row-tail">${tailContent}</span>` : ""}
          </button>
        `;
    },
    renderToggleRow({ focusKey, title, subtitle = "", checked = false, disabled = false, planned = false }) {
      const inert = disabled || planned;
      return `
          <button class="settings-action-row settings-toggle-row settings-content-focusable focusable${inert ? " is-disabled" : ""}${planned ? " is-planned" : ""}"
                  data-zone="content"
                  aria-disabled="${inert ? "true" : "false"}"
                  ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}
                  role="switch" aria-checked="${checked ? "true" : "false"}"
                  data-role="toggle">
            <span class="settings-row-copy">
              <span class="settings-row-title">${escapeHtml(title)}</span>
              ${subtitle ? `<span class="settings-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
            </span>
            <span class="settings-row-tail">
              ${planned ? `<span class="settings-row-badge">${escapeHtml(t("common.soon"))}</span>` : ""}
              <span class="settings-toggle-pill${checked ? " is-checked" : ""}">
                <span class="settings-toggle-thumb"></span>
              </span>
            </span>
          </button>
        `;
    },
    renderThemeCard(theme, selected, focusKey) {
      const selectedClass = selected ? " is-selected" : "";
      const swatchClass = theme.id === "WHITE" ? " settings-theme-swatch-light" : "";
      const palette = ThemeColors.getPalette(theme.id, theme.customThemeColors);
      const swatchBackground = palette["--accent-gradient"] || theme.color;
      const swatchCheckColor = theme.onColor || palette["--on-secondary"] || "#fff";
      return `
          <button class="settings-theme-card settings-content-focusable focusable${selectedClass}" role="radio" aria-checked="${selected ? "true" : "false"}"
                  data-zone="content"
                  ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
            <span class="settings-theme-swatch-wrap">
              <span class="settings-theme-swatch${swatchClass}" style="background:${escapeHtml(swatchBackground)};">
                ${selected ? `<span class="settings-theme-check-wrap" style="color:${escapeHtml(swatchCheckColor)};">${iconSvg(ROW_ICONS.check, "settings-theme-check")}</span>` : ""}
              </span>
            </span>
            <span class="settings-theme-name">${escapeHtml(translateOptionLabel(theme))}</span>
          </button>
        `;
    },
    renderLayoutCard(option, selected, focusKey) {
      return `
          <button class="settings-layout-card settings-content-focusable focusable${selected ? " is-selected" : ""}" role="radio" aria-checked="${selected ? "true" : "false"}"
                  data-zone="content"
                  ${this.registerAction(focusKey, this.actionMap.get(focusKey))}>
            ${renderLayoutPreviewPlaceholderMarkup()}
            <span class="settings-layout-preview settings-layout-preview-${escapeHtml(option.id)}">${renderLayoutPreviewMarkup(option.id)}</span>
            <span class="settings-layout-name">${escapeHtml(translateOptionLabel(option))}</span>
          </button>
        `;
    },
    renderPluginIconButton({ focusKey, icon, label, destructive = false, disabled = false, planned = false }) {
      const inert = disabled || planned;
      return `
          <button class="settings-plugin-icon-button settings-content-focusable focusable${inert ? " is-disabled" : ""}${destructive ? " is-destructive" : ""}${planned ? " is-planned" : ""}"
                  data-zone="content"
                  aria-label="${escapeHtml(label)}"
                  title="${escapeHtml(label)}"
                  ${this.registerAction(focusKey, inert ? () => {} : this.actionMap.get(focusKey))}>
            ${planned ? `<span class="settings-plugin-icon-badge">${escapeHtml(t("common.soon"))}</span>` : iconSvg(ROW_ICONS[icon], "settings-plugin-icon-symbol")}
          </button>
        `;
    },
    renderPluginRepositoryCard(addon, index) {
      const streamResourceCount = Array.isArray(addon.resources)
        ? addon.resources.filter((resource) => resource?.name === "stream").length
        : 0;
      return `
          <article class="settings-plugin-repo-card">
            <div class="settings-plugin-repo-copy">
              <div class="settings-plugin-repo-title">${escapeHtml(addon.displayName || addon.name || t("common.repository"))}</div>
              <div class="settings-plugin-repo-meta">
                ${escapeHtml(
                  t(streamResourceCount === 1 ? "settings.plugins.repoMetaSingular" : "settings.plugins.repoMetaPlural", {
                    count: streamResourceCount,
                    version: addon.version || "0.0.0"
                  })
                )}
              </div>
              <div class="settings-plugin-repo-url">${escapeHtml(addon.baseUrl || addon.description || addonKindsLabel(addon))}</div>
            </div>
            <div class="settings-plugin-repo-actions">
              ${this.renderPluginIconButton({
                focusKey: `plugins:refresh:${index}`,
                icon: "refresh",
                label: t("settings.plugins.refreshRepository")
              })}
              ${this.renderPluginIconButton({
                focusKey: `plugins:remove:${index}`,
                icon: "trash",
                label: t("settings.plugins.removeRepository"),
                destructive: true
              })}
            </div>
          </article>
        `;
    },
    openOptionDialog({
      title,
      message = "",
      messageHtml = "",
      options,
      selectedId,
      onSelect,
      returnFocusKey,
      dialogClassName = "",
      optionRenderer = "default",
      optionColumns = null,
      onRender = null,
      onClose = null
    }) {
      this.textDialog = null;
      this.optionDialog = {
        title,
        message,
        messageHtml,
        options: Array.isArray(options) ? options : [],
        selectedId: selectedId ?? null,
        onSelect,
        returnFocusKey,
        dialogClassName,
        optionRenderer,
        onRender,
        onClose,
        // Compact action dialogs can opt into multiple columns so dpad left/right
        // can move between visually adjacent options.
        optionColumns: Number.isFinite(Number(optionColumns)) ? Math.max(1, Math.trunc(Number(optionColumns))) : 1
      };
      const selectedIndex = this.optionDialog.options.findIndex((option) => String(option.id) === String(selectedId));
      this.dialogFocusIndex = clamp(selectedIndex >= 0 ? selectedIndex : 0, 0, Math.max(0, this.optionDialog.options.length - 1));
      this.focusZone = "dialog";
    },
    openMultiChoiceDialog({ title, message = "", options, selectedIds = [], onToggle, returnFocusKey, dialogClassName = "" }) {
      this.textDialog = null;
      this.optionDialog = {
        title,
        message,
        options: Array.isArray(options) ? options : [],
        selectedId: null,
        selectedIds: new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id))),
        onToggle,
        returnFocusKey,
        dialogClassName,
        optionRenderer: "multi",
        multiChoice: true,
        optionColumns: 1
      };
      this.dialogFocusIndex = 0;
      this.focusZone = "dialog";
    },
    openTextDialog({
      title,
      value = "",
      multiline = false,
      secret = false,
      inputType = "text",
      placeholder = "",
      returnFocusKey,
      saveLabel = t("common.save", {}, "Save"),
      cancelLabel = t("common.cancel", {}, "Cancel"),
      clearLabel = "",
      onClear,
      onSubmit
    }) {
      this.optionDialog = null;
      this.textDialog = {
        title,
        value: String(value ?? ""),
        draft: String(value ?? ""),
        multiline: Boolean(multiline),
        secret: Boolean(secret),
        inputType,
        placeholder,
        returnFocusKey,
        saveLabel,
        cancelLabel,
        clearLabel,
        statusMessage: "",
        statusKind: "error",
        onClear,
        onSubmit
      };
      this.dialogFocusIndex = 0;
      this.focusZone = "dialog";
    },
    closeOptionDialog() {
      if (!this.optionDialog) {
        return;
      }
      this.contentFocusKey = this.optionDialog.returnFocusKey || this.contentFocusKey;
      const onClose = this.optionDialog.onClose;
      this.optionDialog = null;
      if (typeof onClose === "function") onClose();
      this.focusZone = "content";
    },
    closeTextDialog({ restoreEditor = true } = {}) {
      if (!this.textDialog) {
        return;
      }
      this.contentFocusKey = this.textDialog.returnFocusKey || this.contentFocusKey;
      const restoreCustomThemeEditor = Boolean(restoreEditor && this.textDialog.restoreCustomThemeEditor && this.customThemeDraft);
      this.textDialog = null;
      if (restoreCustomThemeEditor) {
        this.showCustomThemeEditorDialog();
        return;
      }
      this.focusZone = "content";
    },
    dismissDialogsForAmbient() {
      this.closeOptionDialog();
      this.closeTextDialog({ restoreEditor: false });
      for (const slot of this.container?.querySelectorAll?.("[data-settings-dialog], [data-trakt-dialog]") || []) {
        slot.textContent = "";
      }
    },
    renderOptionDialog() {
      if (!this.optionDialog) {
        return "";
      }

      const dialogClassName = this.optionDialog.dialogClassName ? ` ${escapeHtml(this.optionDialog.dialogClassName)}` : "";
      const useLanguageRenderer = this.optionDialog.optionRenderer === "subtitle-language";
      const useSingleChoiceRenderer = this.optionDialog.optionRenderer === "single-choice";
      const useMultiRenderer = this.optionDialog.optionRenderer === "multi";
      const selectable = useMultiRenderer || useLanguageRenderer || useSingleChoiceRenderer || this.optionDialog.selectedId != null;
      const isP2pConsentDialog = String(this.optionDialog.dialogClassName || "") === "settings-p2p-consent-dialog";
      const messageHtml = this.optionDialog.message
        ? `<div class="settings-text-dialog-message settings-option-dialog-message${isP2pConsentDialog ? " settings-p2p-consent-message" : ""}">${escapeHtml(String(this.optionDialog.message)).replace(/\n/g, "<br>")}</div>`
        : String(this.optionDialog.messageHtml || "");

      return `
          <div class="settings-dialog-backdrop">
            <div class="settings-dialog${dialogClassName}">
              <div class="settings-dialog-title">${escapeHtml(this.optionDialog.title || t("common.selectOption"))}</div>
              ${messageHtml}
              <div class="settings-dialog-list${useLanguageRenderer ? " settings-language-dialog-list" : ""}">
                ${this.optionDialog.options
                  .map((option, index) => {
                    const optionId = String(option.id);
                    const isSelected = useMultiRenderer
                      ? this.optionDialog.selectedIds?.has?.(optionId)
                      : optionId === String(this.optionDialog.selectedId);
                    return `
                  <button class="settings-dialog-option settings-content-focusable focusable${useLanguageRenderer ? " settings-language-option" : ""}${useSingleChoiceRenderer ? " settings-single-choice-option" : ""}${isSelected ? " is-selected" : ""}"
                          data-zone="dialog"
                          data-dialog-index="${index}"
                          role="${useMultiRenderer ? "checkbox" : selectable ? "radio" : "button"}" ${selectable ? `aria-checked="${isSelected ? "true" : "false"}"` : ""}
                          data-dialog-option-id="${escapeHtml(option.id)}">
                    ${
                      useLanguageRenderer
                        ? `<span class="settings-language-option-copy">
                          <span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>
                        </span>
                        <span class="settings-language-option-meta">
                          ${
                            subtitleLanguageOptionCode(option)
                              ? `<span class="settings-language-option-code">${escapeHtml(subtitleLanguageOptionCode(option))}</span>`
                              : ""
                          }
                          ${isSelected ? `<span class="settings-language-option-check" aria-hidden="true">&#10003;</span>` : ""}
                        </span>`
                        : useMultiRenderer
                          ? `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span><span class="settings-language-option-check" aria-hidden="true">${isSelected ? "&#10003;" : ""}</span>`
                          : useSingleChoiceRenderer
                            ? `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>${isSelected ? '<span class="settings-single-choice-option-check" aria-hidden="true">&#10003;</span>' : ""}`
                            : `<span class="settings-dialog-option-label">${escapeHtml(translateOptionLabel(option))}</span>`
                    }
                  </button>
                `;
                  })
                  .join("")}
              </div>
            </div>
          </div>
        `;
    }
  };
}
