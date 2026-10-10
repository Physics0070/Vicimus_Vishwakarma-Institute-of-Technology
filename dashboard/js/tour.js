/* Guided demo: a reproducible 2-minute walk from the ward to one patient's alert, its evidence,
   the outcome the model never saw, a what-if, and the FHIR record. It drives the real app at a fixed
   replay moment; every number it narrates is fetched from the API when the tour starts. */

import { api } from "./api.js";
import { store, on, setNow } from "./store.js";
import { $, esc, parseTs, pct, mg, fmtClock, reducedMotion } from "./ui.js";

const PID = "P050";
const AT = "2026-09-11T12:10";

function steps(n) {
  const when = fmtClock(parseTs(AT));
  return [
    { route: `#/?t=${AT}`, target: "#queuePanel", title: "The virtual ward",
      body: `A recorded synthetic cohort, replayed as if live. The replay clock is at <b>${when}</b>. Every patient's twin has just been re-scored, and the queue ranks who needs attention, with the single factor driving each risk.` },
    { route: `#/?t=${AT}`, target: "#triagePanel", title: "Triage at a glance",
      body: "Each dot is one patient: current glucose across, modelled 2-hour spike risk up. Anything in the shaded band is above the alert threshold. Press <b>Replay</b> in the header and the dots move as time passes." },
    { route: `#/patient/${PID}?t=${AT}`, target: "#riskPanel", title: `${esc(n.name)}: a warning before the spike`,
      body: `Glucose is <b>${mg(n.g)} mg/dL</b>, comfortably in range, yet the model puts the chance of exceeding 180 within 2 hours at <b>${pct(n.p)}</b>. The bars show why: <b>${esc(n.drivers)}</b>. No lunch has been logged yet; across the cohort, the model has learned that glucose tends to climb after midday.` },
    { route: `#/patient/${PID}?t=${AT}`, target: "#chartPanel", title: "Observed, predicted, simulated",
      body: `The observed points are what the sensor recorded. Cyan is the ML forecast, <b>${mg(n.f120)} mg/dL at 2 h</b>, with its 90% interval. Violet dashes are the patient's physiological twin. Each series is drawn and labelled differently, so none can pass for another.` },
    { route: `#/patient/${PID}?t=${AT}`, target: "#chartPanel", title: "What actually happened",
      body: `Amber circles are the next 2 hours the sensor <i>recorded</i>, revealed only in retrospective replay and never shown to the model. Over those 2 hours glucose peaked at <b>${mg(n.truePeak)} mg/dL</b>; the forecast for the 2-hour mark was ${mg(n.f120)}.`,
      action: () => { const r = $("#reveal"); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change")); } } },
    { route: `#/patient/${PID}?t=${AT}`, target: "#scrubWrap", title: "Travel through the record",
      body: "The strip is this patient's whole recorded history up to the replay clock: hourly glucose, meals and every alert sent. Drag it, use the arrow keys, or press Play. The chart, risk and twin state all follow the clock." },
    { route: `#/patient/${PID}?t=${AT}`, target: "#pipe", title: "Inside the twin",
      body: "Observations synchronise the twin's internal state (glucose, carbs still absorbing, insulin action), which feeds the projection and finally the clinician's view. Every value is read from the API (sensor data or model output); nothing is decorative." },
    { route: `#/simulate/${PID}?t=${AT}`, target: "#simChart", title: "Ask the twin before you prescribe",
      body: "The twin is rolled forward from this exact moment under a planned lunch, with and without a 15-minute walk, against no further meal. Try another dish or <b>Rank options</b> to compare every regional alternative. This is deterministic physiology, not a promise." },
    { route: `#/records/${PID}?t=${AT}`, target: "#recBody .panel.c4", title: "The record behind the twin",
      body: "The static stream is an HL7 FHIR R4 bundle (LOINC, SNOMED CT, RxNorm, ABHA masked). Structural checks run in the browser and say plainly what they don't validate." },
    { route: `#/?t=${AT}`, target: null, title: "That is the loop",
      body: `Ward → patient → evidence → outcome → what-if → record. On ${n.ward} unseen synthetic patients the alert policy flagged ${n.sens}% of excursions a median <b>${n.lead} min</b> early. It is a research prototype on synthetic data, not a medical device.` },
  ];
}

let state = null;

export async function startTour() {
  if (state) return;
  if (store.playing) $("#clockPlay").click();
  const card = $("#tour");
  card.hidden = false;
  card.innerHTML = `<p class="eyebrow">Guided demo</p><h3>Preparing…</h3><p>Fetching the demo moment from the API.</p>`;
  let n;
  try {
    const d = await api(`/api/patients/${PID}?at=${encodeURIComponent(AT)}&reveal=true`);
    const up = d.risk.reasons.filter((r) => r.impact > 0).slice(0, 2).map((r) => r.label);
    const mc = store.meta.model_card;
    n = { name: d.patient.name, g: d.current.glucose, p: d.risk.p_spike, f120: d.forecast.horizons["120"].point, drivers: up.join(" and "),
      truePeak: Math.max(...d.outcome.cgm.filter((v) => v != null)), ward: store.meta.ward_size, sens: mc.sensitivity_pct, lead: Math.round(mc.median_lead_min) };
  } catch (e) {
    card.innerHTML = `<p class="eyebrow">Guided demo</p><h3>Demo unavailable</h3><p>${esc(e.message)}</p><button class="btn" id="tClose">Close</button>`;
    $("#tClose").onclick = stopTour;
    return;
  }
  state = { i: 0, list: steps(n), off: null };
  window.addEventListener("resize", placeRing);
  window.addEventListener("scroll", placeRing, { passive: true });
  document.addEventListener("keydown", onKey);
  go(0);
}

function onKey(e) {
  if (!state) return;
  if (e.key === "Escape") stopTour();
  if (e.key === "ArrowRight" && !/INPUT|SELECT/.test(document.activeElement?.tagName)) go(state.i + 1);
  if (e.key === "ArrowLeft" && !/INPUT|SELECT/.test(document.activeElement?.tagName)) go(state.i - 1);
}

function waitReady(view, ms = 15000) {
  return new Promise((res) => {
    const t = setTimeout(() => { off(); res(); }, ms);
    const off = on((type, d) => { if (type === "ready" && d === view) { clearTimeout(t); off(); res(); } });
  });
}

const viewOf = (route) => (route.startsWith("#/patient") ? "twin" : route.startsWith("#/simulate") ? "simulate" : route.startsWith("#/records") ? "records" : "overview");

async function go(i) {
  if (!state || i < 0) return;
  if (i >= state.list.length) { stopTour(); return; }
  state.i = i;
  const s = state.list[i];
  const card = $("#tour");
  card.innerHTML = `<p class="eyebrow">Guided demo · ${i + 1} of ${state.list.length}</p><h3>${s.title}</h3><p>${s.body}</p>
    <div class="row"><div class="dots">${state.list.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div><span class="spacer"></span>
      <button class="btn btn-ghost" id="tExit">Exit</button>
      ${i ? '<button class="btn" id="tBack">Back</button>' : ""}
      <button class="btn btn-primary" id="tNext">${i === state.list.length - 1 ? "Finish" : "Next"}</button></div>`;
  $("#tExit").onclick = stopTour;
  $("#tNext").onclick = () => go(i + 1);
  if ($("#tBack")) $("#tBack").onclick = () => go(i - 1);
  $("#tNext").focus({ preventScroll: true });

  const path = s.route.split("?")[0];
  const curPath = (location.hash || "#/").split("?")[0];
  const ready = curPath !== path ? waitReady(viewOf(s.route)) : null;
  if (curPath !== path) location.hash = s.route;
  else setNow(parseTs(s.route.split("t=")[1]));
  if (ready) await ready;
  if (state?.i !== i) return;
  s.action?.();
  const el = s.target && document.querySelector(s.target);
  if (el) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  state.target = el;
  setTimeout(placeRing, reducedMotion() ? 0 : 450);
}

function placeRing() {
  const ring = $("#tourRing");
  const el = state?.target;
  if (!el) { ring.hidden = true; return; }
  const r = el.getBoundingClientRect();
  ring.hidden = false;
  Object.assign(ring.style, { left: `${r.left + scrollX - 6}px`, top: `${r.top + scrollY - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
}

export function stopTour() {
  $("#tour").hidden = true;
  $("#tourRing").hidden = true;
  window.removeEventListener("resize", placeRing);
  window.removeEventListener("scroll", placeRing);
  document.removeEventListener("keydown", onKey);
  state = null;
}
