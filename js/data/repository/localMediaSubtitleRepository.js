import { requestWebOsCompanionService } from "../../platform/webos/webosCompanionService.js";

const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("webOS subtitle request timed out")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

export const localMediaSubtitleRepository = {
  async getExternalSubtitleText(url) {
    const targetUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error("Unsupported subtitle URL");
    }
    const result = await withTimeout(
      requestWebOsCompanionService({
        method: "subtitleText",
        parameters: { url: targetUrl }
      }),
      REQUEST_TIMEOUT_MS
    );
    const payload = result?.payload || {};
    if (
      payload.returnValue === false ||
      Number(payload.statusCode || 0) < 200 ||
      Number(payload.statusCode || 0) >= 300
    ) {
      throw new Error(
        payload.errorText || `Subtitle request failed with HTTP ${payload.statusCode || 0}`
      );
    }
    if (payload.bodyTruncated) {
      throw new Error("Subtitle response is too large");
    }
    const body = String(payload.body || "");
    if (!body.trim()) {
      throw new Error("Subtitle response is empty");
    }
    return {
      body,
      contentType: String(payload.contentType || "text/vtt"),
      // Forwarded when the companion service reports the final URL after
      // redirects; absent today, so callers fall back to the requested URL.
      resolvedUrl: payload.resolvedUrl ? String(payload.resolvedUrl) : ""
    };
  }
};
