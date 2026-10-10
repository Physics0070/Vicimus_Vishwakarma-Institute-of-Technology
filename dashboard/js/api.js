/* Thin fetch wrapper: timeouts, cancellation of superseded requests, and connection health.
   A request aborted because the user moved on is not a system failure and is not reported as one. */

import { reportFail, reportOk } from "./store.js";

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { signal, body, timeout = 45000 } = {}) {
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener("abort", relay, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeout);
  const t0 = performance.now();
  try {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!r.ok) {
      let detail = r.statusText;
      try { const j = await r.json(); detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* not JSON */ }
      throw new ApiError(`${r.status} ${detail}`, r.status);
    }
    const data = await r.json();
    reportOk(performance.now() - t0);
    return data;
  } catch (e) {
    if (signal?.aborted) throw new DOMException("superseded", "AbortError");
    if (e.name === "AbortError") e = new ApiError(`Timed out after ${Math.round(timeout / 1000)} s`, 0);
    if (!(e instanceof ApiError && e.status >= 400 && e.status < 500)) reportFail(e);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

export const isAbort = (e) => e?.name === "AbortError";

/* One in-flight request per key: starting a new one cancels the previous, so a slow response for
   an older patient or clock time can never overwrite a newer selection. */
export function latest() {
  let ctl = null;
  return {
    next() { ctl?.abort(); ctl = new AbortController(); return ctl.signal; },
    cancel() { ctl?.abort(); ctl = null; },
  };
}
