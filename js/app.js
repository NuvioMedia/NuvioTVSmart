import "./core/diagnostics/consoleDebugBuffer.js";
import { detailWatchedEnrichmentService } from "./data/repository/detailWatchedEnrichmentService.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { ProfileManager } from "./core/profile/profileManager.js";
import { ProfileSyncService } from "./core/profile/profileSyncService.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { preloadStreamBadgeImages } from "./ui/screens/stream/streamScreen.js";
import { warmStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";

(function applyLegacyPatches() {
  const originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    if (id === undefined || id === null || id === "") return null;
    return originalGetElementById.call(document, id);
  };

  if (typeof Node === "undefined") {
    globalThis.Node = { ELEMENT_NODE: 1 };
  }
})();

const GUEST_QR_BYPASS_KEY = "skipAuthQrGate";
const SIGNED_OUT_ALLOWED_ROUTES = new Set(["trakt"]);
let hasSelectedProfileThisSession = false;
let appShellRendered = false;

function markBootStage(stage) {
  const guard = globalThis.NuvioBootGuard;
  if (guard && typeof guard.stage === "function") {
    guard.stage(stage);
  }
}

function isSignedOutRouteAllowed() {
  return SIGNED_OUT_ALLOWED_ROUTES.has(Router.getCurrent());
}

function formatErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error?.stack || error?.message || error);
}

function renderFatalError(error) {
  const message = formatErrorMessage(error);
  const guard = globalThis.NuvioBootGuard;
  if (guard && typeof guard.fail === "function" && guard.isActive?.()) {
    guard.fail(
      "Something went wrong while the application was starting.",
      message,
      "BOOT-APPLICATION"
    );
    return;
  }
  document.body.innerHTML = `
    <div style="min-height:100vh;background:#0f1115;color:#f4f7fb;padding:48px;font-family:Arial,sans-serif;">
      <div style="max-width:960px;margin:0 auto;">
        <h1 style="margin:0 0 16px;font-size:42px;">Nuvio TV failed to start</h1>
        <p style="margin:0 0 20px;font-size:20px;color:#c7d0dd;">Startup hit an error before the app UI rendered.</p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#171b22;border:1px solid #2b3340;border-radius:12px;padding:20px;font-size:18px;line-height:1.5;">${message}</pre>
      </div>
    </div>
  `;
}

function isLowEndDevice() {
  const hardware = Number(globalThis.navigator?.hardwareConcurrency || 0);
  const memory = Number(globalThis.navigator?.deviceMemory || 0);
  const lowCpu = Number.isFinite(hardware) && hardware > 0 && hardware <= 4;
  const lowMem = Number.isFinite(memory) && memory > 0 && memory <= 2;
  return lowCpu || lowMem;
}

function getChromiumMajorVersion() {
  const userAgent = String(globalThis.navigator?.userAgent || "");
  const match = userAgent.match(/(?:chrome|chromium)\/(\d{2,3})/i);
  const version = Number(match?.[1] || 0);
  return Number.isFinite(version) ? version : 0;
}

function applyPerformanceMode() {
  const constrained = Platform.isWebOS() || Platform.isTizen() || isLowEndDevice();
  const webOsMajorVersion = Platform.isWebOS() ? Number(Platform.getWebOsMajorVersion() || 0) : 0;
  const legacyWebOs = Platform.isWebOS() && (webOsMajorVersion === 0 || webOsMajorVersion <= 6);
  const legacyWebOs38 = Platform.isWebOS() && webOsMajorVersion > 0 && webOsMajorVersion <= 3;
  const legacyTizen = Platform.isTizen();
  const rootClasses = document.documentElement.classList;
  const modernWebOs = Platform.isWebOS() && getChromiumMajorVersion() >= 120;
  const modernSidebarBlurCapable =
    !rootClasses.contains("no-backdrop-filter") && ((!constrained && !legacyTizen) || modernWebOs);
  document.documentElement.classList.toggle("performance-constrained", constrained);
  document.body.classList.toggle("performance-constrained", constrained);
  document.documentElement.classList.toggle(
    "modern-sidebar-blur-capable",
    modernSidebarBlurCapable
  );
  document.body.classList.toggle("modern-sidebar-blur-capable", modernSidebarBlurCapable);
  document.documentElement.classList.toggle("legacy-webos", legacyWebOs);
  document.body.classList.toggle("legacy-webos", legacyWebOs);
  document.documentElement.classList.toggle("legacy-webos38", legacyWebOs38);
  document.body.classList.toggle("legacy-webos38", legacyWebOs38);
  document.documentElement.classList.toggle("legacy-tizen", legacyTizen);
  document.body.classList.toggle("legacy-tizen", legacyTizen);
  ["no-flex-gap", "no-aspect-ratio", "no-css-math", "no-backdrop-filter"].forEach((className) => {
    document.body.classList.toggle(className, rootClasses.contains(className));
  });
}

function isAddonRemoteMode() {
  try {
    return new URLSearchParams(window.location.search).get("addonsRemote") === "1";
  } catch {
    return false;
  }
}

async function shouldShowProfileSelection() {
  const [, pinStates] = await Promise.all([
    ProfileSyncService.pull(),
    ProfileSyncService.pullProfileLockStates()
  ]);
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const activeProfileHasPin = Boolean(
    pinStates?.[String(activeProfileId)] || pinStates?.[Number(activeProfileId)]
  );

  if (hasSelectedProfileThisSession) {
    return { show: false, pinStates };
  }

  // Remember last profile: when enabled and the last used profile has no PIN,
  // skip the picker and go straight in, matching the Android TV app. A profile
  // with a PIN always shows the picker so the PIN can be entered.
  if (
    ProfileManager.isRememberLastProfileEnabled() &&
    ProfileManager.hasEverSelectedProfile() &&
    !activeProfileHasPin
  ) {
    return { show: false, pinStates };
  }

  return { show: profiles.length > 1 || activeProfileHasPin, pinStates };
}

async function enterWithLastProfile({ restoreWebOsRoute = false } = {}) {
  hasSelectedProfileThisSession = true;
  const profiles = await ProfileManager.getProfiles();
  const activeProfileId = ProfileManager.getActiveProfileId();
  const activeProfile =
    profiles.find((profile) => String(profile.id) === String(activeProfileId)) ||
    profiles[0] ||
    null;
  if (activeProfile) {
    await ProfileManager.setActiveProfile(activeProfile.id);
    StartupSyncService.enableProfileScopedSync();
    detailWatchedEnrichmentService.invalidateAllCache();
    await I18n.init();
    ThemeManager.apply();
    I18n.apply();
    void preloadStreamBadgeImages().catch((error) => {
      console.warn("Stream badge image prerender failed", error);
    });
  }
  const resumeRoute =
    restoreWebOsRoute && typeof Router.consumeWebOsResumeRoute === "function"
      ? Router.consumeWebOsResumeRoute()
      : null;
  if (resumeRoute?.route) {
    await Router.navigate(resumeRoute.route, resumeRoute.params || {}, {
      replaceHistory: true,
      skipStackPush: true
    });
  } else {
    await Router.navigate("home");
  }
  void StartupSyncService.requestSyncNow().catch((error) => {
    console.warn("Profile background sync failed", error);
  });
}

async function routeAfterAuthentication() {
  const profileRoute = await shouldShowProfileSelection();
  if (profileRoute.show) {
    await Router.navigate("profileSelection", {
      skipInitialProfileSync: true,
      profilePinEnabled: profileRoute.pinStates
    });
    return;
  }

  await enterWithLastProfile({ restoreWebOsRoute: true });
}

function setupWebOsAppLifecycle() {
  if (!Platform.isWebOS()) {
    return;
  }

  const appSystems = Array.from(
    new Set([globalThis.webOSSystem || null, globalThis.PalmSystem || null].filter(Boolean))
  );

  function activateWebOsApp() {
    const system = appSystems.find((entry) => typeof entry?.activate === "function") || null;
    if (!system) {
      return;
    }
    try {
      system.activate();
    } catch (error) {
      console.warn("webOS activate failed", error);
    }
  }

  function installNativeCallback(system, systemName, callbackName, { recoverOnCall = false } = {}) {
    if (!system) {
      return;
    }
    const previous =
      typeof system[callbackName] === "function" ? system[callbackName].bind(system) : null;
    try {
      system[callbackName] = (...args) => {
        if (previous) {
          try {
            previous(...args);
          } catch (error) {
            console.warn(`webOS callback ${systemName}.${callbackName} failed`, error);
          }
        }
        if (recoverOnCall) {
          void recover(`${systemName}.${callbackName}`);
        }
      };
    } catch (error) {
      console.warn(`webOS callback hook ${systemName}.${callbackName} failed`, error);
    }
  }

  // webOS keeps the app resident when it is backgrounded. Re-opening can fire
  // a launch event on the existing JS context instead of reloading the page.
  let recovering = false;
  const recover = async () => {
    if (recovering || !appShellRendered) {
      return;
    }
    const current = Router.getCurrent();
    if (!current) {
      return;
    }
    recovering = true;
    try {
      if (document.body) {
        document.body.style.removeProperty("display");
      }
      if (current === "debugConsole") {
        await Router.navigate(
          "home",
          {},
          {
            replaceHistory: true,
            skipStackPush: true
          }
        );
      } else if (typeof Router.persistWebOsResumeRoute === "function") {
        Router.persistWebOsResumeRoute(current, Router.currentParams || {});
      }
      // With handlesRelaunch=true, webOS expects the app to explicitly request
      // foreground activation after processing the relaunch callback.
      activateWebOsApp();
    } catch (error) {
      console.warn("webOS relaunch recovery failed", error);
    } finally {
      recovering = false;
    }
  };

  document.addEventListener(
    "webOSRelaunch",
    () => {
      void recover();
    },
    true
  );

  // webOS 4.x may fire webOSLaunch instead of webOSRelaunch when resuming.
  document.addEventListener(
    "webOSLaunch",
    () => {
      void recover();
    },
    true
  );

  // Some builds only expose visibilitychange when the WebView is resumed.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void recover();
    }
  });

  // Older webOS WebKit builds may emit only the prefixed visibility signal.
  document.addEventListener("webkitvisibilitychange", () => {
    if (document.webkitHidden !== true) {
      void recover();
    }
  });

  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "onshow", { recoverOnCall: true });
  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "onhide");
  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "onfocus", { recoverOnCall: true });
  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "onblur");
  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "onactivate", {
    recoverOnCall: true
  });
  installNativeCallback(globalThis.webOSSystem, "webOSSystem", "ondeactivate");
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "onshow", { recoverOnCall: true });
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "onhide");
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "onfocus", { recoverOnCall: true });
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "onblur");
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "onactivate", { recoverOnCall: true });
  installNativeCallback(globalThis.PalmSystem, "PalmSystem", "ondeactivate");
}

async function bootstrapApp() {
  markBootStage("Rendering application shell");
  renderAppShell();
  appShellRendered = true;
  markBootStage("Initializing TV platform");
  Platform.init();
  applyPerformanceMode();
  markBootStage("Loading language resources");
  await I18n.init();

  markBootStage("Initializing navigation");
  Router.init();
  PlayerController.init();

  FocusEngine.init();
  setupWebOsAppLifecycle();

  ThemeManager.apply();
  I18n.apply();
  warmStreamingLibs({ delayMs: 1400 });

  markBootStage("Restoring session");
  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      return;
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      hasSelectedProfileThisSession = false;
      const shouldBypassQr = Boolean(LocalStore.get(GUEST_QR_BYPASS_KEY, false));
      if (isSignedOutRouteAllowed()) {
        return;
      }
      if (shouldBypassQr) {
        // Honor "remember last profile" for guests too: skip the picker and go
        // straight in with the last profile (guests have no PIN).
        if (
          ProfileManager.isRememberLastProfileEnabled() &&
          ProfileManager.hasEverSelectedProfile()
        ) {
          enterWithLastProfile({ restoreWebOsRoute: true }).catch((error) => {
            console.warn("Failed to enter with last profile", error);
            ProfileManager.clearActiveProfile();
            if (Router.getCurrent() !== "profileSelection") {
              Router.navigate(
                "profileSelection",
                {},
                { replaceHistory: true, skipStackPush: true }
              );
            }
          });
          return;
        }
        ProfileManager.clearActiveProfile();
        if (Router.getCurrent() !== "profileSelection") {
          Router.navigate(
            "profileSelection",
            {},
            {
              replaceHistory: true,
              skipStackPush: true
            }
          );
        }
        return;
      }
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      Router.navigate("authQrSignIn", {
        onboardingMode: !hasSeenQr
      });
    }

    if (state === AuthState.AUTHENTICATED) {
      markBootStage("Loading profiles");
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
      StartupSyncService.start({ runInitialPull: false });
      routeAfterAuthentication().catch((error) => {
        console.warn("Failed to resolve authenticated route", error);
        Router.navigate("profileSelection");
      });
    }
  });

  markBootStage("Checking authentication");
  await AuthManager.bootstrap();
}

async function bootstrapAddonRemoteMode() {
  await renderAddonRemotePage();
  appShellRendered = true;
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
      bootstrap().catch((error) => {
        console.error("App bootstrap failed", error);
        renderFatalError(error);
      });
    },
    { once: true }
  );
} else {
  const bootstrap = isAddonRemoteMode() ? bootstrapAddonRemoteMode : bootstrapApp;
  bootstrap().catch((error) => {
    console.error("App bootstrap failed", error);
    renderFatalError(error);
  });
}

window.addEventListener("error", (event) => {
  if (!event?.error) {
    return;
  }
  if (!appShellRendered) {
    renderFatalError(event.error);
    return;
  }
  console.warn("Unhandled runtime error", event.error);
});

window.addEventListener("unhandledrejection", (event) => {
  if (!appShellRendered) {
    renderFatalError(event?.reason);
    return;
  }
  console.warn("Unhandled promise rejection", event?.reason);
});
