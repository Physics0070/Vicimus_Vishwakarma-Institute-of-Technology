/* Clinical record: the patient's HL7 FHIR R4 bundle as the API serves it, made readable,
   with structural checks that run in the browser (and say plainly what they do not check). */

import { api, latest, isAbort } from "../api.js";
import { emit } from "../store.js";
import { $, esc, errorBox, ICON } from "../ui.js";

const UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function structuralChecks(b) {
  const entries = b.entry || [];
  const res = entries.map((e) => e.resource || {});
  const patients = res.filter((r) => r.resourceType === "Patient");
  const pref = patients[0] ? `Patient/${patients[0].id}` : null;
  const codings = res.flatMap((r) => [r.code, r.medicationCodeableConcept, ...(r.category || []), r.clinicalStatus].filter(Boolean).flatMap((c) => c.coding || []));
  const obs = res.filter((r) => r.resourceType === "Observation");
  const valueOf = (o) => o.valueQuantity || o.valueCodeableConcept || o.valueString;
  const subj = res.filter((r) => r.subject);
  const badSubj = subj.filter((r) => r.subject.reference !== pref);
  const badUrl = entries.filter((e) => !UUID.test(e.fullUrl || ""));
  return [
    [b.resourceType === "Bundle" && !!b.type, `Resource is a Bundle of type "${esc(b.type)}"`],
    [badUrl.length === 0, badUrl.length ? `${badUrl.length} entries have a fullUrl that is not a valid urn:uuid` : `All ${entries.length} entries have a valid urn:uuid fullUrl`],
    [res.every((r) => r.resourceType && r.id), "Every resource has a resourceType and an id"],
    [patients.length === 1, `${patients.length} Patient resource${patients.length === 1 ? "" : "s"} (expected exactly 1)`],
    [badSubj.length === 0, badSubj.length ? `${badSubj.length} subject references do not resolve to the Patient` : `All ${subj.length} subject references resolve to ${esc(pref)}`],
    [codings.every((c) => c.system && c.code), `All ${codings.length} codings carry a system and a code`],
    [obs.every((o) => o.status && o.code && o.effectiveDateTime && valueOf(o)), `All ${obs.length} Observations have status, code, effective time and a value`],
  ];
}

const sys = (s) => ({ "http://loinc.org": "LOINC", "http://snomed.info/sct": "SNOMED CT", "http://www.nlm.nih.gov/research/umls/rxnorm": "RxNorm" }[s] || s);

export default {
  mount(root, { pid }) {
    root.innerHTML = `
      <a class="crumb" href="#/patient/${esc(pid)}">${ICON.back} Back to the twin</a>
      <div class="page-head"><div><p class="eyebrow">Clinical record · HL7 FHIR R4</p><h1 id="recTitle">Patient record</h1>
        <p>The static EHR stream the twin is seeded from, exactly as <code>/api/patients/${esc(pid)}/fhir</code> serves it. ABHA number masked by the server.</p></div></div>
      <div id="recBody"><div class="skeleton" style="height:420px"></div></div>`;
    const req = latest();

    async function update() {
      const signal = req.next();
      try {
        const b = await api(`/api/patients/${pid}/fhir`, { signal });
        render(b);
        emit("ready", "records");
      } catch (e) { if (!isAbort(e)) $("#recBody", root).innerHTML = errorBox(e, update); }
    }

    function render(b) {
      const res = (b.entry || []).map((e) => e.resource);
      const by = (t) => res.filter((r) => r.resourceType === t);
      const pt = by("Patient")[0] || {};
      const counts = res.reduce((m, r) => ({ ...m, [r.resourceType]: (m[r.resourceType] || 0) + 1 }), {});
      const checks = structuralChecks(b);
      const passed = checks.filter((c) => c[0]).length;
      const obs = by("Observation").slice().sort((a, b2) => String(b2.effectiveDateTime).localeCompare(a.effectiveDateTime));
      $("#recTitle", root).textContent = `${pt.name?.[0]?.text || pid} · clinical record`;
      $("#recBody", root).innerHTML = `
        <section class="grid">
          <div class="panel c8">
            <div class="panel-head"><h2>Bundle contents</h2><div class="res-types">${Object.entries(counts).map(([t, n]) => `<span class="pill">${esc(t)} × ${n}</span>`).join("")}</div></div>
            <div class="grid">
              <div class="c6"><h3 style="font-size:14px;margin-bottom:10px">Patient</h3><dl class="kv">
                <dt>Name</dt><dd style="font-family:var(--font)">${esc(pt.name?.[0]?.text)}</dd>
                <dt>${esc(pt.identifier?.[0]?.type?.text || "Identifier")}</dt><dd>${esc(pt.identifier?.[0]?.value)}</dd>
                <dt>Gender · birth date</dt><dd>${esc(pt.gender)} · ${esc(pt.birthDate)}</dd>
                <dt>City</dt><dd style="font-family:var(--font)">${esc(pt.address?.[0]?.city)}, ${esc(pt.address?.[0]?.country)}</dd>
                <dt>Tag</dt><dd style="font-family:var(--font)"><small>${esc(pt.meta?.tag?.[0]?.display)}</small></dd></dl></div>
              <div class="c6"><h3 style="font-size:14px;margin-bottom:10px">Conditions</h3>
                <ul class="checks">${by("Condition").map((c) => `<li><span class="faint">•</span><span>${esc(c.code.coding[0].display)} <span class="code">${esc(sys(c.code.coding[0].system))} ${esc(c.code.coding[0].code)}</span>${c.onsetDateTime ? `<br><span class="faint tiny">since ${esc(c.onsetDateTime)}</span>` : ""}</span></li>`).join("")}</ul>
                <h3 style="font-size:14px;margin:18px 0 10px">Medications</h3>
                <ul class="checks">${by("MedicationStatement").map((m) => `<li><span class="faint">•</span><span>${esc(m.medicationCodeableConcept.coding[0].display)} · ${esc(m.dosage?.[0]?.text)} <span class="code">RxNorm ${esc(m.medicationCodeableConcept.coding[0].code)}</span></span></li>`).join("") || '<li><span></span><span class="faint">None recorded</span></li>'}</ul>
              </div>
            </div>
            <h3 style="font-size:14px;margin:24px 0 6px">Observations</h3>
            <div class="table-wrap"><table class="obs-table"><thead><tr><th>Observation</th><th>Value</th><th>Date</th><th>Code</th></tr></thead><tbody>
              ${obs.map((o) => {
                const c = o.code.coding[0];
                const v = o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit}` : o.valueCodeableConcept?.text || "";
                return `<tr><td>${esc(c.display)}</td><td class="num">${esc(v)}</td><td class="num faint">${esc(o.effectiveDateTime)}</td><td class="code">${esc(sys(c.system))} ${esc(c.code)}</td></tr>`;
              }).join("")}</tbody></table></div>
          </div>
          <div class="panel c4">
            <div class="panel-head"><h2>Structural checks</h2><span class="pill">${passed} / ${checks.length} passed</span></div>
            <ul class="checks">${checks.map(([ok, t]) => `<li><span class="${ok ? "ok" : "bad"}" aria-label="${ok ? "pass" : "fail"}">${ok ? ICON.check : ICON.cross}</span><span>${t}</span></li>`).join("")}</ul>
            <p class="note" style="margin-top:16px">These checks run in your browser. They are <b>not</b> a FHIR conformance validator: no profile, cardinality, terminology-binding or invariant validation (use the HL7 validator or an ABDM sandbox for that). The bundle uses FHIR R4 resource shapes with LOINC, SNOMED CT and RxNorm codes.</p>
          </div>
          <div class="panel c12"><details class="raw"><summary>Raw FHIR JSON (${res.length} resources)</summary><pre></pre></details></div>
        </section>`;
      $("pre", root).textContent = JSON.stringify(b, null, 2);
    }

    update();
    return { update() { /* the record does not change with the replay clock */ }, destroy() { req.cancel(); } };
  },
};
