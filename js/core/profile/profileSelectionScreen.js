import { Router } from "../../ui/navigation/routerState.js";
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
import { PluginStore } from "../../data/local/pluginStore.js";
import { PluginCodeStore } from "../../data/local/pluginCodeStore.js";
import { PluginRuntime } from "../player/pluginRuntime.js";
import { ProfileSettingsCopyService } from "./profileSettingsCopyService.js";

import { createProfileSelectionScreenMethods01 } from "./profileSelectionScreenMethods-01-mount.js";
import { createProfileSelectionScreenMethods02 } from "./profileSelectionScreenMethods-02-render-editor-overlay.js";
import { createProfileSelectionScreenMethods03 } from "./profileSelectionScreenMethods-03-render-pin-overlay.js";
import { createProfileSelectionScreenMethods04 } from "./profileSelectionScreenMethods-04-get-preferred-editor-avatar-button.js";
import { createProfileSelectionScreenMethods05 } from "./profileSelectionScreenMethods-05-sync-editor-preview.js";
import { createProfileSelectionScreenMethods06 } from "./profileSelectionScreenMethods-06-submit-completed-pin.js";
import { createProfileSelectionScreenMethods07 } from "./profileSelectionScreenMethods-07-activate-focused-node.js";
import { createProfileSelectionScreenMethods08 } from "./profileSelectionScreenMethods-08-cleanup.js";
import { createProfileSelectionScreenMethods09 } from "./profileSelectionScreenMethods-09-copy-settings.js";

export {
  Router,
  MAX_PROFILES,
  ProfileManager,
  ProfileSyncService,
  StartupSyncService,
  ScreenUtils,
  AvatarRepository,
  MemberAccessRepository,
  ProfileBackgroundRepository,
  ThemeManager,
  renderMemberBrandWordmark,
  I18n,
  NuvioDialog,
  detailWatchedEnrichmentService,
  resolveExperienceRoute,
  getTvRuntimePerformanceProfile,
  PluginStore,
  PluginCodeStore,
  PluginRuntime,
  ProfileSettingsCopyService,
  PINNED_AVATAR_CATEGORIES,
  DEFAULT_PROFILE_COLOR,
  PROFILE_HOLD_DELAY_MS,
  PROFILE_PIN_LENGTH,
  PROFILE_PIN_OPEN_MS,
  PROFILE_PIN_CLOSE_MS,
  PROFILE_BACKGROUND_ANIMATION_MS,
  PROFILE_PIN_TEXT,
  t,
  keyEventToDigit,
  getDefaultProfileColor,
  escapeHtml,
  getProfileInitial,
  resolveProfileAvatarUrl,
  centeredScrollAnimations,
  animateScrollTop,
  centerAvatarRowInScrollContainer,
  clampChannel,
  parseHexColor,
  mixColors,
  colorToRgba,
  colorsEqual,
  fastOutSlowIn,
  categoryLabel,
  getAvatarCategories,
  isTextInput,
  getNodeHorizontalCenter,
  findNearestByHorizontalCenter,
  buildVisualRows
};
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
  forgot: "Forgot PIN? Reset it from your Nuvio account page.",
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
  ...createProfileSelectionScreenMethods01(),
  ...createProfileSelectionScreenMethods02(),
  ...createProfileSelectionScreenMethods03(),
  ...createProfileSelectionScreenMethods04(),
  ...createProfileSelectionScreenMethods05(),
  ...createProfileSelectionScreenMethods06(),
  ...createProfileSelectionScreenMethods07(),
  ...createProfileSelectionScreenMethods08(),
  ...createProfileSelectionScreenMethods09()
};
