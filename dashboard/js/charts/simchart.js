/* What-if comparison chart: simulated trajectories from the twin, drawn in on every run,
   with a hover crosshair that reads every scenario at the same minute. */

import { esc, fmtHM, parseTs, mg } from "../ui.js";

const W = 760, H = 320, M = { l: 44, r: 16, t: 16, b: 40 };
const CLS = ["base", "s1", "s2"];

export function mountSimChart(el) {
  el.classList.add("sim-chart");
  el.style.position = "relative";
  let last = null;

  function render(r, plan, replay = true) {
    last = { r, plan };
    const ts = r.ts.map(parseTs);
    const n = ts.length;
    const all = r.scenarios.flatMap((s) => s.glucose).filter((v) => v != null);
    const yMax = Math.max(250, Math.ceil((Math.max(...all) + 20) / 25) * 25), yMin = 50;
    const x = (k) => M.l + (k / (n - 1)) * (W - M.l - M.r);
    const y = (v) => H - M.b - ((Math.min(Math.max(v, yMin), yMax) - yMin) / (yMax - yMin)) * (H - M.t - M.b);
    const xMin = (m) => x((m / 5) - 1);
    const path = (g) => g.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const yt = []; for (let v = 100; v <= yMax; v += 50) yt.push(v);
    const xt = ts.map((t, k) => [t, k]).filter(([t]) => t.getMinutes() === 0);

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulated glucose for each scenario over the next ${Math.round(n * 5 / 60)} hours">
      <rect class="band" x="${M.l}" y="${y(180)}" width="${W - M.l - M.r}" height="${y(70) - y(180)}"/>
      ${yt.map((v) => `<line class="gl" x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" font-family="var(--mono)">${v}</text>`).join("")}
      ${xt.map(([t, k]) => `<text x="${x(k)}" y="${H - M.b + 18}" text-anchor="middle" font-family="var(--mono)">${fmtHM(t)}</text>`).join("")}
      <line class="hl180" x1="${M.l}" x2="${W - M.r}" y1="${y(180)}" y2="${y(180)}"/>
      ${plan.meal != null ? `<line x1="${xMin(Math.max(5, plan.meal))}" x2="${xMin(Math.max(5, plan.meal))}" y1="${M.t}" y2="${H - M.b}" stroke="var(--mod)" stroke-dasharray="2 4" opacity=".7"/>
        <text x="${xMin(Math.max(5, plan.meal)) + 5}" y="${M.t + 10}" fill="var(--mod)">meal</text>` : ""}
      ${plan.walk ? `<rect x="${xMin(plan.walk[0])}" y="${H - M.b - 6}" width="${Math.max(2, xMin(plan.walk[0] + plan.walk[1]) - xMin(plan.walk[0]))}" height="6" rx="3" fill="var(--twin)" opacity=".8"/>
        <text x="${xMin(plan.walk[0])}" y="${H - M.b - 10}" fill="var(--twin)">walk</text>` : ""}
      ${r.scenarios.map((s, i) => `<path class="ln ${CLS[i]} ${replay ? "draw" : ""}" ${replay ? 'pathLength="1"' : ""} style="--d:${i * 0.25}s" d="${path(s.glucose)}"/>`).join("")}
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" visibility="hidden"/>
      <rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent" data-hit/>
    </svg><div class="tip"></div>`;
    // the CSS draw animation uses dasharray 1 on pathLength=1; drop it when each line finishes so the dashed baseline shows
    if (replay) el.querySelectorAll(".draw").forEach((p) => p.addEventListener("animationend", () => { p.classList.remove("draw"); p.removeAttribute("pathLength"); }, { once: true }));

    const svg = el.querySelector("svg"), cross = el.querySelector(".cross"), tip = el.querySelector(".tip"), hit = el.querySelector("[data-hit]");
    const move = (e) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const k = Math.round(((p.x - M.l) / (W - M.l - M.r)) * (n - 1));
      if (k < 0 || k >= n) return;
      cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<b class="num">${fmtHM(ts[k])} · +${(k + 1) * 5} min</b>${r.scenarios.map((s, i) =>
        `<div class="row" style="gap:8px;justify-content:space-between"><span><span class="key"><i style="border-color:${["var(--text-3)", "var(--twin-2)", "var(--twin)"][i]}"></i></span>${esc(s.label)}</span><span class="num">${mg(s.glucose[k])}</span></div>`).join("")}`;
      const box = el.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 230)}px`;
      tip.style.top = `${Math.max(0, e.clientY - box.top - 40)}px`;
      tip.classList.add("on");
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.classList.remove("on"); });
  }

  return { render, replay() { if (last) render(last.r, last.plan, true); } };
}
