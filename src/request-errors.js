import { logEvent } from "./storage.js";

export async function recordRequestError(root, entry) {
  try {
    await logEvent(root, "errors", entry);
    return true;
  } catch {
    // The primary request error still needs a deterministic response when the
    // store itself is unavailable. The response marks the missing audit entry.
    return false;
  }
}

export function requestErrorPayload(error, logged, { includeOk = false } = {}) {
  return {
    ...(includeOk ? { ok: false } : {}),
    error: error?.message || "request failed",
    ...(logged ? {} : { error_log: "unavailable" })
  };
}
