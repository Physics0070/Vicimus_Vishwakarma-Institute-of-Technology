/* What-if simulator: roll the patient's twin forward from the replay clock under a planned meal and
   walk, compared with doing nothing. Deterministic physiology, so no uncertainty band is claimed. */

import { api, latest, isAbort } from "../api.js";
import { store, emit } from "../store.js";
import { $, esc, fmtTs, fmtClock, mg, errorBox, debounce, ICON } from "../ui.js";
import { mountSimChart } from "../charts/simchart.js";

const slotFor = (d) => { const h = d.getHours(); return h < 10 ? "breakfast" : h < 15 ? "lunch" : h < 19 ? "snack" : "dinner"; };
const DEFAULT = { breakfast: "idli_sambar", lunch: "rice_dal_sabzi", dinner: "rice_dal_sabzi", snack: "chai_biscuits" };

export default {
  mount(root, { pid }) {
    const meals = store.meta.meals;
    const slot0 = slotFor(store.now);
    root.innerHTML = `
      <a class="crumb" href="#/patient/${esc(pid)}">${ICON.back} Back to the twin</a>
      <div class="page-head"><div><p class="eyebrow">What-if simulator · ${esc(pid)}</p><h1 id="simTitle">Test a change on the twin</h1>
        <p id="simSub">Rolls this patient's calibrated twin forward 5 hours from the replay clock.</p></div></div>
      <section class="grid">
        <div class="panel c4">
          <div class="panel-head"><h2>Plan</h2></div>
          <form class="sim-form" id="simForm">
            <label>Planned meal<select class="field" id="sMeal">${["breakfast", "lunch", "dinner", "snack"].map((s) =>
              `<optgroup label="${s}">${meals.filter((m) => m.slot === s).map((m) => `<option value="${esc(m.key)}">${esc(m.name)} · ${Math.round(m.carbs_g)} g carbs · GI ${m.gi}</option>`).join("")}</optgroup>`).join("")}</select></label>
            <label>Portion <span class="v" id="vPortion">1×</span><input type="range" id="sPortion" min="0.5" max="1.5" step="0.25" value="1"></label>
            <label>Eaten in <span class="v" id="vOffset">15 min</span><input type="range" id="sOffset" min="0" max="120" step="15" value="15"></label>
            <label>Brisk walk after the meal <span class="v" id="vWalk">15 min</span><input type="range" id="sWalk" min="0" max="45" step="5" value="15"></label>
            <div class="row"><button class="btn btn-primary" type="submit" id="sRun">Simulate</button><button class="btn btn-ghost" type="button" id="sReplay">Replay comparison</button></div>
          </form>
          <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
          <h3 style="font-size:14px;margin-bottom:8px">Assumptions</h3>
          <ul class="assume">
            <li>Starts from the twin's state synchronised to the latest CGM reading, with every meal already logged still absorbing.</li>
            <li>Meal absorption comes from the food library's carbs, GI, fat, protein and fibre, scaled by this patient's calibrated gut speed.</li>
            <li>The walk is 100 steps/min, starting 15 min after the meal; its effect uses this patient's calibrated exercise response.</li>
            <li>No change to medication, stress or sleep is simulated; the twin cannot model them.</li>
            <li>The physiology is deterministic: results show no uncertainty band, and that should not be read as certainty.</li>
          </ul>
        </div>
        <div class="panel c8">
          <div class="panel-head"><div><h2>Simulated glucose, next 5 hours</h2><p id="simAt"></p></div>
            <div class="hero-legend"><span class="key"><i style="border-color:var(--text-3);border-top-style:dashed"></i>No further meal</span><span class="key"><i class="k-sim"></i>Planned meal</span><span class="key"><i style="border-color:var(--twin)"></i>Meal + walk</span></div></div>
          <div id="simChart"><div class="skeleton" style="height:320px"></div></div>
          <div class="results" id="results"></div>
        </div>
        <div class="panel c12">
          <div class="panel-head"><div><h2>Best swaps for this patient</h2><p id="rankSub">Every option for this meal slot simulated on the twin, ranked by time above 180 mg/dL</p></div>
            <button class="btn" id="sRank">Rank options</button></div>
          <div id="rankOut" class="faint small">Ranks region-appropriate meals for the selected slot with the same timing and walk.</div>
        </div>
      </section>`;

    const req = latest(), rankReq = latest();
    const chart = mountSimChart($("#simChart", root));
    const f = { meal: $("#sMeal", root), portion: $("#sPortion", root), offset: $("#sOffset", root), walk: $("#sWalk", root) };
    f.meal.value = DEFAULT[slot0];
    const label = () => meals.find((m) => m.key === f.meal.value)?.name || f.meal.value;
    const bindV = (inp, out, fmt) => inp.addEventListener("input", () => { $(out, root).textContent = fmt(inp.value); });
    bindV(f.portion, "#vPortion", (v) => `${(+v).toString()}×`);
    bindV(f.offset, "#vOffset", (v) => (+v ? `${v} min` : "now"));
    bindV(f.walk, "#vWalk", (v) => (+v ? `${v} min` : "no walk"));

    async function run(replay = true) {
      const signal = req.next();
      const portion = +f.portion.value, offset = +f.offset.value, walk = +f.walk.value;
      const meal = { meal_key: f.meal.value, portion, offset_min: offset };
      const scenarios = [
        { label: "No further meal", meals: [], walks: [] },
        { label: `${label()}${portion !== 1 ? ` × ${portion}` : ""}`, meals: [meal], walks: [] },
      ];
      if (walk) scenarios.push({ label: `+ ${walk}-min walk`, meals: [meal], walks: [{ offset_min: offset + 15, duration_min: walk, cadence: 100 }] });
      $("#sRun", root).disabled = true;
      try {
        const [r, pt] = await Promise.all([
          api(`/api/patients/${pid}/whatif`, { signal, body: { at: fmtTs(store.now), horizon_min: 300, scenarios } }),
          api(`/api/patients/${pid}?at=${encodeURIComponent(fmtTs(store.now))}&window_h=2`, { signal }),
        ]);
        $("#simTitle", root).textContent = `Test a change on ${pt.patient.name}'s twin`;
        $("#simSub", root).textContent = `Rolls the calibrated twin forward 5 hours from ${fmtClock(store.now)} (replay clock), starting at ${mg(r.start_glucose)} mg/dL.`;
        $("#simAt", root).textContent = `Simulated, not observed · horizon 5 h from ${fmtClock(store.now)}`;
        chart.render(r, { meal: offset, walk: walk ? [offset + 15, walk] : null }, replay);
        renderResults(r);
        emit("ready", "simulate");
      } catch (e) {
        if (!isAbort(e)) $("#simChart", root).innerHTML = errorBox(e, () => run());
      } finally { $("#sRun", root).disabled = false; }
    }

    function renderResults(r) {
      const [b, m, w] = r.scenarios;
      const card = (s, cls, ref) => {
        const dPeak = ref ? s.peak - ref.peak : null, dT = ref ? s.time_above_180_min - ref.time_above_180_min : null;
        return `<div class="res"><div class="lab"><i style="border-color:${cls}"></i>${esc(s.label)}</div>
          <b>${s.peak}<small> mg/dL peak</small></b>
          <small>${s.time_above_180_min} min above 180 · mean ${s.mean}</small>
          ${ref ? `<div class="small delta ${dPeak <= 0 ? "good" : "bad"}">${dPeak <= 0 ? "−" : "+"}${Math.abs(dPeak)} peak · ${dT <= 0 ? "−" : "+"}${Math.abs(dT)} min above 180 vs meal alone</div>` : ""}</div>`;
      };
      $("#results", root).innerHTML = card(b, "var(--text-3)") + card(m, "var(--twin-2)") + (w ? card(w, "var(--twin)", m) : "");
    }

    async function rank() {
      const signal = rankReq.next();
      const ms = meals.find((m) => m.key === f.meal.value)?.slot || slot0;
      // the server's "dinner" list already includes lunch dishes, which are eaten at both meals
      const slot = ms === "lunch" && slotFor(store.now) === "dinner" ? "dinner" : ms;
      $("#rankOut", root).innerHTML = `<div class="skeleton" style="height:200px"></div>`;
      try {
        const rows = await api(`/api/patients/${pid}/meal-ranking?slot=${slot}&at=${encodeURIComponent(fmtTs(store.now))}&offset_min=${f.offset.value}&walk_min=${f.walk.value}`, { signal });
        $("#rankSub", root).textContent = `${rows.length} ${slot} options for this patient's region, simulated on the twin and ranked by time above 180 mg/dL`;
        $("#rankOut", root).innerHTML = `<table class="rank-table"><thead><tr><th>#</th><th>Option</th><th class="r">Carbs</th><th class="r">GI</th><th class="r">Simulated peak</th><th class="r">Min above 180</th><th></th></tr></thead><tbody>
          ${rows.map((x, i) => `<tr><td class="num faint">${i + 1}</td><td>${esc(x.name)}</td><td class="r num">${Math.round(x.carbs_g)} g</td><td class="r num">${x.gi}</td>
            <td class="r num">${x.peak}</td><td class="r num">${x.time_above_180_min}</td><td class="r"><button data-try="${esc(x.meal_key)}">Simulate</button></td></tr>`).join("")}</tbody></table>`;
      } catch (e) { if (!isAbort(e)) $("#rankOut", root).innerHTML = errorBox(e, rank); }
    }

    $("#simForm", root).addEventListener("submit", (e) => { e.preventDefault(); run(); });
    $("#sReplay", root).addEventListener("click", () => chart.replay());
    $("#sRank", root).addEventListener("click", rank);
    $("#rankOut", root).addEventListener("click", (e) => {
      const b = e.target.closest("[data-try]");
      if (!b) return;
      f.meal.value = b.dataset.try;
      run();
      $("#simChart", root).scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const onClock = debounce(() => run(false), 350);
    run();
    return { update: (reason) => (reason === "tick" ? run(false) : onClock()), destroy() { req.cancel(); rankReq.cancel(); onClock.cancel(); } };
  },
};
