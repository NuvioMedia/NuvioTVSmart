/* eslint-disable no-unused-vars */

import { Router } from "../navigation/routerState.js";

import { ProfileManager } from "../../core/profile/profileManager.js";

import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";

import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";

import { I18n } from "../../i18n/index.js";

import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

export const ROOT_SIDEBAR_ITEMS = [
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

export const DISCOVER_SIDEBAR_ITEM = {
  action: "gotoDiscover",
  route: "discover",
  labelKey: "discover_title",
  iconType: "material",
  iconName: "explore"
};

export function sidebarItems(layout = {}) {
  if (String(layout?.discoverLocation || "in_search") !== "in_sidebar") {
    return ROOT_SIDEBAR_ITEMS;
  }
  return [ROOT_SIDEBAR_ITEMS[0], ROOT_SIDEBAR_ITEMS[1], DISCOVER_SIDEBAR_ITEM, ...ROOT_SIDEBAR_ITEMS.slice(2)];
}

export const sidebarAvatarCatalogPromises = new Map();

export function profileInitial(name) {
  const raw = String(name || "").trim();
  return raw ? raw.charAt(0).toUpperCase() : "P";
}

export function iconMarkup(item, className = "root-sidebar-icon") {
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

export function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function getThemeAccentFallback() {
  const value = globalThis?.document ? getComputedStyle(document.documentElement).getPropertyValue("--secondary-color").trim() : "";
  return value || "#f5f5f5";
}

export function itemLabel(item) {
  return t(item?.labelKey, {}, String(item?.label || item?.route || ""));
}

export function syncSidebarStateClasses(container) {
  const rootSelector = ".home-shell, .settings-shell, .library-shell";
  const root =
    (container?.matches?.(rootSelector) && container) ||
    container?.closest?.(rootSelector) ||
    container?.querySelector?.(rootSelector) ||
    container;
  if (!root?.classList) {
    return;
  }

  const legacySidebar = root.querySelector?.(".root-sidebar-legacy");
  const modernSidebar = root.querySelector?.(".modern-sidebar-shell");
  root.classList.toggle("has-modern-sidebar", Boolean(modernSidebar));
  root.classList.toggle("has-collapsible-sidebar", Boolean(legacySidebar?.getAttribute("data-collapsible") === "true"));
  root.classList.toggle(
    "has-expanded-sidebar",
    Boolean(legacySidebar?.classList?.contains("expanded") || modernSidebar?.classList?.contains("expanded"))
  );
}

export function getSidebarTextFitTargets(container) {
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

export function fitSidebarLabel(node, minFontSizePx) {
  if (!node || !node.isConnected) {
    return false;
  }

  const targetWidth = node.getBoundingClientRect().width;
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    return false;
  }

  const previousInlineSize = node.style.fontSize;
  node.style.fontSize = "";

  const computedSize = Number.parseFloat(globalThis?.getComputedStyle ? getComputedStyle(node).fontSize : "") || 0;
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

export function fitRootSidebarText(container) {
  const targets = getSidebarTextFitTargets(container);
  targets.forEach((node) => {
    if (node.matches(".modern-sidebar-pill-label")) {
      fitSidebarLabel(node, 28);
      return;
    }
    // Android TV AutoResizeText uses a 9sp floor; the Web TV canvas is 2x.
    fitSidebarLabel(node, 18);
  });
}

export function scheduleRootSidebarTextFit(container) {
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

export function getSelectedItem(routeName = "") {
  return [...ROOT_SIDEBAR_ITEMS, DISCOVER_SIDEBAR_ITEM].find((item) => item.route === String(routeName || "")) || ROOT_SIDEBAR_ITEMS[0];
}

export function getItemForAction(action = "") {
  return [...ROOT_SIDEBAR_ITEMS, DISCOVER_SIDEBAR_ITEM].find((item) => item.action === String(action || "")) || null;
}

export function getModernSidebarPresentation(selectedRoute = "") {
  const route = String(selectedRoute || "")
    .trim()
    .toLowerCase();
  return {
    showPill: true,
    keepPillExpanded: route === "settings"
  };
}
