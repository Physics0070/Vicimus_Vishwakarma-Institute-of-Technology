/* Virtual ward: searchable, filterable, sortable list of every patient at the replay clock. */

import { api, latest, isAbort } from "../api.js";
import { store, emit } from "../store.js";
import { $, $$, esc, fmtTs, fmtClock, pct, mg, tierPill, riskBar, trendArrow, errorBox, debounce } from "../ui.js";

const TIER_RANK = { high: 0, moderate: 1, low: 2 };
const COLS = [
  ["name", "Patient", (p) => p.name],
  ["p_spike", "2-h spike risk", (p) => p.p_spike],
  ["tier", "Tier", (p) => TIER_RANK[p.tier]],
  ["glucose", "Glucose now", (p) => p.glucose ?? -1],
  ["pred_60", "In 60 min", (p) => p.pred_60 ?? -1],
  ["tir_24h", "Time in range · 24 h", (p) => p.tir_24h ?? -1],
  ["reason", "Main driver", (p) => p.reason || "~"],
];

export default {
  mount(root) {
    const ui = { q: "", tier: "all", status: "all", hypo: false, sort: "tier", dir: 1 };
    root.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Virtual ward</p><h1>All patients</h1>
          <p id="wardSub">Every patient's twin, re-scored at the replay clock.</p></div>
      </div>
      <div class="panel">
        <div class="toolbar" role="search">
          <label class="sr" for="wq">Search patients</label>
          <input type="search" id="wq" placeholder="Search name, ID or city" autocomplete="off">
          <div class="seg" role="group" aria-label="Risk tier">${["all", "high", "moderate", "low"].map((t) =>
            `<button data-tier="${t}" aria-pressed="${t === "all"}">${t === "all" ? "All tiers" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
          <div class="seg" role="group" aria-label="Diagnosis">${[["all", "All"], ["T2D", "T2D"], ["Prediabetes", "Prediabetes"]].map(([v, l]) =>
            `<button data-status="${v}" aria-pressed="${v === "all"}">${l}</button>`).join("")}</div>
          <label class="switch"><input type="checkbox" id="whypo"> On sulfonylurea or insulin</label>
          <span class="spacer"></span><span class="faint small" id="wcount"></span>
        </div>
        <div class="table-wrap"><table class="ward" aria-describedby="wardSub">
          <thead><tr>${COLS.map(([k, l]) => `<th scope="col"><button data-sort="${k}">${l}</button></th>`).join("")}</tr></thead>
          <tbody id="wbody"><tr><td colspan="7"><div class="skeleton" style="height:360px"></div></td></tr></tbody>
        </table></div>
      </div>`;

    const req = latest();
    let data = null;

    function render() {
      if (!data) return;
      const q = ui.q.trim().toLowerCase();
      const col = COLS.find((c) => c[0] === ui.sort);
      let rows = data.patients.filter((p) =>
        (ui.tier === "all" || p.tier === ui.tier) && (ui.status === "all" || p.status === ui.status) && (!ui.hypo || p.on_hypo_agents) &&
        (!q || `${p.name} ${p.patient_id}`.toLowerCase().includes(q)));
      rows = rows.slice().sort((a, b) => {
        const va = col[2](a), vb = col[2](b);
        const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
        return (c || b.p_spike - a.p_spike) * ui.dir;
      });
      if (ui.sort === "tier") rows.sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) * ui.dir || b.p_spike - a.p_spike);
      for (const b of $$("[data-sort]", root)) b.setAttribute("aria-sort", b.dataset.sort === ui.sort ? (ui.dir > 0 ? "ascending" : "descending") : "none");
      $("#wcount", root).textContent = `${rows.length} of ${data.patients.length} patients`;
      const thr = data.threshold;
      $("#wbody", root).innerHTML = rows.length ? rows.map((p) => {
        const tr = trendArrow(p.trend_15);
        return `<tr data-pid="${esc(p.patient_id)}">
          <td class="nm"><a href="#/patient/${esc(p.patient_id)}">${esc(p.name)}</a><span>${esc(p.patient_id)} · ${p.age}${esc(p.sex)} · ${esc(p.status)}${p.on_hypo_agents ? " · SU/insulin" : ""}</span></td>
          <td data-k="Risk" style="min-width:120px"><span class="num">${pct(p.p_spike)}</span>${riskBar(p.p_spike, thr)}</td>
          <td>${tierPill(p.tier)}</td>
          <td class="r num" data-k="Now">${mg(p.glucose)} <span title="${tr.t}">${tr.a}</span>${p.cgm_missing ? ' <span class="faint tiny">gap</span>' : ""}</td>
          <td class="r num" data-k="60 min">${mg(p.pred_60)}</td>
          <td class="r num" data-k="TIR">${p.tir_24h ?? "–"}%</td>
          <td class="small muted" data-k="Driver">${p.reason ? esc(p.reason) : "–"}</td></tr>`;
      }).join("") : `<tr><td colspan="7"><div class="empty">No patients match these filters.</div></td></tr>`;
    }

    async function update() {
      const signal = req.next();
      try {
        const w = await api(`/api/ward?at=${encodeURIComponent(fmtTs(store.now))}`, { signal });
        data = { ...w, threshold: store.meta.thresholds.spike_alert };
        store.topPid = w.patients[0]?.patient_id;
        $("#wardSub", root).textContent = `Every patient's twin, re-scored at ${fmtClock(store.now)} (replay clock). Synthetic cohort.`;
        render();
        emit("ready", "ward");
      } catch (e) {
        if (!isAbort(e)) $("#wbody", root).innerHTML = `<tr><td colspan="7">${errorBox(e, update)}</td></tr>`;
      }
    }

    $("#wq", root).addEventListener("input", debounce((e) => { ui.q = e.target.value; render(); }, 120));
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tier],[data-status],[data-sort]");
      if (t?.dataset.tier) { ui.tier = t.dataset.tier; $$("[data-tier]", root).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); render(); return; }
      if (t?.dataset.status) { ui.status = t.dataset.status; $$("[data-status]", root).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); render(); return; }
      if (t?.dataset.sort) { ui.dir = ui.sort === t.dataset.sort ? -ui.dir : (t.dataset.sort === "name" || t.dataset.sort === "tier" ? 1 : -1); ui.sort = t.dataset.sort; render(); return; }
      const tr = e.target.closest("tr[data-pid]");
      if (tr && !e.target.closest("a")) location.hash = `#/patient/${tr.dataset.pid}`;
    });
    $("#whypo", root).addEventListener("change", (e) => { ui.hypo = e.target.checked; render(); });

    update();
    return { update, destroy() { req.cancel(); } };
  },
};
