/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods05() {
  const {
    Router,
    NuvioDialog,
    PROFILE_HOLD_DELAY_MS,
    PROFILE_PIN_OPEN_MS,
    PROFILE_PIN_CLOSE_MS,
    PROFILE_PIN_TEXT,
    t,
    getDefaultProfileColor
  } = internals;

  return {
    syncEditorPreview() {
      if (!this.editorState) {
        return;
      }

      const previewName = String(this.editorState.name || "").trim() || "Profile name";
      const previewNameNode = this.container.querySelector("[data-role='editor-preview-name']");
      if (previewNameNode) {
        previewNameNode.textContent = previewName;
        previewNameNode.classList.toggle("is-placeholder", !String(this.editorState.name || "").trim());
      }

      const submitButton = this.container.querySelector("[data-action='submit-editor']");
      if (submitButton) {
        const disabled = this.isEditorSubmitDisabled();
        submitButton.disabled = disabled;
        submitButton.classList.toggle("is-disabled", disabled);
      }
    },
    isEditorSubmitDisabled() {
      return !String(this.editorState?.name || "").trim();
    },
    openCreateEditor() {
      this.optionsProfileId = null;
      this.deleteProfileId = null;
      this.editorState = {
        mode: "create",
        profileId: null,
        originalName: "",
        originalAvatarUrl: null,
        name: "",
        selectedColorHex: "#1E88E5",
        selectedAvatarId: null,
        baseAvatarId: null,
        baseColorHex: "#1E88E5",
        originalBackgroundUrl: null,
        baseBackgroundId: null,
        baseBackgroundUrl: null,
        selectedBackgroundId: null,
        selectedBackgroundUrl: null,
        category: "all",
        editorTab: "avatar",
        focusedAvatarName: null,
        copySourceProfileId: null,
        copyProviderCredentials: false
      };
      this.pendingFocusKey = "editor:name";
      this.render();
    },
    openEditEditor(profile) {
      if (!profile) {
        return;
      }
      this.optionsProfileId = null;
      this.deleteProfileId = null;
      this.editorState = {
        mode: "edit",
        profileId: String(profile.id),
        originalName: String(profile.name || ""),
        originalAvatarUrl: String(profile.avatarUrl || "").trim() || null,
        name: String(profile.name || ""),
        selectedColorHex: String(profile.avatarColorHex || getDefaultProfileColor()),
        selectedAvatarId: profile.avatarId || null,
        baseAvatarId: profile.avatarId || null,
        baseColorHex: String(profile.avatarColorHex || getDefaultProfileColor()),
        originalBackgroundUrl: String(profile.profileBackgroundUrl || "").trim() || null,
        baseBackgroundId: profile.profileBackgroundId || null,
        baseBackgroundUrl: String(profile.profileBackgroundUrl || "").trim() || null,
        selectedBackgroundId: profile.profileBackgroundId || null,
        selectedBackgroundUrl: String(profile.profileBackgroundUrl || "").trim() || null,
        category: "all",
        editorTab: "avatar",
        focusedAvatarName: null
      };
      this.pendingFocusKey = "editor:name";
      this.render();
    },
    closeEditor() {
      this.editorState = null;
      this.pendingFocusKey = this.lastProfileFocusKey || "profile:1";
      this.render();
    },
    async openOptionsDialog(profile) {
      const mountToken = this.mountToken;
      await this.initialProfileSync;
      if (!this.isMounted || this.mountToken !== mountToken) return;
      profile = this.getProfileById(profile?.id);
      if (!profile) {
        return;
      }
      // Destroy any existing dialogs
      this._destroyDialogs();

      this.optionsProfileId = String(profile.id);
      const pinEnabled = this.isProfilePinEnabled(profile.id);

      const buttons = [
        {
          label: t("profile_edit_label", {}, "Edit"),
          key: "edit",
          onAction: () => {
            this._optionsDialog?.destroy();
            this._optionsDialog = null;
            this.openEditEditor(this.getProfileById(profile.id));
          }
        },
        {
          label: pinEnabled ? PROFILE_PIN_TEXT.change : PROFILE_PIN_TEXT.set,
          key: "pin",
          onAction: () => {
            this._optionsDialog?.destroy();
            this._optionsDialog = null;
            const p = this.getProfileById(profile.id);
            if (p) this.openPinOverlay(this.isProfilePinEnabled(p.id) ? "verify-change" : "set", p);
          }
        },
        ...(pinEnabled
          ? [
              {
                label: PROFILE_PIN_TEXT.remove,
                key: "remove-pin",
                onAction: () => {
                  this._optionsDialog?.destroy();
                  this._optionsDialog = null;
                  const p = this.getProfileById(profile.id);
                  if (p) this.openPinOverlay("verify-remove", p);
                }
              }
            ]
          : []),
        ...(this.getVisibleProfiles().length > 1
          ? [
              {
                label: t("profile_copy_settings_label", {}, "Copy Settings"),
                key: "copy-settings",
                onAction: () => {
                  this._optionsDialog?.destroy();
                  this._optionsDialog = null;
                  this.openProfileCopySourceDialog(this.getProfileById(profile.id));
                }
              }
            ]
          : []),
        ...(!profile.isPrimary
          ? [
              {
                label: t("profile_delete", {}, "Delete"),
                key: "delete",
                danger: true,
                onAction: () => {
                  this._optionsDialog?.destroy();
                  this._optionsDialog = null;
                  this.openDeleteDialog(this.getProfileById(profile.id));
                }
              }
            ]
          : [])
      ];

      this._optionsDialog = new NuvioDialog({
        title: t("profile_selection_options_title", {}, "Profile Options"),
        widthVw: 37.5, // 360dp / 960dp screen = 37.5vw
        suppressEnterUntilKeyUp: true,
        buttons,
        onDismiss: () => {
          this._optionsDialog = null;
          this.optionsProfileId = null;
          this.pendingFocusKey = `profile:${profile.id}`;
          this.restoreFocus();
        }
      }).mount(document.body);
      this.suppressHoldMenuEnterUntilKeyUp = true;
    },
    canHoldManageProfile(node) {
      return (
        !this.isManagementMode &&
        Boolean(node?.matches?.(".profile-card.focused, .profile-card")) &&
        String(node?.dataset?.profileId || "") !== "add"
      );
    },
    cancelPendingProfileHold() {
      if (this.pendingProfileHoldTimer) {
        clearTimeout(this.pendingProfileHoldTimer);
        this.pendingProfileHoldTimer = null;
      }
      this.pendingProfileHoldTarget = null;
    },
    hasPendingProfileHold(node) {
      const pending = this.pendingProfileHoldTarget;
      if (!pending || !node) {
        return false;
      }
      return String(node.dataset.profileId || "") === String(pending.profileId || "");
    },
    startPendingProfileHold(node) {
      const profileId = String(node?.dataset?.profileId || "");
      if (!profileId || profileId === "add") {
        return false;
      }
      this.cancelPendingProfileHold();
      this.pendingProfileHoldTarget = {
        profileId,
        holdTriggered: false
      };
      this.pendingProfileHoldTimer = setTimeout(() => {
        this.pendingProfileHoldTimer = null;
        const pending = this.pendingProfileHoldTarget;
        if (!pending || Router.getCurrent() !== "profileSelection") {
          return;
        }
        const current = this.container?.querySelector(".profile-card.focused") || null;
        if (!this.hasPendingProfileHold(current)) {
          return;
        }
        const profile = this.getProfileById(pending.profileId);
        if (!profile) {
          return;
        }
        pending.holdTriggered = true;
        this.openOptionsDialog(profile);
      }, PROFILE_HOLD_DELAY_MS);
      return true;
    },
    async completePendingProfileHold(node, event = null) {
      const pending = this.pendingProfileHoldTarget;
      if (!pending) {
        return false;
      }
      const holdTriggered = Boolean(pending.holdTriggered);
      const heldLongEnough = Number(event?.keyDownDurationMs || 0) >= PROFILE_HOLD_DELAY_MS;
      const shouldOpenHoldMenu = !holdTriggered && heldLongEnough && this.hasPendingProfileHold(node);
      const profile = shouldOpenHoldMenu ? this.getProfileById(pending.profileId) : null;
      this.cancelPendingProfileHold();
      if (holdTriggered || shouldOpenHoldMenu) {
        if (shouldOpenHoldMenu && profile) {
          this.openOptionsDialog(profile);
        }
        return true;
      }
      if (!node) {
        return false;
      }
      await this.activateFocusedNode(node);
      return true;
    },
    closeOptionsDialog() {
      const profileId = this.optionsProfileId;
      this.optionsProfileId = null;
      if (this._optionsDialog) {
        this._optionsDialog.destroy();
        this._optionsDialog = null;
      }
      this.pendingFocusKey = profileId ? `profile:${profileId}` : this.lastProfileFocusKey || "profile:1";
      this.restoreFocus();
    },
    openPinOverlay(type, profile, currentPin = null) {
      if (!profile) {
        return;
      }
      if (this.pinTransitionTimer) {
        clearTimeout(this.pinTransitionTimer);
        this.pinTransitionTimer = null;
      }
      this.pinTransitionCallback = null;
      this.editorState = null;
      this.optionsProfileId = null;
      this.deleteProfileId = null;
      this.pinOverlayState = {
        type,
        profileId: String(profile.id),
        currentPin: currentPin ? String(currentPin) : null
      };
      this.pinOverlayRenderState = this.pinOverlayState;
      this.pinOverlayPhase = "opening";
      this.pinOverlayError = "";
      this.pinEntryStage = "create";
      this.pinValue = "";
      this.pinDraftValue = "";
      this.pendingFocusKey = "pin:1";
      this.render();
      this.pinTransitionTimer = setTimeout(() => {
        this.pinTransitionTimer = null;
        if (!this.pinOverlayState) {
          return;
        }
        this.pinOverlayRenderState = this.pinOverlayState;
        this.pinOverlayPhase = "open";
        this.render();
      }, PROFILE_PIN_OPEN_MS);
    },
    closePinOverlay({ focusKey = "", afterClose = null } = {}) {
      if (this.pinOverlayPhase === "closing") {
        return;
      }
      const renderState = this.pinOverlayState || this.pinOverlayRenderState;
      const profileId = renderState?.profileId;
      if (!renderState) {
        return;
      }
      if (this.pinTransitionTimer) {
        clearTimeout(this.pinTransitionTimer);
        this.pinTransitionTimer = null;
      }
      this.pinTransitionCallback = typeof afterClose === "function" ? afterClose : null;
      this.pinOverlayState = null;
      this.pinOverlayRenderState = renderState;
      this.pinOverlayPhase = "closing";
      this.isPinOperationInProgress = false;
      this.pendingFocusKey = focusKey || (profileId ? `profile:${profileId}` : this.lastProfileFocusKey || "profile:1");
      this.render();
      this.pinTransitionTimer = setTimeout(async () => {
        const callback = this.pinTransitionCallback;
        this.pinTransitionTimer = null;
        this.pinTransitionCallback = null;
        this.pinOverlayRenderState = null;
        this.pinOverlayPhase = "closed";
        this.pinOverlayError = "";
        this.pinEntryStage = "create";
        this.pinValue = "";
        this.pinDraftValue = "";
        this.render();
        if (callback) {
          await callback();
        }
      }, PROFILE_PIN_CLOSE_MS);
    },
    setPinActionMessage(message) {
      if (this.pinActionMessageTimer) {
        clearTimeout(this.pinActionMessageTimer);
        this.pinActionMessageTimer = null;
      }
      this.pinActionMessage = String(message || "");
      if (!this.pinActionMessage) {
        this.render();
        return;
      }
      this.render();
      this.pinActionMessageTimer = setTimeout(() => {
        this.pinActionMessageTimer = null;
        this.pinActionMessage = "";
        this.render();
      }, 2600);
    },
    triggerPinShake() {
      const row = this.container?.querySelector("[data-role='pin-box-row']");
      if (!row) {
        return;
      }
      row.classList.remove("is-shaking");
      void row.offsetWidth;
      row.classList.add("is-shaking");
    }
  };
}
