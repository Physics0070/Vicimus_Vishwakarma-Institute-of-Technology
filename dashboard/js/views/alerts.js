/* Alert history: every notification the alert policy sent across the ward, and what the CGM showed next. */

import { api, latest, isAbort } from "../api.js";
import { store, emit } from "../store.js";
import { $, $$, esc, fmtTs, fmtHM, fmtDay, fmtClock, parseTs, pct, mg, tierPill, outcomePill, errorBox } from "../ui.js";

export default {
  mount(root) {
    const ui = { hours: 24, outcome: "all" };
    root.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Alert centre</p><h1>Alert history</h1>
        <p id="alSub">Notifications sent by the CGM-style alert policy, with the outcome the sensor recorded afterwards.</p></div></div>
      <section class="kpis" id="alKpis">${["Alerts sent", "Followed by an excursion", "No excursion (false alert)", "Window still open"].map((l, i) =>
        `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-val num" data-k="${i}">–</div></div>`).join("")}</section>
      <div class="panel">
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Time window">${[24, 48, 72].map((h) => `<button data-h="${h}" aria-pressed="${h === 24}">Last ${h} h</button>`).join("")}</div>
          <div class="seg" role="group" aria-label="Outcome">${[["all", "All"], ["excursion", "Excursion"], ["no_excursion", "No excursion"], ["pending", "Open"]].map(([v, l]) =>
            `<button data-o="${v}" aria-pressed="${v === "all"}">${l}</button>`).join("")}</div>
          <span class="spacer"></span><span class="faint small" id="alCount"></span>
        </div>
        <ul class="alerts" id="alList"><li class="skeleton" style="height:300px"></li></ul>
        <p class="note" style="margin-top:16px">Acknowledgement is not offered: this prototype has no persistent store, and an acknowledgement that silently disappears would be worse than none. Outcomes use only data recorded up to the replay clock; "window open" means the 2-hour window after the alert has not finished yet.</p>
      </div>`;
    const req = latest();
    let data = null;

    function render() {
      if (!data) return;
      const ev = data.events.filter((e) => ui.outcome === "all" || e.outcome === ui.outcome);
      const c = data.counts;
      [data.events.length, c.excursion, c.no_excursion, c.pending].forEach((v, i) => ($(`[data-k="${i}"]`, root).textContent = v));
      $("#alSub", root).textContent = `Sent by the alert policy (${data.policy}) in the ${ui.hours} h before ${fmtClock(store.now)}, with the outcome the sensor recorded afterwards.`;
      $("#alCount", root).textContent = `${ev.length} shown`;
      $("#alList", root).innerHTML = ev.length ? ev.map((e) => {
        const t = parseTs(e.ts);
        return `<li class="arow">
          <time class="num" datetime="${esc(e.ts)}">${fmtHM(t)}<br><span class="faint tiny">${fmtDay(t)}</span></time>
          <span class="who"><b>${esc(e.name)}</b><span>${esc(e.patient_id)} · ${tierPill(e.severity)}</span></span>
          <span class="why">Risk <span class="num">${pct(e.p_spike)}</span> at glucose <span class="num">${mg(e.glucose)}</span>${e.reason ? ` · driven by ${esc(e.reason)}` : ""}</span>
          ${outcomePill(e.outcome, e.lead_min)}
          <a class="link go" href="#/patient/${esc(e.patient_id)}?t=${esc(e.ts.replace(" ", "T").slice(0, 16))}">Replay →</a></li>`;
      }).join("") : `<li class="empty">No alerts match.</li>`;
    }

    async function update() {
      const signal = req.next();
      try {
        data = await api(`/api/alerts?at=${encodeURIComponent(fmtTs(store.now))}&hours=${ui.hours}`, { signal });
        render();
        emit("ready", "alerts");
      } catch (e) { if (!isAbort(e)) $("#alList", root).innerHTML = `<li>${errorBox(e, update)}</li>`; }
    }

    root.addEventListener("click", (e) => {
      const h = e.target.closest("[data-h]"), o = e.target.closest("[data-o]");
      if (h) { ui.hours = +h.dataset.h; $$("[data-h]", root).forEach((b) => b.setAttribute("aria-pressed", String(b === h))); update(); }
      if (o) { ui.outcome = o.dataset.o; $$("[data-o]", root).forEach((b) => b.setAttribute("aria-pressed", String(b === o))); render(); }
    });

    update();
    return { update, destroy() { req.cancel(); } };
  },
};
