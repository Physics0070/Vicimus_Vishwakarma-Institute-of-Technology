/* Triage map: every ward patient placed by current glucose (x) and modelled 2-h spike risk (y).
   Points are keyed by patient and glide to their new position when the replay clock moves. */

import { esc, pct, mg, tierPill, trendArrow } from "../ui.js";

const W = 520, H = 330, M = { l: 44, r: 16, t: 14, b: 40 };
const G0 = 60, G1 = 300;
const x = (g) => M.l + ((Math.min(Math.max(g ?? G0, G0), G1) - G0) / (G1 - G0)) * (W - M.l - M.r);
const y = (p) => H - M.b - p * (H - M.t - M.b);

export function mountTriage(el, { onOpen }) {
  el.classList.add("triage");
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Triage map: current glucose against 2-hour spike risk">
      <rect class="zone-hi" data-zone x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="0"/>
      ${[0, 0.25, 0.5, 0.75, 1].map((p) => `<line class="grid-l" x1="${M.l}" x2="${W - M.r}" y1="${y(p)}" y2="${y(p)}"/><text x="${M.l - 8}" y="${y(p) + 4}" text-anchor="end">${p * 100}%</text>`).join("")}
      ${[70, 120, 180, 240, 300].map((g) => `<text x="${x(g)}" y="${H - M.b + 18}" text-anchor="middle">${g}</text>`).join("")}
      <line x1="${x(180)}" x2="${x(180)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--high)" stroke-dasharray="2 4" opacity=".45"/>
      <line class="thr-l" data-thr x1="${M.l}" x2="${W - M.r}"/>
      <text data-thr-t x="${W - M.r}" text-anchor="end" fill="var(--high)">alert threshold</text>
      <text x="${(M.l + W - M.r) / 2}" y="${H - 6}" text-anchor="middle">current glucose (mg/dL)</text>
      <text transform="translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle">2-h risk of &gt;180 mg/dL</text>
      <g data-dots></g>
    </svg><div class="tip" role="tooltip"></div>`;
  const svg = el.querySelector("svg"), dotsG = el.querySelector("[data-dots]"), tip = el.querySelector(".tip");
  const dots = new Map();

  function showTip(p, g) {
    const tr = trendArrow(p.trend_15);
    tip.innerHTML = `<b>${esc(p.name)}</b><span class="faint">${esc(p.patient_id)} · ${p.age}${esc(p.sex)} · ${esc(p.status)}</span>
      <div style="margin-top:6px">${tierPill(p.tier)} <span class="num">${pct(p.p_spike)}</span> risk</div>
      <div class="num" style="margin-top:4px">${mg(p.glucose)} mg/dL ${tr.a} <span class="faint">→ ${mg(p.pred_60)} in 60 min</span></div>
      ${p.reason ? `<div class="faint" style="margin-top:4px">Driven by ${esc(p.reason)}</div>` : ""}`;
    const r = g.getBoundingClientRect(), box = el.getBoundingClientRect();
    const left = Math.min(r.left - box.left + 14, box.width - 200);
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${r.top - box.top + 14}px`;
    tip.classList.add("on");
  }
  const hideTip = () => tip.classList.remove("on");

  return {
    update(ward, thr) {
      svg.querySelector("[data-zone]").setAttribute("height", Math.max(0, y(thr) - M.t));
      for (const l of svg.querySelectorAll("[data-thr]")) { l.setAttribute("y1", y(thr)); l.setAttribute("y2", y(thr)); }
      svg.querySelector("[data-thr-t]").setAttribute("y", y(thr) - 6);
      const seen = new Set();
      for (const p of ward.patients) {
        seen.add(p.patient_id);
        let g = dots.get(p.patient_id);
        if (!g) {
          g = document.createElementNS("http://www.w3.org/2000/svg", "g");
          g.setAttribute("class", "dot");
          g.setAttribute("tabindex", "0");
          g.setAttribute("role", "link");
          g.innerHTML = `<circle r="7"/>`;
          g.addEventListener("click", () => onOpen(p.patient_id));
          g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.patient_id); } });
          dotsG.appendChild(g);
          dots.set(p.patient_id, g);
        }
        g._p = p;
        g.onmouseenter = g.onfocus = () => showTip(g._p, g);
        g.onmouseleave = g.onblur = hideTip;
        g.setAttribute("class", `dot ${p.tier}`);
        g.setAttribute("aria-label", `${p.name}, ${p.tier} risk ${pct(p.p_spike)}, glucose ${mg(p.glucose)} mg/dL. Open twin.`);
        g.style.transform = `translate(${x(p.glucose)}px, ${y(p.p_spike)}px)`;
      }
      for (const [pid, g] of dots) if (!seen.has(pid)) { g.remove(); dots.delete(pid); }
    },
  };
}
