import { Platform } from "../../../platform/index.js";
import { PluginServiceClient } from "../../../platform/pluginServiceClient.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { CUSTOM_POSTER_SCREENS } from "../../../core/poster/customPoster.js";
import { I18n } from "../../../i18n/index.js";
import { withRequestTimeout } from "../../../core/network/requestTimeout.js";

function escape(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

export async function openCustomPosterPhoneConfig(screen) {
  const profileId = ProfileManager.getActiveProfileId();
  const mountToken = screen.settingsMountToken;
  const current = () =>
    screen.isMounted &&
    screen.settingsMountToken === mountToken &&
    screen.activeSection === "layout" &&
    ProfileManager.getActiveProfileId() === profileId;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const health = await PluginServiceClient.ensureReady();
  if (!current()) return;
  const port = Number(health.port || (Platform.isWebOS() ? 2721 : 2711));
  if (![2711, 2721].includes(port)) throw new Error("web_custom_poster_error_connection");
  const control = async (action, extra = {}) =>
    withRequestTimeout(async (signal) => {
      const response = await fetch(`http://127.0.0.1:${port}/poster-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, token, ...extra }),
        signal
      });
      if (!response.ok) throw new Error("web_custom_poster_error_connection");
      const result = await response.json();
      if (result.returnValue === false) throw new Error("web_custom_poster_error_connection");
      return result;
    }, 10000);
  const keys = {
    title: "title",
    subtitle: "subtitle",
    label: "label",
    save: "save",
    clear: "clear",
    saved: "saved",
    cleared: "cleared",
    info: "placeholders_info",
    error: "error_connection"
  };
  const labels = Object.fromEntries(
    Object.entries(keys).map(([key, suffix]) => [key, I18n.t(`web_custom_poster_${suffix}`)])
  );
  const session = await control("start", {
    pattern: LayoutPreferences.get().customPosterUrlPattern,
    labels
  });
  let timer = null;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    void control("stop").catch(() => {});
  };
  if (!current()) {
    stop();
    return;
  }
  let address = session.address;
  if (!address && Platform.isTizen()) {
    try {
      address = globalThis.webapis?.network?.getIp?.();
    } catch (_) {
      /* No usable local address. */
    }
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address || "") || /^127\./.test(address)) {
    stop();
    throw new Error("web_custom_poster_error_connection");
  }
  const url = `http://${address}:${session.port}/${token}/`;
  const canvas = document.createElement("canvas");
  try {
    QrCodeGenerator.generate(canvas, url, 420);
  } catch (error) {
    stop();
    throw error;
  }
  screen.closeCustomPosterPhoneConfig?.();
  screen.closeCustomPosterPhoneConfig = stop;
  screen.openOptionDialog({
    title: I18n.t("layout_custom_poster_qr"),
    messageHtml: `<p>${escape(I18n.t("custom_poster_qr_instruction"))}</p><img class="settings-trakt-qr" src="${escape(canvas.toDataURL("image/png"))}" alt="${escape(I18n.t("layout_custom_poster_qr"))}" />`,
    options: [{ id: "close", label: I18n.t("action_back") }],
    selectedId: "close",
    returnFocusKey: "layout:customPosterPhone",
    onClose: stop
  });
  let revision = 0;
  const poll = async () => {
    if (closed) return;
    if (!current() || screen.optionDialog?.returnFocusKey !== "layout:customPosterPhone") {
      stop();
      return;
    }
    try {
      const state = await control("read");
      if (closed || !current()) {
        stop();
        return;
      }
      if (state.revision > revision) {
        revision = state.revision;
        LayoutPreferences.set({
          customPosterUrlPattern: state.pattern,
          ...(state.cleared ? { customPosterEnabledScreens: CUSTOM_POSTER_SCREENS } : {})
        });
        // Updating the content keeps the QR dialog open and restores its focus.
        await screen.render({ refreshModel: false });
      }
    } catch (_) {
      stop();
      return;
    }
    if (!closed) timer = setTimeout(poll, 1000);
  };
  timer = setTimeout(poll, 1000);
}
