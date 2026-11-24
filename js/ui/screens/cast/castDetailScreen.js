import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import {
  normalizeTmdbLanguageCode,
  TmdbSettingsStore
} from "../../../data/local/tmdbSettingsStore.js";
import { containsCjkOrHangul, resolvePersonName } from "../../../core/tmdb/tmdbMetadataService.js";
import { Environment } from "../../../platform/environment.js";
import { TMDB_API_KEY } from "../../../config.js";
import { I18n } from "../../../i18n/index.js";
import {
  posterItemFromNode,
  PosterOptionsDialogController
} from "../../components/posterOptionsMenu.js";

import { createCastDetailScreenMethods01 } from "./castDetailScreenMethods-01-get-route-state-key.js";
import { createCastDetailScreenMethods02 } from "./castDetailScreenMethods-02-remember-focused-card.js";

export {
  Router,
  ScreenUtils,
  normalizeTmdbLanguageCode,
  TmdbSettingsStore,
  containsCjkOrHangul,
  resolvePersonName,
  Environment,
  TMDB_API_KEY,
  I18n,
  posterItemFromNode,
  PosterOptionsDialogController,
  TMDB_BASE_URL,
  POSTER_HOLD_DELAY_MS,
  t,
  escapeHtml,
  escapeAttribute,
  toImage,
  isBackEvent,
  getDirection
};
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// Android buildImageUrl(profilePath, "w500").
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const POSTER_HOLD_DELAY_MS = 650;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}

function toImage(path) {
  const value = String(path || "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (value.startsWith("/")) {
    return `${IMAGE_BASE_URL}${value}`;
  }
  return value;
}

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function getDirection(event) {
  const code = Number(event?.keyCode || 0);
  if (code === 37) return "left";
  if (code === 39) return "right";
  if (code === 38) return "up";
  if (code === 40) return "down";
  return null;
}

export const CastDetailScreen = {
  ...createCastDetailScreenMethods01(),
  ...createCastDetailScreenMethods02()
};
