import { Router } from "../../ui/navigation/router.js";
import { MAX_PROFILES, ProfileManager } from "../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../core/profile/profileSyncService.js";
import { StartupSyncService } from "../../core/profile/startupSyncService.js";
import { ScreenUtils } from "../../ui/navigation/screen.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";
import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";
import { ProfileBackgroundRepository } from "../../data/remote/supabase/profileBackgroundRepository.js";
import { ThemeManager } from "../../ui/theme/themeManager.js";
import { renderMemberBrandWordmark } from "../../ui/components/memberBrandWordmark.js";
import { I18n } from "../../i18n/index.js";
import { NuvioDialog } from "../../ui/components/nuvioDialog.js";
import { detailWatchedEnrichmentService } from "../../data/repository/detailWatchedEnrichmentService.js";
import { resolveExperienceRoute } from "./experienceModeRouting.js";
import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

const PINNED_AVATAR_CATEGORIES = ["anime", "animation", "tv", "movie", "gaming"];
const DEFAULT_PROFILE_COLOR = "#f5f5f5";
const PROFILE_HOLD_DELAY_MS = 650;
const PROFILE_PIN_LENGTH = 4;
const PROFILE_PIN_OPEN_MS = 320;
const PROFILE_PIN_CLOSE_MS = 240;
const PROFILE_BACKGROUND_ANIMATION_MS = 520;
const PROFILE_PIN_TEXT = {
  set: "Set PIN",
  change: "Change PIN",
  remove: "Remove PIN",
  headingSet: (name) => `Create a 4-digit PIN for ${name}.`,
  headingUnlock: (name) => `Enter your PIN to access ${name}.`,
  headingConfirm: "Confirm your new PIN.",
  headingVerifyChange: (name) => `Enter current PIN to change PIN for ${name}.`,
  headingVerifyRemove: (name) => `Enter current PIN to remove lock for ${name}.`,
  supportSet: "This PIN will be required before opening this profile.",
  supportUnlock: "Use your remote or keyboard to enter 4 digits.",
  supportConfirm: "Re-enter the same 4 digits to finish setup.",
  supportVerifyChange: "Enter the current 4-digit PIN before setting a new one.",
  supportVerifyRemove: "Enter the current 4-digit PIN to remove this lock.",
  mismatch: "PINs did not match. Enter a new PIN again.",
  forgot: "Forgot PIN? Reset it from your Nuvio account on nuvio website.",
  back: "Press back to cancel",
  verifying: "Verifying…",
  saving: "Saving…",
  saved: (name) => `PIN saved for ${name}.`,
  removed: (name) => `PIN lock removed for ${name}.`,
  saveFailed: "Could not save PIN. Try again.",
  verifyFailed: "Could not verify PIN. Try again.",
  invalidPin: "Invalid PIN. Try again.",
  incorrectCurrent: "Current PIN is incorrect.",
  lockedRetry: (seconds) => `Profile is locked. Try again in ${seconds}s.`
};

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function keyEventToDigit(event) {
  const key = String(event?.key || "");
  if (/^\d$/.test(key)) {
    return key;
  }
  const keyName = String(event?.keyName || "");
  if (/^\d$/.test(keyName)) {
    return keyName;
  }
  const codeName = String(event?.code || "");
  const codeNameMatch = codeName.match(/^(?:Digit|Numpad)(\d)$/);
  if (codeNameMatch) {
    return codeNameMatch[1];
  }
  const codes = [Number(event?.keyCode || event?.which || 0), Number(event?.originalKeyCode || 0)];
  const standardCode = codes.find((code) => code >= 48 && code <= 57);
  if (standardCode != null) {
    return String(standardCode - 48);
  }
  const numpadCode = codes.find((code) => code >= 96 && code <= 105);
  if (numpadCode != null) {
    return String(numpadCode - 96);
  }
  return null;
}

function getDefaultProfileColor() {
  const value = globalThis?.document
    ? getComputedStyle(document.documentElement).getPropertyValue("--secondary-color").trim()
    : "";
  return value || DEFAULT_PROFILE_COLOR;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProfileInitial(name) {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function resolveProfileAvatarUrl(profile, avatarUrlResolver) {
  const avatarUrl = String(profile?.avatarUrl || "").trim();
  if (avatarUrl) {
    return avatarUrl;
  }
  return avatarUrlResolver(profile?.avatarId);
}

const centeredScrollAnimations = new WeakMap();

function animateScrollTop(container, clampedTarget, duration = 220) {
  if (!container) {
    return;
  }
  if (typeof requestAnimationFrame !== "function") {
    container.scrollTop = clampedTarget;
    return;
  }
  const existing = centeredScrollAnimations.get(container);
  if (existing) {
    cancelAnimationFrame(existing);
  }
  const startTop = container.scrollTop;
  const delta = clampedTarget - startTop;
  if (Math.abs(delta) < 1) {
    container.scrollTop = clampedTarget;
    return;
  }
  const startTime = performance.now();
  const step = (now) => {
    const elapsed = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 4);
    container.scrollTop = startTop + delta * eased;
    if (elapsed < 1) {
      centeredScrollAnimations.set(container, requestAnimationFrame(step));
    } else {
      centeredScrollAnimations.delete(container);
    }
  };
  centeredScrollAnimations.set(container, requestAnimationFrame(step));
}

function centerAvatarRowInScrollContainer(node, container, siblingNodes, behavior = "smooth") {
  if (!node || !container) {
    return;
  }
  const rows = buildVisualRows(siblingNodes || []);
  const row = rows.find((entry) => entry.nodes.includes(node));
  if (!row) {
    return;
  }
  const rowRects = row.nodes.map((entry) => entry.getBoundingClientRect());
  const rowTop = Math.min(...rowRects.map((rect) => rect.top));
  const rowBottom = Math.max(...rowRects.map((rect) => rect.bottom));
  const rowHeight = rowBottom - rowTop;
  const containerRect = container.getBoundingClientRect();
  const targetTop =
    container.scrollTop + (rowTop - containerRect.top) - (containerRect.height - rowHeight) / 2;
  const clampedTarget = Math.max(0, targetTop);
  if (behavior !== "smooth") {
    container.scrollTop = clampedTarget;
    return;
  }
  if (Math.abs(clampedTarget - container.scrollTop) < 8) {
    container.scrollTop = clampedTarget;
    return;
  }
  animateScrollTop(container, clampedTarget, 120);
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(colorHex, fallback = { r: 30, g: 136, b: 229 }) {
  const value = String(colorHex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return fallback;
  }
  const normalized = match[1];
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function mixColors(baseColor, accentColor, weight) {
  const normalizedWeight = Math.min(1, Math.max(0, Number(weight) || 0));
  return {
    r: clampChannel(baseColor.r * (1 - normalizedWeight) + accentColor.r * normalizedWeight),
    g: clampChannel(baseColor.g * (1 - normalizedWeight) + accentColor.g * normalizedWeight),
    b: clampChannel(baseColor.b * (1 - normalizedWeight) + accentColor.b * normalizedWeight)
  };
}

function colorToRgba(color, alpha = 1) {
  const normalizedAlpha = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${normalizedAlpha})`;
}

function colorsEqual(left, right) {
  return (
    Boolean(left) &&
    Boolean(right) &&
    clampChannel(left.r) === clampChannel(right.r) &&
    clampChannel(left.g) === clampChannel(right.g) &&
    clampChannel(left.b) === clampChannel(right.b)
  );
}

// ATV tween() default easing is FastOutSlowIn = cubic-bezier(0.4, 0.0, 0.2, 1.0).
function fastOutSlowIn(t) {
  const cx = 1.2;
  const bx = -0.6;
  const ax = 0.4;
  const cy = 0;
  const by = 3;
  const ay = -2;
  let s = t;
  for (let i = 0; i < 6; i += 1) {
    const x = ((ax * s + bx) * s + cx) * s - t;
    const dx = (3 * ax * s + 2 * bx) * s + cx;
    if (Math.abs(dx) < 1e-6) break;
    s -= x / dx;
  }
  return ((ay * s + by) * s + cy) * s;
}

function categoryLabel(category) {
  switch (String(category || "").toLowerCase()) {
    case "all":
      return "All";
    case "anime":
      return "Anime";
    case "animation":
      return "Animation";
    case "movie":
      return "Movie";
    case "tv":
      return "TV";
    case "gaming":
      return "Gaming";
    case "supporter":
      return t("profile_avatar_category_supporter", {}, "Supporter");
    default:
      return String(category || "Other").replace(/^./, (match) => match.toUpperCase());
  }
}

function getAvatarCategories(avatars) {
  const avatarEntries = Array.isArray(avatars) ? avatars : [];
  const hasMemberAvatars = avatarEntries.some((avatar) => Boolean(avatar?.memberOnly));
  const normalizedCategories = avatarEntries
    .filter((avatar) => !avatar?.memberOnly)
    .map((avatar) =>
      String(avatar?.category || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  const uniqueCategories = Array.from(new Set(normalizedCategories));
  const categories = [
    "all",
    ...PINNED_AVATAR_CATEGORIES.filter((category) => uniqueCategories.includes(category)),
    ...uniqueCategories
      .filter(
        (category) => category !== "supporter" && !PINNED_AVATAR_CATEGORIES.includes(category)
      )
      .sort((left, right) => left.localeCompare(right))
  ];
  if (hasMemberAvatars) {
    categories.push("supporter");
  }
  return categories;
}

function isTextInput(node) {
  if (!node) {
    return false;
  }
  const tagName = String(node.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea";
}

function getNodeHorizontalCenter(node) {
  const rect = node?.getBoundingClientRect?.();
  if (!rect) {
    return 0;
  }
  return rect.left + rect.width / 2;
}

function findNearestByHorizontalCenter(referenceNode, candidates) {
  const nodes = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (!referenceNode || !nodes.length) {
    return null;
  }
  const referenceCenter = getNodeHorizontalCenter(referenceNode);
  return (
    nodes
      .map((node) => ({
        node,
        distance: Math.abs(getNodeHorizontalCenter(node) - referenceCenter)
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.node || null
  );
}

function buildVisualRows(nodes, tolerance = 18) {
  const rows = [];
  (Array.isArray(nodes) ? nodes : []).filter(Boolean).forEach((node) => {
    const rect = node.getBoundingClientRect();
    const existingRow = rows.find((entry) => Math.abs(entry.top - rect.top) <= tolerance);
    if (existingRow) {
      existingRow.nodes.push(node);
      return;
    }
    rows.push({
      top: rect.top,
      nodes: [node]
    });
  });
  rows.sort((left, right) => left.top - right.top);
  rows.forEach((row) => {
    row.nodes.sort(
      (left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left
    );
  });
  return rows;
}

export const ProfileSelectionScreen = {
  async mount(params = {}) {
    this.container = document.getElementById("profileSelection");
    if (!this.container) {
      console.error("Missing #profileSelection container");
      return;
    }

    this.container.style.display = "block";
    this.screenMode = String(params?.mode || "selection").toLowerCase();
    this.returnRoute = String(params?.returnRoute || "");
    this.isManagementMode = this.screenMode === "management";
    this.activeProfileId = String(ProfileManager.getActiveProfileId() || "1");
    this.focusKey = "";
    this.focusedNode = null;
    this.pendingFocusKey = "";
    this.lastProfileFocusKey = "profile:1";
    this.optionsProfileId = null;
    this.deleteProfileId = null;
    this._optionsDialog = null;
    this._deleteDialog = null;
    this.editorState = null;
    this.pinOverlayState = null;
    this.pinOverlayRenderState = null;
    this.pinOverlayPhase = "closed";
    this.pinOverlayError = "";
    this.pinActionMessage = "";
    this.pinEntryStage = "create";
    this.pinValue = "";
    this.pinDraftValue = "";
    this.profilePinEnabled = {};
    this.isPinOperationInProgress = false;
    this.pinActionMessageTimer = null;
    this.pinTransitionTimer = null;
    this.pinTransitionCallback = null;
    this.suppressedFocusClick = null;
    this.avatarCatalog = [];
    this.profileBackgroundCatalog = [];
    this.memberAccess = MemberAccessRepository.getCurrentAccess();
    this.hasProfileAvatarAccess = false;
    this.hasProfileBackgroundAccess = false;
    this.memberAccessUnsubscribe = null;
    this.profileBackgroundUnsubscribe = null;
    this.isMounted = true;
    this.lastKeyboardActivation = null;
    this.suppressHoldMenuEnterUntilKeyUp = false;
    this.isActivatingProfile = false;
    this.activatingProfileId = "";
    this._bgScreen = null;
    this._bgThemeColors = null;
    this._bgTargetColor = null;

    const skipInitialProfileSync = Boolean(params?.skipInitialProfileSync);
    const profilePinEnabled = skipInitialProfileSync
      ? params?.profilePinEnabled || {}
      : (
          await Promise.all([ProfileSyncService.pull(), ProfileSyncService.pullProfileLockStates()])
        )[1];
    this.profiles = await ProfileManager.getProfiles();
    this.profilePinEnabled = profilePinEnabled;
    this.lastProfileFocusKey = `profile:${this.activeProfileId || "1"}`;
    globalThis.NuvioBootGuard?.stage?.("Loading profile avatars");
    await this.refreshMemberFeatures({ render: false });
    this.memberAccessUnsubscribe = MemberAccessRepository.subscribe((access) => {
      this.memberAccess = access;
      if (!this.isMounted || !this.profiles) {
        return;
      }
      void this.refreshMemberFeatures({ render: true });
    });
    this.profileBackgroundUnsubscribe = ProfileBackgroundRepository.subscribe((catalog) => {
      this.profileBackgroundCatalog = Array.isArray(catalog) ? catalog : [];
      if (!this.isMounted) {
        return;
      }
      if (this.editorState) {
        this.render();
      } else {
        this.updateProfileBackground(this.getFocusedProfile());
      }
    });
    this.render();
  },

  async loadAvatarCatalog(hasMemberAccess = this.hasProfileAvatarAccess) {
    try {
      this.avatarCatalog = await AvatarRepository.getAvatarCatalog(Boolean(hasMemberAccess));
    } catch (error) {
      console.warn("Failed to load avatar catalog", error);
      this.avatarCatalog = [];
    }
    this.avatarImageUrlsById = this.avatarCatalog.reduce((accumulator, avatar) => {
      accumulator[avatar.id] = avatar.imageUrl;
      return accumulator;
    }, {});
  },

  async refreshMemberFeatures({ render = false } = {}) {
    const previousBackgroundAccess = Boolean(this.hasProfileBackgroundAccess);
    const access = await MemberAccessRepository.getAccess().catch(() => this.memberAccess);
    this.memberAccess = access;
    this.hasProfileAvatarAccess = MemberAccessRepository.hasEntitlement(access, "PROFILE_AVATARS");
    this.hasProfileBackgroundAccess = MemberAccessRepository.hasEntitlement(
      access,
      "PROFILE_BACKGROUNDS"
    );
    await this.loadAvatarCatalog(this.hasProfileAvatarAccess);
    if (this.hasProfileBackgroundAccess) {
      this.profileBackgroundCatalog = await ProfileBackgroundRepository.ensureLoaded();
      const selectedId = this.getFocusedProfile()?.profileBackgroundId || null;
      void ProfileBackgroundRepository.loadSelectedAndPreload(selectedId);
    } else {
      if (previousBackgroundAccess || this.profileBackgroundCatalog.length) {
        ProfileBackgroundRepository.invalidateCache();
      }
      this.profileBackgroundCatalog = [];
    }
    if (render && this.isMounted) {
      this.render();
    }
  },

  getProfileById(profileId) {
    return (
      (this.profiles || []).find((profile) => String(profile.id) === String(profileId)) || null
    );
  },

  getFocusedProfile() {
    const focusedProfileId = this.focusedNode?.dataset?.profileId;
    return (
      this.getProfileById(focusedProfileId) ||
      this.getProfileById(this.activeProfileId) ||
      this.getVisibleProfiles()[0] ||
      null
    );
  },

  getProfileBackgroundImageUrl(profile) {
    if (!this.hasProfileBackgroundAccess || !profile) {
      return null;
    }
    const customUrl = String(profile.profileBackgroundUrl || "").trim();
    return customUrl || ProfileBackgroundRepository.getImageUrl(profile.profileBackgroundId);
  },

  getVisibleProfiles() {
    return Array.isArray(this.profiles) ? this.profiles : [];
  },

  async refreshProfilePinStates() {
    this.profilePinEnabled = await ProfileSyncService.pullProfileLockStates();
  },

  isProfilePinEnabled(profileId) {
    const normalizedId = String(profileId || "");
    return Boolean(
      this.profilePinEnabled?.[normalizedId] || this.profilePinEnabled?.[Number(normalizedId)]
    );
  },

  getAvatarImageUrl(avatarId) {
    const normalizedId = String(avatarId || "").trim();
    if (!normalizedId) {
      return null;
    }
    return this.avatarImageUrlsById?.[normalizedId] || null;
  },

  getEditorSelectedAvatar() {
    if (!this.editorState?.selectedAvatarId) {
      return null;
    }
    return (
      this.avatarCatalog.find((avatar) => avatar.id === this.editorState.selectedAvatarId) || null
    );
  },

  getEditorSelectedBackground() {
    const selectedId = String(this.editorState?.selectedBackgroundId || "").trim();
    if (!selectedId) {
      return null;
    }
    return this.profileBackgroundCatalog.find((background) => background.id === selectedId) || null;
  },

  getEditorBackgroundPreviewUrl() {
    const customUrl = String(this.editorState?.selectedBackgroundUrl || "").trim();
    return customUrl || this.getEditorSelectedBackground()?.imageUrl || null;
  },

  getFilteredEditorAvatars() {
    const category = String(this.editorState?.category || "all");
    if (category === "all") {
      return this.avatarCatalog;
    }
    if (category.toLowerCase() === "supporter") {
      return this.avatarCatalog.filter((avatar) => Boolean(avatar.memberOnly));
    }
    return this.avatarCatalog.filter(
      (avatar) =>
        !avatar.memberOnly && String(avatar.category || "").toLowerCase() === category.toLowerCase()
    );
  },

  render() {
    const visibleProfiles = this.getVisibleProfiles();
    const canAddProfile = visibleProfiles.length < MAX_PROFILES;
    const totalItems = visibleProfiles.length + (canAddProfile ? 1 : 0);
    const gridClass = totalItems >= 5 ? "profile-grid profile-grid-compact" : "profile-grid";
    const title = this.isManagementMode
      ? t("profile_manage_title", {}, "Manage Profiles")
      : t("profile_selection_title", {}, "Who's watching?");
    const subtitle = this.isManagementMode
      ? t("profile_manage_subtitle", {}, "Select a profile to edit, switch, or create a new one")
      : t("profile_selection_subtitle", {}, "Select a profile to continue");
    const hint = this.isManagementMode
      ? t("profile_manage_hint", {}, "Select a profile to manage")
      : t("profile_selection_hint", {}, "Hold to manage profile");
    const renderedPinState = this.getRenderedPinOverlayState();
    const isPinActive = Boolean(renderedPinState);
    const pinScreenPhaseClass = isPinActive
      ? ` is-pin-${escapeHtml(this.pinOverlayPhase || "open")}`
      : "";
    const compactGridScreenClass = totalItems >= 5 ? " profile-screen-compact-grid" : "";

    this.container.innerHTML = `
      <div class="profile-screen${pinScreenPhaseClass}${compactGridScreenClass}">
        <div class="profile-screen-background" data-role="profile-screen-background" aria-hidden="true"></div>
        <div class="profile-main-layer"${isPinActive ? ' aria-hidden="true"' : ""}>
          ${renderMemberBrandWordmark({
            access: this.memberAccess,
            imageClass: "profile-logo",
            wrapperClass: "profile-brand-lockup"
          })}

          <h1 class="profile-title">${escapeHtml(title)}</h1>
          <p class="profile-subtitle">${escapeHtml(subtitle)}</p>

          <div class="${gridClass}" id="profileGrid" data-profile-item-count="${totalItems}">
            ${visibleProfiles.map((profile) => this.renderProfileCard(profile)).join("")}
            ${canAddProfile ? this.renderAddProfileCard() : ""}
          </div>

          <p class="profile-hint">${escapeHtml(hint)}</p>
        </div>
        ${this.renderPinOverlay()}
      </div>
      ${this.renderEditorOverlay()}
      ${this.renderPinActionToast()}
    `;

    this.bindEvents();
    if (renderedPinState) {
      const pinProfile = this.getPinOverlayProfile();
      if (pinProfile?.avatarColorHex) {
        this.updateBackground(pinProfile.avatarColorHex);
      }
    }
    this.restoreFocus();
    this.updateProfileBackground(this.getFocusedProfile());
  },

  renderProfileCard(profile) {
    const avatarUrl = resolveProfileAvatarUrl(profile, (avatarId) =>
      this.getAvatarImageUrl(avatarId)
    );
    return `
      <div class="profile-card profile-focusable focusable"
           data-profile-id="${escapeHtml(profile.id)}"
           data-focus-key="profile:${escapeHtml(profile.id)}"
           tabindex="0">
        <div class="profile-avatar-ring">
          <div class="profile-avatar" style="background:${escapeHtml(profile.avatarColorHex || getDefaultProfileColor())}">
            ${
              avatarUrl
                ? `<img class="profile-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(profile.name)}"/>`
                : escapeHtml(getProfileInitial(profile.name))
            }
          </div>
          ${profile.isPrimary ? `<span class="profile-primary-dot" aria-hidden="true">&#9733;</span>` : ""}
        </div>
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        ${profile.isPrimary ? `<div class="profile-badge">${escapeHtml(t("profile_selection_primary_badge", {}, "PRIMARY"))}</div>` : `<div class="profile-badge-slot" aria-hidden="true"></div>`}
      </div>
    `;
  },

  renderAddProfileCard() {
    return `
      <div class="profile-card profile-card-add profile-focusable focusable"
           data-profile-id="add"
           data-focus-key="profile:add"
           tabindex="0">
        <div class="profile-avatar-ring">
          <div class="profile-avatar profile-avatar-add" aria-hidden="true"></div>
        </div>
        <div class="profile-name">${escapeHtml(t("profile_add_new", {}, "Add Profile"))}</div>
        <div class="profile-badge-slot" aria-hidden="true"></div>
      </div>
    `;
  },

  renderEditorOverlay() {
    if (!this.editorState) {
      return "";
    }

    const editorTitle =
      this.editorState.mode === "edit"
        ? t("profile_edit_label", {}, "Edit")
        : t("profile_create_title", {}, "Create Profile");
    const editorButtonLabel =
      this.editorState.mode === "edit"
        ? t("profile_save", {}, "Save")
        : t("profile_create_btn", {}, "Create");
    const previewName =
      String(this.editorState.name || "").trim() ||
      t("profile_name_placeholder", {}, "Profile name");
    const selectedAvatar = this.getEditorSelectedAvatar();
    const hasChangedAvatarSelection =
      this.editorState.selectedAvatarId !== this.editorState.baseAvatarId;
    const previewAvatarUrl =
      selectedAvatar?.imageUrl ||
      (!hasChangedAvatarSelection
        ? String(this.editorState.originalAvatarUrl || "").trim() ||
          this.getAvatarImageUrl(this.editorState.baseAvatarId) ||
          null
        : null);
    const hasBackgroundTab = Boolean(this.hasProfileBackgroundAccess);
    const editorTab =
      hasBackgroundTab && this.editorState.editorTab === "background" ? "background" : "avatar";
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
  },

  renderPinOverlay() {
    const state = this.getRenderedPinOverlayState();
    const profile = this.getPinOverlayProfile();
    if (!state || !profile) {
      return "";
    }
    const phaseClass =
      this.pinOverlayPhase === "closing"
        ? " is-closing"
        : this.pinOverlayPhase === "opening"
          ? " is-opening"
          : " is-open";

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
        hintNode.textContent =
          this.editorState.focusedAvatarName || "Focus an avatar to view its name";
        hintNode.classList.toggle("has-name", Boolean(this.editorState.focusedAvatarName));
      }
      const gridNode = node.closest(".profile-editor-avatar-grid");
      const avatarButtons = Array.from(
        gridNode?.querySelectorAll("[data-action='select-avatar']") || []
      );
      centerAvatarRowInScrollContainer(node, gridNode, avatarButtons, "smooth");
    }

    if (category) {
      node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  },

  restoreFocus() {
    const defaultFocusKey = this.getDefaultFocusKey();
    const target = this.findFocusableByKey(
      this.pendingFocusKey || defaultFocusKey || this.focusKey
    );
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
      cancelButton: overlayRoot.querySelector("[data-focus-key='editor:cancel']"),
      tabButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-editor-tab']")),
      categoryButtons: Array.from(
        overlayRoot.querySelectorAll("[data-action='select-avatar-category']")
      ),
      avatarButtons: Array.from(overlayRoot.querySelectorAll("[data-action='select-avatar']")),
      backgroundButtons: Array.from(
        overlayRoot.querySelectorAll("[data-action='select-background']")
      )
    };
  },

  getPreferredEditorTabButton(navigationState) {
    return (
      navigationState?.tabButtons?.find((node) => node.classList.contains("is-selected")) ||
      navigationState?.tabButtons?.[0] ||
      null
    );
  },

  getPreferredEditorContentButton(navigationState, referenceNode = null) {
    const isBackgroundTab = this.editorState?.editorTab === "background";
    const candidates = isBackgroundTab
      ? navigationState?.backgroundButtons || []
      : navigationState?.avatarButtons || [];
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
    return (
      navigationState?.categoryButtons.find(
        (node) => String(node.dataset.category || "") === avatarCategory
      ) || null
    );
  },

  getPreferredEditorAvatarButton(navigationState, referenceNode = null) {
    const avatarButtons = navigationState?.avatarButtons || [];
    if (!avatarButtons.length) {
      return null;
    }
    return (
      avatarButtons.find((node) => node.classList.contains("is-selected")) ||
      findNearestByHorizontalCenter(referenceNode, avatarButtons) ||
      avatarButtons[0] ||
      null
    );
  },

  getAvatarGridPosition(navigationState, node) {
    const rows = buildVisualRows(navigationState?.avatarButtons || []);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const columnIndex = rows[rowIndex].nodes.indexOf(node);
      if (columnIndex !== -1) {
        return {
          rows,
          rowIndex,
          columnIndex,
          rowNodes: rows[rowIndex].nodes
        };
      }
    }
    return null;
  },

  moveEditorFocus(event, overlayRoot) {
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 38
        ? "up"
        : code === 40
          ? "down"
          : code === 37
            ? "left"
            : code === 39
              ? "right"
              : null;
    if (!direction) {
      return false;
    }

    const navigationState = this.getEditorNavigationState();
    if (!navigationState) {
      return false;
    }

    const current =
      overlayRoot.querySelector(".profile-overlay-focusable.focused") || document.activeElement;
    if (!current) {
      return false;
    }

    const preferredTabButton = this.getPreferredEditorTabButton(navigationState);
    const preferredCategoryButton = this.getPreferredEditorCategoryButton(navigationState);
    const preferredContentButton = this.getPreferredEditorContentButton(navigationState, current);
    let target = null;

    if (current === navigationState.submitButton) {
      if (direction === "left") {
        target = navigationState.nameInput;
      } else if (direction === "down" || direction === "right") {
        target = preferredTabButton || preferredCategoryButton;
      }
    } else if (current === navigationState.nameInput) {
      if (direction === "up") {
        target = navigationState.submitButton;
      } else if (direction === "down") {
        target = navigationState.cancelButton || preferredCategoryButton;
      } else if (direction === "right") {
        target = preferredTabButton || preferredCategoryButton;
      }
    } else if (current === navigationState.cancelButton) {
      if (direction === "up") {
        target = navigationState.nameInput;
      } else if (direction === "right" || direction === "down") {
        target = preferredTabButton || preferredCategoryButton;
      } else if (direction === "left") {
        target = navigationState.nameInput;
      }
    } else if (current.matches?.("[data-action='select-editor-tab']")) {
      const index = navigationState.tabButtons.indexOf(current);
      if (direction === "left") {
        target = index > 0 ? navigationState.tabButtons[index - 1] : navigationState.cancelButton;
      } else if (direction === "right") {
        target = navigationState.tabButtons[index + 1] || null;
      } else if (direction === "up") {
        target = navigationState.submitButton;
      } else if (direction === "down") {
        target = preferredContentButton;
      }
    } else if (current.matches?.("[data-action='select-avatar-category']")) {
      const index = navigationState.categoryButtons.indexOf(current);
      if (direction === "left") {
        target =
          index > 0 ? navigationState.categoryButtons[index - 1] : navigationState.cancelButton;
      } else if (direction === "right") {
        target = navigationState.categoryButtons[index + 1] || null;
      } else if (direction === "up") {
        target = preferredTabButton || navigationState.submitButton;
      } else if (direction === "down") {
        target = this.getPreferredEditorAvatarButton(navigationState, current);
      }
    } else if (current.matches?.("[data-action='select-avatar']")) {
      const position = this.getAvatarGridPosition(navigationState, current);
      if (!position) {
        return false;
      }
      if (direction === "left") {
        target = position.rowNodes[position.columnIndex - 1] || navigationState.cancelButton;
      } else if (direction === "right") {
        target = position.rowNodes[position.columnIndex + 1] || null;
      } else if (direction === "up") {
        const previousRow = position.rows[position.rowIndex - 1];
        target = previousRow
          ? findNearestByHorizontalCenter(current, previousRow.nodes)
          : preferredCategoryButton ||
            this.getEditorCategoryButtonForAvatar(navigationState, current.dataset.avatarId) ||
            findNearestByHorizontalCenter(current, navigationState.categoryButtons) ||
            preferredTabButton;
      } else if (direction === "down") {
        const nextRow = position.rows[position.rowIndex + 1];
        target = nextRow ? findNearestByHorizontalCenter(current, nextRow.nodes) : null;
      }
    } else if (current.matches?.("[data-action='select-background']")) {
      const rows = buildVisualRows(navigationState.backgroundButtons || []);
      const rowIndex = rows.findIndex((row) => row.nodes.includes(current));
      if (rowIndex < 0) {
        return false;
      }
      const row = rows[rowIndex];
      const columnIndex = row.nodes.indexOf(current);
      if (direction === "left") {
        target = row.nodes[columnIndex - 1] || navigationState.cancelButton;
      } else if (direction === "right") {
        target = row.nodes[columnIndex + 1] || null;
      } else if (direction === "up") {
        const previousRow = rows[rowIndex - 1];
        target = previousRow
          ? findNearestByHorizontalCenter(current, previousRow.nodes)
          : preferredTabButton || navigationState.submitButton;
      } else if (direction === "down") {
        const nextRow = rows[rowIndex + 1];
        target = nextRow ? findNearestByHorizontalCenter(current, nextRow.nodes) : null;
      }
    }

    if (!target) {
      return false;
    }

    event?.preventDefault?.();
    target.focus();
    return true;
  },

  moveProfileFocus(event) {
    const code = Number(event?.keyCode || 0);
    const direction =
      code === 37
        ? "left"
        : code === 39
          ? "right"
          : code === 38
            ? "up"
            : code === 40
              ? "down"
              : null;
    if (!direction) {
      return false;
    }
    if (direction === "up" || direction === "down") {
      return false;
    }

    const cards = Array.from(this.container?.querySelectorAll(".profile-card") || []);
    if (!cards.length) {
      return false;
    }

    const current =
      this.container?.querySelector(".profile-card.focused") ||
      (document.activeElement?.matches?.(".profile-card") ? document.activeElement : null) ||
      cards[0];
    const currentIndex = cards.indexOf(current);
    if (currentIndex === -1) {
      return false;
    }

    const nextIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= cards.length) {
      event?.preventDefault?.();
      return true;
    }

    event?.preventDefault?.();
    try {
      cards[nextIndex].focus({ preventScroll: true });
    } catch (_) {
      cards[nextIndex].focus();
    }
    return true;
  },

  updateBackground(colorHex) {
    const screen = this.container?.querySelector(".profile-screen");
    if (!screen) return;

    const screenChanged = this._bgScreen !== screen;
    this._bgScreen = screen;
    const targetColor = parseHexColor(colorHex, parseHexColor(getDefaultProfileColor()));
    if (!screenChanged && colorsEqual(this._bgTargetColor, targetColor)) {
      return;
    }
    if (!this._bgAnimRaf && colorsEqual(this._bgCurrentColor, targetColor)) {
      this._bgTargetColor = targetColor;
      if (screenChanged) {
        screen.style.background = this.buildBackgroundStyleFromColor(
          targetColor,
          this.getBackgroundThemeColors()
        );
      }
      return;
    }
    this._bgTargetColor = targetColor;
    const themeColors = this.getBackgroundThemeColors();

    if (this._bgAnimRaf) {
      cancelAnimationFrame(this._bgAnimRaf);
      this._bgAnimRaf = null;
    }

    if (
      getTvRuntimePerformanceProfile().isPerformanceConstrained ||
      globalThis.document?.body?.classList?.contains("performance-constrained")
    ) {
      this._bgCurrentColor = targetColor;
      screen.style.background = this.buildBackgroundStyleFromColor(targetColor, themeColors);
      return;
    }

    const fromColor = this._bgCurrentColor || targetColor;
    this._bgCurrentColor = fromColor;

    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / PROFILE_BACKGROUND_ANIMATION_MS, 1);
      const eased = fastOutSlowIn(t);
      const animatedColor = {
        r: Math.round(fromColor.r + (targetColor.r - fromColor.r) * eased),
        g: Math.round(fromColor.g + (targetColor.g - fromColor.g) * eased),
        b: Math.round(fromColor.b + (targetColor.b - fromColor.b) * eased)
      };
      this._bgCurrentColor = animatedColor;
      screen.style.background = this.buildBackgroundStyleFromColor(animatedColor, themeColors);
      if (t < 1) {
        this._bgAnimRaf = requestAnimationFrame(tick);
      } else {
        this._bgAnimRaf = null;
      }
    };

    this._bgAnimRaf = requestAnimationFrame(tick);
  },

  updateProfileBackground(profile) {
    const layer = this.container?.querySelector("[data-role='profile-screen-background']");
    if (!layer) {
      return;
    }
    const imageUrl = String(this.getProfileBackgroundImageUrl(profile) || "").trim();
    if (String(layer.dataset.imageUrl || "") === imageUrl) {
      return;
    }
    layer.dataset.imageUrl = imageUrl;
    layer.innerHTML = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" aria-hidden="true"/>`
      : "";
    layer.classList.toggle("has-image", Boolean(imageUrl));
    if (imageUrl) {
      const image = layer.querySelector("img");
      image?.addEventListener("error", () => {
        if (String(layer.dataset.imageUrl || "") !== imageUrl) {
          return;
        }
        layer.dataset.imageUrl = "";
        layer.classList.remove("has-image");
        layer.innerHTML = "";
      });
    }
  },

  buildBackgroundStyle(colorHex) {
    const accent = parseHexColor(colorHex, parseHexColor(getDefaultProfileColor()));
    return this.buildBackgroundStyleFromColor(accent, this.getBackgroundThemeColors());
  },

  getBackgroundThemeColors() {
    if (this._bgThemeColors) {
      return this._bgThemeColors;
    }
    const rootStyles = getComputedStyle(document.documentElement);
    this._bgThemeColors = {
      background: parseHexColor(rootStyles.getPropertyValue("--bg-color"), {
        r: 13,
        g: 13,
        b: 13
      }),
      elevated: parseHexColor(rootStyles.getPropertyValue("--bg-elevated"), {
        r: 26,
        g: 26,
        b: 26
      })
    };
    return this._bgThemeColors;
  },

  buildBackgroundStyleFromColor(accent, themeColors = null) {
    const { background, elevated } = themeColors || this.getBackgroundThemeColors();
    const gradientTop = mixColors(elevated, accent, 0.3);
    const gradientMid = mixColors(background, accent, 0.14);
    return `
      linear-gradient(90deg, ${colorToRgba(accent, 0.26)} 0%, ${colorToRgba(accent, 0.08)} 45%, rgba(0, 0, 0, 0) 72%, rgba(0, 0, 0, 0) 100%),
      linear-gradient(180deg, ${colorToRgba(gradientTop, 1)} 0%, ${colorToRgba(gradientMid, 1)} 42%, ${colorToRgba(background, 1)} 100%)
    `;
  },

  syncEditorPreview() {
    if (!this.editorState) {
      return;
    }

    const previewName = String(this.editorState.name || "").trim() || "Profile name";
    const previewNameNode = this.container.querySelector("[data-role='editor-preview-name']");
    if (previewNameNode) {
      previewNameNode.textContent = previewName;
      previewNameNode.classList.toggle(
        "is-placeholder",
        !String(this.editorState.name || "").trim()
      );
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
      focusedAvatarName: null
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

  openOptionsDialog(profile) {
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
    this.pendingFocusKey = profileId
      ? `profile:${profileId}`
      : this.lastProfileFocusKey || "profile:1";
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
    this.pendingFocusKey =
      focusKey || (profileId ? `profile:${profileId}` : this.lastProfileFocusKey || "profile:1");
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
  },

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
    if (
      this.pinValue.length !== PROFILE_PIN_LENGTH ||
      this.isPinOperationInProgress ||
      !this.pinOverlayState
    ) {
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
    this.pendingFocusKey = profileId
      ? `profile:${profileId}`
      : this.lastProfileFocusKey || "profile:1";
    this.restoreFocus();
  },

  async submitEditor() {
    if (!this.editorState || this.isEditorSubmitDisabled()) {
      return;
    }

    const editorState = { ...this.editorState };
    const trimmedName = String(editorState.name || "").trim();
    const focusProfileId =
      editorState.mode === "edit"
        ? editorState.profileId
        : String(ProfileManager.getNextProfileIndex(this.getVisibleProfiles()) || "");

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
        avatarUrl:
          editorState.selectedAvatarId !== editorState.baseAvatarId
            ? null
            : String(existing.avatarUrl || "").trim() || null,
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
      remainingProfiles.find(
        (entry) =>
          Number(entry.profileIndex || entry.id || 0) <
          Number(profile.profileIndex || profile.id || 0)
      ) ||
      remainingProfiles[0] ||
      null;
    this.profiles = remainingProfiles;
    this.pendingFocusKey = fallbackProfile ? `profile:${fallbackProfile.id}` : "";
    this.render();
  },

  async reloadProfiles(focusKey = "") {
    this.profiles = await ProfileManager.getProfiles();
    await this.refreshProfilePinStates();
    this.activeProfileId = String(
      ProfileManager.getActiveProfileId() || this.activeProfileId || "1"
    );
    this.pendingFocusKey = focusKey;
    this.render();
  },

  async activateFocusedNode(node) {
    const action = String(node?.dataset?.action || "");
    const profileId = node?.dataset?.profileId;

    if (action === "cancel-editor") {
      this.closeEditor();
      return;
    }
    if (action === "submit-editor") {
      await this.submitEditor();
      return;
    }
    if (action === "select-editor-tab" && this.editorState) {
      const editorTab = String(node.dataset.editorTab || "avatar");
      if (editorTab !== "background" || this.hasProfileBackgroundAccess) {
        this.editorState.editorTab = editorTab === "background" ? "background" : "avatar";
        this.pendingFocusKey = `editor:tab:${this.editorState.editorTab}`;
        this.render();
      }
      return;
    }
    if (action === "select-avatar-category" && this.editorState) {
      this.editorState.category = String(node.dataset.category || "all");
      this.pendingFocusKey = `editor:category:${this.editorState.category}`;
      this.render();
      return;
    }
    if (action === "select-background" && this.editorState) {
      const backgroundId = String(node.dataset.backgroundId || "");
      if (backgroundId === "normal") {
        this.editorState.selectedBackgroundId = null;
        this.editorState.selectedBackgroundUrl = null;
      } else if (backgroundId === "custom") {
        const customUrl = String(this.editorState.baseBackgroundUrl || "").trim();
        if (!customUrl) {
          return;
        }
        if (
          !this.editorState.selectedBackgroundId &&
          this.editorState.selectedBackgroundUrl === customUrl
        ) {
          this.editorState.selectedBackgroundUrl = null;
        } else {
          this.editorState.selectedBackgroundId = null;
          this.editorState.selectedBackgroundUrl = customUrl;
        }
      } else {
        const background = this.profileBackgroundCatalog.find((entry) => entry.id === backgroundId);
        if (!background) {
          return;
        }
        if (
          !this.editorState.selectedBackgroundUrl &&
          this.editorState.selectedBackgroundId === background.id
        ) {
          this.editorState.selectedBackgroundId = null;
          this.editorState.selectedBackgroundUrl = null;
        } else {
          this.editorState.selectedBackgroundId = background.id;
          this.editorState.selectedBackgroundUrl = null;
          void ProfileBackgroundRepository.loadSelectedAndPreload(background.id);
        }
      }
      this.editorState.editorTab = "background";
      this.pendingFocusKey = `editor:background:${backgroundId}`;
      this.render();
      return;
    }
    if (action === "select-avatar" && this.editorState) {
      const avatar = this.avatarCatalog.find((entry) => entry.id === node.dataset.avatarId);
      if (!avatar) {
        return;
      }
      if (this.editorState.selectedAvatarId === avatar.id) {
        this.editorState.selectedAvatarId = null;
        this.editorState.selectedColorHex =
          this.editorState.mode === "edit"
            ? this.editorState.baseColorHex || getDefaultProfileColor()
            : getDefaultProfileColor();
      } else {
        this.editorState.selectedAvatarId = avatar.id;
        this.editorState.selectedColorHex = avatar.bgColor || getDefaultProfileColor();
      }
      this.editorState.focusedAvatarName = avatar.displayName;
      this.pendingFocusKey = `editor:avatar:${avatar.id}`;
      this.render();
      return;
    }
    if (action === "open-edit-profile") {
      this.openEditEditor(this.getProfileById(profileId));
      return;
    }
    if (action === "open-profile-pin") {
      const profile = this.getProfileById(profileId);
      if (profile) {
        this.openPinOverlay(
          this.isProfilePinEnabled(profile.id) ? "verify-change" : "set",
          profile
        );
      }
      return;
    }
    if (action === "remove-profile-pin") {
      const profile = this.getProfileById(profileId);
      if (profile) {
        this.openPinOverlay("verify-remove", profile);
      }
      return;
    }
    if (action === "confirm-delete-profile") {
      this.openDeleteDialog(this.getProfileById(profileId));
      return;
    }
    if (action === "delete-profile") {
      await this.deleteProfile(profileId);
      return;
    }

    if (profileId === "add") {
      this.openCreateEditor();
      return;
    }

    const profile = this.getProfileById(profileId);
    if (!profile) {
      return;
    }

    if (this.isManagementMode) {
      this.openOptionsDialog(profile);
      return;
    }

    if (this.isProfilePinEnabled(profile.id)) {
      this.openPinOverlay("unlock", profile);
      return;
    }

    await this.activateProfile(profile.id);
  },

  async activateProfile(profileId) {
    if (!profileId || this.isActivatingProfile) {
      return;
    }
    this.isActivatingProfile = true;
    this.activatingProfileId = String(profileId);
    const profileCard =
      Array.from(this.container?.querySelectorAll(".profile-card[data-profile-id]") || []).find(
        (node) => String(node.dataset.profileId || "") === String(profileId)
      ) || null;
    profileCard?.classList?.add("is-activating");
    try {
      await ProfileManager.setActiveProfile(profileId);
      StartupSyncService.enableProfileScopedSync();
      detailWatchedEnrichmentService.invalidateAllCache();
      await I18n.init();
      const memberAccess = await MemberAccessRepository.getAccess().catch(() =>
        MemberAccessRepository.getCurrentAccess()
      );
      ThemeManager.apply({ enforceAccess: true, access: memberAccess });
      I18n.apply();
      const experienceRoute = await resolveExperienceRoute(profileId);
      await Router.navigate(
        experienceRoute,
        experienceRoute === "home" ? { forceReload: true } : {},
        experienceRoute === "home" ? {} : { replaceHistory: true, skipStackPush: true }
      );
      void StartupSyncService.requestSyncNow({
        notifyPullCompleted: experienceRoute === "home"
      }).catch((error) => {
        console.warn("Profile background sync failed", error);
      });
    } catch (error) {
      console.warn("Failed to activate profile", error);
      this.isActivatingProfile = false;
      this.activatingProfileId = "";
      profileCard?.classList?.remove("is-activating");
    }
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }
    if (this.isActivatingProfile) {
      event?.preventDefault?.();
      return;
    }

    const code = Number(event?.keyCode || 0);
    if (this.suppressHoldMenuEnterUntilKeyUp && code === 13) {
      event?.preventDefault?.();
      return;
    }
    const overlayRoot =
      this.container.querySelector("[data-overlay-root='pin']") ||
      this.container.querySelector("[data-overlay-root='delete']") ||
      this.container.querySelector("[data-overlay-root='options']") ||
      this.container.querySelector("[data-overlay-root='editor']");
    const currentProfileCard = this.container.querySelector(".profile-card.focused") || null;

    if (code !== 13 || !this.canHoldManageProfile(currentProfileCard)) {
      this.cancelPendingProfileHold();
    }

    if (overlayRoot) {
      this.cancelPendingProfileHold();
      if (overlayRoot.dataset.overlayRoot === "pin") {
        await this.handlePinOverlayKeyDown(event);
        return;
      }
      const isEditorOverlay = overlayRoot.dataset.overlayRoot === "editor";
      const overlaySelector = isEditorOverlay
        ? ".profile-overlay-focusable:not(.is-disabled)"
        : ".profile-dialog-button";

      if (
        (isEditorOverlay && this.moveEditorFocus(event, overlayRoot)) ||
        (!isEditorOverlay && ScreenUtils.handleDpadNavigation(event, overlayRoot, overlaySelector))
      ) {
        return;
      }

      if (code !== 13) {
        return;
      }

      const focused =
        overlayRoot.querySelector(`${overlaySelector}.focused`) || document.activeElement;
      if (!focused || (isTextInput(focused) && overlayRoot.dataset.overlayRoot === "editor")) {
        return;
      }
      event?.preventDefault?.();
      this.rememberKeyboardActivation(focused);
      await this.activateFocusedNode(focused);
      return;
    }

    if (code === 13 && this.canHoldManageProfile(currentProfileCard)) {
      event?.preventDefault?.();
      if (!event?.repeat && !this.hasPendingProfileHold(currentProfileCard)) {
        this.startPendingProfileHold(currentProfileCard);
      }
      return;
    }

    if (
      this.moveProfileFocus(event) ||
      ScreenUtils.handleDpadNavigation(event, this.container, ".profile-card")
    ) {
      return;
    }

    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector(".profile-card.focused");
    if (!current) {
      return;
    }
    this.rememberKeyboardActivation(current);
    await this.activateFocusedNode(current);
  },

  async onKeyUp(event) {
    if (this.suppressHoldMenuEnterUntilKeyUp) {
      this.suppressHoldMenuEnterUntilKeyUp = false;
      if (Number(event?.keyCode || 0) === 13) {
        event?.preventDefault?.();
        return;
      }
    }
    if (
      Number(event?.keyCode || 0) !== 13 ||
      this.pinOverlayState ||
      this.optionsProfileId ||
      this.deleteProfileId ||
      this.editorState
    ) {
      return;
    }
    const current = this.container?.querySelector(".profile-card.focused") || null;
    if (await this.completePendingProfileHold(current, event)) {
      event?.preventDefault?.();
    }
  },

  consumeBackRequest() {
    if (this.pinOverlayState || this.pinOverlayRenderState) {
      this.closePinOverlay();
      return true;
    }
    if (this._deleteDialog || this.deleteProfileId) {
      this.closeDeleteDialog();
      return true;
    }
    if (this._optionsDialog || this.optionsProfileId) {
      this.closeOptionsDialog();
      return true;
    }
    if (this.editorState) {
      this.closeEditor();
      return true;
    }
    if (!this.isManagementMode) {
      return true;
    }
    return false;
  },

  _destroyDialogs() {
    if (this._optionsDialog) {
      this._optionsDialog.destroy();
      this._optionsDialog = null;
    }
    if (this._deleteDialog) {
      this._deleteDialog.destroy();
      this._deleteDialog = null;
    }
    this.optionsProfileId = null;
    this.deleteProfileId = null;
  },

  cleanup() {
    this.isMounted = false;
    this.memberAccessUnsubscribe?.();
    this.memberAccessUnsubscribe = null;
    this.profileBackgroundUnsubscribe?.();
    this.profileBackgroundUnsubscribe = null;
    this._destroyDialogs();
    this.cancelPendingProfileHold();
    this.suppressHoldMenuEnterUntilKeyUp = false;
    this.focusedNode = null;
    if (this._bgAnimRaf) {
      cancelAnimationFrame(this._bgAnimRaf);
      this._bgAnimRaf = null;
    }
    this._bgCurrentColor = null;
    this._bgScreen = null;
    this._bgTargetColor = null;
    this._bgThemeColors = null;
    if (this.pinActionMessageTimer) {
      clearTimeout(this.pinActionMessageTimer);
      this.pinActionMessageTimer = null;
    }
    if (this.pinTransitionTimer) {
      clearTimeout(this.pinTransitionTimer);
      this.pinTransitionTimer = null;
    }
    this.pinTransitionCallback = null;
    this.suppressedFocusClick = null;
    const container = document.getElementById("profileSelection");
    if (!container) {
      return;
    }
    container.style.display = "none";
    container.innerHTML = "";
  }
};
