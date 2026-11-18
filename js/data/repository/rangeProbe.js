/** HTTP range reads shared by the embedded track and chapter probes. */
export function requestHeaders(headers = {}) {
  const result = {};
  Object.entries(headers || {}).forEach(([name, value]) => {
    if (
      !String(name).toLowerCase().startsWith("range") &&
      !String(name).toLowerCase().startsWith("accept-encoding") &&
      value != null
    ) {
      result[name] = String(value);
    }
  });
  return result;
}

// Chromium before 66 (Tizen 5.0 and older) has no AbortController. Range
// probes still run there: the timer settles the probe and cancels the bodies
// still being read, and an expired probe starts no further request.
export async function runRangeProbe(timeoutMs, task) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const probe = { signal: controller?.signal, expired: false, readers: new Set() };
  let settle = () => {};
  const timeout = setTimeout(() => {
    probe.expired = true;
    controller?.abort();
    probe.readers.forEach((reader) => void reader.cancel().catch(() => {}));
    settle([]);
  }, timeoutMs);
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => task(probe))
        .catch(() => []),
      new Promise((resolve) => {
        settle = resolve;
      })
    ]);
  } finally {
    clearTimeout(timeout);
    controller?.abort();
  }
}

// partialOnly rejects a server that ignores Range and sends the whole file.
export async function fetchRange(
  url,
  headers,
  start,
  length,
  probe = null,
  { partialOnly = false } = {}
) {
  if (probe?.expired) {
    return null;
  }
  let reader;
  try {
    const response = await fetch(url, {
      headers: {
        ...requestHeaders(headers),
        Range: `bytes=${start}-${start + length - 1}`,
        "Accept-Encoding": "identity"
      },
      ...(probe?.signal ? { signal: probe.signal } : {}),
      credentials: "omit"
    });
    if (probe?.expired) {
      return null;
    }
    const range = response.headers.get("content-range");
    const validStatus =
      response.status === 206 || (response.status === 200 && start === 0 && !partialOnly);
    // A 206 already answers the requested range; a Content-Range, when sent, must match it.
    if (
      !validStatus ||
      (range && !new RegExp(`^bytes ${start}-\\d+/\\d+$`, "i").test(range)) ||
      !response.body?.getReader
    ) {
      return null;
    }
    reader = response.body.getReader();
    probe?.readers.add(reader);
    const bytes = new Uint8Array(length);
    let read = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return bytes.subarray(0, read);
      }
      if (read + value.length > length) {
        return null;
      }
      bytes.set(value, read);
      read += value.length;
      if (read === length) {
        return bytes;
      }
    }
  } catch (_) {
    return null;
  } finally {
    if (reader) {
      probe?.readers.delete(reader);
      void reader.cancel().catch(() => {});
    }
  }
}
