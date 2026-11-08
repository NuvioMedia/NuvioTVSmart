/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods02() {
  const { PROFILE_PIN_LENGTH, t, getDefaultProfileColor, escapeHtml, getProfileInitial, categoryLabel, getAvatarCategories } = internals;

  return {
    renderEditorOverlay() {
      if (!this.editorState) {
        return "";
      }

      const editorTitle =
        this.editorState.mode === "edit" ? t("profile_edit_label", {}, "Edit") : t("profile_create_title", {}, "Create Profile");
      const editorButtonLabel = this.editorState.mode === "edit" ? t("profile_save", {}, "Save") : t("profile_create_btn", {}, "Create");
      const previewName = String(this.editorState.name || "").trim() || t("profile_name_placeholder", {}, "Profile name");
      const selectedAvatar = this.getEditorSelectedAvatar();
      const hasChangedAvatarSelection = this.editorState.selectedAvatarId !== this.editorState.baseAvatarId;
      const previewAvatarUrl =
        selectedAvatar?.imageUrl ||
        (!hasChangedAvatarSelection
          ? String(this.editorState.originalAvatarUrl || "").trim() || this.getAvatarImageUrl(this.editorState.baseAvatarId) || null
          : null);
      const hasBackgroundTab = Boolean(this.hasProfileBackgroundAccess);
      const editorTab = hasBackgroundTab && this.editorState.editorTab === "background" ? "background" : "avatar";
      const copySourceProfile = this.getProfileById(this.editorState.copySourceProfileId);
      const copySourceLabel = copySourceProfile
        ? String(copySourceProfile.name || `Profile ${copySourceProfile.id}`)
        : t("profile_copy_settings_start_fresh", {}, "Start fresh");
      const previewBackgroundUrl = this.getEditorBackgroundPreviewUrl();
      const overlayHeading =
        this.editorState.mode === "edit"
          ? `
              <div class="profile-editor-heading-stack">
                <span class="profile-editor-heading-kicker">${escapeHtml(editorTitle)}</span>
                <span class="profile-editor-heading-name">${escapeHtml(this.editorState.originalName || previewName)}</span>
              </div>
            `
          : `<span class="profile-editor-heading-title">${escapeHtml(editorTitle)}</span>`;
      const categories = getAvatarCategories(this.avatarCatalog);
      const filteredAvatars = this.getFilteredEditorAvatars();
      const selectedBackgroundId = String(this.editorState.selectedBackgroundId || "");
      const selectedBackgroundUrl = String(this.editorState.selectedBackgroundUrl || "").trim();
      const backgroundOptions = [
        {
          id: "normal",
          label: t("profile_background_normal", {}, "Default"),
          imageUrl: null,
          selected: !selectedBackgroundId && !selectedBackgroundUrl
        },
        ...(String(this.editorState.baseBackgroundUrl || "").trim()
          ? [
              {
                id: "custom",
                label: t("profile_background_custom", {}, "Custom URL"),
                imageUrl: String(this.editorState.baseBackgroundUrl || "").trim(),
                selected: !selectedBackgroundId && Boolean(selectedBackgroundUrl)
              }
            ]
          : []),
        ...this.profileBackgroundCatalog.map((background) => ({
          id: background.id,
          label: background.displayName,
          imageUrl: background.imageUrl,
          selected: !selectedBackgroundUrl && selectedBackgroundId === background.id
        }))
      ];

      return `
          <div class="profile-editor-backdrop" data-action="dismiss-overlay">
            <div class="profile-editor-panel" data-overlay-root="editor">
              <div class="profile-editor-header">
                ${overlayHeading}
                <button class="profile-overlay-button profile-overlay-button-primary profile-overlay-focusable${this.isEditorSubmitDisabled() ? " is-disabled" : ""}"
                        type="button"
                        data-action="submit-editor"
                        data-focus-key="editor:submit"
                        ${this.isEditorSubmitDisabled() ? "disabled" : ""}
                        tabindex="0">
                  ${escapeHtml(editorButtonLabel)}
                </button>
              </div>

              <div class="profile-editor-body">
                <div class="profile-editor-preview">
                  ${
                    previewBackgroundUrl
                      ? `<div class="profile-editor-preview-background"><img src="${escapeHtml(previewBackgroundUrl)}" alt="" aria-hidden="true"/></div>`
                      : ""
                  }
                  <div class="profile-editor-preview-avatar" style="background:${escapeHtml(this.editorState.selectedColorHex || getDefaultProfileColor())}">
                    ${
                      previewAvatarUrl
                        ? `<img class="profile-editor-preview-image" src="${escapeHtml(previewAvatarUrl)}" alt="${escapeHtml(previewName)}"/>`
                        : escapeHtml(getProfileInitial(String(this.editorState.name || "").trim()))
                    }
                  </div>

                  <div class="profile-editor-preview-name${String(this.editorState.name || "").trim() ? "" : " is-placeholder"}" data-role="editor-preview-name">${escapeHtml(previewName)}</div>

                  <label class="profile-editor-field-shell">
                    <span class="sr-only">${escapeHtml(t("profile_name_placeholder", {}, "Profile name"))}</span>
                    <input class="profile-editor-name-input profile-overlay-focusable"
                           type="text"
                           maxlength="20"
                           value="${escapeHtml(this.editorState.name || "")}"
                           placeholder="${escapeHtml(t("profile_name_placeholder", {}, "Profile name"))}"
                           data-role="editor-name-input"
                           data-focus-key="editor:name"
                           tabindex="0"/>
                  </label>

                  ${
                    this.editorState.mode === "create" && this.getVisibleProfiles().length > 0
                      ? `<button class="profile-overlay-button profile-overlay-focusable"
                          type="button"
                          data-action="select-copy-source"
                          data-focus-key="editor:copy-source"
                          tabindex="0">
                    <span>${escapeHtml(t("profile_copy_settings_from", {}, "Copy settings from"))}</span>
                    <span class="profile-editor-copy-source-value">${escapeHtml(copySourceLabel)}</span>
                  </button>`
                      : ""
                  }

                  <button class="profile-overlay-button profile-overlay-button-primary profile-overlay-focusable"
                          type="button"
                          data-action="cancel-editor"
                          data-focus-key="editor:cancel"
                          tabindex="0">
                    ${escapeHtml(t("profile_cancel", {}, "Cancel"))}
                  </button>
                </div>

                <div class="profile-editor-divider" aria-hidden="true"></div>

                <div class="profile-editor-picker-pane">
                  ${
                    hasBackgroundTab
                      ? `<div class="profile-editor-tabs" role="tablist">
                        <button class="profile-editor-tab profile-overlay-focusable${editorTab === "avatar" ? " is-selected" : ""}"
                                type="button" role="tab" aria-selected="${editorTab === "avatar" ? "true" : "false"}"
                                data-action="select-editor-tab" data-editor-tab="avatar"
                                data-focus-key="editor:tab:avatar" tabindex="0">
                          ${escapeHtml(t("profile_editor_tab_avatar", {}, "Avatar"))}
                        </button>
                        <button class="profile-editor-tab profile-overlay-focusable${editorTab === "background" ? " is-selected" : ""}"
                                type="button" role="tab" aria-selected="${editorTab === "background" ? "true" : "false"}"
                                data-action="select-editor-tab" data-editor-tab="background"
                                data-focus-key="editor:tab:background" tabindex="0">
                          ${escapeHtml(t("profile_editor_tab_background", {}, "Background"))}
                        </button>
                      </div>`
                      : ""
                  }

                  ${
                    editorTab === "avatar"
                      ? `
                    <div class="profile-editor-avatar-pane">
                      <div class="profile-editor-avatar-title">${escapeHtml(t("profile_choose_avatar", {}, "Choose Avatar"))}</div>

                      <div class="profile-editor-category-row">
                        ${categories
                          .map(
                            (category) => `
                          <button class="profile-avatar-category profile-overlay-focusable${this.editorState.category === category ? " is-selected" : ""}"
                                  type="button"
                                  data-action="select-avatar-category"
                                  data-category="${escapeHtml(category)}"
                                  data-focus-key="editor:category:${escapeHtml(category)}"
                                  tabindex="0">
                            ${escapeHtml(categoryLabel(category))}
                          </button>
                        `
                          )
                          .join("")}
                      </div>

                      ${
                        filteredAvatars.length
                          ? `
                        <div class="profile-editor-avatar-grid">
                          ${filteredAvatars
                            .map(
                              (avatar) => `
                            <button class="profile-avatar-tile profile-overlay-focusable${this.editorState.selectedAvatarId === avatar.id ? " is-selected" : ""}"
                                    type="button"
                                    data-action="select-avatar"
                                    data-avatar-id="${escapeHtml(avatar.id)}"
                                    data-focus-key="editor:avatar:${escapeHtml(avatar.id)}"
                                    tabindex="0">
                              <img class="profile-avatar-tile-image" src="${escapeHtml(avatar.imageUrl)}" alt="${escapeHtml(avatar.displayName)}"/>
                            </button>
                          `
                            )
                            .join("")}
                        </div>
                      `
                          : `
                        <div class="profile-editor-avatar-empty">
                          ${escapeHtml(t("profile_choose_avatar", {}, "Choose Avatar"))}
                        </div>
                      `
                      }

                      <div class="profile-editor-avatar-hint${this.editorState.focusedAvatarName ? " has-name" : ""}" data-role="editor-avatar-hint">
                        ${escapeHtml(this.editorState.focusedAvatarName || t("profile_avatar_focus_hint", {}, "Focus an avatar to view its name"))}
                      </div>
                    </div>
                  `
                      : `
                    <div class="profile-editor-background-pane">
                      <div class="profile-editor-avatar-title">${escapeHtml(t("profile_choose_background", {}, "Choose Background"))}</div>
                      <div class="profile-editor-background-note">${escapeHtml(t("profile_background_member_note", {}, "Supporter backgrounds are available with an active membership."))}</div>
                      <div class="profile-background-grid">
                        ${backgroundOptions
                          .map(
                            (background) => `
                          <button class="profile-background-tile profile-overlay-focusable${background.selected ? " is-selected" : ""}"
                                  type="button"
                                  data-action="select-background"
                                  data-background-id="${escapeHtml(background.id)}"
                                  data-focus-key="editor:background:${escapeHtml(background.id)}"
                                  tabindex="0">
                            <span class="profile-background-tile-media${background.imageUrl ? " has-image" : ""}">
                              ${
                                background.imageUrl
                                  ? `<img src="${escapeHtml(background.imageUrl)}" alt="${escapeHtml(background.label)}"/>`
                                  : ""
                              }
                            </span>
                            <span class="profile-background-tile-label">${escapeHtml(background.label)}</span>
                          </button>
                        `
                          )
                          .join("")}
                      </div>
                    </div>
                  `
                  }
                </div>
              </div>
            </div>
          </div>
        `;
    },
    getPinOverlayProfile() {
      const profileId = this.pinOverlayState?.profileId || this.pinOverlayRenderState?.profileId;
      return this.getProfileById(profileId);
    },
    getRenderedPinOverlayState() {
      return this.pinOverlayRenderState || this.pinOverlayState;
    },
    renderPinBoxes() {
      const isError = Boolean(this.pinOverlayError);
      return Array.from({ length: PROFILE_PIN_LENGTH }, (_, index) => {
        const isFilled = index < this.pinValue.length;
        const isActive =
          index === Math.min(this.pinValue.length, PROFILE_PIN_LENGTH - 1) &&
          this.pinValue.length < PROFILE_PIN_LENGTH &&
          !this.isPinOperationInProgress;
        return `
            <span class="profile-pin-box${isFilled ? " is-filled" : ""}${isActive ? " is-active" : ""}${isError ? " is-error" : ""}" aria-hidden="true">
              <span class="profile-pin-dot"></span>
              <span class="profile-pin-cursor"></span>
            </span>
          `;
      }).join("");
    },
    renderPinKeypad() {
      const deleteIcon = `
          <svg
            class="profile-pin-delete-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false">
            <path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"></path>
            <path d="m11 9 6 6m0-6-6 6"></path>
          </svg>
        `;
      const keys = [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
        { value: "5", label: "5" },
        { value: "6", label: "6" },
        { value: "7", label: "7" },
        { value: "8", label: "8" },
        { value: "9", label: "9" },
        { value: "delete", label: deleteIcon, ariaLabel: "Delete digit", isIcon: true },
        { value: "0", label: "0" }
      ];
      return keys
        .map(
          ({ value, label, ariaLabel = label, isIcon = false }) => `
              <button
                class="profile-pin-key focusable"
                type="button"
                data-pin-key="${escapeHtml(value)}"
                data-focus-key="pin:${escapeHtml(value)}"
                aria-label="${escapeHtml(ariaLabel)}"
                tabindex="0">${isIcon ? label : escapeHtml(label)}</button>
            `
        )
        .join("");
    }
  };
}
