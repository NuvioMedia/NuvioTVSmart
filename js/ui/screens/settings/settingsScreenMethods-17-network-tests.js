/* eslint-disable no-unused-vars */
import * as internals from "./settingsScreenContext.js";

function formatMbps(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} Mbps` : "";
}

export function createSettingsScreenMethods17() {
  const { runNetworkSpeedTest, runStreamSpeedTest, LastPlaybackStore } = internals;

  return {
    isNetworkSpeedTestRunning() {
      return this.networkSpeedTestState === "latency" || this.networkSpeedTestState === "download";
    },

    isStreamSpeedTestRunning() {
      return (
        this.streamSpeedTestState &&
        this.streamSpeedTestState !== "idle" &&
        this.streamSpeedTestState !== "done" &&
        this.streamSpeedTestState !== "error"
      );
    },

    startNetworkSpeedTest() {
      if (this.isNetworkSpeedTestRunning()) {
        return;
      }
      this.networkSpeedTestState = "latency";
      this.networkLatencyMs = null;
      this.networkDownloadMbps = null;
      this.networkSpeedTestError = "";
      void this.render({ refreshModel: false });
      void runNetworkSpeedTest({
        onPhase: (phase) => {
          if (this.isNetworkSpeedTestRunning()) {
            this.networkSpeedTestState = phase;
            void this.render({ refreshModel: false });
          }
        }
      })
        .then((result) => {
          this.networkLatencyMs = Number(result?.latencyMs) || 0;
          this.networkDownloadMbps = Number(result?.downloadMbps) || 0;
          this.networkSpeedTestError = String(result?.error || "");
          this.networkSpeedTestState = this.networkSpeedTestError ? "error" : "done";
        })
        .catch((error) => {
          this.networkSpeedTestError = String(error?.message || error || "Speed test failed");
          this.networkSpeedTestState = "error";
        })
        .finally(() => {
          void this.render({ refreshModel: false });
        });
    },

    startStreamSpeedTest() {
      if (this.isStreamSpeedTestRunning()) {
        return;
      }
      const lastPlayback = LastPlaybackStore.get();
      if (!lastPlayback?.url) {
        this.streamSpeedTestState = "error";
        this.streamSpeedTestError = "no-stream";
        void this.render({ refreshModel: false });
        return;
      }
      this.streamSpeedTestState = "BASELINE";
      this.streamSpeedTestBaselineMbps = null;
      this.streamSpeedTestParallel = {};
      this.streamSpeedTestError = "";
      void this.render({ refreshModel: false });
      void runStreamSpeedTest(lastPlayback.url, lastPlayback.headers, {
        onPhase: (phase) => {
          if (this.isStreamSpeedTestRunning()) {
            this.streamSpeedTestState = phase;
            void this.render({ refreshModel: false });
          }
        }
      })
        .then((result) => {
          if (result?.error) {
            this.streamSpeedTestError = result.error;
            this.streamSpeedTestState = "error";
            return;
          }
          this.streamSpeedTestBaselineMbps = Number(result?.baselineMbps) || 0;
          this.streamSpeedTestParallel = result?.parallelSpeeds || {};
          this.streamSpeedTestState = "done";
        })
        .catch((error) => {
          this.streamSpeedTestError = "connection";
          this.streamSpeedTestState = "error";
        })
        .finally(() => {
          void this.render({ refreshModel: false });
        });
    },

    streamSpeedTestServerHost() {
      const lastPlayback = LastPlaybackStore.get();
      if (!lastPlayback?.url) {
        return "";
      }
      try {
        return new URL(lastPlayback.url).host;
      } catch (_) {
        return "";
      }
    },

    formatNetworkMbps: formatMbps
  };
}
