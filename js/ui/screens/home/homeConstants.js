import { WATCH_PROGRESS_STARTED_THRESHOLD } from "../../../domain/model/watchProgress.js";

export const HERO_ROTATE_FIRST_DELAY_MS = 20000;
export const HERO_ROTATE_INTERVAL_MS = 10000;
export const HOME_LAYOUT_SEQUENCE = ["modern", "grid", "classic"];

export const CW_MAX_NEXT_UP_LOOKUPS = 32;
export const CW_MAX_NEXT_UP_CONCURRENCY = 4;
export const CW_MAX_ENRICHMENT_CONCURRENCY = 4;
export const CW_MAX_VISIBLE_ITEMS = 300;
export const CW_DISPLAY_SNAPSHOT_MAX_ITEMS = 50;
export const CW_RENDER_BATCH_ITEMS_DEFAULT = 30;
export const CW_RENDER_BATCH_ITEMS_CONSTRAINED = 18;
export const CW_RENDER_BATCH_ITEMS_LEGACY_TV = 12;
export const CW_RENDER_LOAD_AHEAD_ITEMS = 4;
export const CW_DAYS_CAP = 60;
export const CW_PROGRESS_START_THRESHOLD = WATCH_PROGRESS_STARTED_THRESHOLD;
export const CW_ENTER_DELAY_MS = 320;
export const CW_HOLD_DELAY_MS = 650;
export const CW_META_TIMEOUT_MS = 1800;
export const CW_META_TIMEOUT_TV_MS = 4200;
export const CW_NEXT_UP_META_TIMEOUT_MS = 2200;
export const CW_ENRICHMENT_CACHE_KEY = "homeContinueWatchingEnrichmentCache";
export const CW_DISPLAY_SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";
export const CW_DISPLAY_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CW_DISPLAY_SNAPSHOT_MAX_SCOPES = 4;
export const CW_ENRICHMENT_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const CW_NEXT_UP_NEW_SEASON_UNAIRED_WINDOW_DAYS = 7;

export const HOME_INITIAL_CATALOG_LOAD = 10;
export const HOME_MAX_ITEMS_PER_ROW_DEFAULT = 15;
export const HOME_MAX_ITEMS_PER_ROW_CONSTRAINED = 10;
export const HOME_MAX_ITEMS_PER_ROW_LEGACY_TV = 8;
// Android keeps up to 24 items in non-Modern catalog rows before reserving
// the See All slot. Runtime-specific lower limits remain intentional below.
export const HOME_MAX_ITEMS_PER_ROW_CLASSIC = 24;
// Android GridHomeContent receives a safe upper bound from the pipeline and
// trims it again using the actual number of adaptive columns.
export const HOME_GRID_SAFE_MAX_COLUMNS = 8;
export const HOME_GRID_DEFAULT_ROW_COUNT = 3;
export const HOME_GRID_COMPACT_ROW_COUNT = 2;
export const HOME_LOADING_ROW_ITEMS_DEFAULT = 10;
export const HOME_LOADING_ROW_ITEMS_CONSTRAINED = 8;
export const HOME_LOADING_ROW_ITEMS_LEGACY_TV = 6;
export const HOME_STABLE_GATE_TIMEOUT_MS = 5000;
export const HOME_ROW_TIMEOUT_MS = 3500;
export const HOME_ADDON_MANIFEST_TIMEOUT_MS = 3500;
export const HOME_CATALOG_REFRESH_TTL_MS = 15 * 60 * 1000;
export const HOME_ROW_RETRY_TIMEOUT_MS = 12000;
export const HOME_BACKGROUND_RENDER_DELAY_MS = 120;
export const HOME_BACKGROUND_RENDER_DELAY_LEGACY_MS = 180;
// Home artwork is decoded at whatever size the source serves. Measured on an
// LG k8lp the home screen held 179MB of decoded bitmaps while only 34MB was on
// screen, because a hydrated image is never released. Rows stay mounted, so the
// cost only ever grows and the renderer was killed around 477MB.
//
// Images this far outside the viewport give their bitmap back. The margin sits
// well beyond the hydration margin so moving between two rows cannot drop an
// image and immediately reload it.
export const HOME_LAZY_IMAGE_EVICT_MARGIN_PX = 1600;
export const HOME_LEGACY_LAZY_HYDRATION_DEBOUNCE_MS = 180;
export const HOME_LEGACY_LAZY_HYDRATION_MAX_PER_FRAME = 2;
export const HOME_LEGACY_HERO_BACKDROP_CROSSFADE_MS = 300;
export const HOME_MODERN_HERO_BACKDROP_CROSSFADE_MS = 400;
export const HOME_RETURN_FOCUS_STATE_KEY = "homeReturnFocusState";
export const HOME_PERF_DEBUG = Boolean(globalThis.__NUVIO_DEBUG_HOME_PERF__);
