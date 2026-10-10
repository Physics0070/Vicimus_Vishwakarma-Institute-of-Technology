/* Formatting, small components and the motion helpers shared by every view. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ time (the API serves naive local timestamps)
export const parseTs = (s) => new Date(String(s).replace(" ", "T"));
const p2 = (n) => String(n).padStart(2, "0");
export const fmtTs = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00`;
export const fmtHM = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const fmtDay = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
export const fmtClock = (d) => `${fmtDay(d)} · ${fmtHM(d)}`;
export function fmtAgo(then, now) {
  const m = Math.round((now - then) / 60e3);
  if (m <= 0) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60 ? `${m % 60} min ` : ""}ago` : `${Math.floor(h / 24)} d ago`;
}

// ------------------------------------------------------------------ numbers
export const pct = (p) => (p == null ? "–" : `${Math.round(p * 100)}%`);
export const mg = (v) => (v == null ? "–" : Math.round(v));
export function trendArrow(d15) {
  if (d15 == null) return { a: "", t: "trend unknown" };
  if (d15 > 15) return { a: "⇈", t: "rising fast" };
  if (d15 > 6) return { a: "↗", t: "rising" };
  if (d15 < -15) return { a: "⇊", t: "falling fast" };
  if (d15 < -6) return { a: "↘", t: "falling" };
  return { a: "→", t: "steady" };
}

// ------------------------------------------------------------------ components
const TIER_ICON = {
  high: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11.5 11h-11z"/></svg>',
  moderate: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6z"/></svg>',
  low: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/></svg>',
};
const TIER_TEXT = { high: "High", moderate: "Moderate", low: "Low" };
export const tierPill = (t) => `<span class="tier ${t}">${TIER_ICON[t] || ""}${TIER_TEXT[t] || t}</span>`;
export const tierColor = (t) => cssVar({ high: "--high", moderate: "--mod", low: "--low" }[t] || "--text-3");

const OUTCOME_TEXT = { excursion: "Excursion followed", no_excursion: "No excursion", pending: "Window open" };
export const outcomePill = (o, lead) =>
  `<span class="outcome ${o}">${OUTCOME_TEXT[o]}${o === "excursion" && lead ? ` · ${lead} min later` : ""}</span>`;

export function riskBar(p, thr) {
  const col = p >= thr ? "var(--high)" : "var(--pred)";
  return `<div class="riskbar" role="img" aria-label="${pct(p)} risk, alert threshold ${pct(thr)}"><i style="width:${Math.round(p * 100)}%;background:${col}"></i><span class="thr" style="left:${thr * 100}%"></span></div>`;
}

export const ICON = {
  chev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>',
  back: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10l8-5z"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg>',
  reset: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 4v3.5h3.5"/></svg>',
  arrow: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4"/></svg>',
  check: "✓", cross: "✕",
};

export function errorBox(e, retry) {
  const id = `retry-${Math.random().toString(36).slice(2, 8)}`;
  setTimeout(() => document.getElementById(id)?.addEventListener("click", retry), 0);
  return `<div class="err" role="alert"><b>Could not load this view.</b> ${esc(e.message || e)}
    ${retry ? `<button class="btn" id="${id}" style="margin-left:10px">Try again</button>` : ""}</div>`;
}

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 2400);
}

// ------------------------------------------------------------------ motion
/* Count a number up/down to its new value. Purely presentational: the final text is always the exact value. */
export function tween(el, to, fmt = (v) => Math.round(v), ms = 600) {
  if (!el) return;
  const from = Number(el.dataset.v);
  el.dataset.v = to;
  if (to == null || !Number.isFinite(to)) { el.textContent = fmt(to); return; }
  if (!Number.isFinite(from) || reducedMotion() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  el._raf = requestAnimationFrame(step);
}

let revealObs = null;
/* Fade-and-rise sections as they scroll into view (once). */
export function reveal(root = document) {
  const els = $$("[data-reveal]:not(.in)", root);
  if (reducedMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  revealObs ??= new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); revealObs.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  els.forEach((e) => revealObs.observe(e));
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/* Shared Plotly layout in the current theme. */
export function plotLayout(extra = {}) {
  const grid = cssVar("--line"), axis = cssVar("--line-2");
  const base = {
    margin: { l: 46, r: 14, t: 10, b: 34 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: cssVar("--font"), size: 11.5, color: cssVar("--text-3") },
    xaxis: { gridcolor: grid, linecolor: axis, zeroline: false, tickfont: { family: cssVar("--mono"), size: 11 } },
    yaxis: { gridcolor: grid, linecolor: axis, zeroline: false, tickfont: { family: cssVar("--mono"), size: 11 } },
    showlegend: false, hovermode: "x unified",
    hoverlabel: { bgcolor: cssVar("--s3"), bordercolor: axis, font: { family: cssVar("--font"), size: 12, color: cssVar("--text") } },
  };
  return deepMerge(base, extra);
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  return out;
}
export const plotCfg = { displayModeBar: false, responsive: true };
export const whenPlotly = () => new Promise((res) => {
  if (window.Plotly) return res(window.Plotly);
  const t = setInterval(() => { if (window.Plotly) { clearInterval(t); res(window.Plotly); } }, 30);
});
