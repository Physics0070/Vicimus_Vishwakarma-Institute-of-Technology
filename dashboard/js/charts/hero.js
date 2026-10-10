/* Hero visual: one real patient's last 6 h of CGM (observed) handing over to the twin's physiological
   projection and the ML forecast with its 90% interval. Every mark comes from /api/patients. */

import { parseTs, esc, fmtHM } from "../ui.js";

const W = 720, H = 300, M = { l: 44, r: 18, t: 18, b: 34 };

export function heroSvg(d) {
  const now = parseTs(d.at).getTime();
  const t0 = now - 6 * 3600e3, t1 = now + 2 * 3600e3 + 5 * 60e3;
  const obs = d.history.ts.map((t, k) => [parseTs(t).getTime(), d.history.cgm[k]]).filter(([t]) => t >= t0);
  const twin = [[now, d.state.plasma_glucose ?? d.current.glucose], ...d.forecast.twin_ts.map((t, k) => [parseTs(t).getTime(), d.forecast.twin[k]])];
  const H_ = [30, 60, 120];
  const f = d.forecast.horizons;
  const g0 = d.current.glucose;
  const pred = g0 == null ? [] : [[now, g0, g0, g0], ...H_.map((h) => [now + h * 60e3, f[h].point, f[h].lo, f[h].hi])];

  const vals = [...obs.map((p) => p[1]), ...twin.map((p) => p[1]), ...pred.map((p) => p[3])].filter((v) => v != null);
  const yMax = Math.max(260, Math.ceil((Math.max(...vals) + 20) / 20) * 20);
  const yMin = 50;
  const x = (t) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v) => H - M.b - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * (H - M.t - M.b);

  // observed: break the line at sensor gaps instead of bridging them
  let obsPath = "", pen = false;
  for (const [t, v] of obs) {
    if (v == null) { pen = false; continue; }
    obsPath += `${pen ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  }
  const twinPath = twin.filter((p) => p[1] != null).map(([t, v], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const band = pred.length ? [...pred.map(([t, , lo]) => `${x(t)},${y(lo)}`), ...pred.slice().reverse().map(([t, , , hi]) => `${x(t)},${y(hi)}`)].join(" ") : "";
  const predPath = pred.map(([t, v], k) => `${k ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const ticks = [];
  for (let v = 100; v <= yMax; v += 50) ticks.push(v);
  const hours = [];
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 2 * 3600e3) hours.push(t);
  const last = pred[pred.length - 1];
  const twinEnd = twin[twin.length - 1];

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.patient.name)}: observed glucose for the last 6 hours, then the twin projection and ML forecast for the next 2 hours">
    <defs>
      <linearGradient id="hzFuture" x1="0" x2="1"><stop offset="0" stop-color="var(--twin)" stop-opacity=".09"/><stop offset="1" stop-color="var(--twin)" stop-opacity="0"/></linearGradient>
    </defs>
    <rect x="${x(now)}" y="${M.t}" width="${W - M.r - x(now)}" height="${H - M.t - M.b}" fill="url(#hzFuture)"/>
    <rect x="${M.l}" y="${y(180)}" width="${W - M.l - M.r}" height="${y(70) - y(180)}" fill="var(--range)"/>
    ${ticks.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)" font-family="var(--mono)">${v}</text>`).join("")}
    <line x1="${M.l}" x2="${W - M.r}" y1="${y(180)}" y2="${y(180)}" stroke="var(--high)" stroke-dasharray="3 4" opacity=".55"/>
    <text x="${M.l + 6}" y="${y(180) - 6}" font-size="10.5" fill="var(--high)" opacity=".8">180 mg/dL</text>
    ${hours.map((t) => `<text x="${x(t)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-3)" font-family="var(--mono)">${fmtHM(new Date(t))}</text>`).join("")}

    <path d="${obsPath}" pathLength="1" class="draw" fill="none" stroke="var(--obs)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="--d:.1s" opacity=".9"/>
    <line x1="${x(now)}" x2="${x(now)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--text-3)" stroke-dasharray="2 4"/>
    <text x="${x(now)}" y="${M.t - 4}" text-anchor="middle" font-size="10.5" fill="var(--text-2)" letter-spacing=".08em">NOW</text>
    ${band ? `<polygon points="${band}" fill="var(--pred-soft)" class="fade-late" style="--d:1.5s"/>` : ""}
    <path d="${twinPath}" class="fade-late" fill="none" stroke="var(--twin)" stroke-width="2.2" stroke-dasharray="6 5" style="--d:1.3s"/>
    <path d="${predPath}" pathLength="1" class="draw" fill="none" stroke="var(--pred)" stroke-width="2.4" style="--d:1.5s"/>
    ${pred.slice(1).map(([t, v]) => `<circle cx="${x(t)}" cy="${y(v)}" r="4" fill="var(--pred)" stroke="var(--bg)" stroke-width="2" class="fade-late" style="--d:2s"/>`).join("")}
    ${g0 != null ? `<circle cx="${x(now)}" cy="${y(g0)}" r="5.5" fill="var(--obs)" stroke="var(--bg)" stroke-width="2.5"/>` : ""}

    <g class="fade-late" style="--d:.6s" font-size="11.5" font-weight="600">
      <text x="${M.l + 6}" y="${M.t + 4}" fill="var(--obs)">PATIENT · observed CGM</text>
    </g>
    <g class="fade-late" style="--d:2.1s" font-size="11.5" font-weight="600">
      ${twinEnd?.[1] != null ? `<text x="${x(twinEnd[0]) - 4}" y="${y(twinEnd[1]) + (twinEnd[1] > (last?.[1] ?? 0) ? -10 : 18)}" text-anchor="end" fill="var(--twin)">TWIN · physiology</text>` : ""}
      ${last ? `<text x="${x(last[0]) - 4}" y="${y(last[1]) + (last[1] >= (twinEnd?.[1] ?? 0) ? -12 : 20)}" text-anchor="end" fill="var(--pred)">ML forecast ± 90%</text>` : ""}
    </g>
  </svg>`;
}
