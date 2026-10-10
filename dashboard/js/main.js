/* App shell: boot, hash router, the shared replay clock, playback, theme and the system panel.
   Views are modules exporting mount(root, params) -> { update(reason): Promise, destroy() }. */

import { api } from "./api.js";
import { store, health, on, emit, setNow } from "./store.js";
import { $, $$, esc, parseTs, fmtTs, fmtClock, fmtAgo, toast } from "./ui.js";
import overview from "./views/overview.js";
import ward from "./views/ward.js";
import twin from "./views/twin.js";
import simulate from "./views/simulate.js";
import records from "./views/records.js";
import alerts from "./views/alerts.js";

const ROUTES = [
  { re: /^\/?$/, name: "overview", view: overview },
  { re: /^\/ward$/, name: "ward", view: ward },
  { re: /^\/patient(?:\/(P\d{3}))?$/, name: "twin", view: twin, seg: "patient" },
  { re: /^\/simulate(?:\/(P\d{3}))?$/, name: "simulate", view: simulate, seg: "simulate" },
  { re: /^\/records(?:\/(P\d{3}))?$/, name: "records", view: records, seg: "records" },
  { re: /^\/alerts$/, name: "alerts", view: alerts },
];

let current = null;   // { key, name, ctl }

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path: path || "/", q: new URLSearchParams(qs || "") };
}

async function ensureTopPid() {
  if (store.topPid) return store.topPid;
  const w = await api(`/api/ward?at=${encodeURIComponent(fmtTs(store.now))}`);
  store.topPid = w.patients[0]?.patient_id;
  return store.topPid;
}

async function route() {
  const { path, q } = parseHash();
  let moved = false;
  if (q.get("t")) {
    const d = parseTs(q.get("t"));
    if (!Number.isNaN(d.getTime())) moved = setNow(d, "route");
  }
  const r = ROUTES.find((x) => x.re.test(path)) || ROUTES[0];
  let pid = path.match(r.re)?.[1];
  if (r.seg && !pid) {
    try { pid = store.pid || (await ensureTopPid()); } catch { pid = null; }
    if (pid) { location.replace(`#/${r.seg}/${pid}`); return; }
  }
  if (pid) store.pid = pid;
  syncNav(r.name);

  const key = `${r.name}:${pid || ""}`;
  if (current?.key === key) {                  // same view: only the clock in the URL changed
    if (moved) current.ctl?.update?.("clock");
    return;
  }
  current?.ctl?.destroy?.();
  const root = $("#view");
  root.innerHTML = "";
  root.classList.remove("view-enter");
  void root.offsetWidth;                        // restart the entrance animation
  root.classList.add("view-enter");
  window.scrollTo({ top: 0, behavior: "instant" });
  current = { key, name: r.name, ctl: r.view.mount(root, { pid, q }) };
  root.focus({ preventScroll: true });
  syncHash();
}

function syncNav(name) {
  for (const a of $$("[data-nav]")) {
    const on = a.dataset.nav === name;
    a.toggleAttribute("aria-current", on);
    if (on) a.setAttribute("aria-current", "page");
  }
  if (store.pid) {
    $('[data-nav="twin"]').href = `#/patient/${store.pid}`;
    $('[data-nav="simulate"]').href = `#/simulate/${store.pid}`;
    $('[data-nav="records"]').href = `#/records/${store.pid}`;
  }
}

/* Keep the clock in the URL so any screen is a shareable, reproducible link. */
function syncHash() {
  const { path } = parseHash();
  const url = `#${path}?t=${fmtTs(store.now).slice(0, 16)}`;
  if (location.hash !== url) history.replaceState(null, "", url);
}

// ------------------------------------------------------------------ clock & playback
function renderClock() {
  const t = $("#clockTime");
  t.textContent = fmtClock(store.now);
  t.dateTime = fmtTs(store.now);
}

on((type, d) => {
  if (type === "clock") {
    renderClock();
    syncHash();
    if (d?.source !== "tick" && d?.source !== "route") current?.ctl?.update?.("clock");
  }
  if (type === "health") renderHealth();
  if (type === "pid") syncNav(current?.name);
});

let timer = null, busy = false;
function setPlaying(on) {
  store.playing = on;
  $("#clock").classList.toggle("playing", on);
  $("#clockPlay").setAttribute("aria-pressed", String(on));
  $("#clockPlay span").textContent = on ? "Pause" : "Replay";
  clearInterval(timer);
  if (!on) return;
  timer = setInterval(async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const moved = setNow(new Date(store.now.getTime() + store.speed * 60e3), "tick");
      if (!moved) { setPlaying(false); toast("Reached the end of the recorded data"); return; }
      await current?.ctl?.update?.("tick");
    } finally { busy = false; }
  }, 1300);
  emit("playing", on);
}
export const togglePlay = (on = !store.playing) => setPlaying(on);

// ------------------------------------------------------------------ system panel
const HEALTH_TEXT = { ok: "Connected", slow: "Slow connection", down: "API unreachable", unknown: "Connecting" };
function renderHealth() {
  $(".sys-dot").dataset.state = health.state;
  $(".sys-text").textContent = HEALTH_TEXT[health.state];
  if (!$("#sysPanel").hidden) renderSysPanel();
}

let statusCache = null;
async function renderSysPanel() {
  const p = $("#sysPanel");
  const m = store.meta?.model_card;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  p.innerHTML = `<h3>System status</h3>
    <dl class="kv small">
      ${row("API", `<span class="sys-dot" data-state="${health.state}" style="display:inline-block;margin-right:6px"></span>${HEALTH_TEXT[health.state]}`)}
      ${row("Last successful response", health.lastOk ? fmtAgo(health.lastOk, new Date()) : "none yet")}
      ${row("Last latency", health.latencyMs != null ? `${health.latencyMs} ms` : "–")}
      ${health.lastError ? row("Last error", `<small>${esc(health.lastError)}</small>`) : ""}
      ${statusCache ? `
        ${row("Models", statusCache.models_loaded ? "loaded" : "not loaded")}
        ${row("Twins calibrated", `${statusCache.twins_calibrated} / ${statusCache.cohort_size}`)}
        ${row("Patients on ward", statusCache.ward_size)}
        ${row("Hypoglycaemia model", statusCache.hypo_model ? "available" : "not trained (too few events)")}
        ${row("Data", `synthetic, seed ${statusCache.seed ?? "?"}`)}
        ${row("Data generated", statusCache.data_generated_on ?? "unknown")}` : row("Models", "checking…")}
      ${m ? row("Test RMSE @60 min", `${m.rmse_60} mg/dL`) : ""}
    </dl>
    <p class="note" style="margin:12px 0 0">The status above comes from live API responses; the replay clock is simulated time inside a recorded synthetic dataset, not wall-clock time.</p>`;
  if (!statusCache) {
    try { statusCache = await api("/api/status"); renderSysPanel(); } catch (e) { p.querySelector("dl").insertAdjacentHTML("beforeend", row("Models", `<small>${esc(e.message)}</small>`)); }
  }
}

function bindChrome() {
  $("#clockBack").addEventListener("click", () => setNow(new Date(store.now.getTime() - 3600e3)));
  $("#clockFwd").addEventListener("click", () => setNow(new Date(store.now.getTime() + 3600e3)));
  $("#clockPlay").addEventListener("click", () => setPlaying(!store.playing));
  $("#clockSpeed").addEventListener("change", (e) => { store.speed = +e.target.value; });
  $("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gt-theme", next); } catch { /* storage unavailable */ }
    const k = current?.key; current = null; if (k) route();   // re-render charts in the new palette
  });
  const sysBtn = $("#sysBtn"), panel = $("#sysPanel");
  sysBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    sysBtn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) renderSysPanel();
  });
  document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target)) { panel.hidden = true; sysBtn.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; sysBtn.focus(); }
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " && document.activeElement === document.body) { e.preventDefault(); setPlaying(!store.playing); }
  });
  window.addEventListener("hashchange", route);
}

// ------------------------------------------------------------------ boot
async function boot() {
  bindChrome();
  try {
    store.meta = await api("/api/meta");
  } catch (e) {
    $("#view").innerHTML = `<div class="err" role="alert"><b>The GlucoTwin API is not reachable.</b> ${esc(e.message)}<br>
      <span class="small">Locally: run <code>python -m glucotwin.pipeline</code> once, then <code>uvicorn glucotwin.api:app</code>.</span>
      <div style="margin-top:12px"><button class="btn" onclick="location.reload()">Retry</button></div></div>`;
    return;
  }
  const { q } = parseHash();
  setNow(q.get("t") ? parseTs(q.get("t")) : parseTs(store.meta.default_now), "route");
  renderClock();
  await route();
}

export const app = { route: () => { current = null; return route(); }, get view() { return current; } };
boot();
