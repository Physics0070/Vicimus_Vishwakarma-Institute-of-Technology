/* Overview: which patient needs attention, why, and what evidence supports it.
   Hero (one real twin) -> 4 KPIs -> risk queue + triage map -> recent alerts -> how it works. */

import { api, latest, isAbort } from "../api.js";
import { store, emit } from "../store.js";
import { $, esc, fmtTs, fmtHM, fmtDay, parseTs, pct, mg, tierPill, outcomePill, riskBar, trendArrow, tween, reveal, errorBox, ICON } from "../ui.js";
import { heroSvg } from "../charts/hero.js";
import { mountTriage } from "../charts/triage.js";

export default {
  mount(root) {
    const mc = store.meta.model_card;
    root.innerHTML = `
      <section class="hero">
        <div>
          <p class="eyebrow">Virtual diabetes ward · Type 2 diabetes</p>
          <h1>A calibrated <em>digital twin</em> for every patient on the ward.</h1>
          <p class="lede">GlucoTwin fuses CGM, smartwatch and EHR data into a personal physiological model, forecasts glucose two hours ahead with an honest uncertainty band, and lets you test a meal or a walk on the twin before you prescribe it.</p>
          <div class="row">
            <a class="btn btn-primary" id="openTop" href="#/patient">Open highest-risk twin ${ICON.arrow}</a>
            <a class="btn btn-ghost" href="#/ward">Open the virtual ward</a>
          </div>
          <div class="hero-proof" title="Evaluated on 16 synthetic patients the models never saw, days 11–14">
            <div><b>${mc.sensitivity_pct}%</b><span>of excursions above 180 flagged in advance</span></div>
            <div><b>${Math.round(mc.median_lead_min)} min</b><span>median warning before the excursion</span></div>
            <div><b>${mc.false_alerts_per_day}</b><span>false alerts per patient-day</span></div>
          </div>
        </div>
        <figure class="hero-viz" style="margin:0" id="heroViz">
          <div class="skeleton" style="height:300px"></div>
        </figure>
      </section>

      <section class="kpis" id="kpis" aria-label="Ward at a glance">
        ${["Patients monitored", "Need attention", "Alerts · last 24 h", "CGM data freshness"].map((l, i) =>
          `<div class="kpi" data-reveal style="--i:${i}"><div class="kpi-label">${l}</div><div class="kpi-val num" data-k="${i}">–</div><div class="kpi-sub" data-s="${i}">&nbsp;</div></div>`).join("")}
      </section>

      <section class="grid">
        <div class="panel c7" data-reveal id="queuePanel">
          <div class="panel-head"><div><h2>Who needs attention</h2><p>Ranked by risk tier, then by the model's 2-hour spike probability</p></div><a class="link" href="#/ward">Full ward →</a></div>
          <ol class="queue" id="queue"><li class="skeleton" style="height:320px"></li></ol>
        </div>
        <div class="panel c5" data-reveal style="--i:1" id="triagePanel">
          <div class="panel-head"><div><h2>Triage map</h2><p>Each dot is a patient · hover for detail · click to open the twin</p></div></div>
          <div id="triage"></div>
          <div class="row tiny faint" style="margin-top:6px;gap:14px">${tierPill("high")}${tierPill("moderate")}${tierPill("low")}<span>Shaded: above the alert threshold</span></div>
        </div>
        <div class="panel c12" data-reveal id="alertsPanel">
          <div class="panel-head"><div><h2>Recent alerts</h2><p id="alertPolicy">Alerts the CGM-style policy actually sent, with what happened next</p></div><a class="link" href="#/alerts">Alert history →</a></div>
          <ul class="alerts" id="alertList"><li class="skeleton" style="height:180px"></li></ul>
        </div>
      </section>

      <section class="explain" aria-labelledby="howTitle">
        <div class="explain-head" data-reveal>
          <p class="eyebrow">How the twin works</p>
          <h2 id="howTitle">Not a dashboard of numbers. A model of each patient that you can question.</h2>
          <p class="muted">Every forecast on this screen comes from the same four steps, re-run each time the replay clock moves.</p>
        </div>
        <div class="steps" id="steps">
          ${[
            ["Observe", "CGM every 5 minutes, heart rate, HRV, steps, sleep stages and logged meals from an Indian food library, fused with the EHR as FHIR R4."],
            ["Personalise", "Six physiological parameters (insulin action, glucose effectiveness, absorption speed…) are fitted to each patient's own first 10 days."],
            ["Predict and explain", "LightGBM learns what physiology leaves out. Every alert carries its TreeSHAP drivers and a 90% conformal interval."],
            ["Simulate", "Roll the patient's twin forward from right now under a different meal, portion or walk, and compare."],
          ].map(([h, p], i) => `<div class="step" data-reveal style="--i:${i}"><span class="n">${i + 1}</span><h3>${h}</h3><p>${p}</p></div>`).join("")}
        </div>
        <div class="card-strip">
          <div class="mc" data-reveal style="--i:0"><b>${mc.rmse_60}</b><span>mg/dL RMSE at 60 min</span></div>
          <div class="mc" data-reveal style="--i:1"><b>${mc.clarke_ab_60}%</b><span>Clarke error grid A+B at 60 min</span></div>
          <div class="mc" data-reveal style="--i:2"><b>${mc.coverage_60}%</b><span>coverage of the 90% interval (60 min)</span></div>
          <div class="mc" data-reveal style="--i:3"><b>${mc.spike_auroc}</b><span>AUROC, 2-h spike alert</span></div>
        </div>
        <p class="note" style="margin-top:16px" data-reveal>Evaluated on ${store.meta.ward_size} synthetic patients the models never saw (days 11–14 of their record). Synthetic results are an upper bound; on 45 real adults (CGMacros) the forecast error is higher. See the repository's validation reports.</p>
      </section>`;

    const req = latest();
    const triage = mountTriage($("#triage", root), { onOpen: (pid) => (location.hash = `#/patient/${pid}`) });
    let heroPid = null;
    const steps = $("#steps", root);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { steps.style.setProperty("--prog", 1); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(steps);
    reveal(root);

    async function update() {
      const signal = req.next();
      const at = encodeURIComponent(fmtTs(store.now));
      try {
        const [ward, al] = await Promise.all([api(`/api/ward?at=${at}`, { signal }), api(`/api/alerts?at=${at}&hours=24`, { signal })]);
        store.topPid = ward.patients[0]?.patient_id;
        $("#openTop", root).href = `#/patient/${store.topPid}`;
        renderKpis(ward, al);
        renderQueue(ward);
        triage.update(ward, store.meta.thresholds.spike_alert);
        renderAlerts(al);
        const fresh = store.topPid !== heroPid;
        heroPid = store.topPid;
        const d = await api(`/api/patients/${heroPid}?at=${at}&window_h=6`, { signal });
        renderHero(d, fresh);
        emit("ready", "overview");
      } catch (e) {
        if (isAbort(e)) return;
        $("#queue", root).innerHTML = `<li>${errorBox(e, update)}</li>`;
      }
    }

    function renderKpis(ward, al) {
      const ps = ward.patients;
      const hi = ps.filter((p) => p.tier === "high").length, mo = ps.filter((p) => p.tier === "moderate").length;
      const gaps = ps.filter((p) => p.cgm_missing).length;
      const vals = [ps.length, hi + mo, al.events.length, ps.length - gaps];
      vals.forEach((v, i) => tween($(`[data-k="${i}"]`, root), v));
      $('[data-s="0"]', root).textContent = "synthetic cohort, unseen by the models";
      $('[data-s="1"]', root).textContent = `${hi} high · ${mo} moderate`;
      $('[data-s="2"]', root).textContent = `${al.counts.excursion} followed by an excursion · ${al.counts.pending} still open`;
      $('[data-s="3"]', root).textContent = gaps ? `${gaps} sensor gap${gaps > 1 ? "s" : ""} right now` : `all ${ps.length} sensors reporting at ${fmtHM(store.now)}`;
      root.querySelectorAll(".kpi")[1].classList.toggle("attn", hi > 0);
    }

    function renderQueue(ward) {
      const top = ward.patients.filter((p) => p.tier !== "low").slice(0, 6);
      const rows = (top.length ? top : ward.patients.slice(0, 3)).map((p, i) => {
        const tr = trendArrow(p.trend_15);
        return `<li><a class="qrow swap" href="#/patient/${esc(p.patient_id)}" aria-label="Open twin for ${esc(p.name)}">
          <span class="rank">${String(i + 1).padStart(2, "0")}</span>
          <span class="who"><b>${esc(p.name)}</b><span>${esc(p.patient_id)} · ${p.age}${esc(p.sex)} · ${esc(p.status)}${p.on_hypo_agents ? " · on SU/insulin" : ""}</span></span>
          <span class="why">${p.reason ? `Driven by <em>${esc(p.reason)}</em>` : "No single dominant driver"}${p.cgm_missing ? " · <b>CGM gap</b>" : ""}</span>
          <span class="qrisk">${tierPill(p.tier)}<b>${pct(p.p_spike)}</b></span>
          <span class="g" title="${tr.t}">${mg(p.glucose)} ${tr.a}<small>→ ${mg(p.pred_60)} in 60′</small></span>
          <span class="chev">${ICON.chev}</span></a></li>`;
      });
      $("#queue", root).innerHTML = rows.join("") || `<li class="empty">No patients on the ward.</li>`;
    }

    function renderAlerts(al) {
      $("#alertPolicy", root).textContent = `Sent by the alert policy (${al.policy}), with what happened next`;
      const ev = al.events.slice(0, 5);
      $("#alertList", root).innerHTML = ev.length ? ev.map((e) => {
        const t = parseTs(e.ts);
        const sameDay = t.toDateString() === store.now.toDateString();
        return `<li class="arow">
          <time class="num" datetime="${esc(e.ts)}">${fmtHM(t)}${sameDay ? "" : `<br><span class="faint tiny">${fmtDay(t)}</span>`}</time>
          <span class="who"><b>${esc(e.name)}</b><span>${esc(e.patient_id)} · glucose ${mg(e.glucose)} at alert</span></span>
          <span class="why">Risk <span class="num">${pct(e.p_spike)}</span>${e.reason ? ` · driven by ${esc(e.reason)}` : ""}</span>
          ${outcomePill(e.outcome, e.lead_min)}
          <a class="link go" href="#/patient/${esc(e.patient_id)}?t=${esc(e.ts.replace(" ", "T").slice(0, 16))}">Replay ${"→"}</a>
        </li>`;
      }).join("") : `<li class="empty">No alerts in the last 24 hours of the replay.</li>`;
    }

    function renderHero(d, animate) {
      const fig = $("#heroViz", root);
      // drawn-in lines: drop the animation class once it has had time to run, so a page loaded in a
      // background tab (where CSS animations are paused) never leaves the series invisible
      if (animate) setTimeout(() => fig.querySelectorAll(".draw, .fade-late").forEach((n) => n.classList.remove("draw", "fade-late")), 2000);
      fig.innerHTML = `${heroSvg(d, animate)}
        <figcaption class="hero-cap">
          <span>Highest risk now: <a class="link" href="#/patient/${esc(d.patient.patient_id)}">${esc(d.patient.name)}</a> · ${tierPill(d.risk.tier)} ${pct(d.risk.p_spike)}</span>
          <span class="hero-legend"><span class="key"><i class="k-obs"></i>Observed</span><span class="key"><i class="k-twin"></i>Twin physiology</span><span class="key"><i class="k-pred"></i>ML forecast</span><span class="key"><i class="k-band"></i>90% interval</span></span>
        </figcaption>`;
    }

    update();
    return { update, destroy() { req.cancel(); io.disconnect(); } };
  },
};
