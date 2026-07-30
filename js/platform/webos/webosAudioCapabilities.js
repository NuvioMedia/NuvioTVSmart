import { Platform } from "../index.js";
import { WebOsLunaService } from "./webosLunaService.js";

const AUDIO_CAPABILITY_TIMEOUT_MS = 1800;
const DTS_RESTORE_PROBE_PREFIX = "NUVIO_DTS_RESTORE";

// This command is intentionally fixed and read-only. It checks the runtime
// changes made by dts_restore without assuming that the install hook alone ran.
export const DTS_RESTORE_PROBE_COMMAND = [
  "init=0",
  "rank=0",
  "libav=0",
  "plus_init=0",
  "dtsdec=0",
  "truehd=0",
  "[ -e /var/lib/webosbrew/init.d/restore_dts ] && init=1",
  "grep -q 'avdec_dca=290' /etc/gst/gstcool.conf 2>/dev/null && rank=1",
  "grep -q ' /usr/lib/gstreamer-1.0/libgstlibav.so ' /proc/mounts 2>/dev/null && libav=1",
  "[ -e /var/lib/webosbrew/init.d/restore_dts25 ] && plus_init=1",
  '[ "$plus_init" = 1 ] && /usr/bin/gst-inspect-1.0 dtsdec >/dev/null 2>&1 && dtsdec=1',
  '[ "$plus_init" = 1 ] && /usr/bin/gst-inspect-1.0 avdec_truehd >/dev/null 2>&1 && truehd=1',
  `printf '${DTS_RESTORE_PROBE_PREFIX} init=%s rank=%s libav=%s plus_init=%s dtsdec=%s truehd=%s\\n' "$init" "$rank" "$libav" "$plus_init" "$dtsdec" "$truehd"`
].join("; ");

const EMPTY_DTS_RESTORE_STATE = Object.freeze({
  installed: false,
  decoderRankEnabled: false,
  libavMounted: false,
  plusInstalled: false,
  dtsDecoderAvailable: false,
  trueHdDecoderAvailable: false,
  dtsActive: false,
  trueHdActive: false,
  active: false
});

function settleWithin(promise, timeoutMs = AUDIO_CAPABILITY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), Math.max(250, Number(timeoutMs || 0)));
    Promise.resolve(promise).then(finish, () => finish(null));
  });
}

export function parseDtsRestoreProbeOutput(result) {
  const output = typeof result === "string" ? result : String(result?.stdoutString || "");
  const match = output.match(/NUVIO_DTS_RESTORE\s+init=([01])\s+rank=([01])\s+libav=([01])/);
  if (!match) {
    return { ...EMPTY_DTS_RESTORE_STATE };
  }
  const installed = match[1] === "1";
  const decoderRankEnabled = match[2] === "1";
  const libavMounted = match[3] === "1";
  const plusMatch = output.match(/\s+plus_init=([01])\s+dtsdec=([01])\s+truehd=([01])/);
  const plusInstalled = plusMatch?.[1] === "1";
  const dtsDecoderAvailable = plusMatch?.[2] === "1";
  const trueHdDecoderAvailable = plusMatch?.[3] === "1";
  const legacyActive = decoderRankEnabled && libavMounted;
  const dtsActive = legacyActive || (plusInstalled && dtsDecoderAvailable);
  const trueHdActive = plusInstalled && trueHdDecoderAvailable;
  return {
    installed,
    decoderRankEnabled,
    libavMounted,
    plusInstalled,
    dtsDecoderAvailable,
    trueHdDecoderAvailable,
    dtsActive,
    trueHdActive,
    active: dtsActive
  };
}

export function deriveWebOsAudioCapabilities({ edidType = "", dtsRestore = null } = {}) {
  const normalizedEdid = String(edidType || "").toLowerCase();
  const dtsRestoreActive = Boolean(dtsRestore?.dtsActive ?? dtsRestore?.active);
  const trueHdRestoreActive = Boolean(dtsRestore?.trueHdActive);
  const dtsFromEdid = normalizedEdid.includes("dts");
  const trueHdFromEdid = normalizedEdid.includes("truehd");
  const unsupportedAudioCodecs = [];

  if (!dtsFromEdid && !dtsRestoreActive) {
    unsupportedAudioCodecs.push("dts");
  }
  if (!trueHdFromEdid && !trueHdRestoreActive) {
    unsupportedAudioCodecs.push("truehd");
  }

  return {
    unsupportedAudioCodecs,
    dts: {
      supported: dtsFromEdid || dtsRestoreActive,
      source: dtsFromEdid
        ? "edid"
        : dtsRestoreActive
          ? dtsRestore?.plusInstalled
            ? "dts_restore_plus"
            : "dts_restore"
          : "none"
    },
    truehd: {
      supported: trueHdFromEdid || trueHdRestoreActive,
      source: trueHdFromEdid ? "edid" : trueHdRestoreActive ? "dts_restore_plus" : "none"
    },
    dtsRestore: dtsRestore ? { ...dtsRestore } : { ...EMPTY_DTS_RESTORE_STATE }
  };
}

export function applyWebOsAudioCodecOverrides(
  unsupportedAudioCodecs = [],
  { forceDtsAudio = false, forceTrueHdAudio = false } = {}
) {
  const unsupported = new Set(unsupportedAudioCodecs);
  if (forceDtsAudio) {
    unsupported.delete("dts");
  }
  if (forceTrueHdAudio) {
    unsupported.delete("truehd");
  }
  return Array.from(unsupported);
}

async function requestEdidType() {
  const result = await settleWithin(
    WebOsLunaService.request("luna://com.webos.service.config", {
      method: "getConfigs",
      parameters: {
        configNames: ["tv.model.edidType"]
      }
    })
  );
  return String(result?.configs?.["tv.model.edidType"] || "");
}

async function requestDtsRestoreState() {
  const result = await settleWithin(
    WebOsLunaService.request("luna://org.webosbrew.hbchannel.service", {
      method: "exec",
      parameters: {
        command: DTS_RESTORE_PROBE_COMMAND
      }
    })
  );
  return parseDtsRestoreProbeOutput(result);
}

let detectionPromise = null;

export function detectWebOsAudioCapabilities({ forceRefresh = false } = {}) {
  if (!Platform.isWebOS() || !WebOsLunaService.isAvailable()) {
    return Promise.resolve(deriveWebOsAudioCapabilities());
  }
  if (detectionPromise && !forceRefresh) {
    return detectionPromise;
  }

  detectionPromise = Promise.all([requestEdidType(), requestDtsRestoreState()])
    .then(([edidType, dtsRestore]) => deriveWebOsAudioCapabilities({ edidType, dtsRestore }))
    .catch(() => deriveWebOsAudioCapabilities());

  return detectionPromise;
}
