export const MODERN_HOME_CONSTANTS = {
  heroFocusDelayMs: 450,
  heroRapidNavThresholdMs: 130,
  heroRapidSettleMs: 400,
  keyRepeatThrottleMs: 80,
  verticalKeyRepeatThrottleMs: 112,
  trackPaginationIdleMs: 160,
  trackPaginationPrefetchDelayMs: 40,
  trackPaginationLoadAheadItems: 4,
  cameraFollowDelayMs: 140,
  cameraFollowDurationXMs: 440,
  cameraFollowDurationYMs: 440,
  cameraSafetyDurationMs: 180,
  springScrollStiffness: 180,
  springScrollDampingRatio: 0.95,
  rowFocusInset: 40,
  trackEdgePadding: 104,
  verticalFastScrollVelocityPxPerSec: 6400,
  verticalFastScrollEndTimeoutMs: 160,
  verticalFastScrollMaxFrameMs: 48
};

export function renderModernHomeLayout({
  rows = [],
  heroItem = null,
  heroCandidates = [],
  continueWatchingItems = [],
  continueWatchingLoading = false,
  continueWatchingLoadingCount = 0,
  useEpisodeThumbnailsInCw = true,
  blurContinueWatchingNextUp = false,
  rowItemLimit = 15,
  showHeroSection = false,
  showPosterLabels = true,
  showCatalogTypeSuffix = true,
  preferLandscapePosters = false,
  focusedRowKey = "",
  focusedItemIndex = -1,
  expandFocusedPoster = false,
  buildModernHeroPresentation,
  renderHeroBackdropImage,
  renderContinueWatchingSection,
  createPosterCardMarkup,
  createSeeAllCardMarkup: _createSeeAllCardMarkup,
  formatCatalogRowTitle,
  shouldDeferRowImages,
  watchedTitleIds = null,
  escapeHtml,
  escapeAttribute
} = {}) {
  const catalogSeeAllMap = new Map();
  const sectionsMarkup = [];

  rows.forEach((rowData, rowIndex) => {
    const isCollectionRow = rowData?.rowKind === "collection";
    const items = Array.isArray(rowData?.result?.data?.items) ? rowData.result.data.items : [];
    const isLoading = rowData?.result?.status === "loading";
    const rowItems = items.length ? items : rowData.loadingItems || [];
    if (!rowItems.length) {
      return;
    }

    const rowKey = String(rowData?.homeCatalogKey || buildModernRowKey(rowData));
    const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
    if (!isLoading && !isCollectionRow) {
      catalogSeeAllMap.set(seeAllId, {
        addonBaseUrl: rowData.addonBaseUrl || "",
        addonId: rowData.addonId || "",
        addonName: rowData.addonName || "",
        catalogId: rowData.catalogId || "",
        catalogName: rowData.catalogName || "",
        type: rowData.type || "movie",
        initialItems: items
      });
    }

    const maxItems = Math.max(1, Number(rowItemLimit || 15));
    const focusedItemLimit =
      focusedRowKey === rowKey && Number.isFinite(focusedItemIndex)
        ? Math.max(0, Number(focusedItemIndex)) + 1
        : 0;
    const visibleItems = isCollectionRow
      ? rowItems
      : rowItems.slice(0, Math.max(maxItems, focusedItemLimit));
    const rowTitle = isCollectionRow
      ? String(rowData.collectionTitle || rowData.collection?.title || "Collection")
      : formatCatalogRowTitle(rowData.catalogName, rowData.type, showCatalogTypeSuffix);
    const deferRowImages =
      typeof shouldDeferRowImages === "function"
        ? shouldDeferRowImages(rowIndex, rowKey, focusedRowKey)
        : false;
    const cardsMarkup = visibleItems
      .map((item, itemIndex) =>
        createPosterCardMarkup(
          item,
          rowIndex,
          itemIndex,
          rowData.type,
          rowData,
          showPosterLabels,
          "modern",
          expandFocusedPoster && focusedRowKey === rowKey && focusedItemIndex === itemIndex,
          preferLandscapePosters,
          deferRowImages,
          watchedTitleIds
        )
      )
      .join("");

    sectionsMarkup.push(`
      <section class="home-row home-modern-row home-row-enter" data-row-key="${escapeHtml(rowKey)}" data-row-index="${rowIndex}">
        <div class="home-row-head">
          <h2 class="home-row-title">${escapeHtml(rowTitle)}</h2>
        </div>
        <div class="home-track" data-track-row-key="${escapeHtml(rowKey)}">
          ${cardsMarkup}
        </div>
      </section>
    `);
  });

  return {
    catalogSeeAllMap,
    markup: `
      <section class="home-modern-stage">
        ${
          showHeroSection
            ? renderModernHeroMarkup({
                heroItem,
                heroCandidates,
                buildModernHeroPresentation,
                renderHeroBackdropImage,
                escapeHtml,
                escapeAttribute
              })
            : continueWatchingLoading
              ? renderModernHeroSkeletonMarkup()
              : ""
        }
        <div class="home-modern-rows-viewport">
          <div class="home-modern-rows-scroll">
            ${renderContinueWatchingSection(continueWatchingItems, {
              rowKey: "continue_watching",
              loading: continueWatchingLoading,
              loadingCount: continueWatchingLoadingCount,
              useEpisodeThumbnails: useEpisodeThumbnailsInCw,
              blurNextUp: blurContinueWatchingNextUp
            })}
            <div class="home-modern-catalogs">
              ${sectionsMarkup.join("")}
            </div>
          </div>
        </div>
      </section>
    `
  };
}

export function buildModernNavigationRows(container) {
  const rows = [];
  const continueTrack = container?.querySelector(".home-row-continue .home-track");
  if (continueTrack) {
    const continueNodes = Array.from(
      continueTrack.querySelectorAll(".home-content-card.focusable")
    );
    if (continueNodes.length) {
      rows.push(continueNodes);
    }
  }

  const rowSections = Array.from(container?.querySelectorAll(".home-modern-row") || []);
  rowSections.forEach((section) => {
    const track = section.querySelector(".home-track");
    if (!track) {
      return;
    }
    const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
    if (cards.length) {
      rows.push(cards);
    }
  });

  return rows;
}

export function buildModernRowKey(rowData = {}) {
  return `${rowData.addonId || ""}_${rowData.type || ""}_${rowData.catalogId || ""}`;
}

function buildHeroIndicators(items = [], activeItem = null) {
  if (!Array.isArray(items) || items.length <= 1) {
    return "";
  }
  const activeId = String(activeItem?.id || "");
  const activeIndex = items.findIndex((item) => String(item?.id || "") === activeId);
  return items
    .map(
      (_, index) => `
    <span class="home-hero-indicator${index === activeIndex ? " is-active" : ""}"></span>
  `
    )
    .join("");
}

function renderModernHeroMarkup({
  heroItem,
  heroCandidates,
  buildModernHeroPresentation,
  renderHeroBackdropImage,
  escapeHtml,
  escapeAttribute
}) {
  const display = buildModernHeroPresentation(heroItem);
  if (!display) {
    return "";
  }
  const primaryLeft = display.leadingMeta
    .map((token) => `<span>${escapeHtml(token)}</span>`)
    .join('<span class="home-hero-dot">•</span>');
  const primaryRightParts = display.trailingMeta.map(
    (token) => `<span>${escapeHtml(token)}</span>`
  );
  if (display.showImdbPrimary) {
    primaryRightParts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  const hasPrimaryRight = primaryRightParts.length > 0;
  const secondaryParts = [];
  if (display.secondaryHighlightText) {
    secondaryParts.push(
      `<span class="home-modern-hero-highlight">${escapeHtml(display.secondaryHighlightText)}</span>`
    );
  }
  display.badges.forEach((badge) => {
    secondaryParts.push(`<span class="home-modern-hero-badge">${escapeHtml(badge)}</span>`);
  });
  if (display.showImdbSecondary) {
    secondaryParts.push(`
      <span class="home-hero-imdb">
        <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
        <span>${escapeHtml(display.imdbText)}</span>
      </span>
    `);
  }
  if (display.languageText) {
    secondaryParts.push(
      `<span class="home-modern-hero-secondary-detail">${escapeHtml(display.languageText)}</span>`
    );
  }
  return `
    <section class="home-hero home-hero-modern">
      <article class="home-hero-card home-modern-hero-card${heroItem?.heroMetaEnriching ? " is-hero-meta-enriching" : ""}"
               data-item-id="${escapeAttribute(heroItem?.id || "")}"
               data-item-type="${escapeAttribute(heroItem?.type || "movie")}"
               data-item-title="${escapeAttribute(heroItem?.name || "Untitled")}">
        <div class="home-modern-hero-media">
          <div class="home-hero-backdrop-wrap">
          ${
            typeof renderHeroBackdropImage === "function"
              ? renderHeroBackdropImage(display)
              : display.backdrop
                ? `<img class="home-hero-backdrop" src="${escapeAttribute(display.backdrop)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />`
                : '<div class="home-hero-backdrop placeholder"></div>'
          }
          </div>
          <div class="home-hero-trailer-layer"></div>
        </div>
        <div class="home-hero-copy home-modern-hero-copy">
          <div class="home-hero-brand">
            ${display.logo ? `<img class="home-hero-logo" src="${escapeAttribute(display.logo)}" alt="${escapeAttribute(display.title)}" decoding="async" fetchpriority="high" />` : ""}
            <h1 class="home-hero-title-text${display.logo ? " is-hidden" : ""}">${escapeHtml(display.title)}</h1>
          </div>
          <div class="home-modern-hero-meta-line${display.leadingMeta.length || display.trailingMeta.length || display.showImdbPrimary ? "" : " is-empty"}">
            <div class="home-modern-hero-meta-group home-modern-hero-meta-group-leading">
              ${primaryLeft}
            </div>
            ${primaryLeft && hasPrimaryRight ? '<span class="home-hero-dot">•</span>' : ""}
            <div class="home-modern-hero-meta-group home-modern-hero-meta-group-trailing">
              ${primaryRightParts.join('<span class="home-hero-dot">•</span>')}
            </div>
          </div>
          <div class="home-modern-hero-secondary${display.secondaryHighlightText || display.badges.length || display.showImdbSecondary || display.languageText ? "" : " is-empty"}">
            ${secondaryParts.join('<span class="home-hero-dot">•</span>')}
          </div>
          <p class="home-hero-description${display.description ? "" : " is-empty"}">${escapeHtml(display.description)}</p>
        </div>
        <div class="home-hero-indicators">${buildHeroIndicators(heroCandidates, heroItem)}</div>
      </article>
    </section>
  `;
}

function renderModernHeroSkeletonMarkup() {
  return `
    <section class="home-hero home-hero-modern home-hero-modern-loading" aria-hidden="true">
      <article class="home-hero-card home-modern-hero-card home-modern-hero-card-loading">
        <div class="home-modern-hero-media home-modern-hero-media-loading">
          <div class="home-hero-backdrop-wrap">
            <div class="home-hero-backdrop placeholder home-hero-backdrop-loading"></div>
          </div>
        </div>
      </article>
    </section>
  `;
}
