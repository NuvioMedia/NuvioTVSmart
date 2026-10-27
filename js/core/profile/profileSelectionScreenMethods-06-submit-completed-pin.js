/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods06() {
  const {
    ProfileManager,
    ProfileSyncService,
    ScreenUtils,
    NuvioDialog,
    PluginStore,
    PluginCodeStore,
    PROFILE_PIN_LENGTH,
    PROFILE_PIN_TEXT,
    t,
    keyEventToDigit,
    getDefaultProfileColor
  } = internals;

  return {
    async submitCompletedPin(pin) {
      const state = this.pinOverlayState;
      const profile = this.getPinOverlayProfile();
      if (!state || !profile || this.isPinOperationInProgress) {
        return;
      }

      this.isPinOperationInProgress = true;
      this.render();

      if (state.type === "set") {
        const success = await ProfileSyncService.setProfilePin(profile.id, pin, state.currentPin);
        this.isPinOperationInProgress = false;
        if (success) {
          this.profilePinEnabled = {
            ...this.profilePinEnabled,
            [String(profile.id)]: true
          };
          this.pinOverlayError = "";
          this.setPinActionMessage(PROFILE_PIN_TEXT.saved(profile.name));
          this.closePinOverlay({ focusKey: `profile:${profile.id}` });
          return;
        }
        this.pinOverlayError = PROFILE_PIN_TEXT.saveFailed;
        this.pinValue = "";
        this.render();
        this.triggerPinShake();
        return;
      }

      if (state.type === "verify-remove") {
        const success = await ProfileSyncService.clearProfilePin(profile.id, pin);
        this.isPinOperationInProgress = false;
        if (success) {
          this.profilePinEnabled = {
            ...this.profilePinEnabled,
            [String(profile.id)]: false
          };
          this.pinOverlayError = "";
          this.setPinActionMessage(PROFILE_PIN_TEXT.removed(profile.name));
          this.closePinOverlay({ focusKey: `profile:${profile.id}` });
          return;
        }
        this.pinOverlayError = PROFILE_PIN_TEXT.incorrectCurrent;
        this.pinValue = "";
        this.render();
        this.triggerPinShake();
        return;
      }

      const verification = await ProfileSyncService.verifyProfilePin(profile.id, pin);
      this.isPinOperationInProgress = false;
      if (!verification) {
        this.pinOverlayError = PROFILE_PIN_TEXT.verifyFailed;
        this.pinValue = "";
        this.render();
        this.triggerPinShake();
        return;
      }

      if (verification.unlocked) {
        if (state.type === "unlock") {
          this.pinOverlayError = "";
          this.isPinOperationInProgress = true;
          this.render();
          try {
            await this.activateProfile(profile.id);
          } finally {
            this.isPinOperationInProgress = false;
          }
          return;
        }
        if (state.type === "verify-change") {
          this.openPinOverlay("set", profile, pin);
          return;
        }
      }

      this.pinOverlayError =
        verification.retryAfterSeconds > 0
          ? PROFILE_PIN_TEXT.lockedRetry(verification.retryAfterSeconds)
          : state.type === "unlock"
            ? PROFILE_PIN_TEXT.invalidPin
            : PROFILE_PIN_TEXT.incorrectCurrent;
      this.pinValue = "";
      this.render();
      this.triggerPinShake();
    },
    async handleCompletedPinEntry() {
      if (this.pinValue.length !== PROFILE_PIN_LENGTH || this.isPinOperationInProgress || !this.pinOverlayState) {
        return;
      }
      if (this.pinOverlayState.type !== "set") {
        await this.submitCompletedPin(this.pinValue);
        return;
      }
      if (this.pinEntryStage === "create") {
        this.pinDraftValue = this.pinValue;
        this.pinValue = "";
        this.pinOverlayError = "";
        this.pinEntryStage = "confirm";
        this.render();
        return;
      }
      if (this.pinDraftValue === this.pinValue) {
        await this.submitCompletedPin(this.pinValue);
        return;
      }
      this.pinValue = "";
      this.pinDraftValue = "";
      this.pinEntryStage = "create";
      this.pinOverlayError = PROFILE_PIN_TEXT.mismatch;
      this.render();
      this.triggerPinShake();
    },
    async activatePinKey(value) {
      if (this.isPinOperationInProgress) {
        return;
      }
      if (value === "delete") {
        if (this.pinValue) {
          this.pinValue = this.pinValue.slice(0, -1);
          this.pinOverlayError = "";
          this.pendingFocusKey = "pin:delete";
          this.render();
        }
        return;
      }
      const digit = String(value || "");
      if (!/^\d$/.test(digit) || this.pinValue.length >= PROFILE_PIN_LENGTH) {
        return;
      }
      this.pinValue += digit;
      this.pinOverlayError = "";
      this.pendingFocusKey = `pin:${digit}`;
      this.render();
      await this.handleCompletedPinEntry();
    },
    async handlePinOverlayKeyDown(event) {
      const code = Number(event?.keyCode || 0);
      const key = String(event?.key || "");
      if (code === 8 || code === 46 || key === "Backspace" || key === "Delete") {
        event?.preventDefault?.();
        if (!this.isPinOperationInProgress && this.pinValue) {
          this.pinValue = this.pinValue.slice(0, -1);
          this.pinOverlayError = "";
          this.render();
        }
        return true;
      }
      if (code === 27 || code === 461 || code === 10009 || key === "Escape") {
        event?.preventDefault?.();
        this.closePinOverlay();
        return true;
      }
      if ([37, 38, 39, 40].includes(code)) {
        const overlayRoot = this.container?.querySelector("[data-overlay-root='pin']");
        if (overlayRoot) {
          ScreenUtils.handleDpadNavigation(event, overlayRoot, ".profile-pin-key");
        }
        return true;
      }
      if (code === 13) {
        event?.preventDefault?.();
        const focused =
          this.container?.querySelector(".profile-pin-key.focused") ||
          (document.activeElement?.matches?.(".profile-pin-key") ? document.activeElement : null);
        if (focused) {
          await this.activatePinKey(focused.dataset.pinKey);
        }
        return true;
      }
      const digit = keyEventToDigit(event);
      if (!digit || this.isPinOperationInProgress || this.pinValue.length >= PROFILE_PIN_LENGTH) {
        return false;
      }
      event?.preventDefault?.();
      this.pinValue += digit;
      this.pinOverlayError = "";
      this.render();
      await this.handleCompletedPinEntry();
      return true;
    },
    openDeleteDialog(profile) {
      if (!profile || profile.isPrimary) {
        return;
      }
      this._destroyDialogs();
      this.deleteProfileId = String(profile.id);

      this._deleteDialog = new NuvioDialog({
        title: t("profile_delete_confirm_title", {}, "Delete Profile?"),
        subtitle: t(
          "profile_delete_confirm_subtitle",
          {},
          "This will permanently delete this profile and all its data including library, watch history, and addon settings. This cannot be undone."
        ),
        widthVw: 43.75, // 420dp / 960dp screen = 43.75vw
        buttons: [
          {
            label: t("profile_delete_btn", {}, "Delete Profile"),
            key: "confirm",
            danger: true,
            onAction: () => {
              const id = this.deleteProfileId;
              this._deleteDialog = null;
              this.deleteProfileId = null;
              this.deleteProfile(id);
            }
          }
        ],
        onDismiss: () => {
          this._deleteDialog = null;
          this.closeDeleteDialog();
        }
      }).mount(document.body);
    },
    closeDeleteDialog() {
      const profileId = this.deleteProfileId;
      this.deleteProfileId = null;
      if (this._deleteDialog) {
        this._deleteDialog.destroy();
        this._deleteDialog = null;
      }
      this.pendingFocusKey = profileId ? `profile:${profileId}` : this.lastProfileFocusKey || "profile:1";
      this.restoreFocus();
    },
    async submitEditor() {
      if (!this.editorState || this.isEditorSubmitDisabled()) {
        return;
      }

      const editorState = { ...this.editorState };
      const trimmedName = String(editorState.name || "").trim();
      const focusProfileId =
        editorState.mode === "edit" ? editorState.profileId : String(ProfileManager.getNextProfileIndex(this.getVisibleProfiles()) || "");

      this.editorState = null;
      this.pendingFocusKey = `profile:${focusProfileId}`;
      this.render();

      let success = false;
      if (editorState.mode === "edit") {
        const existing = this.getProfileById(editorState.profileId);
        if (!existing) {
          await this.reloadProfiles();
          return;
        }
        success = await ProfileManager.updateProfile({
          ...existing,
          name: trimmedName,
          avatarColorHex: editorState.selectedColorHex || getDefaultProfileColor(),
          avatarId: editorState.selectedAvatarId || null,
          avatarUrl: editorState.selectedAvatarId !== editorState.baseAvatarId ? null : String(existing.avatarUrl || "").trim() || null,
          profileBackgroundId: editorState.selectedBackgroundId || null,
          profileBackgroundUrl: String(editorState.selectedBackgroundUrl || "").trim() || null
        });
      } else {
        success = await ProfileManager.createProfile({
          name: trimmedName,
          avatarColorHex: editorState.selectedColorHex || getDefaultProfileColor(),
          avatarId: editorState.selectedAvatarId || null,
          avatarUrl: null,
          profileBackgroundId: editorState.selectedBackgroundId || null,
          profileBackgroundUrl: String(editorState.selectedBackgroundUrl || "").trim() || null
        });
      }

      if (success !== false) {
        await ProfileSyncService.push();
        await this.refreshProfilePinStates();
      }
      await this.reloadProfiles(`profile:${focusProfileId}`);
    },
    async deleteProfile(profileId) {
      const profile = this.getProfileById(profileId);
      if (!profile || profile.isPrimary) {
        return;
      }

      this.deleteProfileId = null;
      this.render();

      const deleted = await ProfileManager.deleteProfile(profile.id);
      if (deleted !== false) {
        await ProfileSyncService.deleteProfileData(profile.id);
        await ProfileSyncService.push();
        await this.refreshProfilePinStates();
      }

      const remainingProfiles = await ProfileManager.getProfiles();
      const fallbackProfile =
        remainingProfiles.find((entry) => Number(entry.profileIndex || entry.id || 0) < Number(profile.profileIndex || profile.id || 0)) ||
        remainingProfiles[0] ||
        null;
      this.profiles = remainingProfiles;
      this.pendingFocusKey = fallbackProfile ? `profile:${fallbackProfile.id}` : "";
      this.render();
    },
    async reloadProfiles(focusKey = "") {
      this.profiles = await ProfileManager.getProfiles();
      await this.refreshProfilePinStates();
      this.activeProfileId = String(ProfileManager.getActiveProfileId() || this.activeProfileId || "1");
      this.pendingFocusKey = focusKey;
      this.render();
    }
  };
}
