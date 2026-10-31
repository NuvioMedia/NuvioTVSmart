import { StreamInfoMethods } from "./streamInfoOverlay.js";
import { createPlayerScreenMethods01 } from "./playerScreenMethods-01-mount.js";
import { createPlayerScreenMethods02 } from "./playerScreenMethods-02-get-post-play-state.js";
import { createPlayerScreenMethods03 } from "./playerScreenMethods-03-render-post-play-manual-dialog.js";
import { createPlayerScreenMethods04 } from "./playerScreenMethods-04-sync-post-play-backdrop-transition.js";
import { createPlayerScreenMethods05 } from "./playerScreenMethods-05-schedule-post-play-long-press.js";
import { createPlayerScreenMethods06 } from "./playerScreenMethods-06-handle-post-play-key.js";
import { createPlayerScreenMethods07 } from "./playerScreenMethods-07-build-subtitle-lookup-context.js";
import { createPlayerScreenMethods08 } from "./playerScreenMethods-08-update-active-skip-interval.js";
import { createPlayerScreenMethods09 } from "./playerScreenMethods-09-render-skip-intro-button.js";
import { createPlayerScreenMethods10 } from "./playerScreenMethods-10-is-debrid-playback-candidate.js";
import { createPlayerScreenMethods11 } from "./playerScreenMethods-11-release-current-engine-fs-stream-best-effort.js";
import { createPlayerScreenMethods12 } from "./playerScreenMethods-12-normalize-embedded-audio-tracks.js";
import { createPlayerScreenMethods13 } from "./playerScreenMethods-13-parse-dash-manifest-tracks.js";
import { createPlayerScreenMethods14 } from "./playerScreenMethods-14-load-manifest-track-data-for-current-stream.js";
import { createPlayerScreenMethods15 } from "./playerScreenMethods-15-apply-manifest-track-selection.js";
import { createPlayerScreenMethods16 } from "./playerScreenMethods-16-refresh-loading-overlay-presentation.js";
import { createPlayerScreenMethods17 } from "./playerScreenMethods-17-get-web-header-restricted-stream-message.js";
import { createPlayerScreenMethods18 } from "./playerScreenMethods-18-start-player-controller-playback.js";
import { createPlayerScreenMethods19 } from "./playerScreenMethods-19-refresh-loading-overlay-progress.js";
import { createPlayerScreenMethods20 } from "./playerScreenMethods-20-sync-native-paused-state-for-pause-overlay.js";
import { createPlayerScreenMethods21 } from "./playerScreenMethods-21-resolve-next-episode-info.js";
import { createPlayerScreenMethods22 } from "./playerScreenMethods-22-should-show-next-episode-card.js";
import { createPlayerScreenMethods23 } from "./playerScreenMethods-23-maybe-autoplay-next-episode.js";
import { createPlayerScreenMethods24 } from "./playerScreenMethods-24-open-next-episode-stream-picker.js";
import { createPlayerScreenMethods25 } from "./playerScreenMethods-25-get-subtitle-cue-track-list.js";
import { createPlayerScreenMethods26 } from "./playerScreenMethods-26-copy-subtitle-cue-presentation.js";
import { createPlayerScreenMethods27 } from "./playerScreenMethods-27-bind-video-events.js";
import { createPlayerScreenMethods28 } from "./playerScreenMethods-28-unbind-video-events.js";
import { createPlayerScreenMethods29 } from "./playerScreenMethods-29-sync-post-play-player-surface.js";
import { createPlayerScreenMethods30 } from "./playerScreenMethods-30-schedule-buffering-spinner-refresh.js";
import { createPlayerScreenMethods31 } from "./playerScreenMethods-31-seek-playback-seconds.js";
import { createPlayerScreenMethods32 } from "./playerScreenMethods-32-update-ui-tick.js";
import { createPlayerScreenMethods33 } from "./playerScreenMethods-33-resolve-media-action.js";
import { createPlayerScreenMethods34 } from "./playerScreenMethods-34-play-stream-by-url.js";
import { createPlayerScreenMethods35 } from "./playerScreenMethods-35-play-stream-candidate.js";
import { createPlayerScreenMethods36 } from "./playerScreenMethods-36-reset-playback-engine-validation.js";
import { createPlayerScreenMethods37 } from "./playerScreenMethods-37-should-defer-engine-fs-startup-stall.js";
import { createPlayerScreenMethods38 } from "./playerScreenMethods-38-schedule-playback-stall-guard.js";
import { createPlayerScreenMethods39 } from "./playerScreenMethods-39-refresh-track-dialogs.js";
import { createPlayerScreenMethods40 } from "./playerScreenMethods-40-wait-for-initial-embedded-track-bootstrap.js";
import { createPlayerScreenMethods41 } from "./playerScreenMethods-41-build-subtitle-track-signature.js";
import { createPlayerScreenMethods42 } from "./playerScreenMethods-42-create-subtitle-object-url.js";
import { createPlayerScreenMethods43 } from "./playerScreenMethods-43-get-ass-subtitle-container.js";
import { createPlayerScreenMethods44 } from "./playerScreenMethods-44-load-web-os-embedded-text-subtitle-window.js";
import { createPlayerScreenMethods45 } from "./playerScreenMethods-45-load-bitmap-subtitle-window.js";
import { createPlayerScreenMethods46 } from "./playerScreenMethods-46-schedule-html-subtitle-overlay-render.js";
import { createPlayerScreenMethods47 } from "./playerScreenMethods-47-sync-track-state.js";
import { createPlayerScreenMethods48 } from "./playerScreenMethods-48-get-subtitle-entries.js";
import { createPlayerScreenMethods49 } from "./playerScreenMethods-49-collect-subtitle-option-items.js";
import { createPlayerScreenMethods50 } from "./playerScreenMethods-50-scroll-subtitle-rail-node-into-view.js";
import { createPlayerScreenMethods51 } from "./playerScreenMethods-51-get-startup-preferred-subtitle-language-targets.js";
import { createPlayerScreenMethods52 } from "./playerScreenMethods-52-apply-startup-audio-fallback.js";
import { createPlayerScreenMethods53 } from "./playerScreenMethods-53-render-subtitle-style-control-in-place.js";
import { createPlayerScreenMethods54 } from "./playerScreenMethods-54-apply-subtitle-entry.js";
import { createPlayerScreenMethods55 } from "./playerScreenMethods-55-apply-fallback-addon-subtitle.js";
import { createPlayerScreenMethods56 } from "./playerScreenMethods-56-render-subtitle-options-markup.js";
import { createPlayerScreenMethods57 } from "./playerScreenMethods-57-render-subtitle-delay-overlay.js";
import { createPlayerScreenMethods58 } from "./playerScreenMethods-58-capture-subtitle-auto-sync-time.js";
import { createPlayerScreenMethods59 } from "./playerScreenMethods-59-handle-subtitle-dialog-key.js";
import { createPlayerScreenMethods60 } from "./playerScreenMethods-60-get-audio-entries.js";
import { createPlayerScreenMethods61 } from "./playerScreenMethods-61-apply-audio-track.js";
import { createPlayerScreenMethods62 } from "./playerScreenMethods-62-render-audio-control-item.js";
import { createPlayerScreenMethods63 } from "./playerScreenMethods-63-get-source-request-key.js";
import { createPlayerScreenMethods64 } from "./playerScreenMethods-64-move-sources-focus.js";
import { createPlayerScreenMethods65 } from "./playerScreenMethods-65-render-parental-guide-overlay.js";
import { createPlayerScreenMethods66 } from "./playerScreenMethods-66-get-filtered-episode-panel-streams.js";
import { createPlayerScreenMethods67 } from "./playerScreenMethods-67-render-episode-streams-view.js";
import { createPlayerScreenMethods68 } from "./playerScreenMethods-68-load-subtitles.js";
import { createPlayerScreenMethods69 } from "./playerScreenMethods-69-sync-pointer-focus.js";
import { createPlayerScreenMethods70 } from "./playerScreenMethods-70-on-pointer-activate.js";
import { createPlayerScreenMethods71 } from "./playerScreenMethods-71-on-key-down.js";
import { createPlayerScreenMethods72 } from "./playerScreenMethods-72-on-key-up.js";
import { createPlayerScreenMethods73 } from "./playerScreenMethods-73-cleanup.js";
import { createPlayerScreenMethods74 } from "./playerScreenMethods-74-automatic-subtitle-sync.js";

import { createPlayerPartyMethods } from "./playerParty.js";
export * from "./playerScreenContext.js";
export const PlayerScreen = {
  ...StreamInfoMethods,
  ...createPlayerScreenMethods01(),
  ...createPlayerScreenMethods02(),
  ...createPlayerScreenMethods03(),
  ...createPlayerScreenMethods04(),
  ...createPlayerScreenMethods05(),
  ...createPlayerScreenMethods06(),
  ...createPlayerScreenMethods07(),
  ...createPlayerScreenMethods08(),
  ...createPlayerScreenMethods09(),
  ...createPlayerScreenMethods10(),
  ...createPlayerScreenMethods11(),
  ...createPlayerScreenMethods12(),
  ...createPlayerScreenMethods13(),
  ...createPlayerScreenMethods14(),
  ...createPlayerScreenMethods15(),
  ...createPlayerScreenMethods16(),
  ...createPlayerScreenMethods17(),
  ...createPlayerScreenMethods18(),
  ...createPlayerScreenMethods19(),
  ...createPlayerScreenMethods20(),
  ...createPlayerScreenMethods21(),
  ...createPlayerScreenMethods22(),
  ...createPlayerScreenMethods23(),
  ...createPlayerScreenMethods24(),
  ...createPlayerScreenMethods25(),
  ...createPlayerScreenMethods26(),
  ...createPlayerScreenMethods27(),
  ...createPlayerScreenMethods28(),
  ...createPlayerScreenMethods29(),
  ...createPlayerScreenMethods30(),
  ...createPlayerScreenMethods31(),
  ...createPlayerScreenMethods32(),
  ...createPlayerScreenMethods33(),
  ...createPlayerScreenMethods34(),
  ...createPlayerScreenMethods35(),
  ...createPlayerScreenMethods36(),
  ...createPlayerScreenMethods37(),
  ...createPlayerScreenMethods38(),
  ...createPlayerScreenMethods39(),
  ...createPlayerScreenMethods40(),
  ...createPlayerScreenMethods41(),
  ...createPlayerScreenMethods42(),
  ...createPlayerScreenMethods43(),
  ...createPlayerScreenMethods44(),
  ...createPlayerScreenMethods45(),
  ...createPlayerScreenMethods46(),
  ...createPlayerScreenMethods47(),
  ...createPlayerScreenMethods48(),
  ...createPlayerScreenMethods49(),
  ...createPlayerScreenMethods50(),
  ...createPlayerScreenMethods51(),
  ...createPlayerScreenMethods52(),
  ...createPlayerScreenMethods53(),
  ...createPlayerScreenMethods54(),
  ...createPlayerScreenMethods55(),
  ...createPlayerScreenMethods56(),
  ...createPlayerScreenMethods57(),
  ...createPlayerScreenMethods58(),
  ...createPlayerScreenMethods59(),
  ...createPlayerScreenMethods60(),
  ...createPlayerScreenMethods61(),
  ...createPlayerScreenMethods62(),
  ...createPlayerScreenMethods63(),
  ...createPlayerScreenMethods64(),
  ...createPlayerScreenMethods65(),
  ...createPlayerScreenMethods66(),
  ...createPlayerScreenMethods67(),
  ...createPlayerScreenMethods68(),
  ...createPlayerScreenMethods69(),
  ...createPlayerScreenMethods70(),
  ...createPlayerScreenMethods71(),
  ...createPlayerScreenMethods72(),
  ...createPlayerScreenMethods73(),
  ...createPlayerScreenMethods74(),
  ...createPlayerPartyMethods()
};
