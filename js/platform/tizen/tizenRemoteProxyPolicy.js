// Apply the device's opt-in policy without changing automatic routing when off.
export function createRequiresProxy(originalRequiresProxy, isEnabled = () => false) {
  function classifyHost(rawHost) {
    let host = String(rawHost || "")
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      host = [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      /^127\./.test(host)
    )
      return "loopback";
    if (host === "::" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host))
      return "local";
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const parts = host.split(".").map(Number);
      const local =
        parts[0] === 0 ||
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
        parts[0] >= 224;
      return local ? "local" : "remote";
    }
    if (
      host.endsWith(".local") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".home.arpa")
    )
      return "local";
    if (!host.includes(".") && !host.includes(":")) return "local";
    return "remote";
  }

  return function requiresProxy(sourceUrl = "", headers = {}, options = {}) {
    if (!isEnabled()) return originalRequiresProxy.call(this, sourceUrl, headers, options);
    let parsed;
    try {
      parsed = new URL(String(sourceUrl || "").trim());
    } catch (_) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const kind = classifyHost(parsed.hostname);
    // EngineFS already serves local proxy and torrent URLs; never wrap them.
    if (kind === "loopback") return false;
    // resolveRedirects:false is also used by Nuvio as a native-header check.
    // Preserve that check instead of treating it as an instruction to proxy.
    if (options.resolveRedirects !== false && kind === "remote") return true;
    return originalRequiresProxy.call(this, sourceUrl, headers, options);
  };
}

// Classify the URL independently of header-capability checks. The controller
// uses this to keep opted-in streams out of direct-redirect optimizations.
export function isRemoteHttpProxySource(sourceUrl = "") {
  return createRequiresProxy(
    () => false,
    () => true
  )(sourceUrl);
}
