/* eslint-disable no-unused-vars */
import * as internals from "./profileSelectionScreen.js";

export function createProfileSelectionScreenMethods03() {
  const { PROFILE_PIN_TEXT, getDefaultProfileColor, escapeHtml, centerAvatarRowInScrollContainer, findNearestByHorizontalCenter } =
    internals;

  return {
    renderPinOverlay() {
      const state = this.getRenderedPinOverlayState();
      const profile = this.getPinOverlayProfile();
      if (!state || !profile) {
        return "";
      }
      const phaseClass =
        this.pinOverlayPhase === "closing" ? " is-closing" : this.pinOverlayPhase === "opening" ? " is-opening" : " is-open";

      const isSingleEntryMode = state.type !== "set";
      let heading = PROFILE_PIN_TEXT.headingSet(profile.name);
      let support = PROFILE_PIN_TEXT.supportSet;

      if (state.type === "unlock") {
        heading = PROFILE_PIN_TEXT.headingUnlock(profile.name);
        support = PROFILE_PIN_TEXT.supportUnlock;
      } else if (state.type === "verify-change") {
        heading = PROFILE_PIN_TEXT.headingVerifyChange(profile.name);
        support = PROFILE_PIN_TEXT.supportVerifyChange;
      } else if (state.type === "verify-remove") {
        heading = PROFILE_PIN_TEXT.headingVerifyRemove(profile.name);
        support = PROFILE_PIN_TEXT.supportVerifyRemove;
      } else if (state.type === "verify-delete") {
        heading = PROFILE_PIN_TEXT.headingVerifyDelete(profile.name);
        support = PROFILE_PIN_TEXT.supportVerifyDelete;
      } else if (this.pinEntryStage === "confirm") {
        heading = PROFILE_PIN_TEXT.headingConfirm;
        support = PROFILE_PIN_TEXT.supportConfirm;
      }

      if (this.pinOverlayError) {
        support = this.pinOverlayError;
      } else if (this.isPinOperationInProgress) {
        support = isSingleEntryMode ? PROFILE_PIN_TEXT.verifying : PROFILE_PIN_TEXT.saving;
      }

      return `
          <div class="profile-pin-layer${phaseClass}">
            <div class="profile-pin-overlay profile-focusable focusable" data-overlay-root="pin" data-focus-key="pin:root" tabindex="0">
              <div class="profile-pin-content">
                <div class="profile-pin-heading">${escapeHtml(heading)}</div>
                <div class="profile-pin-box-row" data-role="pin-box-row">${this.renderPinBoxes()}</div>
                <div class="profile-pin-support${this.pinOverlayError ? " is-error" : ""}">${escapeHtml(support)}</div>
                <div class="profile-pin-keypad" aria-label="PIN keypad">${this.renderPinKeypad()}</div>
                ${isSingleEntryMode ? `<div class="profile-pin-forgot">${escapeHtml(PROFILE_PIN_TEXT.forgot)}</div>` : ""}
                <div class="profile-pin-back-hint">${escapeHtml(PROFILE_PIN_TEXT.back)}</div>
              </div>
            </div>
          </div>
        `;
    },
    renderPinActionToast() {
      if (!this.pinActionMessage) {
        return "";
      }
      return `
          <div class="profile-pin-toast" role="status" aria-live="polite">
            ${escapeHtml(this.pinActionMessage)}
          </div>
        `;
    },
    bindEvents() {
      const gridCards = Array.from(this.container.querySelectorAll(".profile-card"));
      gridCards.forEach((card) => {
        card.addEventListener("focus", () => this.handleFocusableFocus(card));
        card.addEventListener("click", async () => {
          await this.activateFocusedNode(card);
        });
      });

      Array.from(this.container.querySelectorAll(".profile-overlay-focusable")).forEach((node) => {
        node.addEventListener("focus", () => this.handleFocusableFocus(node));
        node.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (this.shouldIgnoreKeyboardClick(node)) {
            event.preventDefault();
            return;
          }
          await this.activateFocusedNode(node);
        });
      });

      const pinOverlay = this.container.querySelector(".profile-pin-overlay");
      if (pinOverlay) {
        pinOverlay.addEventListener("focus", () => this.handleFocusableFocus(pinOverlay));
        pinOverlay.addEventListener("click", (event) => {
          event.stopPropagation();
          pinOverlay.focus();
        });
      }

      Array.from(this.container.querySelectorAll(".profile-pin-key")).forEach((node) => {
        node.addEventListener("focus", () => this.handleFocusableFocus(node));
        node.addEventListener("click", async (event) => {
          event.stopPropagation();
          await this.activatePinKey(node.dataset.pinKey);
        });
      });

      const nameInput = this.container.querySelector("[data-role='editor-name-input']");
      if (nameInput) {
        nameInput.addEventListener("input", (event) => {
          const nextValue = String(event.target?.value || "").slice(0, 20);
          this.editorState.name = nextValue;
          if (event.target.value !== nextValue) {
            event.target.value = nextValue;
          }
          this.syncEditorPreview();
        });
      }

      const editorBackdrop = this.container.querySelector(".profile-editor-backdrop");
      if (editorBackdrop) {
        editorBackdrop.addEventListener("click", (event) => {
          if (event.target === editorBackdrop) {
            this.closeEditor();
          }
        });
      }

      const pinBackdrop = this.container.querySelector(".profile-pin-layer");
      if (pinBackdrop && pinOverlay) {
        pinBackdrop.addEventListener("click", (event) => {
          if (event.target === pinBackdrop) {
            pinOverlay.focus();
          }
        });
      }
    },
    handleFocusableFocus(node) {
      const previousFocused = this.focusedNode;
      if (previousFocused && previousFocused !== node && previousFocused.isConnected) {
        previousFocused.classList.remove("focused");
      } else if (!previousFocused || previousFocused !== node) {
        Array.from(
          this.container.querySelectorAll(
            ".profile-focusable.focused, .profile-overlay-focusable.focused, .profile-pin-overlay.focused, .profile-pin-key.focused"
          )
        ).forEach((entry) => {
          if (entry !== node) {
            entry.classList.remove("focused");
          }
        });
      }
      node.classList.add("focused");
      this.focusedNode = node;
      this.focusKey = String(node.dataset.focusKey || "");

      const profileId = node.dataset.profileId;
      const avatarId = node.dataset.avatarId;
      const category = node.dataset.category;

      if (profileId && profileId !== "add") {
        const profile = this.getProfileById(profileId);
        if (profile) {
          this.lastProfileFocusKey = `profile:${profile.id}`;
          this.updateBackground(profile.avatarColorHex || getDefaultProfileColor());
          this.updateProfileBackground(profile);
        }
      } else if (profileId === "add") {
        this.lastProfileFocusKey = "profile:add";
        this.updateBackground("#555555");
        this.updateProfileBackground(null);
      }

      if (avatarId && this.editorState) {
        const avatar = this.avatarCatalog.find((entry) => entry.id === avatarId) || null;
        this.editorState.focusedAvatarName = avatar?.displayName || null;
        const hintNode = this.container.querySelector("[data-role='editor-avatar-hint']");
        if (hintNode) {
          hintNode.textContent = this.editorState.focusedAvatarName || "Focus an avatar to view its name";
          hintNode.classList.toggle("has-name", Boolean(this.editorState.focusedAvatarName));
        }
        const gridNode = node.closest(".profile-editor-avatar-grid");
        const avatarButtons = Array.from(gridNode?.querySelectorAll("[data-action='select-avatar']") || []);
        centerAvatarRowInScrollContainer(node, gridNode, avatarButtons, "smooth");
      }

      if (category) {
        node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    },
    restoreFocus() {
      const defaultFocusKey = this.getDefaultFocusKey();
      const target = this.findFocusableByKey(this.pendingFocusKey || defaultFocusKey || this.focusKey);
      this.pendingFocusKey = "";
      if (!target) {
        const fallback = this.container.querySelector(
          ".profile-pin-key, .profile-pin-overlay, .profile-card, .profile-overlay-focusable, .profile-dialog-button"
        );
        if (!fallback) {
          return;
        }
        fallback.classList.add("focused");
        fallback.focus();
        return;
      }
      target.classList.add("focused");
      target.focus();
    },
    getDefaultFocusKey() {
      if (this.pinOverlayState) {
        return "pin:1";
      }
      if (this.editorState) {
        return "editor:name";
      }
      if (this.lastProfileFocusKey) {
        return this.lastProfileFocusKey;
      }
      if (this.focusKey) {
        return this.focusKey;
      }
      return `profile:${this.activeProfileId || "1"}`;
    },
    findFocusableByKey(focusKey) {
      if (!focusKey) {
        return null;
      }
      return (
        Array.from(this.container.querySelectorAll("[data-focus-key]")).find(
          (node) => String(node.dataset.focusKey || "") === String(focusKey)
        ) || null
      );
    },
    rememberKeyboardActivation(node) {
      const focusKey = String(node?.dataset?.focusKey || "");
      if (!focusKey) {
        this.lastKeyboardActivation = null;
        return;
      }
      this.lastKeyboardActivation = {
        focusKey,
        at: Date.now()
      };
    },
    shouldIgnoreKeyboardClick(node) {
      const suppressedFocusClick = this.suppressedFocusClick;
      if (suppressedFocusClick && Date.now() - Number(suppressedFocusClick.at || 0) <= 400) {
        if (String(node?.dataset?.focusKey || "") === String(suppressedFocusClick.focusKey || "")) {
          this.suppressedFocusClick = null;
          return true;
        }
      }
      this.suppressedFocusClick = null;
      const recentActivation = this.lastKeyboardActivation;
      this.lastKeyboardActivation = null;
      if (!recentActivation) {
        return false;
      }
      if (Date.now() - Number(recentActivation.at || 0) > 300) {
        return false;
      }
      return String(node?.dataset?.focusKey || "") === String(recentActivation.focusKey || "");
    },
    suppressNextFocusClick(focusKey) {
      const normalizedFocusKey = String(focusKey || "");
      if (!normalizedFocusKey) {
        this.suppressedFocusClick = null;
        return;
      }
      this.suppressedFocusClick = {
        focusKey: normalizedFocusKey,
        at: Date.now()
      };
    },
    getEditorNavigationState() {
      const overlayRoot = this.container?.querySelector("[data-overlay-root='editor']");
      if (!overlayRoot) {
        return null;
      }
      return {
        overlayRoot,
        submitButton: overlayRoot.querySelector("[data-focus-key='editor:submit']"),
        nameInput: overlayRoot.querySelector("[data-focus-key='editor:name']"),
        copySourceButton: overlayRoot.querySelector("[data-focus-key='editor:copy-source']"),
        cancelButton: overlayRoot.querySelector("[data-focus-key='editor:cancel']"),
        tabButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-editor-tab']")),
        categoryButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-avatar-category']")),
        avatarButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-avatar']")),
        backgroundButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-background']"))
      };
    },
    getPreferredEditorTabButton(navigationState) {
      return (
        navigationState?.tabButtons?.find((node) => node.classList.contains("is-selected")) || navigationState?.tabButtons?.[0] || null
      );
    },
    getPreferredEditorContentButton(navigationState, referenceNode = null) {
      const isBackgroundTab = this.editorState?.editorTab === "background";
      const candidates = isBackgroundTab ? navigationState?.backgroundButtons || [] : navigationState?.avatarButtons || [];
      return (
        candidates.find((node) => node.classList.contains("is-selected")) ||
        findNearestByHorizontalCenter(referenceNode, candidates) ||
        candidates[0] ||
        null
      );
    },
    getPreferredEditorCategoryButton(navigationState) {
      return (
        navigationState?.categoryButtons.find((node) => node.classList.contains("is-selected")) ||
        navigationState?.categoryButtons[0] ||
        null
      );
    },
    getEditorCategoryButtonForAvatar(navigationState, avatarId) {
      const avatar = this.avatarCatalog.find((entry) => entry.id === avatarId) || null;
      const avatarCategory = String(avatar?.category || "")
        .trim()
        .toLowerCase();
      if (!avatarCategory) {
        return null;
      }
      return navigationState?.categoryButtons.find((node) => String(node.dataset.category || "") === avatarCategory) || null;
    }
  };
}
