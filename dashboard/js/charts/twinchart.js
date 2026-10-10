/* The patient's main chart: observed CGM up to "now", the ML forecast with its conformal interval,
   the twin's physiological trajectory, logged meals, alerts that were sent and, in retrospective
   replay only, what the sensor recorded afterwards (never available to the model). */

import { parseTs, cssVar, plotLayout, plotCfg, whenPlotly } from "../ui.js";

export async function renderTwinChart(el, d) {
  const Plotly = await whenPlotly();
  const now = parseTs(d.at);
  const at = (m) => new Date(now.getTime() + m * 60e3);
  const ts = d.history.ts.map(parseTs);
  const f = d.forecast.horizons;
  const g0 = d.current.glucose;
  const H = [30, 60, 120];
  const fx = [now, ...H.map(at)];
  const pts = [g0, ...H.map((h) => f[h].point)];
  const lo = [g0, ...H.map((h) => f[h].lo)];
  const hi = [g0, ...H.map((h) => f[h].hi)];
  const C = { obs: cssVar("--obs"), pred: cssVar("--pred"), twin: cssVar("--twin"), rev: cssVar("--rev"), high: cssVar("--high"), mod: cssVar("--mod"), t3: cssVar("--text-3") };

  const vals = [...d.history.cgm, ...hi, ...d.forecast.twin, ...(d.outcome?.cgm || [])].filter((v) => v != null);
  const yTop = Math.max(300, Math.ceil((Math.max(...vals) + 25) / 25) * 25);

  const traces = [
    { x: ts, y: d.history.cgm, mode: "markers", name: "Observed CGM", marker: { size: 4.5, color: C.obs, opacity: 0.85 },
      hovertemplate: "%{y:.0f} mg/dL<extra>Observed</extra>" },
  ];
  if (g0 != null) {
    traces.push(
      { x: [...fx, ...fx.slice().reverse()], y: [...hi, ...lo.slice().reverse()], mode: "lines", fill: "toself", fillcolor: cssVar("--pred-soft"),
        line: { width: 0 }, name: "90% interval", hoverinfo: "skip" },
      { x: fx, y: pts, mode: "lines+markers", name: "ML forecast", line: { color: C.pred, width: 2.6 }, marker: { size: 7, color: C.pred },
        customdata: [[g0, g0], ...H.map((h) => [f[h].lo, f[h].hi])],
        hovertemplate: "%{y:.0f} mg/dL (90%: %{customdata[0]:.0f}–%{customdata[1]:.0f})<extra>Predicted</extra>" });
  }
  traces.push({ x: d.forecast.twin_ts.map(parseTs), y: d.forecast.twin, mode: "lines", name: "Twin physiology",
    line: { color: C.twin, width: 2, dash: "dash" }, hovertemplate: "%{y:.0f} mg/dL<extra>Twin</extra>" });
  if (d.outcome) {
    traces.push({ x: d.outcome.ts.map(parseTs), y: d.outcome.cgm, mode: "markers", name: "Recorded later",
      marker: { size: 6, color: "rgba(0,0,0,0)", line: { color: C.rev, width: 1.6 } },
      hovertemplate: "%{y:.0f} mg/dL<extra>Recorded later · hidden from the model</extra>" });
  }
  if (d.meals.length) {
    traces.push({ x: d.meals.map((m) => parseTs(m.ts)), y: d.meals.map(() => 56), mode: "markers", name: "Meal logged",
      marker: { symbol: "triangle-up", size: 11, color: C.mod }, text: d.meals.map((m) => `${m.name} · ${Math.round(m.carbs_g)} g carbs`),
      hovertemplate: "%{text}<extra>Meal logged</extra>" });
  }
  if (d.alerts.length) {
    traces.push({ x: d.alerts.map(parseTs), y: d.alerts.map(() => yTop - 12), mode: "markers", name: "Alert sent",
      marker: { symbol: "triangle-down", size: 11, color: C.high }, hovertemplate: "Alert sent<extra></extra>" });
  }

  const layout = plotLayout({
    height: el.clientHeight || 360,
    xaxis: { range: [new Date(now.getTime() - 12 * 3600e3), at(125)], type: "date", tickformat: "%H:%M" },
    yaxis: { range: [40, yTop], title: { text: "mg/dL", font: { size: 11 } } },
    shapes: [
      { type: "rect", xref: "paper", x0: 0, x1: 1, y0: 70, y1: 180, fillcolor: cssVar("--range"), line: { width: 0 }, layer: "below" },
      { type: "rect", x0: now, x1: at(125), yref: "paper", y0: 0, y1: 1, fillcolor: cssVar("--twin-soft"), opacity: 0.35, line: { width: 0 }, layer: "below" },
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: 180, y1: 180, line: { color: C.high, width: 1, dash: "dot" } },
      { type: "line", x0: now, x1: now, yref: "paper", y0: 0, y1: 1, line: { color: C.t3, width: 1, dash: "dash" } },
    ],
    annotations: [
      { x: now, y: 1, yref: "paper", text: "NOW", showarrow: false, yanchor: "bottom", font: { size: 10, color: C.t3 } },
      { x: at(62), y: 1, yref: "paper", text: "next 2 h", showarrow: false, yanchor: "bottom", font: { size: 10, color: C.twin } },
    ],
  });
  await Plotly.react(el, traces, layout, plotCfg);
}
