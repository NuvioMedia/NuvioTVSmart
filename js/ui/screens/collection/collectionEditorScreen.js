import { Router } from "../../navigation/routerState.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { CollectionsStore, CollectionPosterShape } from "../../../data/local/collectionsStore.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { I18n } from "../../../i18n/index.js";
import {
  COLLECTION_TILE_SHAPES,
  COLLECTION_VIEW_MODES,
  TMDB_PRESETS,
  TMDB_SORT_OPTIONS,
  TRAKT_SORTS,
  TRAKT_SORT_HOWS,
  addSourceToFolder,
  addSourcesToFolder,
  buildAddonCatalogSource,
  buildTmdbCollectionSource,
  buildTraktListSource,
  buildTmdbSourcesFromState,
  buildTraktSourcesFromState,
  canSaveCollectionDraft,
  createEmptyCollectionDraft,
  createEmptyFolderDraft,
  createTmdbSourceState,
  createTraktSourceState,
  emptyTmdbFilters,
  moveSourceInFolder,
  nextInList,
  normalizeTmdbDraftFilters,
  parseNumericSourceId,
  removeSourceFromFolder,
  replaceSourceInFolder,
  sourceIdentity,
  tmdbModeUsesFilters,
  tmdbModeUsesMediaControls,
  tmdbSortOptionsForMode,
  titleWithMediaSuffix,
  toggleCatalogSource
} from "../../../core/collections/collectionEditorModel.js";
import { collectionSourceResolver } from "../../../core/collections/collectionSourceResolver.js";

function t(key, fallback) {
  return I18n.t(key, {}, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SELECT_KEY_CODES = new Set([13, 23, 66, 160]);
const VIEW_MODE_LABELS = {
  TABBED_GRID: "collections_editor_view_mode_tabs",
  ROWS: "collections_editor_view_mode_rows",
  FOLLOW_LAYOUT: "collections_editor_view_mode_follow"
};
const TILE_SHAPE_LABELS = {
  POSTER: "collections_editor_shape_poster",
  LANDSCAPE: "collections_editor_shape_wide",
  SQUARE: "collections_editor_shape_square"
};

function viewModeLabel(mode) {
  return t(VIEW_MODE_LABELS[mode] || VIEW_MODE_LABELS.TABBED_GRID, mode);
}

function tileShapeLabel(shape) {
  return t(TILE_SHAPE_LABELS[shape] || TILE_SHAPE_LABELS.SQUARE, shape);
}

const TMDB_MODE_KEYS = {
  PRESETS: "collections_editor_tmdb_mode_presets",
  LIST: "collections_editor_tmdb_mode_public_list",
  PRODUCTION: "collections_editor_tmdb_mode_production",
  NETWORK: "collections_editor_tmdb_mode_network",
  COLLECTION: "collections_editor_tmdb_collection",
  PERSON: "collections_editor_tmdb_mode_person",
  DIRECTOR: "collections_editor_tmdb_mode_director",
  DISCOVER: "collections_editor_tmdb_mode_custom"
};
const TMDB_MODE_ORDER = [
  "PRESETS",
  "LIST",
  "PRODUCTION",
  "NETWORK",
  "COLLECTION",
  "PERSON",
  "DIRECTOR",
  "DISCOVER"
];
const TMDB_MODE_TO_SOURCE_TYPE = {
  LIST: "LIST",
  PRODUCTION: "COMPANY",
  NETWORK: "NETWORK",
  COLLECTION: "COLLECTION",
  PERSON: "PERSON",
  DIRECTOR: "DIRECTOR",
  DISCOVER: "DISCOVER",
  PRESETS: "PRESETS"
};
const SOURCE_TYPE_TO_TMDB_MODE = Object.fromEntries(
  Object.entries(TMDB_MODE_TO_SOURCE_TYPE).map(([mode, type]) => [type, mode])
);
const TMDB_SORT_LABEL_KEYS = {
  [TMDB_SORT_OPTIONS.ORIGINAL]: "collections_editor_sort_original",
  [TMDB_SORT_OPTIONS.POPULAR]: "tmdb_entity_rail_popular",
  [TMDB_SORT_OPTIONS.VOTE_AVERAGE]: "tmdb_entity_rail_top_rated",
  [TMDB_SORT_OPTIONS.VOTE_COUNT]: "tmdb_entity_rail_most_voted",
  [TMDB_SORT_OPTIONS.RECENT]: "tmdb_entity_rail_recent",
  [TMDB_SORT_OPTIONS.RECENT_TV]: "tmdb_entity_rail_recent"
};
const TRAKT_SORT_LABEL_KEYS = {
  rank: "collections_editor_sort_list_order",
  added: "collections_editor_sort_recently_added",
  title: "collections_editor_sort_title",
  released: "collections_editor_sort_released",
  popularity: "tmdb_entity_rail_popular",
  votes: "collections_editor_sort_votes"
};
const FILTER_DEFINITIONS = [
  ["withGenres", "collections_editor_tmdb_genres", "collections_editor_tmdb_genres_helper"],
  [
    "withoutGenres",
    "collections_editor_tmdb_without_genres",
    "collections_editor_tmdb_without_genres_helper"
  ],
  ["releaseDateGte", "collections_editor_tmdb_date_from", "collections_editor_tmdb_date_helper"],
  ["releaseDateLte", "collections_editor_tmdb_date_to", "collections_editor_tmdb_date_helper"],
  ["voteAverageGte", "collections_editor_tmdb_rating_min", "collections_editor_tmdb_rating_helper"],
  ["voteAverageLte", "collections_editor_tmdb_rating_max", "collections_editor_tmdb_rating_helper"],
  ["voteCountGte", "collections_editor_tmdb_votes_min", "collections_editor_tmdb_votes_helper"],
  [
    "withOriginalLanguage",
    "collections_editor_tmdb_language",
    "collections_editor_tmdb_language_helper"
  ],
  [
    "withOriginCountry",
    "collections_editor_tmdb_country",
    "collections_editor_tmdb_country_helper"
  ],
  ["withKeywords", "collections_editor_tmdb_keywords", "collections_editor_tmdb_keywords_helper"],
  [
    "withoutKeywords",
    "collections_editor_tmdb_without_keywords",
    "collections_editor_tmdb_without_keywords_helper"
  ],
  [
    "withCompanies",
    "collections_editor_tmdb_companies",
    "collections_editor_tmdb_companies_helper"
  ],
  [
    "withoutCompanies",
    "collections_editor_tmdb_without_companies",
    "collections_editor_tmdb_without_companies_helper"
  ],
  ["withNetworks", "collections_editor_tmdb_networks", "collections_editor_tmdb_networks_helper"],
  ["year", "collections_editor_tmdb_year", "collections_editor_tmdb_year_helper"],
  [
    "withWatchProviders",
    "collections_editor_tmdb_watch_providers",
    "collections_editor_tmdb_watch_providers_helper"
  ],
  [
    "withoutWatchProviders",
    "collections_editor_tmdb_without_watch_providers",
    "collections_editor_tmdb_without_watch_providers_helper"
  ],
  [
    "watchRegion",
    "collections_editor_tmdb_watch_region",
    "collections_editor_tmdb_watch_region_helper"
  ]
];
const QUICK_CHIP_SECTIONS = [
  {
    key: "withGenres",
    labelKey: "collections_editor_tmdb_quick_genres",
    movie: [
      ["collections_editor_tmdb_genre_action", "28"],
      ["collections_editor_tmdb_genre_adventure", "12"],
      ["collections_editor_tmdb_genre_animation", "16"],
      ["collections_editor_tmdb_genre_comedy", "35"],
      ["collections_editor_tmdb_genre_horror", "27"],
      ["collections_editor_tmdb_genre_scifi", "878"]
    ],
    tv: [
      ["collections_editor_tmdb_genre_drama", "18"],
      ["collections_editor_tmdb_genre_comedy", "35"],
      ["collections_editor_tmdb_genre_animation", "16"],
      ["collections_editor_tmdb_genre_crime", "80"],
      ["collections_editor_tmdb_genre_scifi", "10765"],
      ["collections_editor_tmdb_genre_reality", "10764"]
    ]
  },
  {
    key: "withOriginalLanguage",
    labelKey: "collections_editor_tmdb_quick_languages",
    movie: [
      ["collections_editor_language_english", "en"],
      ["collections_editor_language_korean", "ko"],
      ["collections_editor_language_japanese", "ja"],
      ["collections_editor_language_hindi", "hi"],
      ["collections_editor_language_spanish", "es"]
    ]
  },
  {
    key: "withOriginCountry",
    labelKey: "collections_editor_tmdb_quick_countries",
    movie: [
      ["collections_editor_country_us", "US"],
      ["collections_editor_country_korea", "KR"],
      ["collections_editor_country_japan", "JP"],
      ["collections_editor_country_india", "IN"],
      ["collections_editor_country_uk", "GB"]
    ]
  },
  {
    key: "withKeywords",
    labelKey: "collections_editor_tmdb_quick_keywords",
    movie: [
      ["collections_editor_keyword_superhero", "9715"],
      ["collections_editor_keyword_based_on_novel", "818"],
      ["collections_editor_keyword_time_travel", "4379"],
      ["collections_editor_keyword_space", "9882"]
    ]
  },
  {
    key: "withCompanies",
    labelKey: "collections_editor_tmdb_quick_companies",
    movie: [
      ["Marvel", "420"],
      ["Disney", "2"],
      ["Pixar", "3"],
      ["Lucasfilm", "1"],
      ["Warner Bros.", "174"]
    ]
  },
  {
    key: "withNetworks",
    labelKey: "collections_editor_tmdb_quick_networks",
    movie: [
      ["Netflix", "213"],
      ["HBO", "49"],
      ["Disney+", "2739"],
      ["Prime Video", "1024"],
      ["Hulu", "453"]
    ]
  },
  {
    key: "withWatchProviders",
    labelKey: "collections_editor_tmdb_quick_watch_providers",
    movie: [
      ["Netflix", "8"],
      ["Prime Video", "119"],
      ["Disney+", "337"],
      ["Apple TV+", "350"],
      ["Hulu", "15"]
    ]
  },
  {
    key: "watchRegion",
    labelKey: "collections_editor_tmdb_quick_watch_regions",
    movie: [
      ["collections_editor_country_us", "US"],
      ["collections_editor_country_uk", "GB"],
      ["Canada", "CA"],
      ["Australia", "AU"],
      ["Germany", "DE"]
    ]
  }
];
const EMOJI_OPTIONS = [
  "🎬",
  "🎥",
  "🍿",
  "⭐",
  "🔥",
  "💥",
  "🦸",
  "🧙",
  "👻",
  "🚀",
  "🌌",
  "🧛",
  "❤️",
  "😱",
  "😂",
  "🎭",
  "🎵",
  "🕵️",
  "🐉",
  "⚔️",
  "🏆",
  "🎄",
  "👨‍👩‍👧",
  "🌍",
  "🕒",
  "📺",
  "📼",
  "🎞️",
  "🏰",
  "🧪",
  "🔍",
  "💎",
  "🚗",
  "⚽",
  "🎮",
  "🍕"
];

function tmdbDefaultTitles(tmdbId) {
  const suffix = tmdbId ? ` ${tmdbId}` : "";
  return {
    LIST: `${t("collections_editor_tmdb_default_list", "TMDB List")}${suffix}`.trim(),
    NETWORK: `${t("collections_editor_tmdb_default_network", "TMDB Network")}${suffix}`.trim(),
    COLLECTION: `${t("collections_editor_tmdb_collection", "TMDB Collection")}${suffix}`.trim(),
    COMPANY:
      `${t("collections_editor_tmdb_default_production", "TMDB Production")}${suffix}`.trim(),
    PERSON: `${t("collections_editor_tmdb_person_credits", "TMDB Person Credits")}${suffix}`.trim(),
    DIRECTOR: `${t(
      "collections_editor_tmdb_director_credits",
      "TMDB Director Credits"
    )}${suffix}`.trim(),
    DISCOVER: t("collections_editor_tmdb_default_discover", "TMDB Discover")
  };
}

function tmdbModeLabel(mode) {
  return t(TMDB_MODE_KEYS[mode] || TMDB_MODE_KEYS.PRESETS, mode);
}

function tmdbSortLabel(value) {
  return t(TMDB_SORT_LABEL_KEYS[value] || value, value);
}

function traktSortLabel(value) {
  return t(TRAKT_SORT_LABEL_KEYS[value] || value, value);
}

function filterValueLabel(field, value) {
  if (value == null || value === "") {
    return "";
  }
  return String(value);
}

function coverModeOf(folder) {
  if (folder?.coverEmoji) {
    return "EMOJI";
  }
  if (folder?.coverImageUrl) {
    return "IMAGE";
  }
  return "NONE";
}

function coverModeLabel(mode) {
  return mode === "EMOJI"
    ? t("collections_editor_cover_emoji", "Emoji")
    : mode === "IMAGE"
      ? t("collections_editor_cover_image_url", "Image URL")
      : t("collections_editor_cover_none", "None");
}

function cycleRow(key, label, value, action, extra = "") {
  return `
    <button type="button" class="collections-form-row collections-focusable ${extra}"
            data-focus-key="${escapeHtml(key)}" data-action="${escapeHtml(action)}" data-field="${escapeHtml(key)}">
      <span class="collections-form-copy">
        <span class="collections-form-label">${escapeHtml(label)}</span>
        <span class="collections-form-value">${escapeHtml(value || "")}</span>
      </span>
      <span class="material-icons collections-form-chevron" aria-hidden="true">chevron_right</span>
    </button>
  `;
}

function buttonRow(key, label, action, extra = "", attrs = "") {
  return `
    <button type="button" class="collections-form-row collections-focusable ${extra}"
            data-focus-key="${escapeHtml(key)}" data-action="${escapeHtml(action)}" ${attrs}>
      <span class="collections-form-copy">
        <span class="collections-form-label">${escapeHtml(label)}</span>
      </span>
      <span class="material-icons collections-form-chevron" aria-hidden="true">chevron_right</span>
    </button>
  `;
}

function chipRow(key, label, action, attrs) {
  return `
    <button type="button" class="collections-chip collections-focusable"
            data-focus-key="${escapeHtml(key)}" data-action="${escapeHtml(action)}" ${attrs}>
      ${escapeHtml(label)}
    </button>
  `;
}

function tmdbSourceTypeLabel(sourceType) {
  return (
    {
      LIST: t("collections_editor_tmdb_public_list", "List"),
      COLLECTION: t("collections_editor_tmdb_collection", "Collection"),
      COMPANY: t("collections_editor_tmdb_mode_production", "Company"),
      NETWORK: t("collections_editor_tmdb_mode_network", "Network"),
      PERSON: t("collections_editor_tmdb_mode_person", "Person"),
      DIRECTOR: t("collections_editor_tmdb_mode_director", "Director"),
      DISCOVER: t("collections_editor_tmdb_mode_custom", "Discover")
    }[String(sourceType || "").toUpperCase()] || String(sourceType || "")
  );
}

function mediaTypeLabel(mediaType) {
  const normalized = String(mediaType || "").toUpperCase();
  return normalized === "TV" || normalized === "SERIES"
    ? t("type_series", "Series")
    : t("type_movie", "Movie");
}

function sourceSubtitle(source = {}) {
  if (source.provider === "tmdb") {
    return `${tmdbSourceTypeLabel(source.tmdbSourceType)} · ${mediaTypeLabel(source.mediaType)}`;
  }
  if (source.provider === "trakt") {
    return `${t("collections_editor_trakt_sources", "Trakt")} · ${mediaTypeLabel(source.mediaType)}`;
  }
  return mediaTypeLabel(source.type);
}

function sourceLabel(source = {}) {
  if (source.provider === "tmdb" || source.provider === "trakt") {
    return source.title || t("collections_editor_source", "Source");
  }
  const addonName = source.addonName || source.addonId || "";
  const catalogName = source.catalogName || source.catalogId || "";
  return [addonName, catalogName].filter(Boolean).join(" · ").trim();
}

function toggleRow(key, label, description, checked) {
  return `
    <button type="button" class="collections-form-row collections-focusable"
            data-focus-key="${escapeHtml(key)}" data-action="toggle" data-field="${escapeHtml(key)}">
      <span class="collections-form-copy">
        <span class="collections-form-label">${escapeHtml(label)}</span>
        ${description ? `<span class="collections-form-desc">${escapeHtml(description)}</span>` : ""}
      </span>
      <span class="collections-switch ${checked ? "is-on" : ""}">${escapeHtml(
        checked ? t("common.on", "On") : t("common.off", "Off")
      )}</span>
    </button>
  `;
}

function textRow(key, label, value, placeholder = "") {
  return `
    <button type="button" class="collections-form-row collections-focusable"
            data-focus-key="${escapeHtml(key)}" data-action="editText" data-field="${escapeHtml(key)}">
      <span class="collections-form-copy">
        <span class="collections-form-label">${escapeHtml(label)}</span>
        <span class="collections-form-value ${value ? "" : "is-placeholder"}">${escapeHtml(
          value || placeholder
        )}</span>
      </span>
      <span class="material-icons collections-form-chevron" aria-hidden="true">chevron_right</span>
    </button>
  `;
}

function actionRow(key, label, action, extra = "", attrs = "") {
  return `
    <button type="button" class="collections-form-row collections-focusable ${extra}"
            data-focus-key="${escapeHtml(key)}" data-action="${escapeHtml(action)}" ${attrs}>
      <span class="collections-form-copy">
        <span class="collections-form-label">${escapeHtml(label)}</span>
      </span>
      <span class="material-icons collections-form-chevron" aria-hidden="true">chevron_right</span>
    </button>
  `;
}

export const CollectionEditorScreen = {
  async mount(params = {}) {
    this.params = params || {};
    this.container = document.getElementById("collectionEditor");
    ScreenUtils.show(this.container);
    this.deleteDialog = null;
    this.folderDelete = null;
    this.textDialog = null;
    this.view = "main";
    this.pickerEntries = [];
    this.tmdbState = createTmdbSourceState();
    this.traktState = createTraktSourceState();
    this.editingSourceIndex = -1;
    this.genrePickerIndex = -1;
    this.tmdbBusy = false;
    this.traktBusy = false;
    this.tmdbRequestToken = 0;
    this.traktRequestToken = 0;
    this.installedAddonIds = new Set();
    const collectionId = this.params?.collectionId || null;
    const existing = collectionId
      ? CollectionsStore.get().find((collection) => collection.id === collectionId)
      : null;
    this.collection = existing
      ? JSON.parse(JSON.stringify(existing))
      : createEmptyCollectionDraft(CollectionsStore.generateId());
    this.draft = this.collection;
    this.editingFolderIndex = -1;
    this.editingFolder = null;
    this.focusKey = "title";
    this.render();
    void this.refreshCatalogEntries();
  },

  render() {
    if (this.view === "folder") {
      this.renderFolderEditor();
    } else if (this.view === "picker") {
      this.renderCatalogPicker();
    } else if (this.view === "tmdb") {
      this.renderTmdbPicker();
    } else if (this.view === "trakt") {
      this.renderTraktPicker();
    } else if (this.view === "genre") {
      this.renderGenrePicker();
    } else if (this.view === "emoji") {
      this.renderEmojiPicker();
    } else {
      this.renderMainEditor();
    }
    this.bindEvents();
    this.applyFocus();
  },

  renderMainEditor() {
    const draft = this.draft;
    const canSave = canSaveCollectionDraft(draft);
    const folders = (draft.folders || [])
      .map(
        (folder, index) => `
          <article class="collections-source-card">
            <div class="collections-source-copy">
              <h3>${escapeHtml(folder.title)}</h3>
              <p>${escapeHtml(
                t("collections_editor_source_count", `${folder.sources.length} source(s)`).replace(
                  "%1$d",
                  String(folder.sources.length)
                )
              )}</p>
            </div>
            <div class="collections-source-actions">
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="folder:${escapeHtml(folder.id)}:up" data-action="folderUp" data-index="${index}">
                <span class="material-icons" aria-hidden="true">arrow_upward</span>
              </button>
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="folder:${escapeHtml(folder.id)}:down" data-action="folderDown" data-index="${index}">
                <span class="material-icons" aria-hidden="true">arrow_downward</span>
              </button>
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="folder:${escapeHtml(folder.id)}" data-action="editFolder" data-index="${index}">
                <span class="material-icons" aria-hidden="true">edit</span>
              </button>
              <button type="button" class="collections-action collections-focusable collections-action-danger"
                      data-focus-key="folder:${escapeHtml(folder.id)}:delete"
                      data-action="deleteFolderRow" data-index="${index}">
                <span class="material-icons" aria-hidden="true">delete</span>
              </button>
            </div>
          </article>
        `
      )
      .join("");

    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            t(
              this.isNewCollection() ? "collections_new" : "collections_editor_edit_collection",
              this.isNewCollection() ? "New Collection" : "Edit Collection"
            )
          )}</h1>
          <p class="collections-subtitle">${escapeHtml(
            t("collections_editor_display", "Display")
          )}</p>
          <section class="collections-form">
            ${textRow(
              "title",
              t("collections_editor_row_title", "Row Title"),
              draft.title,
              t("collections_editor_placeholder_name", "Collection name")
            )}
            ${textRow(
              "backdropImageUrl",
              t("collections_editor_backdrop", "Backdrop Image"),
              draft.backdropImageUrl || "",
              t("collections_editor_placeholder_backdrop", "Backdrop image URL (optional)")
            )}
            ${toggleRow(
              "pinToTop",
              t("collections_editor_pin_above", "Pin Above Catalogs"),
              t("collections_editor_pin_above_desc", ""),
              Boolean(draft.pinToTop)
            )}
            ${toggleRow(
              "focusGlowEnabled",
              t("collections_editor_focus_glow", "Focus Glow"),
              t("collections_editor_focus_glow_desc", ""),
              draft.focusGlowEnabled !== false
            )}
            ${textRow(
              "viewMode",
              t("collections_editor_view_mode", "View Mode"),
              viewModeLabel(draft.viewMode),
              ""
            )}
            ${
              draft.viewMode === "TABBED_GRID"
                ? toggleRow(
                    "showAllTab",
                    t("collections_editor_show_all_tab", 'Show "All" Tab'),
                    t("collections_editor_show_all_tab_desc", ""),
                    draft.showAllTab !== false
                  )
                : ""
            }
            <div class="collections-form-section">
              <span>${escapeHtml(t("collections_editor_folders", "Folders"))}</span>
              <span class="collections-form-section-meta">${escapeHtml(
                t("collection_editor_folder_count_other", `${draft.folders.length} items`).replace(
                  "%1$d",
                  String(draft.folders.length)
                )
              )}</span>
            </div>
            ${folders}
            ${actionRow("addFolder", t("collections_editor_add_folder", "Add Folder"), "addFolder")}
            <button type="button"
                    class="collections-form-row collections-focusable collections-save-row${canSave ? "" : " is-disabled"}"
                    data-focus-key="save" data-action="save">
              <span class="collections-form-label">${escapeHtml(
                t("collections_editor_save", "Save")
              )}</span>
            </button>
            ${actionRow("back", t("collections_editor_back", "Back"), "back")}
          </section>
        </main>
      </div>
      ${this.renderTextDialog()}
    `;
  },

  renderFolderEditor() {
    const folder = this.editingFolder;
    if (!folder) {
      this.view = "main";
      return this.renderMainEditor();
    }
    const coverMode = coverModeOf(folder);
    const sources = (folder.sources || [])
      .map((source, index) => {
        const isAddon = String(source.provider || "addon") === "addon";
        const canEdit = !isAddon || this.catalogGenreOptions(source).length > 0;
        return `
          <article class="collections-source-card">
            <div class="collections-source-copy">
              <h3>${escapeHtml(sourceLabel(source))}</h3>
              <p>${escapeHtml(sourceSubtitle(source))}${
                isAddon && source.genre ? ` · ${escapeHtml(source.genre)}` : ""
              }${
                isAddon &&
                source.addonId &&
                this.installedAddonIds?.size &&
                !this.installedAddonIds.has(String(source.addonId))
                  ? ` · ${escapeHtml(
                      t("collections_editor_addon_missing", "Addon not installed: %1$s").replace(
                        "%1$s",
                        String(source.addonId)
                      )
                    )}`
                  : ""
              }</p>
            </div>
            <div class="collections-source-actions">
              ${
                canEdit
                  ? `<button type="button" class="collections-action collections-focusable"
                      data-focus-key="source:${index}:edit" data-action="sourceEdit" data-index="${index}">
                      <span class="material-icons" aria-hidden="true">edit</span>
                    </button>`
                  : ""
              }
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="source:${index}:up" data-action="sourceUp" data-index="${index}">
                <span class="material-icons" aria-hidden="true">arrow_upward</span>
              </button>
              <button type="button" class="collections-action collections-focusable"
                      data-focus-key="source:${index}:down" data-action="sourceDown" data-index="${index}">
                <span class="material-icons" aria-hidden="true">arrow_downward</span>
              </button>
              <button type="button" class="collections-action collections-focusable collections-action-danger"
                      data-focus-key="source:${index}:remove" data-action="sourceRemove" data-index="${index}">
                <span class="material-icons" aria-hidden="true">close</span>
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            this.editingFolderIndex >= 0
              ? t("collections_editor_edit_folder", "Edit Folder")
              : t("collections_editor_new_folder", "New Folder")
          )}</h1>
          <section class="collections-form">
            ${textRow(
              "folderTitle",
              t("collections_editor_folder_title", "Folder Title"),
              folder.title,
              t("collections_editor_placeholder_folder", "Folder name")
            )}
            ${cycleRow(
              "coverMode",
              t("collections_editor_cover", "Cover"),
              coverModeLabel(coverMode),
              "cycleCoverMode"
            )}
            ${coverMode === "EMOJI" ? buttonRow("coverEmojiPick", `${t("collections_editor_cover_emoji", "Emoji")}: ${folder.coverEmoji || "—"}`, "openEmojiPicker") : ""}
            ${coverMode === "IMAGE" ? textRow("coverImageUrl", t("collections_editor_cover_image_url", "Image URL"), folder.coverImageUrl || "", t("collections_editor_placeholder_cover_image", "Cover image URL")) : ""}
            ${
              coverMode === "IMAGE" && folder.coverImageUrl
                ? `<img class="collections-preview collections-preview-cover" src="${escapeHtml(folder.coverImageUrl)}" alt="" />`
                : ""
            }
            ${textRow(
              "focusGifUrl",
              t("collections_editor_focus_gif", "Focus GIF"),
              folder.focusGifUrl || "",
              t("collections_editor_placeholder_gif", "Animated GIF URL")
            )}
            ${toggleRow(
              "focusGifEnabled",
              t("collections_editor_play_gif", "Play GIF on Focus"),
              "",
              folder.focusGifEnabled !== false
            )}
            ${textRow(
              "heroBackdropUrl",
              t("collections_editor_hero_backdrop", "Hero Backdrop"),
              folder.heroBackdropUrl || "",
              t("collections_editor_placeholder_hero_backdrop", "Custom hero backdrop URL")
            )}
            ${
              folder.heroBackdropUrl
                ? `<img class="collections-preview collections-preview-backdrop" src="${escapeHtml(folder.heroBackdropUrl)}" alt="" />`
                : ""
            }
            ${textRow(
              "heroVideoUrl",
              t("collections_editor_hero_video", "Hero Video"),
              folder.heroVideoUrl || "",
              t("collections_editor_placeholder_hero_video", "Custom hero video URL")
            )}
            ${textRow(
              "titleLogoUrl",
              t("collections_editor_title_logo", "Title Logo"),
              folder.titleLogoUrl || "",
              t("collections_editor_placeholder_title_logo", "Custom title logo URL")
            )}
            ${
              folder.titleLogoUrl
                ? `<img class="collections-preview collections-preview-logo" src="${escapeHtml(folder.titleLogoUrl)}" alt="" />`
                : ""
            }
            ${cycleRow("tileShape", t("collections_editor_tile_shape", "Tile Shape"), tileShapeLabel(folder.tileShape), "cycleTileShape")}
            ${toggleRow(
              "hideTitle",
              t("collections_editor_hide_title", "Hide Title"),
              t("collections_editor_hide_title_desc", "Only show the cover image"),
              Boolean(folder.hideTitle)
            )}
            <div class="collections-form-section">
              <span>${escapeHtml(t("collections_editor_sources", "Sources"))}</span>
              <span class="collections-form-section-meta">${escapeHtml(
                t("collections_editor_source_count", `${folder.sources.length} source(s)`).replace(
                  "%1$d",
                  String(folder.sources.length)
                )
              )}</span>
            </div>
            ${sources}
            ${actionRow("addCatalog", t("collections_editor_add_catalog", "Add Catalog"), "addCatalog")}
            ${actionRow(
              "addTmdb",
              t("collections_editor_add_tmdb_source", "Add TMDB Source"),
              "openTmdbPicker"
            )}
            ${actionRow(
              "addTrakt",
              t("collections_editor_add_trakt_source", "Add Trakt List"),
              "openTraktPicker"
            )}
            <button type="button" class="collections-form-row collections-focusable collections-save-row"
                    data-focus-key="folderSave" data-action="saveFolder">
              <span class="collections-form-label">${escapeHtml(
                t("collections_editor_save", "Save")
              )}</span>
            </button>
            ${actionRow("deleteFolder", t("cd_delete", "Delete"), "deleteFolder", "collections-action-danger")}
            ${actionRow("folderBack", t("collections_editor_back", "Back"), "folderBack")}
          </section>
        </main>
      </div>
      ${this.renderTextDialog()}
    `;
  },

  renderCatalogPicker() {
    const folder = this.editingFolder;
    const entries = this.pickerEntries || [];
    const cards = entries
      .map((entry) => {
        const selected = (folder?.sources || []).some(
          (source) => sourceIdentity(source) === sourceIdentity(entry.source)
        );
        return `
          <button type="button" class="collections-picker-row collections-focusable${selected ? " is-selected" : ""}"
                  data-focus-key="catalog:${escapeHtml(entry.key)}"
                  data-action="toggleCatalog" data-key="${escapeHtml(entry.key)}">
            <span class="collections-picker-check">${selected ? "✓" : ""}</span>
            <span class="collections-form-copy">
              <span class="collections-form-label">${escapeHtml(entry.source.catalogName || "")}</span>
              <span class="collections-form-desc">${escapeHtml(
                `${entry.source.addonName || entry.source.addonId || ""} · ${entry.source.type || ""}`
              )}</span>
            </span>
          </button>
        `;
      })
      .join("");
    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            t("collections_editor_select_catalogs", "Select Catalogs")
          )}</h1>
          <section class="collections-form">
            ${
              cards ||
              `<p class="collections-empty">${escapeHtml(
                t("collections_editor_no_catalogs", "No catalogs available")
              )}</p>`
            }
            ${actionRow("pickerDone", t("collections_editor_done", "Done"), "pickerDone")}
          </section>
        </main>
      </div>
    `;
  },

  renderTmdbPicker() {
    const state = this.tmdbState;
    const isPresets = state.mode === "PRESETS";
    const showMedia = tmdbModeUsesMediaControls(state.mode);
    const showFilters = state.mode === "DISCOVER";
    const mediaLabel = state.mediaBoth
      ? t("collection_editor_choice_both", "Both")
      : state.mediaType === "TV"
        ? t("type_series", "Series")
        : t("type_movie", "Movie");
    const modeRows = TMDB_MODE_ORDER.map((mode) =>
      cycleRow(
        `tmdbMode:${mode}`,
        tmdbModeLabel(mode),
        state.mode === mode ? "✓" : "",
        "setTmdbMode",
        state.mode === mode ? "is-selected" : ""
      )
    ).join("");

    const presetRows = TMDB_PRESETS.map((preset, index) =>
      actionRow(
        `tmdbPreset:${index}`,
        `${preset.title} — ${tmdbSourceTypeLabel(preset.source.tmdbSourceType)} ${preset.source.tmdbId}`,
        "addTmdbPreset",
        "",
        `data-index="${index}"`
      )
    ).join("");

    const filterRows = showFilters
      ? FILTER_DEFINITIONS.map(([field, labelKey, helperKey]) =>
          textRow(
            `tmdbFilter:${field}`,
            t(labelKey, field),
            filterValueLabel(field, state.filters[field]),
            t(helperKey, "")
          )
        ).join("")
      : "";

    const quickSections = showFilters
      ? QUICK_CHIP_SECTIONS.map((section) => {
          const chips =
            (section.tv && state.mediaType === "TV" && !state.mediaBoth
              ? section.tv
              : section.movie) || [];
          if (!chips.length) {
            return "";
          }
          return `
            <div class="collections-form-section">
              <span>${escapeHtml(t(section.labelKey, section.key))}</span>
            </div>
            <div class="collections-chips">
              ${chips
                .map(([labelKeyOrText, value]) =>
                  chipRow(
                    `tmdbChip:${section.key}:${value}`,
                    labelKeyOrText.includes("_") ? t(labelKeyOrText, value) : labelKeyOrText,
                    "setTmdbFilter",
                    `data-field="${section.key}" data-value="${escapeHtml(value)}"`
                  )
                )
                .join("")}
            </div>
          `;
        }).join("")
      : "";

    const resultRows = (() => {
      if (state.mode === "PRODUCTION" && state.companyResults.length) {
        return state.companyResults
          .map((result, index) =>
            actionRow(
              `tmdbCompany:${result.id}`,
              `${result.name}${result.originCountry ? ` — ${result.originCountry}` : ""}`,
              "addTmdbResult",
              "",
              `data-index="${index}"`
            )
          )
          .join("");
      }
      if (state.mode === "COLLECTION" && state.collectionResults.length) {
        return state.collectionResults
          .map((result, index) =>
            actionRow(
              `tmdbCollection:${result.id}`,
              result.name,
              "addTmdbResult",
              "",
              `data-index="${index}"`
            )
          )
          .join("");
      }
      return "";
    })();

    const showForm = !isPresets;
    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            this.editingSourceIndex >= 0
              ? t("collections_editor_edit_tmdb_source", "Edit TMDB Source")
              : t("collections_editor_tmdb_sources", "TMDB Sources")
          )}</h1>
          ${state.error ? `<p class="collections-error">${escapeHtml(state.error)}</p>` : ""}
          <section class="collections-form">
            ${modeRows}
            ${
              isPresets
                ? presetRows
                : showForm
                  ? `
              ${
                state.mode === "DISCOVER"
                  ? ""
                  : textRow(
                      "tmdbInput",
                      t(
                        state.mode === "LIST"
                          ? "collections_editor_tmdb_public_list"
                          : state.mode === "NETWORK"
                            ? "collections_editor_tmdb_network_id"
                            : state.mode === "COLLECTION"
                              ? "collections_editor_tmdb_collection_id"
                              : state.mode === "PRODUCTION"
                                ? "collections_editor_tmdb_company_search"
                                : "collections_editor_tmdb_person_id",
                        "ID or URL"
                      ),
                      state.input,
                      t("collections_editor_tmdb_id_or_url", "ID or URL")
                    )
              }
              ${textRow(
                "tmdbTitleInput",
                t("collections_editor_tmdb_display_title", "Display Title"),
                state.titleInput,
                ""
              )}
              ${
                showMedia
                  ? `${cycleRow("tmdbMediaType", t("library_filter_type", "Type"), mediaLabel, "cycleTmdbMedia")}
                     ${toggleRow("tmdbMediaBoth", t("collection_editor_choice_both", "Both"), "", state.mediaBoth)}`
                  : ""
              }
              ${cycleRow("tmdbSortBy", t("library_filter_sort", "Sort"), tmdbSortLabel(state.sortBy), "cycleTmdbSort")}
              ${
                ["PRODUCTION", "COLLECTION"].includes(state.mode)
                  ? actionRow(
                      "tmdbSearch",
                      t("collections_editor_tmdb_search", "Search"),
                      "searchTmdb"
                    )
                  : ""
              }
              ${filterRows}
              ${quickSections}
              ${resultRows}
              ${actionRow(
                "tmdbAdd",
                this.editingSourceIndex >= 0
                  ? t("collections_editor_save_source", "Save Source")
                  : t("collections_editor_add_source", "Add Source"),
                "addTmdbFromInput"
              )}
            `
                  : ""
            }
            ${actionRow("tmdbBack", t("collections_editor_back", "Back"), "tmdbBack")}
          </section>
        </main>
      </div>
      ${this.renderTextDialog()}
    `;
  },

  renderTraktPicker() {
    const state = this.traktState;
    const mediaLabel = state.mediaBoth
      ? t("collection_editor_choice_both", "Both")
      : state.mediaType === "TV"
        ? t("type_series", "Series")
        : t("type_movie", "Movie");
    const resultSubtitle = (result) => {
      const parts = [];
      if (result.owner) {
        parts.push(result.owner);
      }
      if (Number.isFinite(Number(result.itemCount))) {
        parts.push(
          t("collections_editor_trakt_items_count", "%1$d items").replace(
            "%1$d",
            String(result.itemCount)
          )
        );
      }
      if (Number.isFinite(Number(result.likes)) && Number(result.likes) > 0) {
        parts.push(
          t("collections_editor_trakt_likes_count", "%1$d likes").replace(
            "%1$d",
            String(result.likes)
          )
        );
      }
      return parts.join(" • ");
    };
    const resultRows = (results = []) =>
      results
        .map((result) => {
          const subtitle = resultSubtitle(result);
          return actionRow(
            `traktResult:${result.traktListId}`,
            `${result.title}${subtitle ? ` — ${subtitle}` : ""}`,
            "addTraktResult",
            "",
            `data-id="${result.traktListId}"`
          );
        })
        .join("");
    const sections = [
      [t("collections_editor_trakt_search_results", "Search results"), state.results || []],
      [t("collections_editor_trakt_trending", "Trending"), state.trendingResults || []],
      [t("collections_editor_trakt_popular", "Popular"), state.popularResults || []]
    ]
      .filter(([, results]) => results.length)
      .map(
        ([label, results]) => `
          <div class="collections-form-section"><span>${escapeHtml(label)}</span></div>
          ${resultRows(results)}
        `
      )
      .join("");

    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            this.editingSourceIndex >= 0
              ? t("collections_editor_edit_trakt_source", "Edit Trakt List")
              : t("collections_editor_trakt_sources", "Trakt Lists")
          )}</h1>
          ${state.error ? `<p class="collections-error">${escapeHtml(state.error)}</p>` : ""}
          <section class="collections-form">
            ${textRow(
              "traktInput",
              t("collections_editor_trakt_list", "Trakt list"),
              state.input,
              t("collection_editor_trakt_search_placeholder", "Trakt URL or list ID")
            )}
            ${textRow(
              "traktTitleInput",
              t("collections_editor_tmdb_display_title", "Display Title"),
              state.titleInput,
              t("collection_editor_trakt_name_placeholder", "Display name")
            )}
            ${cycleRow("traktMediaType", t("library_filter_type", "Type"), mediaLabel, "cycleTraktMedia")}
            ${toggleRow("traktMediaBoth", t("collection_editor_choice_both", "Both"), "", state.mediaBoth)}
            ${cycleRow("traktSortBy", t("library_filter_sort", "Sort"), traktSortLabel(state.sortBy), "cycleTraktSort")}
            ${cycleRow(
              "traktSortHow",
              t("collections_editor_trakt_direction", "Direction"),
              state.sortHow === "desc"
                ? t("collections_editor_trakt_descending", "Descending")
                : t("collections_editor_trakt_ascending", "Ascending"),
              "cycleTraktSortHow"
            )}
            ${actionRow("traktSearch", t("collections_editor_tmdb_search", "Search"), "searchTrakt")}
            ${actionRow(
              "traktAdd",
              this.editingSourceIndex >= 0
                ? t("collections_editor_save_source", "Save Source")
                : t("collections_editor_add_source", "Add Source"),
              "addTraktFromInput"
            )}
            ${sections}
            ${actionRow("traktBack", t("collections_editor_back", "Back"), "traktBack")}
          </section>
        </main>
      </div>
      ${this.renderTextDialog()}
    `;
  },

  renderGenrePicker() {
    const folder = this.editingFolder;
    const source = folder?.sources?.[this.genrePickerIndex];
    const options = this.genrePickerOptions || [];
    const selected = source?.genre || null;
    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            t("collections_editor_select_genre", "Select Genre")
          )}</h1>
          <p class="collections-subtitle">${escapeHtml(sourceLabel(source || {}))}</p>
          <section class="collections-form">
            ${cycleRow(
              "genre:none",
              t("collections_editor_all_genres", "All genres"),
              selected == null ? "✓" : "",
              "selectGenre",
              selected == null ? "is-selected" : ""
            )}
            ${options
              .map((option) =>
                cycleRow(
                  `genre:${option}`,
                  option,
                  selected === option ? "✓" : "",
                  "selectGenre",
                  selected === option ? "is-selected" : ""
                )
              )
              .join("")}
            ${actionRow("genreBack", t("collections_editor_back", "Back"), "genreBack")}
          </section>
        </main>
      </div>
    `;
  },

  renderEmojiPicker() {
    this.container.innerHTML = `
      <div class="collections-shell">
        <main class="collections-main">
          <h1 class="collections-title">${escapeHtml(
            t("collections_editor_choose_emoji", "Choose Emoji")
          )}</h1>
          <section class="collections-form">
            <div class="collections-chips">
              ${EMOJI_OPTIONS.map((emoji) =>
                chipRow(`emoji:${emoji}`, emoji, "selectEmoji", `data-value="${escapeHtml(emoji)}"`)
              ).join("")}
            </div>
            ${actionRow("emojiCustom", t("collections_editor_cover_emoji", "Emoji"), "customEmoji")}
            ${actionRow("emojiClear", t("collections_editor_cover_none", "None"), "clearEmoji")}
            ${actionRow("emojiBack", t("collections_editor_back", "Back"), "emojiBack")}
          </section>
        </main>
      </div>
    `;
  },

  renderTextDialog() {
    if (!this.textDialog) {
      return "";
    }
    const dialog = this.textDialog;
    return `
      <div class="collections-dialog-backdrop">
        <div class="collections-dialog">
          <div class="collections-dialog-title">${escapeHtml(dialog.title)}</div>
          <input class="collections-dialog-input"
                 data-collections-text-input
                 type="text"
                 autocomplete="off"
                 autocapitalize="none"
                 spellcheck="false"
                 placeholder="${escapeHtml(dialog.placeholder || "")}"
                 value="${escapeHtml(dialog.value || "")}" />
          <div class="collections-dialog-actions">
            <button type="button" class="collections-action collections-dialog-save"
                    data-collections-text-save>${escapeHtml(t("common.save", "Save"))}</button>
            <button type="button" class="collections-action collections-dialog-cancel"
                    data-collections-text-cancel>${escapeHtml(t("collections_cancel", "Cancel"))}</button>
          </div>
        </div>
      </div>
    `;
  },

  bindEvents() {
    this.container.querySelectorAll(".collections-focusable").forEach((node) => {
      node.addEventListener("click", async () => {
        this.focusKey = String(node.dataset.focusKey || this.focusKey);
        this.applyFocus();
        await this.activateFocused();
      });
    });
    const input = this.container.querySelector("[data-collections-text-input]");
    if (input) {
      input.addEventListener("keydown", (event) => {
        if (Number(event?.keyCode || 0) === 13) {
          event.preventDefault();
          event.stopPropagation();
          this.submitTextDialog();
        }
      });
      input.focus?.();
      input.select?.();
    }
    this.container
      .querySelector("[data-collections-text-save]")
      ?.addEventListener("click", () => this.submitTextDialog());
    this.container
      .querySelector("[data-collections-text-cancel]")
      ?.addEventListener("click", () => this.cancelTextDialog());
  },

  applyFocus() {
    this.container
      ?.querySelectorAll(".collections-focusable.focused")
      .forEach((node) => node.classList.remove("focused"));
    const nodes = Array.from(this.container?.querySelectorAll(".collections-focusable") || []);
    if (!nodes.length) {
      return;
    }
    const target =
      nodes.find((node) => String(node.dataset.focusKey || "") === this.focusKey) || nodes[0];
    this.focusKey = String(target.dataset.focusKey || "");
    target.classList.add("focused");
    if (!this.textDialog) {
      target.focus?.({ preventScroll: true });
    }
    target.scrollIntoView?.({ block: "nearest" });
  },

  isNewCollection() {
    return !CollectionsStore.get().some((collection) => collection.id === this.draft?.id);
  },

  openTextDialog({ field, title, value, placeholder, onSave }) {
    this.textDialog = { field, title, value: value || "", placeholder: placeholder || "", onSave };
    this.render();
    this.container.querySelector("[data-collections-text-input]")?.focus?.();
  },

  submitTextDialog() {
    const dialog = this.textDialog;
    if (!dialog) {
      return;
    }
    const input = this.container.querySelector("[data-collections-text-input]");
    const value = String(input?.value ?? dialog.value ?? "");
    this.textDialog = null;
    dialog.onSave(value);
    this.render();
  },

  cancelTextDialog() {
    this.textDialog = null;
    this.render();
  },

  editTextField(field) {
    if (this.view === "tmdb") {
      if (field === "tmdbInput" || field === "tmdbTitleInput") {
        const isInput = field === "tmdbInput";
        this.openTextDialog({
          field,
          title: isInput
            ? t("collections_editor_tmdb_id_or_url", "ID or URL")
            : t("collections_editor_tmdb_display_title", "Display Title"),
          placeholder: isInput ? t("collections_editor_tmdb_id_or_url", "ID or URL") : "",
          value: String(this.tmdbState[field] || ""),
          onSave: (value) => {
            this.tmdbState = { ...this.tmdbState, [field]: value.trim(), error: "" };
          }
        });
        return;
      }
      if (field.startsWith("tmdbFilter:")) {
        const filterField = field.slice("tmdbFilter:".length);
        const definition = FILTER_DEFINITIONS.find(([key]) => key === filterField);
        if (!definition) {
          return;
        }
        this.openTextDialog({
          field,
          title: t(definition[1], filterField),
          placeholder: t(definition[2], ""),
          value: String(this.tmdbState.filters?.[filterField] ?? ""),
          onSave: (value) => {
            this.tmdbState = {
              ...this.tmdbState,
              filters: normalizeTmdbDraftFilters({
                ...this.tmdbState.filters,
                [filterField]: value.trim()
              }),
              error: ""
            };
          }
        });
        return;
      }
      return;
    }
    if (this.view === "trakt") {
      if (field !== "traktInput" && field !== "traktTitleInput") {
        return;
      }
      const isInput = field === "traktInput";
      this.openTextDialog({
        field,
        title: isInput
          ? t("collections_editor_trakt_list", "Trakt list")
          : t("collections_editor_tmdb_display_title", "Display Title"),
        placeholder: isInput
          ? t("collection_editor_trakt_search_placeholder", "Trakt URL or list ID")
          : t("collection_editor_trakt_name_placeholder", "Display name"),
        value: String(this.traktState[field] || ""),
        onSave: (value) => {
          this.traktState = { ...this.traktState, [field]: value.trim(), error: "" };
        }
      });
      return;
    }
    if (this.view === "folder") {
      const folder = this.editingFolder;
      const labels = {
        folderTitle: [
          t("collections_editor_folder_title", "Folder Title"),
          t("collections_editor_placeholder_folder", "")
        ],
        coverImageUrl: [
          t("collections_editor_cover_image_url", "Image URL"),
          t("collections_editor_placeholder_cover_image", "")
        ],
        focusGifUrl: [
          t("collections_editor_focus_gif", "Focus GIF"),
          t("collections_editor_placeholder_gif", "")
        ],
        heroBackdropUrl: [
          t("collections_editor_hero_backdrop", "Hero Backdrop"),
          t("collections_editor_placeholder_hero_backdrop", "")
        ],
        heroVideoUrl: [
          t("collections_editor_hero_video", "Hero Video"),
          t("collections_editor_placeholder_hero_video", "")
        ],
        titleLogoUrl: [
          t("collections_editor_title_logo", "Title Logo"),
          t("collections_editor_placeholder_title_logo", "")
        ]
      };
      const [title, placeholder] = labels[field] || ["", ""];
      if (!title) {
        return;
      }
      this.openTextDialog({
        field,
        title,
        placeholder,
        value: String(folder[field] || ""),
        onSave: (value) => {
          this.editingFolder = { ...folder, [field]: value.trim() || null };
        }
      });
      return;
    }
    if (field === "viewMode") {
      this.draft = {
        ...this.draft,
        viewMode: nextInList(COLLECTION_VIEW_MODES, this.draft.viewMode)
      };
      this.render();
      return;
    }
    const titles = {
      title: t("collections_editor_row_title", "Row Title"),
      backdropImageUrl: t("collections_editor_backdrop", "Backdrop Image")
    };
    const placeholders = {
      title: t("collections_editor_placeholder_name", "Collection name"),
      backdropImageUrl: t("collections_editor_placeholder_backdrop", "")
    };
    if (!titles[field]) {
      return;
    }
    this.openTextDialog({
      field,
      title: titles[field],
      placeholder: placeholders[field],
      value: String(this.draft[field] || ""),
      onSave: (value) => {
        this.draft = { ...this.draft, [field]: field === "title" ? value : value.trim() || null };
      }
    });
  },

  toggleField(field) {
    if (this.view === "tmdb") {
      this.tmdbState = { ...this.tmdbState, [field]: !this.tmdbState[field], error: "" };
      this.render();
      return;
    }
    if (this.view === "trakt") {
      this.traktState = { ...this.traktState, [field]: !this.traktState[field], error: "" };
      this.render();
      return;
    }
    if (this.view === "folder") {
      this.editingFolder = { ...this.editingFolder, [field]: !this.editingFolder[field] };
      this.render();
      return;
    }
    this.draft = { ...this.draft, [field]: !this.draft[field] };
    this.render();
  },

  cycleCoverMode() {
    const folder = this.editingFolder;
    const mode = coverModeOf(folder);
    if (mode === "NONE") {
      this.editingFolder = {
        ...folder,
        coverImageUrl: null,
        coverEmoji: folder.coverEmoji || "🎬"
      };
    } else if (mode === "EMOJI") {
      this.editingFolder = {
        ...folder,
        coverEmoji: null,
        coverImageUrl: folder.coverImageUrl || null
      };
      this.render();
      this.editTextField("coverImageUrl");
      return;
    } else {
      this.editingFolder = { ...folder, coverEmoji: null, coverImageUrl: null };
    }
    this.render();
  },

  cycleTileShape() {
    this.editingFolder = {
      ...this.editingFolder,
      tileShape: nextInList(COLLECTION_TILE_SHAPES, this.editingFolder.tileShape)
    };
    this.render();
  },

  openEmojiPicker() {
    this.view = "emoji";
    this.focusKey = `emoji:${EMOJI_OPTIONS[0]}`;
    this.render();
  },

  selectEmoji(emoji) {
    this.editingFolder = {
      ...this.editingFolder,
      coverEmoji: String(emoji || "").trim() || null,
      coverImageUrl: null
    };
    this.view = "folder";
    this.focusKey = "coverEmojiPick";
    this.render();
  },

  clearEmoji() {
    this.editingFolder = { ...this.editingFolder, coverEmoji: null };
    this.view = "folder";
    this.focusKey = "coverMode";
    this.render();
  },

  catalogGenreOptions(source = {}) {
    const entries = [...(this.catalogEntries || []), ...(this.pickerEntries || [])];
    const entry = entries.find(
      (item) =>
        item.source.addonId === source.addonId &&
        String(item.source.type) === String(source.type) &&
        String(item.source.catalogId) === String(source.catalogId)
    );
    return entry?.genreOptions || [];
  },

  openGenrePicker(index) {
    const source = this.editingFolder?.sources?.[index];
    const options = this.catalogGenreOptions(source || {});
    if (!source || !options.length) {
      return;
    }
    this.genrePickerIndex = index;
    this.genrePickerOptions = options;
    this.view = "genre";
    this.focusKey = `genre:${source.genre || "none"}`;
    this.render();
  },

  selectGenre(value) {
    const index = this.genrePickerIndex;
    const folder = this.editingFolder;
    const source = folder?.sources?.[index];
    if (!source) {
      return;
    }
    const sources = [...folder.sources];
    sources[index] = { ...source, genre: value === "none" ? null : value };
    this.editingFolder = { ...folder, sources };
    this.view = "folder";
    this.focusKey = `source:${index}:edit`;
    this.render();
  },

  async openTmdbPicker({ index = -1 } = {}) {
    this.editingSourceIndex = index;
    this.tmdbState = createTmdbSourceState();
    if (index >= 0) {
      const source = this.editingFolder?.sources?.[index];
      if (source?.provider === "tmdb") {
        this.tmdbState = {
          ...this.tmdbState,
          mode: SOURCE_TYPE_TO_TMDB_MODE[source.tmdbSourceType] || "PRESETS",
          input: source.tmdbId ? String(source.tmdbId) : "",
          titleInput: source.title || "",
          mediaType: source.mediaType === "TV" ? "TV" : "MOVIE",
          mediaBoth: false,
          sortBy: source.sortBy || TMDB_SORT_OPTIONS.POPULAR,
          filters: normalizeTmdbDraftFilters(source.filters)
        };
      }
    }
    this.view = "tmdb";
    this.focusKey = `tmdbMode:${this.tmdbState.mode}`;
    this.render();
  },

  async openTraktPicker({ index = -1 } = {}) {
    this.editingSourceIndex = index;
    this.traktState = createTraktSourceState();
    if (index >= 0) {
      const source = this.editingFolder?.sources?.[index];
      if (source?.provider === "trakt") {
        this.traktState = {
          ...this.traktState,
          input: source.traktListId ? String(source.traktListId) : "",
          titleInput: source.title || "",
          mediaType: source.mediaType === "TV" ? "TV" : "MOVIE",
          mediaBoth: false,
          sortBy: TRAKT_SORTS.includes(source.sortBy) ? source.sortBy : "rank",
          sortHow: TRAKT_SORT_HOWS.includes(source.sortHow) ? source.sortHow : "asc"
        };
      }
    }
    this.view = "trakt";
    this.focusKey = "traktInput";
    this.render();
    void this.loadTraktFeatured();
  },

  async loadTraktFeatured() {
    const token = Number(this.traktRequestToken || 0) + 1;
    this.traktRequestToken = token;
    const [trending, popular] = await Promise.all([
      collectionSourceResolver.trendingTraktLists().catch(() => []),
      collectionSourceResolver.popularTraktLists().catch(() => [])
    ]);
    if (this.traktRequestToken !== token || this.view !== "trakt") {
      return;
    }
    this.traktState = { ...this.traktState, trendingResults: trending, popularResults: popular };
    if (!this.textDialog) {
      this.render();
    }
  },

  applySourcesToFolder(sources, { coverImageUrl = null } = {}) {
    if (!Array.isArray(sources) || !sources.length) {
      return;
    }
    let folder = this.editingFolder;
    if (this.editingSourceIndex >= 0) {
      folder = replaceSourceInFolder(folder, this.editingSourceIndex, sources);
    } else {
      folder = addSourcesToFolder(folder, sources);
    }
    if (coverImageUrl && !folder.coverImageUrl) {
      folder = { ...folder, coverImageUrl, coverEmoji: null };
    }
    this.editingFolder = folder;
    this.editingSourceIndex = -1;
    this.view = "folder";
    this.focusKey = "addTmdb";
    this.render();
  },

  async searchTmdb() {
    const mode = this.tmdbState.mode;
    const query = this.tmdbState.input || this.tmdbState.titleInput;
    if (!query.trim()) {
      this.tmdbState = {
        ...this.tmdbState,
        error: t("collections_editor_tmdb_search_helper", "Search by name or ID")
      };
      this.render();
      return;
    }
    const token = Number(this.tmdbRequestToken || 0) + 1;
    this.tmdbRequestToken = token;
    this.tmdbBusy = true;
    this.tmdbState = { ...this.tmdbState, error: "" };
    this.render();
    let companies = [];
    let collections = [];
    if (mode === "PRODUCTION") {
      companies = await collectionSourceResolver.searchTmdbCompanies(query).catch(() => []);
    } else if (mode === "COLLECTION") {
      collections = await collectionSourceResolver.searchTmdbCollections(query).catch(() => []);
    }
    if (this.tmdbRequestToken !== token || this.view !== "tmdb") {
      return;
    }
    this.tmdbBusy = false;
    this.tmdbState = {
      ...this.tmdbState,
      companyResults: companies,
      collectionResults: collections,
      error:
        !companies.length && !collections.length && ["PRODUCTION", "COLLECTION"].includes(mode)
          ? t("collections_editor_tmdb_search_helper", "No results found")
          : ""
    };
    this.render();
  },

  async addTmdbFromInput() {
    const { sourceType, sources } = buildTmdbSourcesFromState(this.tmdbState, {
      titles: {
        movie: t("type_movies", "Movies"),
        tv: t("type_series_plural", "Series")
      },
      defaultTitles: tmdbDefaultTitles(parseNumericSourceId(this.tmdbState.input))
    });
    if (!sources.length) {
      this.tmdbState = {
        ...this.tmdbState,
        error: t("collections_editor_error_valid_tmdb_id_or_url", "Enter a valid TMDB ID or URL")
      };
      this.render();
      return;
    }
    let coverImageUrl = null;
    const metadataTypes = ["LIST", "COLLECTION", "COMPANY", "NETWORK", "PERSON", "DIRECTOR"];
    if (metadataTypes.includes(sourceType)) {
      const metadata = await collectionSourceResolver
        .tmdbImportMetadata(sourceType, sources[0].tmdbId)
        .catch(() => null);
      if (this.view !== "tmdb") {
        return;
      }
      if (!metadata && (sourceType === "LIST" || sourceType === "COLLECTION")) {
        this.tmdbState = {
          ...this.tmdbState,
          error: t("collections_editor_error_load_tmdb_source", "Could not load the TMDB source")
        };
        this.render();
        return;
      }
      coverImageUrl = metadata?.coverImageUrl || null;
      if (
        (sourceType === "LIST" || sourceType === "COLLECTION") &&
        !this.tmdbState.titleInput &&
        metadata?.title
      ) {
        const rebuilt = buildTmdbSourcesFromState(
          { ...this.tmdbState, titleInput: metadata.title },
          {
            titles: {
              movie: t("type_movies", "Movies"),
              tv: t("type_series_plural", "Series")
            },
            defaultTitles: tmdbDefaultTitles(parseNumericSourceId(this.tmdbState.input))
          }
        );
        this.applySourcesToFolder(rebuilt.sources, { coverImageUrl });
        return;
      }
    }
    this.applySourcesToFolder(sources, { coverImageUrl });
  },

  async addTmdbPreset(index) {
    const preset = TMDB_PRESETS[index];
    if (!preset) {
      return;
    }
    const metadata = await collectionSourceResolver
      .tmdbImportMetadata(preset.source.tmdbSourceType, preset.source.tmdbId)
      .catch(() => null);
    if (this.view !== "tmdb") {
      return;
    }
    this.applySourcesToFolder([preset.source], {
      coverImageUrl: metadata?.coverImageUrl || null
    });
  },

  addTmdbResult(index) {
    const state = this.tmdbState;
    const result =
      state.mode === "PRODUCTION"
        ? state.companyResults?.[index]
        : state.collectionResults?.[index];
    if (!result) {
      return;
    }
    const sourceType = state.mode === "PRODUCTION" ? "COMPANY" : "COLLECTION";
    const mediaTypes = ["PRODUCTION"].includes(state.mode)
      ? state.mediaBoth
        ? ["MOVIE", "TV"]
        : [state.mediaType]
      : ["MOVIE"];
    const sources = mediaTypes.map((mediaType) => ({
      provider: "tmdb",
      tmdbSourceType: sourceType,
      title: titleWithMediaSuffix(result.name, mediaType, mediaTypes.length > 1, {
        movie: t("type_movies", "Movies"),
        tv: t("type_series_plural", "Series")
      }),
      tmdbId: result.id,
      mediaType,
      sortBy: state.sortBy,
      filters: normalizeTmdbDraftFilters(state.filters)
    }));
    this.applySourcesToFolder(sources, {
      coverImageUrl: result.posterUrl || result.logoUrl || null
    });
  },

  async searchTrakt() {
    const query = this.traktState.input || this.traktState.titleInput;
    if (!query.trim()) {
      this.traktState = {
        ...this.traktState,
        error: t("collections_editor_tmdb_search_helper", "Search by name or ID")
      };
      this.render();
      return;
    }
    const token = Number(this.traktRequestToken || 0) + 1;
    this.traktRequestToken = token;
    this.traktState = { ...this.traktState, error: "" };
    this.render();
    const results = await collectionSourceResolver.searchTraktLists(query).catch(() => []);
    if (this.traktRequestToken !== token || this.view !== "trakt") {
      return;
    }
    this.traktState = {
      ...this.traktState,
      results,
      error: results.length
        ? ""
        : t("collections_editor_error_search_trakt_lists", "No Trakt lists found")
    };
    this.render();
  },

  async addTraktFromInput() {
    const input = String(this.traktState.input || "").trim();
    if (!input) {
      this.traktState = {
        ...this.traktState,
        error: t("collections_editor_error_trakt_list_id_or_url", "Enter a Trakt list ID or URL")
      };
      this.render();
      return;
    }
    const metadata = await collectionSourceResolver.traktListMetadata(input).catch(() => null);
    if (this.view !== "trakt") {
      return;
    }
    if (!metadata) {
      this.traktState = {
        ...this.traktState,
        error: t("collections_editor_error_load_trakt_list", "Could not load the Trakt list")
      };
      this.render();
      return;
    }
    const state = {
      ...this.traktState,
      input: String(metadata.traktListId),
      titleInput:
        this.traktState.titleInput || metadata.title || `Trakt List ${metadata.traktListId}`
    };
    const sources = buildTraktSourcesFromState(state, {
      titles: {
        movie: t("type_movies", "Movies"),
        tv: t("type_series_plural", "Series")
      },
      defaultTitle: t("collections_editor_trakt_list_with_id", "Trakt List %1$d").replace(
        "%1$d",
        String(metadata.traktListId)
      )
    });
    this.applySourcesToFolder(sources, { coverImageUrl: metadata.coverImageUrl });
  },

  addTraktResult(listId) {
    const state = this.traktState;
    const result = [
      ...(state.results || []),
      ...(state.trendingResults || []),
      ...(state.popularResults || [])
    ].find((entry) => String(entry.traktListId) === String(listId));
    if (!result) {
      return;
    }
    const sources = buildTraktSourcesFromState(
      {
        ...state,
        input: String(result.traktListId),
        titleInput: state.titleInput || result.title
      },
      {
        titles: {
          movie: t("type_movies", "Movies"),
          tv: t("type_series_plural", "Series")
        }
      }
    );
    this.applySourcesToFolder(sources, { coverImageUrl: result.coverImageUrl });
  },

  openFolderEditor(index) {
    if (index >= 0) {
      this.editingFolderIndex = index;
      this.editingFolder = JSON.parse(JSON.stringify(this.draft.folders[index]));
    } else {
      this.editingFolderIndex = -1;
      this.editingFolder = createEmptyFolderDraft(CollectionsStore.generateId());
    }
    this.view = "folder";
    this.focusKey = "folderTitle";
    this.render();
  },

  moveFolder(index, direction) {
    const folders = [...(this.draft.folders || [])];
    const target = index + direction;
    if (index < 0 || index >= folders.length || target < 0 || target >= folders.length) {
      return;
    }
    const [moved] = folders.splice(index, 1);
    folders.splice(target, 0, moved);
    this.draft = { ...this.draft, folders };
    this.focusKey = `folder:${folders[target].id}`;
    this.render();
  },

  saveFolder() {
    const folder = this.editingFolder;
    if (!folder) {
      return;
    }
    const saved = {
      ...folder,
      title: String(folder.title || "").trim() || t("collection_editor_untitled_folder", "Untitled")
    };
    const folders = [...(this.draft.folders || [])];
    if (this.editingFolderIndex >= 0) {
      folders[this.editingFolderIndex] = saved;
    } else {
      folders.push(saved);
    }
    this.draft = { ...this.draft, folders };
    this.view = "main";
    this.editingFolder = null;
    this.editingFolderIndex = -1;
    this.focusKey = `folder:${saved.id}`;
    this.render();
  },

  async openCatalogPicker() {
    const token = Number(this.pickerRequestToken || 0) + 1;
    this.pickerRequestToken = token;
    this.view = "picker";
    this.pickerEntries = this.catalogEntries || [];
    this.focusKey = this.pickerEntries[0] ? `catalog:${this.pickerEntries[0].key}` : "pickerDone";
    this.render();
    const entries = await this.collectCatalogEntries();
    if (this.pickerRequestToken !== token || this.view !== "picker") {
      return;
    }
    this.pickerEntries = entries;
    this.focusKey = entries[0] ? `catalog:${entries[0].key}` : "pickerDone";
    this.render();
  },

  async collectCatalogEntries() {
    const addons = await addonRepository.getInstalledAddons().catch(() => []);
    this.installedAddonIds = new Set(
      (Array.isArray(addons) ? addons : []).map((addon) => String(addon?.id || ""))
    );
    const entries = [];
    const seen = new Set();
    (Array.isArray(addons) ? addons : []).forEach((addon) => {
      (Array.isArray(addon?.catalogs) ? addon.catalogs : []).forEach((catalog) => {
        const extras = Array.isArray(catalog?.extra) ? catalog.extra : [];
        const genreExtra = extras.find(
          (extra) => String(extra?.name || "").toLowerCase() === "genre"
        );
        const hasRequiredExtra = extras.some(
          (extra) =>
            extra?.isRequired === true && String(extra?.name || "").toLowerCase() !== "genre"
        );
        if (hasRequiredExtra || !catalog?.id || !catalog?.apiType) {
          return;
        }
        const source = {
          provider: "addon",
          addonId: addon.id,
          addonBaseUrl: addon.baseUrl || null,
          addonName: addon.displayName || addon.id,
          type: catalog.apiType,
          catalogId: catalog.id,
          catalogName: catalog.name || catalog.id,
          title: catalog.name || catalog.id,
          genre: null
        };
        const identity = addon.id + "|" + catalog.apiType + "|" + catalog.id;
        if (seen.has(identity)) {
          return;
        }
        seen.add(identity);
        entries.push({
          key: identity,
          source,
          genreOptions: Array.isArray(genreExtra?.options) ? genreExtra.options : [],
          genreRequired: genreExtra?.isRequired === true
        });
      });
    });
    this.catalogEntries = entries;
    return entries;
  },

  async refreshCatalogEntries() {
    await this.collectCatalogEntries();
    if (this.view === "folder" && !this.textDialog) {
      this.render();
    }
  },

  async activateFocused() {
    if (this.textDialog) {
      return;
    }
    const node =
      this.container?.querySelector(".collections-focusable.focused") ||
      this.container?.querySelector(".collections-focusable");
    if (!node) {
      return;
    }
    const action = String(node.dataset.action || "");
    const field = String(node.dataset.field || "");
    const index = Number(node.dataset.index || -1);
    const value = String(node.dataset.value || "");

    if (action === "editText") {
      this.editTextField(field);
      return;
    }
    if (action === "toggle") {
      this.toggleField(field);
      return;
    }
    if (action === "addFolder") {
      this.openFolderEditor(-1);
      return;
    }
    if (action === "editFolder") {
      this.openFolderEditor(index);
      return;
    }
    if (action === "folderUp" || action === "folderDown") {
      this.moveFolder(index, action === "folderUp" ? -1 : 1);
      return;
    }
    if (action === "deleteFolderRow") {
      this.editingFolderIndex = index;
      this.editingFolder = { ...(this.draft.folders?.[index] || {}) };
      this.confirmDeleteFolder();
      return;
    }
    if (action === "save") {
      this.saveCollection();
      return;
    }
    if (action === "back") {
      await Router.back();
      return;
    }
    if (action === "folderBack") {
      this.view = "main";
      this.editingFolder = null;
      this.editingFolderIndex = -1;
      this.focusKey = "addFolder";
      this.render();
      return;
    }
    if (action === "saveFolder") {
      this.saveFolder();
      return;
    }
    if (action === "deleteFolder") {
      this.confirmDeleteFolder();
      return;
    }
    if (action === "addCatalog") {
      await this.openCatalogPicker();
      return;
    }
    if (action === "openTmdbPicker") {
      await this.openTmdbPicker();
      return;
    }
    if (action === "openTraktPicker") {
      await this.openTraktPicker();
      return;
    }
    if (action === "cycleCoverMode") {
      this.cycleCoverMode();
      return;
    }
    if (action === "cycleTileShape") {
      this.cycleTileShape();
      return;
    }
    if (action === "openEmojiPicker") {
      this.openEmojiPicker();
      return;
    }
    if (action === "selectEmoji") {
      this.selectEmoji(value);
      return;
    }
    if (action === "clearEmoji") {
      this.clearEmoji();
      return;
    }
    if (action === "customEmoji") {
      this.openTextDialog({
        field: "coverEmoji",
        title: t("collections_editor_cover_emoji", "Emoji"),
        placeholder: "😀",
        value: this.editingFolder?.coverEmoji || "",
        onSave: (value) => {
          this.editingFolder = {
            ...this.editingFolder,
            coverEmoji: value.trim() || null,
            coverImageUrl: null
          };
          this.view = "folder";
          this.focusKey = "coverEmojiPick";
        }
      });
      return;
    }
    if (action === "emojiBack") {
      this.view = "folder";
      this.focusKey = "coverEmojiPick";
      this.render();
      return;
    }
    if (action === "genreBack") {
      this.view = "folder";
      this.focusKey = `source:${this.genrePickerIndex}:edit`;
      this.render();
      return;
    }
    if (action === "selectGenre") {
      this.selectGenre(field.slice("genre:".length));
      return;
    }
    if (action === "sourceEdit") {
      const source = this.editingFolder?.sources?.[index];
      if (!source) {
        return;
      }
      if (source.provider === "tmdb") {
        await this.openTmdbPicker({ index });
      } else if (source.provider === "trakt") {
        await this.openTraktPicker({ index });
      } else {
        this.openGenrePicker(index);
      }
      return;
    }
    if (action === "sourceUp" || action === "sourceDown" || action === "sourceRemove") {
      if (action === "sourceRemove") {
        this.editingFolder = removeSourceFromFolder(this.editingFolder, index);
      } else {
        this.editingFolder = moveSourceInFolder(
          this.editingFolder,
          index,
          action === "sourceUp" ? -1 : 1
        );
      }
      this.render();
      return;
    }
    if (action === "toggleCatalog") {
      const key = String(node.dataset.key || "");
      const entry = (this.pickerEntries || []).find((item) => item.key === key);
      if (!entry) {
        return;
      }
      const folder = this.editingFolder;
      const exists = (folder?.sources || []).some(
        (source) => sourceIdentity(source) === sourceIdentity(entry.source)
      );
      if (exists) {
        this.editingFolder = {
          ...folder,
          sources: folder.sources.filter(
            (source) => sourceIdentity(source) !== sourceIdentity(entry.source)
          )
        };
      } else {
        const source = buildAddonCatalogSource(entry.source);
        this.editingFolder = addSourceToFolder(folder, {
          ...source,
          genre: entry.genreRequired ? entry.genreOptions[0] || null : null
        });
      }
      this.focusKey = `catalog:${key}`;
      this.render();
      return;
    }
    if (action === "pickerDone") {
      this.view = "folder";
      this.focusKey = "addCatalog";
      this.render();
      return;
    }
    if (action === "setTmdbMode") {
      const mode = field.slice("tmdbMode:".length);
      const sorts = tmdbSortOptionsForMode(mode, this.tmdbState.mediaType);
      this.tmdbState = {
        ...this.tmdbState,
        mode,
        sortBy: sorts.includes(this.tmdbState.sortBy) ? this.tmdbState.sortBy : sorts[0],
        companyResults: [],
        collectionResults: [],
        error: ""
      };
      this.focusKey = `tmdbMode:${mode}`;
      this.render();
      return;
    }
    if (action === "addTmdbPreset") {
      await this.addTmdbPreset(index);
      return;
    }
    if (action === "cycleTmdbMedia") {
      const state = this.tmdbState;
      if (state.mediaBoth === true) {
        this.tmdbState = { ...state, mediaBoth: false };
      } else {
        const mediaType = state.mediaType === "TV" ? "MOVIE" : "TV";
        let sortBy = state.sortBy;
        if (mediaType === "TV" && sortBy === TMDB_SORT_OPTIONS.RECENT) {
          sortBy = TMDB_SORT_OPTIONS.RECENT_TV;
        } else if (mediaType === "MOVIE" && sortBy === TMDB_SORT_OPTIONS.RECENT_TV) {
          sortBy = TMDB_SORT_OPTIONS.RECENT;
        }
        this.tmdbState = { ...state, mediaType, sortBy };
      }
      this.render();
      return;
    }
    if (action === "cycleTmdbSort") {
      this.tmdbState = {
        ...this.tmdbState,
        sortBy: nextInList(
          tmdbSortOptionsForMode(this.tmdbState.mode, this.tmdbState.mediaType),
          this.tmdbState.sortBy
        )
      };
      this.render();
      return;
    }
    if (action === "setTmdbFilter") {
      this.tmdbState = {
        ...this.tmdbState,
        filters: normalizeTmdbDraftFilters({ ...this.tmdbState.filters, [field]: value })
      };
      this.render();
      return;
    }
    if (action === "searchTmdb") {
      await this.searchTmdb();
      return;
    }
    if (action === "addTmdbFromInput") {
      await this.addTmdbFromInput();
      return;
    }
    if (action === "addTmdbResult") {
      this.addTmdbResult(index);
      return;
    }
    if (action === "tmdbBack") {
      this.editingSourceIndex = -1;
      this.view = "folder";
      this.focusKey = "addTmdb";
      this.render();
      return;
    }
    if (action === "cycleTraktMedia") {
      const state = this.traktState;
      this.traktState =
        state.mediaBoth === true
          ? { ...state, mediaBoth: false }
          : { ...state, mediaType: state.mediaType === "TV" ? "MOVIE" : "TV" };
      this.render();
      return;
    }
    if (action === "cycleTraktSort") {
      this.traktState = {
        ...this.traktState,
        sortBy: nextInList(TRAKT_SORTS, this.traktState.sortBy)
      };
      this.render();
      return;
    }
    if (action === "cycleTraktSortHow") {
      this.traktState = {
        ...this.traktState,
        sortHow: nextInList(TRAKT_SORT_HOWS, this.traktState.sortHow)
      };
      this.render();
      return;
    }
    if (action === "searchTrakt") {
      await this.searchTrakt();
      return;
    }
    if (action === "addTraktFromInput") {
      await this.addTraktFromInput();
      return;
    }
    if (action === "addTraktResult") {
      this.addTraktResult(node.dataset.id);
      return;
    }
    if (action === "traktBack") {
      this.editingSourceIndex = -1;
      this.view = "folder";
      this.focusKey = "addTrakt";
      this.render();
    }
  },

  saveCollection() {
    if (!canSaveCollectionDraft(this.draft)) {
      return;
    }
    const saved = {
      ...this.draft,
      title: String(this.draft.title || "").trim(),
      folders: (this.draft.folders || []).map((folder) => ({
        ...folder,
        title:
          String(folder.title || "").trim() || t("collection_editor_untitled_folder", "Untitled")
      }))
    };
    const current = CollectionsStore.get();
    const index = current.findIndex((collection) => collection.id === saved.id);
    const next = [...current];
    if (index >= 0) {
      next[index] = saved;
    } else {
      next.push(saved);
    }
    CollectionsStore.replace(next);
    void Router.back();
  },

  confirmDeleteFolder() {
    const folder = this.editingFolder;
    if (!folder || this.deleteDialog) {
      return;
    }
    if (this.editingFolderIndex < 0) {
      this.view = "main";
      this.editingFolder = null;
      this.focusKey = "addFolder";
      this.render();
      return;
    }
    this.deleteDialog = new NuvioDialog({
      title: t("collections_editor_delete_folder_title", "Delete Folder?"),
      subtitle: t(
        "collections_editor_delete_folder_subtitle",
        `This will permanently delete "${folder.title}".`
      ).replace("%1$s", folder.title),
      widthVw: 42,
      buttons: [
        {
          label: t("collections_delete_confirm", "Delete"),
          key: "delete",
          danger: true,
          onAction: () => {
            this.closeDeleteDialog();
            const folders = [...(this.draft.folders || [])];
            if (this.editingFolderIndex >= 0) {
              folders.splice(this.editingFolderIndex, 1);
            }
            this.draft = { ...this.draft, folders };
            this.view = "main";
            this.editingFolder = null;
            this.editingFolderIndex = -1;
            this.focusKey = "addFolder";
            this.render();
          }
        },
        {
          label: t("collections_cancel", "Cancel"),
          key: "cancel",
          onAction: () => this.closeDeleteDialog()
        }
      ],
      onDismiss: () => this.closeDeleteDialog()
    }).mount(document.body);
  },

  closeDeleteDialog() {
    const dialog = this.deleteDialog;
    this.deleteDialog = null;
    dialog?.destroy?.();
  },

  consumeBackRequest() {
    if (this.deleteDialog) {
      this.closeDeleteDialog();
      return true;
    }
    if (this.textDialog) {
      this.cancelTextDialog();
      return true;
    }
    if (["picker", "tmdb", "trakt", "genre", "emoji"].includes(this.view)) {
      const returnKey =
        this.view === "picker"
          ? "addCatalog"
          : this.view === "tmdb"
            ? "addTmdb"
            : this.view === "trakt"
              ? "addTrakt"
              : this.view === "genre"
                ? `source:${this.genrePickerIndex}:edit`
                : "coverEmojiPick";
      this.editingSourceIndex = -1;
      this.view = "folder";
      this.focusKey = returnKey;
      this.render();
      return true;
    }
    if (this.view === "folder") {
      this.view = "main";
      this.editingFolder = null;
      this.editingFolderIndex = -1;
      this.focusKey = "addFolder";
      this.render();
      return true;
    }
    return false;
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);
    if (this.deleteDialog) {
      return;
    }
    if (this.textDialog) {
      if (SELECT_KEY_CODES.has(code)) {
        event?.preventDefault?.();
        this.submitTextDialog();
      }
      return;
    }
    if (code === 37 || code === 38 || code === 39 || code === 40) {
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : "right";
      if (ScreenUtils.moveFocusDirectional(this.container, direction, ".collections-focusable")) {
        event?.preventDefault?.();
        const focused = this.container?.querySelector(".collections-focusable.focused");
        this.focusKey = String(focused?.dataset?.focusKey || this.focusKey);
        focused?.scrollIntoView?.({ block: "nearest" });
      }
      return;
    }
    if (SELECT_KEY_CODES.has(code)) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      await this.activateFocused();
    }
  },

  cleanup() {
    this.pickerRequestToken = Number(this.pickerRequestToken || 0) + 1;
    this.tmdbRequestToken = Number(this.tmdbRequestToken || 0) + 1;
    this.traktRequestToken = Number(this.traktRequestToken || 0) + 1;
    this.closeDeleteDialog();
    this.textDialog = null;
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
