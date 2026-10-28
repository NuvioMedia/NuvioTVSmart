/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

export function createSettingsScreenMethods09() {
  const {
    StreamBadgeSettingsStore,
    getStreamBadgePreviewSections,
    normalizeStreamBadgeChipColor,
    STREAM_BADGE_IMPORT_LIMIT,
    SECTION_META,
    t,
    escapeHtml
  } = internals;

  return {
    renderIntegrationSection(model) {
      if (this.integrationView && this.integrationView !== "hub") {
        return this.renderIntegrationDetail(model, this.integrationView);
      }
      return this.renderIntegrationHub();
    },
    renderStreamsSection(model) {
      const badgeSettings = model.streamBadgeSettings || StreamBadgeSettingsStore.get();
      const rules = badgeSettings.rules || { imports: [] };
      const imports = Array.isArray(rules.imports) ? rules.imports : [];
      const previewSourceUrl = String(this.streamBadgePreviewSourceUrl || "").trim();
      const previewImport = previewSourceUrl
        ? imports.find(
            (importItem) =>
              String(importItem?.sourceUrl || "")
                .trim()
                .toLowerCase() === previewSourceUrl.toLowerCase()
          )
        : null;

      this.actionMap.set("streams:add", () => {
        this.openTextDialog({
          title: t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
          value: "",
          placeholder: "https://...",
          returnFocusKey: "streams:add",
          onSubmit: async (value) => {
            const result = await StreamBadgeSettingsStore.importStreamBadgeRulesFromUrl(value);
            if (result.status !== "success") {
              if (this.textDialog) {
                this.textDialog.statusMessage = result.message || t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported.");
                this.textDialog.statusKind = "error";
              }
              return false;
            }
            this.streamBadgePreviewSourceUrl = result.rules?.imports?.[0]?.sourceUrl || this.streamBadgePreviewSourceUrl || null;
            return true;
          }
        });
      });

      this.actionMap.set("streams:toggle:sizeBadges", () => {
        StreamBadgeSettingsStore.setShowFileSizeBadges(!badgeSettings.showFileSizeBadges);
      });

      this.actionMap.set("streams:toggle:addonLogo", () => {
        StreamBadgeSettingsStore.setShowAddonLogo(!badgeSettings.showAddonLogo);
      });

      const badgePlacement =
        String(badgeSettings.badgePlacement || "BOTTOM")
          .trim()
          .toUpperCase() === "TOP"
          ? "TOP"
          : "BOTTOM";
      const badgePlacementOptions = [
        { id: "BOTTOM", label: t("settings_stream_badge_position_bottom", {}, "Bottom") },
        { id: "TOP", label: t("settings_stream_badge_position_top", {}, "Top") }
      ];
      this.actionMap.set("streams:badgePlacement", () => {
        this.openOptionDialog({
          title: t("settings_stream_badge_position_dialog_title", {}, "Badge position"),
          subtitle: t("settings_stream_badge_position_dialog_description", {}, "Select where stream badges appear on stream cards."),
          options: badgePlacementOptions,
          selectedId: badgePlacement,
          returnFocusKey: "streams:badgePlacement",
          onSelect: (option) => StreamBadgeSettingsStore.setBadgePlacement(option.id)
        });
      });

      this.actionMap.set("streams:preview:close", () => {
        this.streamBadgePreviewSourceUrl = null;
      });

      imports.forEach((importItem, index) => {
        const focusKey = `streams:import:${index}`;
        this.actionMap.set(focusKey, () => {
          const sourceUrl = String(importItem?.sourceUrl || "").trim();
          const options = [];
          if (imports.length > 1 && !importItem.isActive) {
            options.push({ id: "activate", label: "Activate" });
          }
          options.push({ id: "edit", label: "Edit URL" });
          options.push({ id: "preview", label: "Preview" });
          options.push({ id: "delete", label: "Delete" });
          options.push({ id: "cancel", labelKey: "action_cancel", label: "Cancel" });
          this.openOptionDialog({
            title: sourceUrl || t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
            options,
            selectedId: "preview",
            returnFocusKey: focusKey,
            onSelect: async (option) => {
              if (option.id === "activate") {
                StreamBadgeSettingsStore.setActiveStreamBadgeRulesSource(sourceUrl);
                this.streamBadgePreviewSourceUrl = sourceUrl;
                return true;
              }
              if (option.id === "preview") {
                this.streamBadgePreviewSourceUrl = sourceUrl;
                return true;
              }
              if (option.id === "delete") {
                StreamBadgeSettingsStore.deleteStreamBadgeRulesSource(sourceUrl);
                if (previewSourceUrl && previewSourceUrl.toLowerCase() === sourceUrl.toLowerCase()) {
                  this.streamBadgePreviewSourceUrl = null;
                }
                return true;
              }
              if (option.id === "edit") {
                this.openTextDialog({
                  title: t("settings_fusion_badge_url_label", {}, "Fusion badge JSON URL"),
                  value: sourceUrl,
                  placeholder: "https://...",
                  returnFocusKey: focusKey,
                  onSubmit: async (nextValue) => {
                    const trimmed = String(nextValue || "").trim();
                    if (!trimmed) {
                      if (this.textDialog) {
                        this.textDialog.statusMessage = "Enter a badge JSON URL.";
                        this.textDialog.statusKind = "error";
                      }
                      return false;
                    }
                    if (trimmed.toLowerCase() === sourceUrl.toLowerCase()) {
                      return true;
                    }
                    const result = await StreamBadgeSettingsStore.importStreamBadgeRulesFromUrl(trimmed);
                    if (result.status !== "success") {
                      if (this.textDialog) {
                        this.textDialog.statusMessage =
                          result.message || t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported.");
                        this.textDialog.statusKind = "error";
                      }
                      return false;
                    }
                    StreamBadgeSettingsStore.deleteStreamBadgeRulesSource(sourceUrl);
                    this.streamBadgePreviewSourceUrl = result.rules?.imports?.[0]?.sourceUrl || trimmed;
                    return true;
                  }
                });
                return true;
              }
              return true;
            }
          });
        });
      });

      this.actionMap.set("streams:toggle:playerBadges", () => {
        StreamBadgeSettingsStore.setShowInPlayer(!badgeSettings.showInPlayer);
      });
      const playerBadgeOptions = [
        { id: "", label: t("settings_player_badges_use_stream_pack", {}, "Use stream badge pack") },
        ...imports.map((entry) => ({ id: entry.sourceUrl, label: entry.sourceUrl }))
      ];
      this.actionMap.set("streams:playerBadgeSource", () => {
        this.openOptionDialog({
          title: t("settings_player_badges_pack_title", {}, "Player badge pack"),
          options: playerBadgeOptions,
          selectedId: badgeSettings.playerBadgeSource || "",
          returnFocusKey: "streams:playerBadgeSource",
          onSelect: (option) => StreamBadgeSettingsStore.setPlayerBadgeSource(option.id)
        });
      });

      const previewHtml = previewImport ? this.renderStreamBadgePreviewCard(previewImport) : "";
      const emptyHtml = imports.length
        ? ""
        : `<p class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badges_empty", {}, "No Fusion badge URLs imported."))}</p>`;

      return `
          ${this.renderSectionHeader(SECTION_META.find((item) => item.id === "streams"))}
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-stack">
              ${this.renderToggleRow({
                focusKey: "streams:toggle:playerBadges",
                title: t("settings_player_badges_title", {}, "Badges in player"),
                subtitle: t("settings_player_badges_description", {}, "Show badges for the playing video and selected audio track."),
                checked: badgeSettings.showInPlayer === true
              })}
              ${this.renderActionRow({
                focusKey: "streams:playerBadgeSource",
                title: t("settings_player_badges_pack_title", {}, "Player badge pack"),
                subtitle: t(
                  "settings_player_badges_pack_description",
                  {},
                  "Choose an imported pack for the player independently of stream cards."
                ),
                value:
                  playerBadgeOptions.find((option) => option.id === badgeSettings.playerBadgeSource)?.label || playerBadgeOptions[0].label
              })}
              ${this.renderToggleRow({
                focusKey: "streams:toggle:sizeBadges",
                title: t("settings_stream_size_badges_title", {}, "Size badges"),
                subtitle: t(
                  "settings_stream_size_badges_description",
                  {},
                  "Show file size badges in stream results and player source panels."
                ),
                checked: badgeSettings.showFileSizeBadges !== false
              })}
              ${this.renderToggleRow({
                focusKey: "streams:toggle:addonLogo",
                title: t("settings_stream_addon_logo_title", {}, "Addon logo"),
                subtitle: t("settings_stream_addon_logo_description", {}, "Show addon logo and name next to stream sources."),
                checked: badgeSettings.showAddonLogo === true
              })}
              ${this.renderActionRow({
                focusKey: "streams:badgePlacement",
                title: t("settings_stream_badge_position_title", {}, "Badge position"),
                subtitle: t(
                  "settings_stream_badge_position_description",
                  {},
                  "Choose whether Fusion and size badges appear above or below stream cards."
                ),
                value: badgePlacementOptions.find((option) => option.id === badgePlacement)?.label || badgePlacementOptions[0].label
              })}
              ${this.renderActionRow({
                focusKey: "streams:add",
                title: t("settings_stream_badge_urls_title", {}, "Fusion badge URLs"),
                subtitle: t(
                  "settings_stream_badge_urls_description",
                  [STREAM_BADGE_IMPORT_LIMIT],
                  `Import up to ${STREAM_BADGE_IMPORT_LIMIT} Fusion-style stream badge JSON URLs.`
                ),
                value: t("action_import", {}, "Import")
              })}
              ${imports
                .map((importItem, index) => {
                  const sourceUrl = String(importItem?.sourceUrl || "").trim();
                  const enabledCount = Array.isArray(importItem?.filters)
                    ? importItem.filters.filter((filter) => filter?.isEnabled !== false).length
                    : 0;
                  const groupCount = Array.isArray(importItem?.groups) ? importItem.groups.length : 0;
                  const statusLabel =
                    importItem?.isActive === false
                      ? t("settings_fusion_badge_url_inactive", {}, "Inactive")
                      : t("settings_fusion_badge_url_active", {}, "Active");
                  const summary = t(
                    "settings_fusion_badge_url_status_summary",
                    [statusLabel, enabledCount, groupCount],
                    `${statusLabel}, ${enabledCount} enabled badges, ${groupCount} groups`
                  );
                  return this.renderActionRow({
                    focusKey: `streams:import:${index}`,
                    title: sourceUrl || `Badge URL ${index + 1}`,
                    subtitle: summary,
                    value: statusLabel
                  });
                })
                .join("")}
              ${emptyHtml}
            </div>
          </div>
          ${previewHtml}
        `;
    },
    renderStreamBadgePreviewCard(importItem) {
      const sections = getStreamBadgePreviewSections(importItem);
      const badgeCount = sections.reduce((total, section) => total + (Array.isArray(section.filters) ? section.filters.length : 0), 0);
      const sourceUrl = String(importItem?.sourceUrl || "").trim();
      const bodyHtml = sections.length
        ? sections
            .map(
              (section) => `
              <div class="settings-stream-badge-preview-section">
                <div class="settings-row-title">${escapeHtml(
                  section.id === "other" ? t("settings_fusion_badge_other_group_title", {}, "Other Fusion badges") : section.title
                )}</div>
                <div class="stream-route-card-badges">
                  ${(section.filters || [])
                    .filter((filter) => String(filter?.imageURL || "").trim())
                    .map((filter) => {
                      const filled =
                        String(filter?.tagStyle || "")
                          .trim()
                          .toLowerCase() === "filled";
                      const background = filled ? normalizeStreamBadgeChipColor(filter?.tagColor) : "";
                      const border = normalizeStreamBadgeChipColor(filter?.borderColor);
                      const textColor = normalizeStreamBadgeChipColor(filter?.textColor);
                      const style = [
                        background ? `background:${background};` : "",
                        border ? `border-color:${border};` : "",
                        textColor ? `color:${textColor};` : ""
                      ].join("");
                      return `
            <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
              <img src="${escapeHtml(filter?.imageURL || "")}" alt="${escapeHtml(filter?.name || "")}" loading="lazy" />
            </span>
          `;
                    })
                    .join("")}
                </div>
              </div>
            `
            )
            .join("")
        : `<p class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badge_preview_empty", {}, "No Fusion-style badge images in this URL."))}</p>`;

      this.actionMap.set("streams:preview:close", () => {
        this.streamBadgePreviewSourceUrl = null;
      });

      return `
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-stack">
              <div class="settings-row-title">${escapeHtml(t("settings_fusion_badge_preview_title", {}, "Fusion badge preview"))}</div>
              <div class="settings-row-subtitle">${escapeHtml(sourceUrl)}</div>
              <div class="settings-row-subtitle">${escapeHtml(t("settings_fusion_badge_preview_count", [badgeCount], `${badgeCount} Fusion-style badges from this URL`))}</div>
              ${bodyHtml}
              ${this.renderActionRow({
                focusKey: "streams:preview:close",
                title: t("common.close", {}, "Close"),
                subtitle: "",
                value: ""
              })}
            </div>
          </div>
        `;
    }
  };
}
