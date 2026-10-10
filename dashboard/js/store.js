/* Single source of truth for app-wide state: the replay clock, the selected patient,
   static metadata and API connection health. Views subscribe; nothing here touches the DOM. */

import { parseTs } from "./ui.js";

export const store = {
  meta: null,          // /api/meta
  now: null,           // Date: the replay clock (naive local time, as served by the API)
  pid: null,           // currently selected patient
  playing: false,
  speed: 15,           // minutes per replay tick
  reveal: false,       // retrospective "what happened next" overlay
  topPid: null,        // highest-risk patient at the current clock (from the last ward fetch)
};

export const health = { state: "unknown", lastOk: null, latencyMs: null, lastError: null, failures: 0 };

const subs = new Set();
export function on(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit(type, detail) { for (const fn of subs) fn(type, detail); }

export function clockBounds() {
  const m = store.meta;
  // keep a day of history behind the clock and 2 h of recorded data ahead of it (for the outcome reveal)
  return { min: parseTs(m.start).getTime() + 24 * 3600e3, max: parseTs(m.end).getTime() - 125 * 60e3 };
}

export function setNow(d, source = "user") {
  const { min, max } = clockBounds();
  const t = Math.min(Math.max(d.getTime(), min), max);
  // snap to the 5-min sampling grid so every request maps to a real reading
  const snapped = new Date(Math.round(t / 300e3) * 300e3);
  if (store.now && snapped.getTime() === store.now.getTime()) return false;
  store.now = snapped;
  emit("clock", { source });
  return true;
}

export function reportOk(ms) {
  health.lastOk = new Date();
  health.latencyMs = Math.round(ms);
  health.failures = 0;
  health.lastError = null;
  health.state = ms > 4000 ? "slow" : "ok";
  emit("health");
}

export function reportFail(err) {
  health.failures += 1;
  health.lastError = err.message || String(err);
  health.state = "down";
  emit("health");
}
