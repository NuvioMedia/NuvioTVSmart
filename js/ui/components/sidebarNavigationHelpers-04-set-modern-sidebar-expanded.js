/* eslint-disable no-unused-vars */

import { Router } from "../navigation/routerState.js";

import { ProfileManager } from "../../core/profile/profileManager.js";

import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";

import { MemberAccessRepository } from "../../data/remote/supabase/memberAccessRepository.js";

import { I18n } from "../../i18n/index.js";

import { getTvRuntimePerformanceProfile } from "../../platform/tvRuntimePerformance.js";

import { syncSidebarStateClasses, scheduleRootSidebarTextFit } from "./sidebarNavigationHelpers-01-root-sidebar-items.js";

export function setModernSidebarExpanded(container, expanded) {
  const shell = container?.querySelector(".modern-sidebar-shell");
  if (!shell) {
    return false;
  }
  // Tizen fast path: Chromium 56-76 cannot composite the 395ms width +
  // 375ms panel scale animation at 60fps. Toggle instantly so menu
  // open/close feels wired instead of laggy. Class hooks
  // (performance-constrained / legacy-tizen) are set in js/app.js.
  const doc = globalThis?.document || null;
  const fastPath =
    Boolean(doc?.body?.classList?.contains("performance-constrained")) ||
    Boolean(doc?.documentElement?.classList?.contains("performance-constrained")) ||
    Boolean(doc?.body?.classList?.contains("legacy-tizen")) ||
    Boolean(doc?.documentElement?.classList?.contains("legacy-tizen"));
  if (fastPath) {
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
    const panel = shell.querySelector(".modern-sidebar-panel");
    const pill = shell.querySelector(".modern-sidebar-pill");
    shell.classList.remove("opening", "collapsing");
    if (expanded) {
      shell.classList.add("panel-visible", "expanded");
      if (panel) panel.setAttribute("aria-hidden", "false");
      if (pill) pill.setAttribute("aria-expanded", "true");
    } else {
      shell.classList.remove("expanded", "panel-visible");
      if (panel) panel.setAttribute("aria-hidden", "true");
      if (pill) pill.setAttribute("aria-expanded", "false");
    }
    syncSidebarStateClasses(container);
    scheduleRootSidebarTextFit(container);
    return true;
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
