import { Router } from "../navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";
import { I18n } from "../../i18n/index.js";
import { Platform } from "../../platform/index.js";

const ROOT_SIDEBAR_ITEMS = [
  {
    action: "gotoHome",
    route: "home",
    labelKey: "sidebar.home",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup:
      '<path d="M12 3.2 3.5 10v10.25c0 .69.56 1.25 1.25 1.25h5.5v-6.5h3.5v6.5h5.5c.69 0 1.25-.56 1.25-1.25V10L12 3.2Zm0 1.92 7 5.6v9.53h-4v-6.5H9v6.5H5v-9.53l7-5.6Z"/>'
  },
  {
    action: "gotoSearch",
    route: "search",
    labelKey: "sidebar.search",
    iconType: "svg",
    viewBox: "0 0 20 20",
    iconMarkup:
      '<path fill-rule="evenodd" d="M4 9a5 5 0 1110 0A5 5 0 014 9zm5-7a7 7 0 104.2 12.6.999.999 0 00.093.107l3 3a1 1 0 001.414-1.414l-3-3a.999.999 0 00-.107-.093A7 7 0 009 2z"/>'
  },
  {
    action: "gotoLibrary",
    route: "library",
    labelKey: "sidebar.library",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup:
      '<path d="M8.50989 2.00001H15.49C15.7225 1.99995 15.9007 1.99991 16.0565 2.01515C17.1643 2.12352 18.0711 2.78958 18.4556 3.68678H5.54428C5.92879 2.78958 6.83555 2.12352 7.94337 2.01515C8.09917 1.99991 8.27741 1.99995 8.50989 2.00001Z"/><path d="M6.31052 4.72312C4.91989 4.72312 3.77963 5.56287 3.3991 6.67691C3.39117 6.70013 3.38356 6.72348 3.37629 6.74693C3.77444 6.62636 4.18881 6.54759 4.60827 6.49382C5.68865 6.35531 7.05399 6.35538 8.64002 6.35547L8.75846 6.35547L15.5321 6.35547C17.1181 6.35538 18.4835 6.35531 19.5639 6.49382C19.9833 6.54759 20.3977 6.62636 20.7958 6.74693C20.7886 6.72348 20.781 6.70013 20.773 6.67691C20.3925 5.56287 19.2522 4.72312 17.8616 4.72312H6.31052Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.67239 7.54204H15.3276C18.7024 7.54204 20.3898 7.54204 21.3377 8.52887C22.2855 9.5157 22.0625 11.0403 21.6165 14.0896L21.1935 16.9811C20.8437 19.3724 20.6689 20.568 19.7717 21.284C18.8745 22 17.5512 22 14.9046 22H9.09536C6.44881 22 5.12553 22 4.22834 21.284C3.33115 20.568 3.15626 19.3724 2.80648 16.9811L2.38351 14.0896C1.93748 11.0403 1.71447 9.5157 2.66232 8.52887C3.61017 7.54204 5.29758 7.54204 8.67239 7.54204ZM8 18.0001C8 17.5859 8.3731 17.2501 8.83333 17.2501H15.1667C15.6269 17.2501 16 17.5859 16 18.0001C16 18.4144 15.6269 18.7502 15.1667 18.7502H8.83333C8.3731 18.7502 8 18.4144 8 18.0001Z"/>'
  },
  {
    action: "gotoSettings",
    route: "settings",
    labelKey: "sidebar.settings",
    iconType: "svg",
    viewBox: "0 0 24 24",
    iconMarkup:
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224ZM12.5 15C14.1695 15 15.5228 13.6569 15.5228 12C15.5228 10.3431 14.1695 9 12.5 9C10.8305 9 9.47716 10.3431 9.47716 12C9.47716 13.6569 10.8305 15 12.5 15Z"/>'
  }
];

let sidebarAvatarCatalogPromise = null;

function profileInitial(name) {
  const raw = String(name || "").trim();
  return raw ? raw.charAt(0).toUpperCase() : "P";
}

function iconMarkup(item, className = "root-sidebar-icon") {
  if (item?.iconType === "material") {
    return `<span class="${className} root-sidebar-icon-material material-icons" aria-hidden="true">${item.iconName}</span>`;
  }

  return `
    <svg class="${className} root-sidebar-icon-svg"
         viewBox="${item?.viewBox || "0 0 24 24"}"
         aria-hidden="true"
         focusable="false">
      ${item?.iconMarkup || ""}
    </svg>
  `;
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function getThemeAccentFallback() {
  const value = globalThis?.document
    ? getComputedStyle(document.documentElement).getPropertyValue("--secondary-color").trim()
    : "";
  return value || "#f5f5f5";
}

function itemLabel(item) {
  return t(item?.labelKey, {}, String(item?.label || item?.route || ""));
}

function syncSidebarStateClasses(container) {
  const root = container?.closest?.(".home-shell, .settings-shell, .library-shell") || container;
  if (!root?.classList) {
    return;
  }

  const legacySidebar = root.querySelector?.(".root-sidebar-legacy");
  const modernSidebar = root.querySelector?.(".modern-sidebar-shell");
  root.classList.toggle("has-modern-sidebar", Boolean(modernSidebar));
  root.classList.toggle(
    "has-collapsible-sidebar",
    Boolean(legacySidebar?.getAttribute("data-collapsible") === "true")
  );
  root.classList.toggle(
    "has-expanded-sidebar",
    Boolean(
      legacySidebar?.classList?.contains("expanded") ||
      modernSidebar?.classList?.contains("expanded")
    )
  );
}

function getSidebarTextFitTargets(container) {
  return Array.from(
    container?.querySelectorAll(
      [
        ".home-sidebar .home-nav-label",
        ".modern-sidebar-panel .modern-sidebar-nav-label",
        ".modern-sidebar-panel .modern-sidebar-profile-name",
        ".modern-sidebar-pill-label"
      ].join(", ")
    ) || []
  );
}

function fitSidebarLabel(node, minFontSizePx) {
  if (!node || !node.isConnected) {
    return false;
  }

  const targetWidth = node.getBoundingClientRect().width;
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    return false;
  }

  const previousInlineSize = node.style.fontSize;
  node.style.fontSize = "";

  const computedSize =
    Number.parseFloat(globalThis?.getComputedStyle ? getComputedStyle(node).fontSize : "") || 0;
  if (!computedSize) {
    node.style.fontSize = previousInlineSize;
    return false;
  }

  const currentWidth = node.scrollWidth;
  if (currentWidth <= node.clientWidth + 1) {
    node.style.fontSize = "";
    return true;
  }

  const minSize = Math.max(12, Number(minFontSizePx) || 12);
  let low = minSize;
  let high = computedSize;
  let best = minSize;

  for (let index = 0; index < 8 && high - low > 0.25; index += 1) {
    const mid = (low + high) / 2;
    node.style.fontSize = `${mid}px`;
    if (node.scrollWidth <= node.clientWidth + 1) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  node.style.fontSize = `${best}px`;
  return true;
}

function fitRootSidebarText(container) {
  const targets = getSidebarTextFitTargets(container);
  targets.forEach((node) => {
    if (node.matches(".home-nav-label")) {
      fitSidebarLabel(node, 24);
      return;
    }
    if (node.matches(".modern-sidebar-pill-label")) {
      fitSidebarLabel(node, 28);
      return;
    }
    if (node.matches(".modern-sidebar-profile-name")) {
      // Android TV AutoResizeText uses a 9sp floor; the Web TV canvas is 2x.
      fitSidebarLabel(node, 18);
      return;
    }
    fitSidebarLabel(node, 30);
  });
}

function scheduleRootSidebarTextFit(container) {
  if (!container) {
    return;
  }
  if (container._rootSidebarTextFitRaf) {
    cancelAnimationFrame(container._rootSidebarTextFitRaf);
  }
  container._rootSidebarTextFitRaf = requestAnimationFrame(() => {
    container._rootSidebarTextFitRaf = null;
    fitRootSidebarText(container);
  });
}

function getSelectedItem(routeName = "") {
  return (
    ROOT_SIDEBAR_ITEMS.find((item) => item.route === String(routeName || "")) ||
    ROOT_SIDEBAR_ITEMS[0]
  );
}

function getItemForAction(action = "") {
  return ROOT_SIDEBAR_ITEMS.find((item) => item.action === String(action || "")) || null;
}

function getModernSidebarPresentation(selectedRoute = "") {
  const route = String(selectedRoute || "")
    .trim()
    .toLowerCase();
  return {
    showPill: true,
    keepPillExpanded: route === "settings"
  };
}

function getSidebarAvatarCatalog() {
  if (!sidebarAvatarCatalogPromise) {
    sidebarAvatarCatalogPromise = AvatarRepository.getAvatarCatalog().catch(() => {
      sidebarAvatarCatalogPromise = null;
      return [];
    });
  }
  return sidebarAvatarCatalogPromise;
}

export async function getSidebarProfileState() {
  const activeProfileId = String(ProfileManager.getActiveProfileId() || "");
  const [profiles, avatarCatalog] = await Promise.all([
    ProfileManager.getProfiles(),
    getSidebarAvatarCatalog()
  ]);
  const activeProfile =
    profiles.find(
      (profile) => String(profile.id || profile.profileIndex || "1") === activeProfileId
    ) ||
    profiles[0] ||
    null;
  const activeProfileAvatarUrl =
    String(activeProfile?.avatarUrl || "").trim() ||
    AvatarRepository.getAvatarImageUrl(activeProfile?.avatarId, avatarCatalog);

  return {
    activeProfileName:
      String(activeProfile?.name || t("sidebar.profileFallback")).trim() ||
      t("sidebar.profileFallback"),
    activeProfileInitial: profileInitial(activeProfile?.name || t("sidebar.profileFallback")),
    activeProfileColorHex: String(activeProfile?.avatarColorHex || getThemeAccentFallback()),
    activeProfileAvatarUrl: String(activeProfileAvatarUrl || ""),
    showProfileSelector: Boolean(activeProfile)
  };
}

export function activateLegacySidebarAction(action, currentRoute = "") {
  const normalizedAction = String(action || "");
  if (!normalizedAction) {
    return;
  }
  if (normalizedAction === "gotoAccount") {
    Router.navigate("profileSelection");
    return;
  }

  const target = getItemForAction(normalizedAction);
  if (!target) {
    return;
  }
  if (target.route === currentRoute) {
    // Re-selecting the tab you are already on. Let the screen react, e.g. Home
    // scrolls back to the top, matching the Android TV app.
    Router.getCurrentScreen()?.onSidebarReselect?.();
    return;
  }
  Router.navigate(target.route);
}

export function isSelectedSidebarAction(action, selectedRoute = "") {
  return getItemForAction(action)?.route === String(selectedRoute || "");
}

export function renderLegacySidebar({ selectedRoute = "home", profile = null, layout = {} } = {}) {
  const selectedItem = getSelectedItem(selectedRoute);
  const profileState = profile || {};
  const showProfileSelector = Boolean(
    profileState.showProfileSelector && profileState.activeProfileName
  );
  const collapsible = Boolean(layout?.collapseSidebar);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <aside class="home-sidebar root-sidebar root-sidebar-legacy${performanceConstrained ? " performance-constrained" : ""}"
           data-selected-route="${selectedRoute}"
           data-collapsible="${collapsible ? "true" : "false"}">
      ${
        showProfileSelector
          ? `
        <button class="home-profile-pill focusable"
                data-nav-zone="sidebar"
                data-nav-index="0"
                data-action="gotoAccount"
                aria-label="${t("sidebar.switchProfile")}">
          <span class="home-profile-avatar" style="background:${profileState.activeProfileColorHex || getThemeAccentFallback()}">
            ${
              profileState.activeProfileAvatarUrl
                ? `<img class="sidebar-profile-avatar-image" src="${profileState.activeProfileAvatarUrl}" alt="${profileState.activeProfileName || t("sidebar.profileFallback")}" />`
                : profileState.activeProfileInitial || "P"
            }
          </span>
          <span class="home-profile-name">${profileState.activeProfileName || t("sidebar.profileFallback")}</span>
        </button>
      `
          : ""
      }
      <div class="home-nav-list">
        ${ROOT_SIDEBAR_ITEMS.map(
          (item, index) => `
          <button class="home-nav-item focusable${selectedItem.action === item.action ? " selected" : ""}"
                  data-nav-zone="sidebar"
                  data-nav-index="${showProfileSelector ? index + 1 : index}"
                  data-action="${item.action}"
                  aria-label="${itemLabel(item)}">
            <span class="home-nav-icon-wrap">${iconMarkup(item, "home-nav-icon")}</span>
            <span class="home-nav-label">${itemLabel(item)}</span>
          </button>
        `
        ).join("")}
      </div>
    </aside>
  `;
}

export function renderModernSidebar({
  selectedRoute = "home",
  profile = null,
  expanded = false,
  pillIconOnly = false,
  blurEnabled = false
} = {}) {
  const selectedItem = getSelectedItem(selectedRoute);
  const profileState = profile || {};
  const showProfileSelector = Boolean(
    profileState.showProfileSelector && profileState.activeProfileName
  );
  const { keepPillExpanded } = getModernSidebarPresentation(selectedRoute);
  const showPill = selectedItem.route !== "search";
  const selectedLabel = itemLabel(selectedItem);
  const performanceConstrained = Platform.isWebOS() || Platform.isTizen();

  return `
    <div class="modern-sidebar-shell${expanded ? " expanded panel-visible" : ""}${blurEnabled ? " blur-enabled" : ""}${keepPillExpanded ? " keep-pill-expanded" : ""}${performanceConstrained ? " performance-constrained" : ""}" data-selected-route="${selectedRoute}">
      ${
        showPill
          ? `
        <button class="modern-sidebar-pill${pillIconOnly && !keepPillExpanded ? " icon-only" : ""}"
                data-nav-zone="sidebar"
                data-nav-index="0"
                data-action="expandSidebar"
                aria-label="${t("sidebar.expandSidebar")}" aria-expanded="${expanded ? "true" : "false"}">
          <img class="modern-sidebar-pill-chevron" src="assets/icons/ic_chevron_compact_left.png" alt="" aria-hidden="true" />
          <span class="modern-sidebar-pill-chip">
            <span class="modern-sidebar-pill-icon-wrap">${iconMarkup(selectedItem, "modern-sidebar-pill-icon")}</span>
            <span class="modern-sidebar-pill-label">${selectedLabel}</span>
          </span>
        </button>
      `
          : ""
      }
      <aside class="modern-sidebar-panel" aria-hidden="${expanded ? "false" : "true"}">
        ${
          showProfileSelector
            ? `
          <button class="modern-sidebar-profile focusable"
                  data-nav-zone="sidebar"
                  data-nav-index="${showPill ? 1 : 0}"
                  data-action="gotoAccount" aria-label="${t("sidebar.switchProfile")}">
            <span class="modern-sidebar-profile-avatar" style="background:${profileState.activeProfileColorHex || getThemeAccentFallback()}">
              ${
                profileState.activeProfileAvatarUrl
                  ? `<img class="sidebar-profile-avatar-image" src="${profileState.activeProfileAvatarUrl}" alt="${profileState.activeProfileName || t("sidebar.profileFallback")}" />`
                  : profileState.activeProfileInitial || "P"
              }
            </span>
            <span class="modern-sidebar-profile-name">${profileState.activeProfileName || t("sidebar.profileFallback")}</span>
          </button>
        `
            : ""
        }
        <div class="modern-sidebar-nav-list">
          ${ROOT_SIDEBAR_ITEMS.map(
            (item, index) => `
            <button class="modern-sidebar-nav-item focusable${selectedItem.action === item.action ? " selected" : ""}"
                    data-nav-zone="sidebar"
                    data-nav-index="${(showPill ? 1 : 0) + (showProfileSelector ? 1 : 0) + index}"
                    data-action="${item.action}"
                    aria-label="${itemLabel(item)}">
              <span class="modern-sidebar-nav-icon-circle">
                ${iconMarkup(item, "modern-sidebar-nav-icon")}
              </span>
              <span class="modern-sidebar-nav-label">${itemLabel(item)}</span>
            </button>
          `
          ).join("")}
        </div>
      </aside>
    </div>
  `;
}

export function isModernSidebarBlurAvailable() {
  return Boolean(
    globalThis.document?.documentElement?.classList?.contains("modern-sidebar-blur-capable")
  );
}

export function renderRootSidebar({
  selectedRoute = "home",
  profile = null,
  layout = {},
  expanded = false,
  pillIconOnly = false
} = {}) {
  if (layout?.modernSidebar) {
    return renderModernSidebar({
      selectedRoute,
      profile,
      expanded,
      pillIconOnly,
      blurEnabled: Boolean(layout?.modernSidebarBlur) && isModernSidebarBlurAvailable()
    });
  }
  return renderLegacySidebar({ selectedRoute, profile, layout });
}

export function bindRootSidebarEvents(
  container,
  { currentRoute = "", onExpandSidebar = null, onSelectedAction = null } = {}
) {
  const focusables = Array.from(
    container?.querySelectorAll(".home-sidebar .focusable, .modern-sidebar-panel .focusable") || []
  );

  const moveSidebarFocus = (currentNode, delta) => {
    const nodes = focusables.filter((node) => node.isConnected);
    const currentIndex = nodes.indexOf(currentNode);
    if (currentIndex === -1) {
      return false;
    }
    const nextIndex = Math.max(0, Math.min(nodes.length - 1, currentIndex + delta));
    const target = nodes[nextIndex] || null;
    if (!target || target === currentNode) {
      return true;
    }
    nodes.forEach((node) => node.classList.remove("focused"));
    target.classList.add("focused");
    focusWithoutAutoScroll(target);
    return true;
  };

  focusables.forEach((node) => {
    node.onclick = async (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const action = String(node.dataset.action || "");
      activateLegacySidebarAction(action, currentRoute);
      if (isSelectedSidebarAction(action, currentRoute) && typeof onSelectedAction === "function") {
        await onSelectedAction(node);
      }
    };

    node.onkeydown = (event) => {
      const keyCode = Number(event?.keyCode || 0);
      if (keyCode === 38) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        moveSidebarFocus(node, -1);
        return;
      }
      if (keyCode === 40) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        moveSidebarFocus(node, 1);
      }
    };
  });

  container
    ?.querySelectorAll(".modern-sidebar-pill[data-action='expandSidebar']")
    .forEach((node) => {
      node.onclick = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        if (typeof onExpandSidebar === "function") {
          onExpandSidebar(node);
        }
      };
    });

  scheduleRootSidebarTextFit(container);
  syncSidebarStateClasses(container);
}

export function setLegacySidebarExpanded(container, expanded) {
  const sidebar = container?.querySelector(".home-sidebar");
  if (!sidebar) {
    return;
  }
  if (sidebar._legacyOpenTimer) {
    clearTimeout(sidebar._legacyOpenTimer);
    sidebar._legacyOpenTimer = null;
  }
  const shouldExpand = Boolean(expanded);
  if (shouldExpand) {
    sidebar.classList.add("opening");
    sidebar.classList.add("content-expanded");
    syncSidebarStateClasses(container);
    void sidebar.offsetWidth;
    requestAnimationFrame(() => {
      sidebar.classList.add("expanded");
      syncSidebarStateClasses(container);
    });
    sidebar._legacyOpenTimer = setTimeout(() => {
      sidebar.classList.remove("opening");
      sidebar._legacyOpenTimer = null;
      scheduleRootSidebarTextFit(container);
      syncSidebarStateClasses(container);
    }, 350);
    scheduleRootSidebarTextFit(container);
    return;
  }

  sidebar.classList.remove("opening");
  sidebar.classList.remove("content-expanded");
  syncSidebarStateClasses(container);
  void sidebar.offsetWidth;
  requestAnimationFrame(() => {
    sidebar.classList.remove("expanded");
    scheduleRootSidebarTextFit(container);
    syncSidebarStateClasses(container);
  });
  scheduleRootSidebarTextFit(container);
}

export function getLegacySidebarNodes(container) {
  return Array.from(container?.querySelectorAll(".home-sidebar .focusable") || []).filter(
    (node) => !node.closest(".modern-sidebar-panel")
  );
}

export function getLegacySidebarSelectedNode(container) {
  return (
    container?.querySelector(".home-sidebar .home-nav-item.selected") ||
    container?.querySelector(".home-sidebar .home-nav-item") ||
    container?.querySelector(".home-sidebar .focusable") ||
    null
  );
}

export function handleLegacySidebarBack(screen, event) {
  const keyCode = Number(event?.keyCode || 0);
  const isBackEvent = keyCode === 8 || keyCode === 27 || keyCode === 461 || keyCode === 10009;
  if (!isBackEvent) {
    return false;
  }

  event?.preventDefault?.();

  const current =
    screen?.container?.querySelector(".focusable.focused") || document.activeElement || null;
  const sidebarFocused = Boolean(current?.closest?.(".home-sidebar"));

  if (sidebarFocused) {
    Router.navigate("home");
    return true;
  }

  if (typeof screen?.focusSidebarNode === "function") {
    screen.focusSidebarNode();
    return true;
  }

  if (screen && typeof screen.applyFocus === "function") {
    const nodes = getLegacySidebarNodes(screen.container);
    const selected = getLegacySidebarSelectedNode(screen.container);
    screen.focusZone = "sidebar";
    screen.sidebarFocusIndex = Math.max(0, nodes.indexOf(selected));
    screen.applyFocus();
    return true;
  }

  return false;
}

export function getModernSidebarNodes(container) {
  return Array.from(container?.querySelectorAll(".modern-sidebar-panel .focusable") || []);
}

export function getModernSidebarSelectedNode(container) {
  return (
    container?.querySelector(".modern-sidebar-panel .modern-sidebar-nav-item.selected") ||
    container?.querySelector(".modern-sidebar-panel .modern-sidebar-nav-item") ||
    container?.querySelector(".modern-sidebar-panel .focusable") ||
    null
  );
}

export function getRootSidebarNodes(container, layout = {}) {
  return layout?.modernSidebar
    ? getModernSidebarNodes(container)
    : getLegacySidebarNodes(container);
}

export function getRootSidebarSelectedNode(container, layout = {}) {
  return layout?.modernSidebar
    ? getModernSidebarSelectedNode(container)
    : getLegacySidebarSelectedNode(container);
}

export function isRootSidebarNode(node) {
  return Boolean(node?.closest?.(".home-sidebar, .modern-sidebar-panel"));
}

export function setModernSidebarPillIconOnly(container, iconOnly, keepExpanded = false) {
  const shell = container?.querySelector(".modern-sidebar-shell");
  const pill = container?.querySelector(".modern-sidebar-pill");
  const shouldKeepExpanded = Boolean(
    keepExpanded || shell?.classList?.contains("keep-pill-expanded")
  );
  if (!pill || shouldKeepExpanded) {
    pill?.classList.remove("icon-only");
    return;
  }
  pill.classList.toggle("icon-only", Boolean(iconOnly));
}

export function setModernSidebarExpanded(container, expanded) {
  const shell = container?.querySelector(".modern-sidebar-shell");
  if (!shell) {
    return false;
  }
  const panel = shell.querySelector(".modern-sidebar-panel");
  const pill = shell.querySelector(".modern-sidebar-pill");
  if (shell._modernOpenTimer) {
    clearTimeout(shell._modernOpenTimer);
    shell._modernOpenTimer = null;
  }
  if (shell._modernCloseStartTimer) {
    clearTimeout(shell._modernCloseStartTimer);
    shell._modernCloseStartTimer = null;
  }
  if (shell._modernCloseEndTimer) {
    clearTimeout(shell._modernCloseEndTimer);
    shell._modernCloseEndTimer = null;
  }

  if (expanded) {
    shell.classList.add("panel-visible", "opening");
    shell.classList.remove("collapsing");
    syncSidebarStateClasses(container);
    if (panel) {
      panel.setAttribute("aria-hidden", "false");
    }
    if (pill) {
      pill.setAttribute("aria-expanded", "true");
    }
    requestAnimationFrame(() => {
      shell.classList.add("expanded");
      syncSidebarStateClasses(container);
    });
    shell._modernOpenTimer = setTimeout(() => {
      shell.classList.remove("opening");
      shell._modernOpenTimer = null;
      scheduleRootSidebarTextFit(container);
      syncSidebarStateClasses(container);
    }, 365);
    scheduleRootSidebarTextFit(container);
    return true;
  }

  shell.classList.add("collapsing");
  shell.classList.remove("opening");
  syncSidebarStateClasses(container);
  if (pill) {
    pill.setAttribute("aria-expanded", "false");
  }
  shell._modernCloseStartTimer = setTimeout(() => {
    shell.classList.remove("expanded");
    shell._modernCloseStartTimer = null;
    syncSidebarStateClasses(container);
  }, 70);
  shell._modernCloseEndTimer = setTimeout(() => {
    shell.classList.remove("panel-visible", "collapsing");
    if (panel) {
      panel.setAttribute("aria-hidden", "true");
    }
    shell._modernCloseEndTimer = null;
    scheduleRootSidebarTextFit(container);
    syncSidebarStateClasses(container);
  }, 430);
  scheduleRootSidebarTextFit(container);
  return true;
}

export function focusWithoutAutoScroll(node) {
  if (!node || typeof node.focus !== "function") {
    return;
  }
  try {
    node.focus({ preventScroll: true });
  } catch (_) {
    node.focus();
  }
}
