/* eslint-disable no-unused-vars */
import { NuvioDialog } from "../../components/nuvioDialog.js";
import * as internals from "./playerScreenContext.js";

// Matches Compose's default long-click timeout used by the Android episode rows.
const EPISODE_LONG_PRESS_DELAY_MS = 500;

export function createPlayerScreenMethods77() {
  const { t } = internals;

  return {
    scheduleEpisodePanelLongPress() {
      this.clearEpisodePanelLongPressTimer();
      this.episodePanelLongPressTriggered = false;
      this.episodePanelLongPressTimer = setTimeout(() => {
        this.episodePanelLongPressTimer = null;
        this.triggerEpisodePanelLongPress();
      }, EPISODE_LONG_PRESS_DELAY_MS);
    },

    clearEpisodePanelLongPressTimer() {
      if (this.episodePanelLongPressTimer) {
        clearTimeout(this.episodePanelLongPressTimer);
        this.episodePanelLongPressTimer = null;
      }
    },

    triggerEpisodePanelLongPress() {
      if (this.episodePanelLongPressTriggered) {
        return;
      }
      this.episodePanelLongPressTriggered = true;
      this.episodePanelPendingSelect = false;
      this.clearEpisodePanelLongPressTimer();
      this.openEpisodeOptionsDialog();
    },

    openEpisodeOptionsDialog() {
      if (this.episodeOptionsDialogVisible) {
        return false;
      }
      const episode = this.episodes?.[this.episodePanelIndex];
      if (!episode?.id) {
        return false;
      }
      const isCurrent = Number(episode.season) === Number(this.params?.season) && Number(episode.episode) === Number(this.params?.episode);
      // Android disables Play for the episode already playing and hides "Play
      // manually": the overlay would only be informative, so there is nothing to do.
      if (isCurrent) {
        return false;
      }
      const label = episode.season != null && episode.episode != null ? `S${episode.season}E${episode.episode}` : "";
      this.episodeOptionsDialogVisible = true;
      this.episodeOptionsDialog = new NuvioDialog({
        title: String(episode.title || "").trim() || label || t("episodes_dialog_subtitle", {}, "Episode"),
        subtitle: label || null,
        widthVw: 37.5,
        suppressEnterUntilKeyUp: true,
        buttons: [
          {
            label: t("episodes_play", {}, "Play"),
            key: "play",
            onAction: () => {
              this.closeEpisodeOptionsDialog();
              void this.playEpisodeFromPanel();
            }
          },
          {
            label: t("play_manually", {}, "Play manually"),
            key: "playManually",
            onAction: () => {
              this.closeEpisodeOptionsDialog();
              void this.playEpisodeFromPanel(null, { manualSelection: true });
            }
          }
        ],
        onDismiss: () => this.closeEpisodeOptionsDialog()
      }).mount(document.body);
      return true;
    },

    closeEpisodeOptionsDialog() {
      const dialog = this.episodeOptionsDialog;
      this.episodeOptionsDialog = null;
      this.episodeOptionsDialogVisible = false;
      dialog?.destroy?.();
    }
  };
}
