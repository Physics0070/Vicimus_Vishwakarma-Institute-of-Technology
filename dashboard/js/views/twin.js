/* Patient twin: the signature view. One patient, one moment on the replay clock:
   risk and its evidence, the chart (observed / predicted / twin / revealed), the replay scrubber,
   the twin's state pipeline and, on demand, the secondary evidence. */

import { api, latest, isAbort } from "../api.js";
import { store, emit, setNow, clockBounds } from "../store.js";
import { $, $$, esc, fmtTs, fmtHM, fmtClock, fmtAgo, parseTs, pct, mg, tierPill, trendArrow, tween, reveal, errorBox, toast, ICON, cssVar } from "../ui.js";
import { renderTwinChart } from "../charts/twinchart.js";
import { mountScrubber } from "../charts/scrubber.js";
import { renderWearables, renderSleep, renderA1c } from "../charts/evidence.js";

const TABS = [["wear", "Wearables"], ["food", "Food response"], ["sleep", "Sleep"], ["labs", "Labs & history"], ["summary", "Pre-consultation summary"]];
const ordinal = (n) => n + ((n % 100 >= 10 && n % 100 <= 20) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));

export default {
  mount(root, { pid }) {
    const arrivedAt = store.now.getTime();
    let d = null, tab = "wear", lastTimelineAt = null;
    root.innerHTML = `
      <a class="crumb" href="#/ward">${ICON.back} Virtual ward</a>
      <header class="pt-head" id="ptHead"><div><h1 class="skeleton" style="width:280px;height:38px"></h1></div></header>

      <section class="grid">
        <div class="panel c4 risk-hero" id="riskPanel" aria-labelledby="riskH">
          <p class="eyebrow" id="riskH">Two-hour outlook</p>
          <div class="risk-big"><b class="num" id="riskP">–</b><span>chance of glucose above 180 mg/dL within 2 hours</span></div>
          <div class="risk-meta" id="riskMeta"></div>
          <div>
            <div class="panel-head" style="margin-bottom:10px"><h2 style="font-size:14px">Why: strongest drivers</h2><span class="faint tiny">TreeSHAP, log-odds</span></div>
            <div class="drivers" id="drivers"></div>
          </div>
          <p class="note" id="hypoNote"></p>
        </div>

        <div class="panel c8" id="chartPanel">
          <div class="panel-head">
            <div><h2>Glucose: observed, predicted and simulated</h2><p id="freshLine" class="fresh"><i></i>–</p></div>
            <label class="switch" title="Retrospective replay only: overlay what the sensor recorded after the replay clock. The model never sees it.">
              <input type="checkbox" id="reveal" ${store.reveal ? "checked" : ""}> Reveal what happened next</label>
          </div>
          <div class="hero-legend" style="margin-bottom:6px">
            <span class="key"><i class="k-obs"></i>Observed CGM</span><span class="key"><i class="k-pred"></i>ML forecast</span>
            <span class="key"><i class="k-band"></i>90% interval</span><span class="key"><i class="k-twin"></i>Twin physiology</span>
            <span class="key"><i class="k-rev"></i>Recorded later (hidden from model)</span>
          </div>
          <div id="twinChart" class="chart" style="height:360px"></div>
          <div class="scrub" id="scrubWrap">
            <div class="scrub-bar">
              <button class="btn" id="tPlay">${ICON.play}<span>Play</span></button>
              <button class="btn btn-ghost" id="tReset" title="Back to the moment you opened this patient">${ICON.reset}<span>Reset</span></button>
              <time class="num" id="tNow">–</time>
              <span class="faint small" id="tHint">Drag the timeline, or use ← → (Shift for 1 h)</span>
            </div>
            <div id="scrub"></div>
          </div>
        </div>

        <div class="panel c12" data-reveal>
          <div class="panel-head"><div><h2>Inside the twin</h2><p>How this moment's data becomes a decision. Values update with the replay clock.</p></div>
            <a class="btn btn-twin" id="toSim" href="#/simulate/${esc(pid)}">Test a change on the twin ${ICON.arrow}</a></div>
          <div class="pipe" id="pipe"><div class="pipe-line" aria-hidden="true"></div></div>
        </div>

        <div class="panel c12" data-reveal>
          <div class="tabs" role="tablist" aria-label="Supporting evidence">${TABS.map(([k, l]) =>
            `<button role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`).join("")}</div>
          ${TABS.map(([k]) => `<div class="tabpanel" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" ${k === tab ? "" : "hidden"}></div>`).join("")}
        </div>
      </section>
      <p class="note" style="margin-top:20px;max-width:90ch" id="limits"></p>`;

    const req = latest(), tlReq = latest();
    const scrub = mountScrubber($("#scrub", root), {
      onPreview: (t) => { $("#tNow", root).textContent = fmtClock(new Date(t)); },
      onSeek: (t) => { if (!setNow(new Date(t))) $("#tNow", root).textContent = fmtClock(store.now); },
    });

    // ------------------------------------------------------------------ data
    async function update(reason) {
      const signal = req.next();
      const at = encodeURIComponent(fmtTs(store.now));
      $("#tNow", root).textContent = fmtClock(store.now);
      scrub.setNow(store.now.getTime());
      root.querySelector("#pipe").classList.add("updating");
      try {
        d = await api(`/api/patients/${pid}?at=${at}&window_h=12${store.reveal ? "&reveal=true" : ""}`, { signal });
        render(reason);
        const moved = lastTimelineAt == null || Math.abs(store.now - lastTimelineAt) >= 30 * 60e3 || reason !== "tick";
        if (moved) loadTimeline();
        emit("ready", "twin");
      } catch (e) {
        if (isAbort(e)) return;
        if (!d) root.querySelector(".grid").innerHTML = `<div class="c12">${errorBox(e, update)}</div>`;
        else toast(`Update failed: ${e.message}`);
      } finally {
        root.querySelector("#pipe")?.classList.remove("updating");
      }
    }

    async function loadTimeline() {
      const signal = tlReq.next();
      try {
        const tl = await api(`/api/patients/${pid}/timeline?at=${encodeURIComponent(fmtTs(store.now))}`, { signal });
        lastTimelineAt = store.now.getTime();
        scrub.setData(tl, store.now.getTime(), clockBounds());
      } catch (e) { if (!isAbort(e)) toast(`Timeline unavailable: ${e.message}`); }
    }

    // ------------------------------------------------------------------ render
    function render() {
      const p = d.patient, r = d.risk;
      renderHead(p);
      tween($("#riskP", root), r.p_spike * 100, (v) => `${Math.round(v)}%`);
      $("#riskP", root).style.color = r.p_spike >= r.spike_threshold ? "var(--high)" : "var(--text)";
      const lastAlert = d.alerts.length ? parseTs(d.alerts[d.alerts.length - 1]) : null;
      const alertRecent = lastAlert && store.now - lastAlert <= 2 * 3600e3;
      $("#riskMeta", root).innerHTML = `${tierPill(r.tier)}
        <span>alert threshold <span class="num">${pct(r.spike_threshold)}</span></span>
        <span>${alertRecent ? `<b style="color:var(--high)">Alert sent ${fmtHM(lastAlert)}</b>` : r.p_spike >= r.spike_threshold ? "above threshold, confirming (10 min)" : "no alert in the last 2 h"}</span>`;
      renderDrivers(r.reasons);
      $("#hypoNote", root).innerHTML = r.hypo_threshold == null
        ? `<b>Hypoglycaemia:</b> no model. The training cohort had too few hypo events to learn one, so no hypo risk is shown.${p.medications.some((m) => /Glimepiride|Insulin/.test(m)) ? " This patient is on an agent that can cause hypoglycaemia." : ""}`
        : `<b>Hypoglycaemia risk:</b> ${pct(r.p_hypo)} (threshold ${pct(r.hypo_threshold)}).`;

      const fr = d.freshness;
      const fl = $("#freshLine", root);
      fl.classList.toggle("stale", !fr.last_cgm_ts || fr.minutes_since_cgm > 10);
      fl.lastChild.textContent = fr.last_cgm_ts
        ? ` Last CGM reading ${fmtHM(parseTs(fr.last_cgm_ts))}${fr.minutes_since_cgm ? ` (${fr.minutes_since_cgm} min before the clock)` : ""} · ${fr.missing_last_hour} of 12 readings missing in the last hour`
        : " No CGM reading in this window";

      renderTwinChart($("#twinChart", root), d);
      renderPipe();
      renderTab();
      $("#limits", root).innerHTML = `<b>How to read this.</b> <b>Observed</b> points are CGM readings recorded up to the replay clock. The <b>ML forecast</b> is a LightGBM model; on unseen test patients its 90% interval contained the true value ${store.meta.model_card.coverage_60}% of the time at 60 min. <b>Twin physiology</b> is this patient's calibrated 3-state minimal model (fitted on days 1–10); it does not model medication changes, illness or stress, which the ML layer only partly captures. <b>Recorded later</b> is shown only in retrospective replay and is never available to either model. This is a synthetic patient.`;
    }

    function renderHead(p) {
      const h = $("#ptHead", root);
      if (h.dataset.pid === p.patient_id) return;
      h.dataset.pid = p.patient_id;
      h.innerHTML = `<div>
          <p class="eyebrow">Patient twin · ${esc(p.patient_id)}</p>
          <h1>${esc(p.name)}</h1>
          <div class="pt-meta">${p.age} y · ${p.sex === "M" ? "Male" : "Female"} · ${esc(p.city)} · ABHA ${esc(p.abha_masked)} · ${p.status === "Prediabetes" ? "Prediabetes" : `T2D for ${p.duration_y} y`} · HbA1c ${p.labs.hba1c}%</div>
          <div class="chips">${p.conditions.map((c) => `<span class="pill">${esc(c)}</span>`).join("")}
            ${p.medications.map((m) => `<span class="pill med">${esc(m)}</span>`).join("") || '<span class="pill">Lifestyle therapy only</span>'}
            <span class="pill syn">Synthetic patient</span></div>
        </div>
        <div class="row"><a class="btn" href="#/records/${esc(p.patient_id)}">Clinical record</a><a class="btn btn-twin" href="#/simulate/${esc(p.patient_id)}">Simulate</a></div>`;
    }

    function renderDrivers(reasons) {
      const max = Math.max(...reasons.map((x) => Math.abs(x.impact)), 0.01);
      const el = $("#drivers", root);
      const html = reasons.slice(0, 5).map((x) => {
        const w = (Math.abs(x.impact) / max) * 50;
        const up = x.impact > 0;
        const val = x.value == null ? "" : ` · now ${Math.abs(x.value) >= 100 ? Math.round(x.value) : Math.round(x.value * 100) / 100}`;
        return `<div class="drv" title="${up ? "Raises" : "Lowers"} the risk by ${Math.abs(x.impact).toFixed(2)} log-odds">
          <div class="l">${esc(x.label)}<small>${esc(x.stream)}${val} · ${up ? "raises" : "lowers"} risk</small></div>
          <div class="b"><i style="${up ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`};background:${up ? "var(--high)" : "var(--pred)"}"></i></div></div>`;
      }).join("");
      el.innerHTML = html;
    }

    function renderPipe() {
      const c = d.current, s = d.state, f = d.forecast.horizons, p = d.patient, r = d.risk;
      const tr = trendArrow(c.trend_15);
      const lastMeal = d.meals[d.meals.length - 1];
      const twinPeak = Math.max(...d.forecast.twin.filter((v) => v != null));
      const lastAlert = d.alerts.length ? parseTs(d.alerts[d.alerts.length - 1]) : null;
      const action = d.insights.summary.actions[0];
      const pipe = $("#pipe", root);
      if (!pipe.querySelector(".stage")) {
        pipe.insertAdjacentHTML("beforeend", `
          <div class="stage"><div class="stage-k"><i style="background:var(--obs)"></i>1 · Observations</div><h3>What the sensors and app recorded</h3><dl class="kv" data-s="obs"></dl><span class="flow">${ICON.chev}</span></div>
          <div class="stage"><div class="stage-k"><i style="background:var(--twin)"></i>2 · Twin state</div><h3>Personal physiology, synced to the latest reading</h3><dl class="kv" data-s="twin"></dl><span class="flow">${ICON.chev}</span></div>
          <div class="stage"><div class="stage-k"><i style="background:var(--pred)"></i>3 · Projection</div><h3>Model outputs for the next 2 hours</h3><dl class="kv" data-s="proj"></dl><span class="flow">${ICON.chev}</span></div>
          <div class="stage"><div class="stage-k"><i style="background:var(--mod)"></i>4 · Clinician review</div><h3>What it means for this patient</h3><div data-s="rev"></div></div>`);
      }
      const kv = (k, v, unit = "", id = "") => `<dt>${k}</dt><dd>${id ? `<span data-tw="${id}">${v}</span>` : v}${unit ? ` <small>${unit}</small>` : ""}</dd>`;
      $('[data-s="obs"]', pipe).innerHTML =
        kv("CGM now", `${mg(c.glucose)} ${tr.a}`, "mg/dL") + kv("Heart rate", mg(c.hr), "bpm") + kv("HRV, last hour", mg(c.hrv), "ms") +
        kv("Steps today", (c.steps_today ?? 0).toLocaleString("en-IN")) + kv("Last night's sleep", c.sleep_last_h == null ? "–" : c.sleep_last_h.toFixed(1), "h") +
        kv("Last meal logged", lastMeal ? `${fmtHM(parseTs(lastMeal.ts))} <small>${esc(lastMeal.name)}, ${mg(lastMeal.carbs_g)} g</small>` : "none in 12 h");
      const tw = $('[data-s="twin"]', pipe);
      if (!tw.firstChild) {      // built once so the values can animate between clock positions
        tw.innerHTML = kv("Plasma glucose estimate", "", "mg/dL", "g") + kv("Carbs still absorbing", "", "g", "cob") +
          kv("Insulin action X", "", "×10⁻⁴/min", "x") + kv("Personal basal glucose", "", "mg/dL", "gb") +
          kv("Insulin action vs cohort", `${ordinal(p.twin.insulin_action_pct)} pct`) + kv("Exercise response vs cohort", `${ordinal(p.twin.exercise_response_pct)} pct`);
      }
      tween($('[data-tw="g"]', pipe), s.plasma_glucose, (v) => mg(v));
      tween($('[data-tw="cob"]', pipe), s.carbs_on_board_g, (v) => mg(v));
      tween($('[data-tw="x"]', pipe), s.insulin_action_e4, (v) => (v == null ? "–" : v.toFixed(1)));
      tween($('[data-tw="gb"]', pipe), s.basal_glucose, (v) => mg(v));
      $('[data-s="proj"]', pipe).innerHTML =
        [30, 60, 120].map((h) => kv(`ML at ${h} min`, `${mg(f[h].point)} <small>(${mg(f[h].lo)}–${mg(f[h].hi)})</small>`, "mg/dL")).join("") +
        kv("Twin 2-h peak", mg(twinPeak), "mg/dL") + kv("Spike risk, 2 h", pct(r.p_spike));
      $('[data-s="rev"]', pipe).innerHTML = `<div class="row" style="margin-bottom:10px">${tierPill(r.tier)}<span class="small muted">${pct(r.p_spike)} vs threshold ${pct(r.spike_threshold)}</span></div>
        <p class="small" style="margin:0 0 8px">${lastAlert && store.now - lastAlert <= 2 * 3600e3 ? `Alert sent at <b>${fmtHM(lastAlert)}</b> (${fmtAgo(lastAlert, store.now)}).` : "No alert sent in the last 2 hours."}</p>
        ${action ? `<p class="small muted" style="margin:0">Suggested discussion point: ${esc(action)}</p>` : `<p class="small muted" style="margin:0">No discussion points flagged by the summary.</p>`}`;
    }

    // ------------------------------------------------------------------ evidence tabs (lazy)
    function renderTab() {
      if (!d) return;
      const el = $(`#panel-${tab}`, root);
      const ins = d.insights, p = d.patient;
      if (tab === "wear") {
        if (!el.firstChild) el.innerHTML = `<p class="note" style="margin:0 0 8px">Simulated smartwatch stream (Apple Health / Google Fit shape), 5-min resolution, last 12 h.</p><div class="chart" style="height:320px"></div>`;
        renderWearables(el.querySelector(".chart"), d);
      } else if (tab === "food") {
        const fr = ins.food_response, maxR = Math.max(...fr.map((x) => x.rise), 1);
        el.innerHTML = fr.length ? `<p class="note" style="margin:0 0 8px">Average rise from meal start to the 2-h peak for each logged meal type, from this patient's own CGM.</p>
          <table class="food"><thead><tr><th>Meal</th><th>Times eaten</th><th>Avg rise</th><th>Avg peak</th><th style="width:30%"></th></tr></thead><tbody>
          ${fr.slice(0, 10).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.n}</td><td class="num">+${x.rise} mg/dL</td><td class="num">${x.peak}</td>
            <td><div class="bar" style="width:${(x.rise / maxR) * 100}%;background:${x.rise > 80 ? "var(--high)" : x.rise > 50 ? "var(--mod)" : "var(--low)"}"></div></td></tr>`).join("")}
          </tbody></table>` : `<p class="empty">Not enough logged meals yet.</p>`;
      } else if (tab === "sleep") {
        el.innerHTML = `<div class="chart" style="height:240px"></div><p class="note">${ins.sleep_effect_mgdl > 5 ? `After nights under 6 h, next-day mean glucose was <b>${ins.sleep_effect_mgdl} mg/dL higher</b> (last 7 nights).` : "No consistent sleep effect over the last 7 nights."}</p>`;
        renderSleep(el.querySelector(".chart"), ins.nights);
      } else if (tab === "labs") {
        const l = p.labs, g = p.genetics, m = ins.metrics_7d || {};
        el.innerHTML = `<div class="grid"><div class="c6"><dl class="kv">
            <dt>HbA1c</dt><dd>${l.hba1c}%</dd><dt>Fasting glucose</dt><dd>${l.fpg} <small>mg/dL</small></dd>
            <dt>Blood pressure</dt><dd>${esc(l.bp)} <small>mmHg</small></dd><dt>LDL · eGFR</dt><dd>${l.ldl} · ${l.egfr}</dd>
            <dt>BMI · weight</dt><dd>${p.bmi} · ${p.weight_kg} <small>kg</small></dd>
            <dt>TCF7L2 rs7903146</dt><dd>${g.tcf7l2_risk_alleles} risk allele${g.tcf7l2_risk_alleles === 1 ? "" : "s"}</dd>
            <dt>Polygenic risk (z)</dt><dd>${g.prs_z}${g.family_history ? " <small>· family history</small>" : ""}</dd>
            <dt>7-day time in range</dt><dd>${m.tir_pct ?? "–"}%</dd><dt>7-day GMI · CV</dt><dd>${m.gmi ?? "–"}% · ${m.cv_pct ?? "–"}%</dd>
          </dl></div><div class="c6"><div class="chart" style="height:180px"></div></div></div>`;
        renderA1c(el.querySelector(".chart"), p.hba1c_history);
      } else if (tab === "summary") {
        const s = ins.summary;
        el.innerHTML = `<div class="summary-text">${esc(s.text)}</div>
          ${s.actions.length ? `<p style="margin:16px 0 0;font-weight:600">Suggested discussion points</p><ul class="actions-list">${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
          <p class="note">${esc(s.disclaimer)} Generated from rules over the twin's data, not by a language model.</p>
          <button class="btn" data-copy>Copy summary</button>`;
        el.querySelector("[data-copy]").addEventListener("click", async (e) => {
          const text = `${s.text}\n\nSuggested discussion points:\n- ${s.actions.join("\n- ")}\n\n${s.disclaimer}`;
          try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied ✓"; }
          catch { e.target.textContent = "Copy failed (needs https or localhost)"; }
          setTimeout(() => (e.target.textContent = "Copy summary"), 2000);
        });
      }
    }

    // ------------------------------------------------------------------ events
    root.querySelector(".tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      tab = b.dataset.tab;
      $$("[data-tab]", root).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $$(".tabpanel", root).forEach((x) => (x.hidden = x.id !== `panel-${tab}`));
      renderTab();
    });
    root.querySelector(".tabs").addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
      const bs = $$("[data-tab]", root), i = bs.findIndex((x) => x.dataset.tab === tab);
      const n = bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
      n.focus(); n.click();
    });
    $("#reveal", root).addEventListener("change", (e) => { store.reveal = e.target.checked; update("reveal"); });
    $("#tPlay", root).addEventListener("click", () => document.getElementById("clockPlay").click());
    $("#tReset", root).addEventListener("click", () => { if (store.playing) document.getElementById("clockPlay").click(); setNow(new Date(arrivedAt)); });
    const offPlay = (() => {
      const sync = () => {
        const b = $("#tPlay", root);
        if (!b) return;
        b.innerHTML = store.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play</span>`;
      };
      const obs = new MutationObserver(sync);
      obs.observe(document.getElementById("clock"), { attributes: true, attributeFilter: ["class"] });
      sync();
      return () => obs.disconnect();
    })();

    reveal(root);
    update("mount");
    return { update, destroy() { req.cancel(); tlReq.cancel(); scrub.destroy(); offPlay(); } };
  },
};
