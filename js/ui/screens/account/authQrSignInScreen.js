import { Router } from "../../navigation/routerState.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { SessionStore } from "../../../core/storage/sessionStore.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";
import { Platform } from "../../../platform/index.js";
import { renderBrandWordmarkImage } from "../../components/brandWordmark.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { PluginManager } from "../../../core/player/pluginManager.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { ServerConfigurationStore } from "../../../data/local/serverConfigurationStore.js";
import { WatchProgressStore } from "../../../data/local/watchProgressStore.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { savedLibraryRepository } from "../../../data/repository/savedLibraryRepository.js";
import {
  supportsEmailPasswordAuth,
  supportsTvLogin
} from "../../../core/server/serverConfiguration.js";

import { createAuthQrSignInScreenMethods01 } from "./authQrSignInScreenMethods-01-mount.js";
import { createAuthQrSignInScreenMethods02 } from "./authQrSignInScreenMethods-02-bind-controls.js";
import { createAuthQrSignInScreenMethods03 } from "./authQrSignInScreenMethods-03-to-friendly-email-error.js";

export {
  Router,
  QrLoginService,
  LocalStore,
  SessionStore,
  ScreenUtils,
  AuthManager,
  I18n,
  Platform,
  renderBrandWordmarkImage,
  QrCodeGenerator,
  PluginManager,
  ProfileManager,
  ServerConfigurationStore,
  WatchProgressStore,
  addonRepository,
  savedLibraryRepository,
  supportsEmailPasswordAuth,
  supportsTvLogin,
  GUEST_QR_BYPASS_KEY,
  decodeJwtPayload,
  connectedAccountIdentity,
  escapeHtml,
  focusNode,
  formatDuration,
  parseQrExpiration
};
const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";

function decodeJwtPayload(token) {
  try {
    if (typeof atob !== "function") return null;
    const [, payload] = String(token || "").split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

function connectedAccountIdentity() {
  const payload = decodeJwtPayload(SessionStore.accessToken);
  return {
    email: String(payload?.email || payload?.user_metadata?.email || "").trim(),
    userId: String(payload?.sub || "").trim()
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function focusNode(node) {
  if (!node) {
    return;
  }
  const scope = node.closest?.(".qr-email-form") || node.parentElement;
  scope?.querySelectorAll?.(".focusable.focused").forEach((focusedNode) => {
    if (focusedNode !== node) {
      focusedNode.classList.remove("focused");
    }
  });
  node.classList.add("focused");
  focusWithoutScroll(node);
}

function formatDuration(millis) {
  const totalSeconds = Math.max(0, Math.floor(Number(millis || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseQrExpiration(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export const AuthQrSignInScreen = {
  ...createAuthQrSignInScreenMethods01(),
  ...createAuthQrSignInScreenMethods02(),
  ...createAuthQrSignInScreenMethods03()
};
