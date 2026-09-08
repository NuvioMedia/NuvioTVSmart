function createRequestTimeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.code = "REQUEST_TIMEOUT";
  error.name = "TimeoutError";
  return error;
}

export async function withRequestTimeout(task, timeoutMs, callerSignal) {
  if (!timeoutMs) return task(callerSignal);

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const requestSignal = controller?.signal || callerSignal;
  let removeAbortListener = null;
  if (controller && callerSignal) {
    const forwardAbort = () => controller.abort();
    if (callerSignal.aborted) {
      controller.abort();
    } else if (typeof callerSignal.addEventListener === "function") {
      callerSignal.addEventListener("abort", forwardAbort, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener("abort", forwardAbort);
    }
  }

  let timeoutId = 0;
  let didTimeout = false;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller?.abort();
        reject(createRequestTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(() => task(requestSignal)), timeoutPromise]);
  } catch (error) {
    if (didTimeout) throw createRequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}
