import { createMetaDetailsScreenMethods01 } from "./metaDetailsScreenMethods-01-get-route-state-key.js";
import { createMetaDetailsScreenMethods02 } from "./metaDetailsScreenMethods-02-mount.js";
import { createMetaDetailsScreenMethods03 } from "./metaDetailsScreenMethods-03-load-detail.js";
import { createMetaDetailsScreenMethods04 } from "./metaDetailsScreenMethods-04-fetch-more-like-this.js";
import { createMetaDetailsScreenMethods05 } from "./metaDetailsScreenMethods-05-resolve-initial-selected-season.js";
import { createMetaDetailsScreenMethods06 } from "./metaDetailsScreenMethods-06-enrich-meta.js";
import { createMetaDetailsScreenMethods07 } from "./metaDetailsScreenMethods-07-merge-stream-items.js";
import { createMetaDetailsScreenMethods08 } from "./metaDetailsScreenMethods-08-render-external-ratings-row.js";
import { createMetaDetailsScreenMethods09 } from "./metaDetailsScreenMethods-09-render-series-insight-section.js";
import { createMetaDetailsScreenMethods10 } from "./metaDetailsScreenMethods-10-get-episode-card-presentation.js";
import { createMetaDetailsScreenMethods11 } from "./metaDetailsScreenMethods-11-sync-rendered-episode-track.js";
import { createMetaDetailsScreenMethods12 } from "./metaDetailsScreenMethods-12-get-episode-hold-menu-options.js";
import { createMetaDetailsScreenMethods13 } from "./metaDetailsScreenMethods-13-has-pending-hero-hold.js";
import { createMetaDetailsScreenMethods14 } from "./metaDetailsScreenMethods-14-move-episode-focus.js";
import { createMetaDetailsScreenMethods15 } from "./metaDetailsScreenMethods-15-refresh-episode-playback-state.js";
import { createMetaDetailsScreenMethods16 } from "./metaDetailsScreenMethods-16-render-comments-section.js";
import { createMetaDetailsScreenMethods17 } from "./metaDetailsScreenMethods-17-capture-detail-focus.js";
import { createMetaDetailsScreenMethods18 } from "./metaDetailsScreenMethods-18-stop-trailer-progress-timer.js";
import { createMetaDetailsScreenMethods19 } from "./metaDetailsScreenMethods-19-toggle-active-trailer-playback.js";
import { createMetaDetailsScreenMethods20 } from "./metaDetailsScreenMethods-20-stop-trailer-playback.js";
import { createMetaDetailsScreenMethods21 } from "./metaDetailsScreenMethods-21-consume-back-request.js";
import { createMetaDetailsScreenMethods22 } from "./metaDetailsScreenMethods-22-get-horizontal-track-scroll-left.js";
import { createMetaDetailsScreenMethods23 } from "./metaDetailsScreenMethods-23-apply-stream-chooser-focus.js";
import { createMetaDetailsScreenMethods24 } from "./metaDetailsScreenMethods-24-handle-series-dpad.js";
import { createMetaDetailsScreenMethods25 } from "./metaDetailsScreenMethods-25-handle-movie-dpad.js";
import { createMetaDetailsScreenMethods26 } from "./metaDetailsScreenMethods-26-on-key-down.js";
import { createMetaDetailsScreenMethods27 } from "./metaDetailsScreenMethods-27-on-pointer-move.js";
import { createMetaDetailsScreenMethods28 } from "./metaDetailsScreenMethods-28-ratings.js";

export * from "./metaDetailsScreenContext.js";
export const MetaDetailsScreen = {
  ...createMetaDetailsScreenMethods01(),
  ...createMetaDetailsScreenMethods02(),
  ...createMetaDetailsScreenMethods03(),
  ...createMetaDetailsScreenMethods04(),
  ...createMetaDetailsScreenMethods05(),
  ...createMetaDetailsScreenMethods06(),
  ...createMetaDetailsScreenMethods07(),
  ...createMetaDetailsScreenMethods08(),
  ...createMetaDetailsScreenMethods09(),
  ...createMetaDetailsScreenMethods10(),
  ...createMetaDetailsScreenMethods11(),
  ...createMetaDetailsScreenMethods12(),
  ...createMetaDetailsScreenMethods13(),
  ...createMetaDetailsScreenMethods14(),
  ...createMetaDetailsScreenMethods15(),
  ...createMetaDetailsScreenMethods16(),
  ...createMetaDetailsScreenMethods17(),
  ...createMetaDetailsScreenMethods18(),
  ...createMetaDetailsScreenMethods19(),
  ...createMetaDetailsScreenMethods20(),
  ...createMetaDetailsScreenMethods21(),
  ...createMetaDetailsScreenMethods22(),
  ...createMetaDetailsScreenMethods23(),
  ...createMetaDetailsScreenMethods24(),
  ...createMetaDetailsScreenMethods25(),
  ...createMetaDetailsScreenMethods26(),
  ...createMetaDetailsScreenMethods27(),
  ...createMetaDetailsScreenMethods28()
};
