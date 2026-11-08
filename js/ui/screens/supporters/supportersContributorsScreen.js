import { ScreenUtils } from "../../navigation/screen.js";
import { focusWithoutScroll } from "../../navigation/focusWithoutScroll.js";
import { Router } from "../../navigation/routerState.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";
import {
  SUPPORTERS_API_BASE_URL,
  SUPPORT_URL,
  SPONSOR_NAMES,
  UNIQUE_CONTRIBUTIONS_BASE_URL
} from "../../../config.js";
import { QrCodeGenerator } from "../../../core/qr/qrCodeGenerator.js";
import { MembershipOverviewRepository } from "../../../data/remote/supabase/membershipOverviewRepository.js";
import {
  normalizeContributors,
  normalizeSupporterMembers,
  parseSponsorNames
} from "./supportersData.js";
import {
  bindSettingsScrollIndicators,
  scrollSettingsContentItem,
  settingsScrollIndicatorMarkup
} from "../settings/settingsScreen.js";

import { createSupportersContributorsScreenMethods01 } from "./supportersContributorsScreenMethods-01-ensure-state.js";
import { createSupportersContributorsScreenMethods02 } from "./supportersContributorsScreenMethods-02-render-contributor-card.js";
import { createSupportersContributorsScreenMethods03 } from "./supportersContributorsScreenMethods-03-activate-target.js";

export {
  ScreenUtils,
  Router,
  Platform,
  I18n,
  SUPPORTERS_API_BASE_URL,
  SUPPORT_URL,
  SPONSOR_NAMES,
  UNIQUE_CONTRIBUTIONS_BASE_URL,
  QrCodeGenerator,
  MembershipOverviewRepository,
  normalizeContributors,
  normalizeSupporterMembers,
  parseSponsorNames,
  bindSettingsScrollIndicators,
  scrollSettingsContentItem,
  settingsScrollIndicatorMarkup,
  TABS,
  DEFAULT_TAB,
  PATREON_MEMBERSHIP_URL,
  CONTRIBUTOR_SUPPORT_LINKS,
  t,
  escapeHtml,
  normalizeBaseUrl,
  uniqueContributionsUrl,
  requestJson,
  formatSupporterDate,
  initialsForName,
  supporterTierLabel,
  contributorLogin,
  contributorRoleLabel,
  contributorSupportLink,
  focusNode,
  visibleFocusableNodes,
  findDirectionalTarget,
  sortedTabListItems,
  loadSupporters,
  loadSponsors,
  loadContributors
};
const TABS = ["supporters", "sponsors", "contributors"];
const DEFAULT_TAB = "contributors";
const PATREON_MEMBERSHIP_URL = "https://www.patreon.com/settings/memberships";
const CONTRIBUTOR_SUPPORT_LINKS = {
  skoruppa: { kofiUrl: "https://ko-fi.com/skoruppa" },
  crisszollo: { kofiUrl: "https://ko-fi.com/crisszollo" },
  whitegiso: { kofiUrl: "https://ko-fi.com/whitegiso" },
  edoedac0: { kofiUrl: "https://ko-fi.com/edoedac" }
};

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function uniqueContributionsUrl(value) {
  const baseUrl = normalizeBaseUrl(value);
  return baseUrl ? `${baseUrl}/api/unique-contributions` : "";
}

async function requestJson(url, errorMessage) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`${errorMessage}: ${response.status}`);
  }
  return await response.json();
}

function formatSupporterDate(rawDate) {
  const timestamp = Date.parse(String(rawDate || ""));
  if (!Number.isFinite(timestamp)) {
    return String(rawDate || "");
  }
  try {
    return new Intl.DateTimeFormat(I18n.getLocale(), {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(new Date(timestamp));
  } catch (_) {
    return new Date(timestamp).toLocaleDateString();
  }
}

function initialsForName(name) {
  return (
    String(name || "")
      .trim()
      .charAt(0)
      .toUpperCase() || "?"
  );
}

function supporterTierLabel(level) {
  return String(level || "").trim() === "SUPPORTER_PLUS"
    ? t("supporters_level_supporter_plus", {}, "Supporter+")
    : t("supporters_level_supporter", {}, "Supporter");
}

function contributorLogin(contributor) {
  return String(contributor?.githubLogin || contributor?.name || "").trim();
}

function contributorRoleLabel(login) {
  switch (String(login || "").toLowerCase()) {
    case "milicevicivan":
      return t("contributor_role_translator", {}, "Translator");
    case "tapframe":
      return t("contributor_role_maintainer", {}, "Maintainer");
    default:
      return null;
  }
}

function contributorSupportLink(login) {
  return CONTRIBUTOR_SUPPORT_LINKS[String(login || "").toLowerCase()] || null;
}

function focusNode(node) {
  focusWithoutScroll(node);
}

function visibleFocusableNodes(container) {
  return Array.from(container?.querySelectorAll?.(".focusable") || []).filter((node) => {
    if (node.disabled || node.getAttribute("aria-disabled") === "true") return false;
    const rect = node.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0;
  });
}

function findDirectionalTarget(nodes, current, direction) {
  if (!current || !nodes.length) return nodes[0] || null;
  const currentRect = current.getBoundingClientRect();
  const cx = currentRect.left + currentRect.width / 2;
  const cy = currentRect.top + currentRect.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;

  return (
    nodes
      .filter((node) => node !== current)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const nx = rect.left + rect.width / 2;
        const ny = rect.top + rect.height / 2;
        const primary = horizontal ? nx - cx : ny - cy;
        const secondary = horizontal ? Math.abs(ny - cy) : Math.abs(nx - cx);
        const alignedBonus =
          secondary <=
          (horizontal
            ? Math.max(currentRect.height, rect.height)
            : Math.max(currentRect.width, rect.width)) *
            0.7
            ? -10000
            : 0;
        return {
          node,
          primary,
          secondary,
          score: Math.abs(primary) * 1000 + secondary + alignedBonus
        };
      })
      .filter((entry) => entry.primary * sign > 2)
      .sort((left, right) => left.score - right.score)[0]?.node || null
  );
}

function sortedTabListItems(container, tab) {
  return Array.from(
    container?.querySelectorAll?.(`.supporters-person-card[data-tab="${tab}"]`) || []
  ).sort(
    (left, right) => Number(left.dataset.itemIndex || 0) - Number(right.dataset.itemIndex || 0)
  );
}

async function loadSupporters() {
  const baseUrl = normalizeBaseUrl(SUPPORTERS_API_BASE_URL);
  if (!baseUrl) {
    throw new Error(t("supporters_error_load", {}, "Unable to load supporters."));
  }
  const data = await requestJson(
    `${baseUrl}/api/supporters/wall`,
    t("supporters_error_api_http", {}, "Supporters API error")
  );
  return normalizeSupporterMembers(data?.top?.members);
}

async function loadSponsors() {
  if (!SPONSOR_NAMES) {
    throw new Error(t("sponsors_error_load", {}, "Unable to load sponsors."));
  }
  return parseSponsorNames(SPONSOR_NAMES);
}

async function loadContributors() {
  const url = uniqueContributionsUrl(UNIQUE_CONTRIBUTIONS_BASE_URL);
  if (!url) {
    throw new Error(
      t("contributors_error_api_not_configured", {}, "Contributors API is not configured.")
    );
  }
  const data = await requestJson(
    url,
    t("contributors_error_api_http", {}, "Contributors API error")
  );
  return normalizeContributors(data?.contributors);
}

export const SupportersContributorsScreen = {
  container: null,
  selectedTab: DEFAULT_TAB,
  focusKey: "tab:contributors",
  showMembershipQr: false,
  dialog: null,
  routeEnterPending: false,
  routeEnterTimer: null,
  state: null,
  membershipState: null,
  membershipUnsubscribe: null,
  scrollTops: null,
  preserveListScrollAfterFocus: false,
  ...createSupportersContributorsScreenMethods01(),
  ...createSupportersContributorsScreenMethods02(),
  ...createSupportersContributorsScreenMethods03()
};
