/* global __NUVIO_APP_VERSION__ */

import "./core/diagnostics/consoleDebugBuffer.js";
import { detailWatchedEnrichmentService } from "./data/repository/detailWatchedEnrichmentService.js";
import { Router } from "./ui/navigation/router.js";
import { FocusEngine } from "./ui/navigation/focusEngine.js";
import { PlayerController } from "./core/player/playerController.js";
import { AuthManager } from "./core/auth/authManager.js";
import { AuthState } from "./core/auth/authState.js";
import { DeviceSessionRegistration } from "./core/auth/deviceSessionRegistration.js";
import { ProfileManager } from "./core/profile/profileManager.js";
import { MemberAccessRepository } from "./data/remote/supabase/memberAccessRepository.js";
import { ProfileSyncService } from "./core/profile/profileSyncService.js";
import { StartupSyncService } from "./core/profile/startupSyncService.js";
import { ProviderCredentialSyncService } from "./core/profile/providerCredentialSyncService.js";
import { ThemeManager } from "./ui/theme/themeManager.js";
import { renderAppShell } from "./bootstrap/renderAppShell.js";
import { renderAddonRemotePage } from "./bootstrap/renderAddonRemotePage.js";
import { preloadStreamBadgeImages } from "./ui/screens/stream/streamScreen.js";
import { warmStreamingLibs } from "./runtime/loadStreamingLibs.js";
import { Platform } from "./platform/index.js";
import { TizenCapabilities } from "./platform/tizen/tizenCapabilities.js";
import { PluginServiceClient } from "./platform/pluginServiceClient.js";
import { getTvRuntimePerformanceProfile } from "./platform/tvRuntimePerformance.js";
import { LocalStore } from "./core/storage/localStore.js";
import { I18n } from "./i18n/index.js";
import { getLatestAppUpdateWithRetry } from "./core/update/appUpdateService.js";
import { shouldShowUpdate } from "./core/update/updateBannerPolicy.js";
import { showAppUpdatePrompt } from "./ui/components/appUpdatePrompt.js";
import { resolveExperienceRoute } from "./core/profile/experienceModeRouting.js";
import { PluginRuntime } from "./core/player/pluginRuntime.js";
import { ServerConfigurationStore } from "./data/local/serverConfigurationStore.js";
import { supportsEmailPasswordAuth } from "./core/server/serverConfiguration.js";

// These legacy Web-only overrides are no longer user settings. Navigation now
// uses the stable grid algorithm and simulator detection automatically.
LocalStore.remove("strictDpadGridNavigation");
LocalStore.remove("rotatedDpadMapping");

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
const SIGNED_OUT_ALLOWED_ROUTES = new Set([
  "trakt",
  "authQrSignIn",
  "authSignIn",
  "serverConnection"
]);
let hasSelectedProfileThisSession = false;
let appShellRendered = false;
let updateCheckStarted = false;

const APP_VERSION = typeof __NUVIO_APP_VERSION__ !== "undefined" ? __NUVIO_APP_VERSION__ : "0.0.0";
const UPDATE_DISMISSED_TAG_KEY = "app_update_dismissed_tag";
const UPDATE_ROUTE_WAIT_TIMEOUT_MS = 60_000;

function markBootStage(stage) {
  const guard = globalThis.NuvioBootGuard;
  if (guard && typeof guard.stage === "function") {
    guard.stage(stage);
  }
}

function loginTrace(event, data) {
  try {
    globalThis.__NUVIO_TIZEN_LOGIN_TRACE__?.(event, data);
  } catch (_) {
    // Login diagnostics must never change the application flow.
  }
}

function shouldDisableTizenPluginSupport() {
  return Platform.isTizen() && !TizenCapabilities.canUsePlugins();
}

async function waitForInitialRoute(timeoutMs = UPDATE_ROUTE_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (!Router.getCurrent() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return Boolean(Router.getCurrent());
}

async function checkForAppUpdateOnStartup() {
  if (updateCheckStarted) {
    return;
  }
  updateCheckStarted = true;

  try {
    // Tizen can spend longer restoring the authenticated route because the
    // WebView and profile-sync requests start cold. Do not let a fast GitHub
    // response get discarded while Router is still waiting for that route.
    if (!(await waitForInitialRoute())) {
      return;
    }

    const update = await getLatestAppUpdateWithRetry({ currentVersion: APP_VERSION });
    if (!update) {
      return;
    }
    const dismissedTag = LocalStore.get(UPDATE_DISMISSED_TAG_KEY, null);
    if (!shouldShowUpdate({ isRemoteNewer: true, dismissedTag, updateTag: update.tag })) {
      return;
    }
    showAppUpdatePrompt(update, {
      onClose: () => LocalStore.set(UPDATE_DISMISSED_TAG_KEY, update.tag)
    });
  } catch (error) {
    console.warn("App update check failed", error);
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
  // TV runtimes use the year/Chromium profile below. Their exposed
  // hardwareConcurrency/deviceMemory values are often coarse and would mark
  // otherwise modern TV generations as low-end by accident.
  if (getTvRuntimePerformanceProfile().isTvRuntime) {
    return false;
  }
  const hardware = Number(globalThis.navigator?.hardwareConcurrency || 0);
  const memory = Number(globalThis.navigator?.deviceMemory || 0);
  const lowCpu = Number.isFinite(hardware) && hardware > 0 && hardware <= 4;
  const lowMem = Number.isFinite(memory) && memory > 0 && memory <= 2;
  return lowCpu || lowMem;
}

function applyPerformanceMode() {
  const tvRuntime = getTvRuntimePerformanceProfile();
  const constrained = tvRuntime.isPerformanceConstrained || isLowEndDevice();
  const webOsMajorVersion = Platform.isWebOS() ? Number(Platform.getWebOsMajorVersion() || 0) : 0;
  const legacyWebOs = Platform.isWebOS() && tvRuntime.isLegacyTvRuntime;
  const legacyWebOs38 = Platform.isWebOS() && webOsMajorVersion > 0 && webOsMajorVersion <= 3;
  // Keep the Tizen class as a platform-layout fallback; performance gating is
  // handled exclusively by the runtime profile above.
  const legacyTizen = Platform.isTizen();
  const rootClasses = document.documentElement.classList;
  const modernSidebarBlurCapable = !rootClasses.contains("no-backdrop-filter") && !constrained;
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
  ["no-flex-gap", "no-css-grid", "no-aspect-ratio", "no-css-math", "no-backdrop-filter"].forEach(
    (className) => {
      document.body.classList.toggle(className, rootClasses.contains(className));
    }
  );
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
    const memberAccess = MemberAccessRepository.getCachedAccess();
    ThemeManager.apply({ enforceAccess: true, access: memberAccess });
    void MemberAccessRepository.getAccess().catch((error) => {
      console.warn("Profile member access refresh failed", error);
    });
    I18n.apply();
    void preloadStreamBadgeImages().catch((error) => {
      console.warn("Stream badge image prerender failed", error);
    });
  }
  const experienceRoute = activeProfile ? await resolveExperienceRoute(activeProfile.id) : "home";
  const resumeRoute =
    restoreWebOsRoute && typeof Router.consumeWebOsResumeRoute === "function"
      ? Router.consumeWebOsResumeRoute()
      : null;
  const isHomeResumeRoute = resumeRoute?.route === "home";

  if (experienceRoute !== "home") {
    await Router.navigate(experienceRoute, {}, { replaceHistory: true, skipStackPush: true });
  } else if (resumeRoute?.route && !isHomeResumeRoute) {
    await Router.navigate(resumeRoute.route, resumeRoute.params || {}, {
      replaceHistory: true,
      skipStackPush: true
    });
  } else {
    await Router.navigate("home", {
      ...(isHomeResumeRoute ? resumeRoute.params || {} : {}),
      ...(StartupSyncService.started ? { forceReload: true } : {})
    });
  }

  void StartupSyncService.requestSyncNow({
    notifyPullCompleted: ["home", "plugins"].includes(experienceRoute)
  }).catch((error) => {
    console.warn("Profile background sync failed", error);
  });
}

async function routeAfterAuthentication() {
  loginTrace("authenticated route begin", { currentRoute: Router.getCurrent() || "" });
  const profileRoute = await shouldShowProfileSelection();
  loginTrace("authenticated route profile decision", { show: profileRoute.show === true });
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
    void DeviceSessionRegistration.requestForegroundRegistration();
    ProviderCredentialSyncService.requestForegroundPull();
    StartupSyncService.requestForegroundSync();
    const current = Router.getCurrent();
    if (!current) {
      return;
    }
    recovering = true;
    try {
      if (document.body) {
        document.body.style.removeProperty("display");
      }
      const shouldReturnHome = !Router.isWebOsResumeRouteRestorable(current);
      if (shouldReturnHome) {
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

function setupProviderCredentialForegroundLifecycle() {
  let wasBackgrounded = document.visibilityState === "hidden" || document.webkitHidden === true;
  const requestAfterBackground = () => {
    if (!wasBackgrounded) return;
    wasBackgrounded = false;
    ProviderCredentialSyncService.requestForegroundPull();
    StartupSyncService.requestForegroundSync();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      wasBackgrounded = true;
    } else if (document.visibilityState === "visible") {
      requestAfterBackground();
    }
  });
  document.addEventListener("webkitvisibilitychange", () => {
    if (document.webkitHidden === true) {
      wasBackgrounded = true;
    } else {
      requestAfterBackground();
    }
  });
  window.addEventListener("pagehide", () => {
    wasBackgrounded = true;
  });
  window.addEventListener("pageshow", (event) => {
    if (event?.persisted) requestAfterBackground();
  });
  window.addEventListener("blur", () => {
    wasBackgrounded = true;
  });
  window.addEventListener("focus", requestAfterBackground);
}

function setupPluginRuntimeLifecycle() {
  const cancel = () => PluginRuntime.cancelAll();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cancel();
  });
  document.addEventListener("webkitvisibilitychange", () => {
    if (document.webkitHidden === true) cancel();
  });
  window.addEventListener("pagehide", cancel);
  window.addEventListener("beforeunload", cancel);
  document.addEventListener("nuvio:beforeExitApp", cancel);
}

function setupPluginServiceLifecycle() {
  if (!Platform.isTizen() || shouldDisableTizenPluginSupport()) {
    return;
  }

  const checkWhenForegrounded = () => {
    if (document.visibilityState === "hidden" || document.webkitHidden === true) {
      return;
    }
    void PluginServiceClient.checkLifecycleNow({ force: true }).catch(() => {
      // The lifecycle client emits one deduplicated warning for a failed
      // recovery round; foreground transitions must not duplicate it.
    });
  };

  // A foreground transition should recover a service that was killed while
  // the TV suspended the UI, without waiting for the next watchdog tick.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkWhenForegrounded();
    }
  });
  document.addEventListener("webkitvisibilitychange", () => {
    if (document.webkitHidden !== true) {
      checkWhenForegrounded();
    }
  });
  window.addEventListener("pageshow", checkWhenForegrounded);
  window.addEventListener("focus", checkWhenForegrounded);

  // Do not stop the service on app-specific navigation/visibility events. The
  // monitor belongs to the whole UI lifecycle and is stopped only on unload.
  window.addEventListener("beforeunload", () => {
    PluginServiceClient.stopLifecycleMonitor();
  });
}

async function bootstrapApp() {
  markBootStage("Rendering application shell");
  renderAppShell();
  appShellRendered = true;
  markBootStage("Initializing TV platform");
  Platform.init();
  setupPluginServiceLifecycle();
  if (shouldDisableTizenPluginSupport()) {
    markBootStage("PluginService disabled on Tizen below 6.0");
  } else {
    markBootStage("Starting optional PluginService");
    // The WRT bridge has already been loaded by index.html. Platform.init() is
    // therefore the first stable point at which the service can be started.
    // PluginService is optional: keep its watchdog/recovery loop active, but
    // never make the application shell wait for its initial /health response.
    void PluginServiceClient.startLifecycleMonitor().catch(() => {
      // Health diagnostics and the lifecycle watchdog own the retry/reporting
      // path. A failed optional service must not fail application bootstrap.
    });
  }
  applyPerformanceMode();
  markBootStage("Loading language resources");
  await I18n.init();

  markBootStage("Initializing navigation");
  Router.init();
  PlayerController.init();

  FocusEngine.init();
  setupProviderCredentialForegroundLifecycle();
  setupPluginRuntimeLifecycle();
  setupWebOsAppLifecycle();

  ThemeManager.apply();
  I18n.apply();
  warmStreamingLibs({ delayMs: 1400 });
  void checkForAppUpdateOnStartup();

  markBootStage("Restoring session");
  DeviceSessionRegistration.start();
  AuthManager.subscribe((state) => {
    if (state === AuthState.LOADING) {
      StartupSyncService.stop();
      ProviderCredentialSyncService.cancelForegroundPull();
      return;
    }

    if (state === AuthState.SIGNED_OUT) {
      StartupSyncService.stop();
      ProviderCredentialSyncService.cancelForegroundPull();
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
      const server = ServerConfigurationStore.getActive();
      if (supportsEmailPasswordAuth(server)) {
        Router.navigate("authSignIn");
      } else {
        Router.navigate("authQrSignIn", {
          onboardingMode: !hasSeenQr
        });
      }
    }

    if (state === AuthState.AUTHENTICATED) {
      loginTrace("authenticated subscriber begin", { currentRoute: Router.getCurrent() || "" });
      markBootStage("Loading profiles");
      LocalStore.remove(GUEST_QR_BYPASS_KEY);
      StartupSyncService.start({ runInitialPull: false });
      loginTrace("authenticated subscriber sync scheduled");
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
