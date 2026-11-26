import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import {
  CloudLibraryPlaybackProgressStore,
  CloudLibraryPlaybackSessionStore
} from "../../../data/local/cloudLibraryPlaybackStore.js";
import { I18n } from "../../../i18n/index.js";
import {
  LibraryController,
  LIBRARY_PRIVACY_OPTIONS,
  LIBRARY_VIEW_MODE
} from "./libraryController.js";
import { LibrarySourceMode } from "../../../data/repository/libraryRepository.js";
import { renderContentFilterPicker } from "../../components/filterPicker.js";
import {
  PosterOptionsDialogController,
  posterItemFromNode
} from "../../components/posterOptionsMenu.js";
import { isTitleItemWatched, renderTitleWatchedBadge } from "../../components/watchedTitleBadge.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import { allowDpadRepeat, resetDpadRepeat } from "../../navigation/dpadRepeatThrottle.js";
import { scrollFocusedIntoContainer } from "../../navigation/scrollFocusedIntoContainer.js";

import { createLibraryScreenMethods01 } from "./libraryScreenMethods-01-clear-closing-picker.js";
import { createLibraryScreenMethods02 } from "./libraryScreenMethods-02-render-picker-groups.js";
import { createLibraryScreenMethods03 } from "./libraryScreenMethods-03-update-rendered-library-content.js";
import { createLibraryScreenMethods04 } from "./libraryScreenMethods-04-render.js";
import { createLibraryScreenMethods05 } from "./libraryScreenMethods-05-resolve-preferred-picker-row-node.js";
import { createLibraryScreenMethods06 } from "./libraryScreenMethods-06-handle-privacy-memory-navigation.js";
import { createLibraryScreenMethods07 } from "./libraryScreenMethods-07-activate-node.js";
import { createLibraryScreenMethods08 } from "./libraryScreenMethods-08-cleanup.js";

export {
  Router,
  ScreenUtils,
  Environment,
  Platform,
  LayoutPreferences,
  CloudLibraryPlaybackProgressStore,
  CloudLibraryPlaybackSessionStore,
  I18n,
  LibraryController,
  LIBRARY_PRIVACY_OPTIONS,
  LIBRARY_VIEW_MODE,
  LibrarySourceMode,
  renderContentFilterPicker,
  PosterOptionsDialogController,
  posterItemFromNode,
  isTitleItemWatched,
  renderTitleWatchedBadge,
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  focusWithoutAutoScroll,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded,
  renderLoadingIndicator,
  allowDpadRepeat,
  resetDpadRepeat,
  POSTER_HOLD_DELAY_MS,
  PICKER_MENU_EXIT_MS,
  escapeHtml,
  t,
  bookmarkOutlineSvg,
  isTextField,
  selectorValue,
  scrollIntoNearestView,
  scrollFocusedIntoContainer,
  findNearestNodeByCenterX,
  groupNodesByRow,
  filterStructureSignature
};
const POSTER_HOLD_DELAY_MS = 650;
const PICKER_MENU_EXIT_MS = 160;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function bookmarkOutlineSvg() {
  return `
    <svg viewBox="0 0 80 80" class="library-empty-icon" aria-hidden="true" focusable="false">
      <path d="M25 15h30c3.3 0 6 2.7 6 6v40L40 51 19 61V21c0-3.3 2.7-6 6-6z"
            fill="none"
            stroke="currentColor"
            stroke-width="5.5"
            stroke-linecap="round"
            stroke-linejoin="round" />
    </svg>
  `;
}

function isTextField(node) {
  const tagName = String(node?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function selectorValue(value) {
  const raw = String(value || "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function scrollIntoNearestView(node) {
  if (!node || typeof node.scrollIntoView !== "function") {
    return;
  }
  try {
    node.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest"
    });
  } catch (_) {
    node.scrollIntoView();
  }
}

function findNearestNodeByCenterX(referenceNode, nodes = []) {
  if (!referenceNode || !nodes.length) {
    return nodes[0] || null;
  }
  const referenceRect = referenceNode.getBoundingClientRect();
  const referenceCenter = referenceRect.left + referenceRect.width / 2;
  let bestNode = nodes[0] || null;
  let bestDistance = Number.POSITIVE_INFINITY;
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const distance = Math.abs(center - referenceCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node;
    }
  });
  return bestNode;
}

function groupNodesByRow(nodes = [], tolerance = 28) {
  const rows = [];
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const top = rect.top;
    const existingRow = rows.find((row) => Math.abs(row.top - top) <= tolerance);
    if (existingRow) {
      existingRow.nodes.push(node);
      return;
    }
    rows.push({
      top,
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

function filterStructureSignature(state = {}) {
  return [
    state.sourceMode === LibrarySourceMode.LOCAL ? "local" : "remote",
    Array.isArray(state.availableGenres) && state.availableGenres.length ? "genre" : "no-genre",
    Array.isArray(state.availableYears) && state.availableYears.length ? "year" : "no-year",
    "watched"
  ].join("|");
}

export const LibraryScreen = {
  ...createLibraryScreenMethods01(),
  ...createLibraryScreenMethods02(),
  ...createLibraryScreenMethods03(),
  ...createLibraryScreenMethods04(),
  ...createLibraryScreenMethods05(),
  ...createLibraryScreenMethods06(),
  ...createLibraryScreenMethods07(),
  ...createLibraryScreenMethods08()
};
