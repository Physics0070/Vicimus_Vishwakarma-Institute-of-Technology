/* Replay scrubber for one patient's whole record: an hourly heat strip of what the CGM recorded up to
   the replay clock, with meals, alerts and excursions marked. Dragging moves the shared clock. */

import { parseTs, fmtClock, fmtDay, cssVar, esc } from "../ui.js";

const STEP = 5 * 60e3;

export function mountScrubber(el, { onSeek, onPreview }) {
  el.innerHTML = `
    <div class="scrub-track" tabindex="0" role="slider" aria-label="Replay position">
      <canvas aria-hidden="true"></canvas><div class="future" title="Not yet recorded at the replay clock"></div>
      <div class="days"></div><div class="handle"></div>
    </div>
    <div class="scrub-legend">
      <span><i style="background:var(--low)"></i>in range 70–180</span>
      <span><i style="background:var(--mod)"></i>above 180</span>
      <span><i style="background:var(--high)"></i>below 70 or above 250</span>
      <span><i style="background:var(--high);clip-path:polygon(0 0,100% 0,50% 100%)"></i>alert sent</span>
      <span><i style="background:var(--text-2);width:2px"></i>meal logged</span>
      <span><i style="background:repeating-linear-gradient(135deg,transparent 0 2px,var(--text-3) 2px 3px)"></i>not yet recorded</span>
    </div>`;
  const track = el.querySelector(".scrub-track"), canvas = el.querySelector("canvas");
  const future = el.querySelector(".future"), handle = el.querySelector(".handle"), days = el.querySelector(".days");
  let tl = null, t0 = 0, t1 = 1, pos = 0, minT = 0, maxT = 1;

  const frac = (t) => (t - t0) / (t1 - t0);
  const place = (t) => {
    pos = t;
    handle.style.left = `${frac(t) * 100}%`;
    track.setAttribute("aria-valuenow", String(t));
    track.setAttribute("aria-valuetext", fmtClock(new Date(t)));
  };

  function draw() {
    if (!tl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const col = { low: cssVar("--low"), mod: cssVar("--mod"), high: cssVar("--high"), t2: cssVar("--text-2") };
    const hw = w / ((t1 - t0) / 3600e3);
    tl.hourly_mean.forEach((v, k) => {
      if (v == null) return;
      const c = v < 70 || v > 250 ? col.high : v > 180 ? col.mod : col.low;
      const a = v > 180 ? Math.min(1, 0.45 + (v - 180) / 140) : v < 70 ? 0.9 : 0.22 + 0.4 * ((v - 70) / 110);
      ctx.globalAlpha = a;
      ctx.fillStyle = c;
      ctx.fillRect(k * hw, 10, Math.max(1, hw - 0.5), h - 20);
    });
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = col.t2;
    for (const m of tl.meals) ctx.fillRect(frac(parseTs(m.ts).getTime()) * w - 0.5, h - 9, 1.5, 9);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col.high;
    for (const a of tl.alerts) {
      const x = frac(parseTs(a).getTime()) * w;
      ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.fill();
    }
  }

  function setData(timeline, now, bounds) {
    tl = timeline;
    t0 = parseTs(timeline.start).getTime();
    t1 = parseTs(timeline.end).getTime() + STEP;
    minT = bounds.min; maxT = bounds.max;
    track.setAttribute("aria-valuemin", String(minT));
    track.setAttribute("aria-valuemax", String(maxT));
    future.style.left = `${frac(parseTs(timeline.at).getTime() + STEP) * 100}%`;
    const n = Math.round((t1 - t0) / 86400e3);
    days.innerHTML = Array.from({ length: n }, (_, k) => {
      const d = new Date(t0 + k * 86400e3);
      return k % (track.clientWidth < 600 ? 3 : 1) ? "" : `<span style="left:${((k + 0.5) / n) * 100}%">${esc(fmtDay(d).replace(/^\w+, /, ""))}</span>`;
    }).join("");
    place(now);
    draw();
  }

  // ------------------------------------------------------------------ interaction
  const snap = (t) => Math.min(maxT, Math.max(minT, Math.round(t / STEP) * STEP));
  const tAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return snap(t0 + ((clientX - r.left) / r.width) * (t1 - t0));
  };
  let dragging = false;
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    place(tAt(e.clientX));
    onPreview?.(pos);
  });
  track.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    place(tAt(e.clientX));
    onPreview?.(pos);
  });
  const end = () => { if (!dragging) return; dragging = false; onSeek(pos); };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 3600e3 : STEP;
    const moves = { ArrowRight: big, ArrowLeft: -big, PageUp: 86400e3, PageDown: -86400e3 };
    let t = null;
    if (e.key in moves) t = pos + moves[e.key];
    if (e.key === "Home") t = minT;
    if (e.key === "End") t = maxT;
    if (t == null) return;
    e.preventDefault();
    place(snap(t));
    onSeek(pos);
  });
  const ro = new ResizeObserver(() => draw());
  ro.observe(track);

  return {
    setData,
    setNow(t) { if (!dragging) place(t); },
    get dragging() { return dragging; },
    destroy() { ro.disconnect(); },
  };
}
