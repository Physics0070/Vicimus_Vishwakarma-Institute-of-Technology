/* Secondary evidence charts, rendered only when their tab is opened. */

import { parseTs, cssVar, plotLayout, plotCfg, whenPlotly } from "../ui.js";

export async function renderWearables(el, d) {
  const Plotly = await whenPlotly();
  const h = d.history, ts = h.ts.map(parseTs);
  const stage = ["awake", "light", "deep", "REM"];
  await Plotly.react(el, [
    { x: ts, y: h.hr, name: "Heart rate", mode: "lines", line: { color: cssVar("--high"), width: 1.4 }, yaxis: "y", hovertemplate: "%{y:.0f} bpm<extra>Heart rate</extra>" },
    { x: ts, y: h.hrv, name: "HRV (RMSSD)", mode: "lines", line: { color: cssVar("--low"), width: 1.2 }, yaxis: "y", hovertemplate: "%{y:.0f} ms<extra>HRV</extra>" },
    { x: ts, y: h.steps, name: "Steps per 5 min", type: "bar", marker: { color: cssVar("--pred") }, yaxis: "y2", hovertemplate: "%{y} steps<extra>5 min</extra>" },
    { x: ts, y: h.sleep_stage.map((s) => ({ 1: 2, 2: 1, 3: 3 }[s] ?? null)), name: "Sleep stage", mode: "lines",
      line: { color: cssVar("--twin"), shape: "hv", width: 1.6 }, yaxis: "y3", text: h.sleep_stage.map((s) => stage[s]), hovertemplate: "%{text}<extra>Sleep</extra>" },
  ], plotLayout({
    height: 320, showlegend: true, legend: { orientation: "h", y: 1.1, x: 0, font: { size: 11 } },
    yaxis: { domain: [0.5, 1], title: { text: "bpm · ms", font: { size: 11 } } },
    yaxis2: { domain: [0.22, 0.44], title: { text: "steps", font: { size: 11 } } },
    yaxis3: { domain: [0, 0.16], tickvals: [1, 2, 3], ticktext: ["deep", "light", "REM"], range: [0.5, 3.5] },
    xaxis: { anchor: "y3", type: "date", tickformat: "%H:%M" }, bargap: 0,
  }), plotCfg);
}

export async function renderSleep(el, nights) {
  const Plotly = await whenPlotly();
  const x = nights.map((n) => n.date);
  await Plotly.react(el, [
    { x, y: nights.map((n) => n.sleep_h), type: "bar", name: "Sleep (h)", hovertemplate: "%{y:.1f} h<extra>Sleep</extra>",
      marker: { color: nights.map((n) => (n.sleep_h < 6 ? cssVar("--mod") : cssVar("--twin"))) } },
    { x, y: nights.map((n) => n.next_day_mean), name: "Next-day mean glucose", mode: "lines+markers", yaxis: "y2",
      line: { color: cssVar("--obs") }, hovertemplate: "%{y:.0f} mg/dL<extra>Next-day mean</extra>" },
  ], plotLayout({
    height: 240, showlegend: true, legend: { orientation: "h", y: 1.15, x: 0 }, margin: { r: 50 },
    yaxis: { title: { text: "hours slept", font: { size: 11 } }, range: [0, 10] },
    yaxis2: { overlaying: "y", side: "right", title: { text: "mg/dL", font: { size: 11 } }, showgrid: false, tickfont: { family: cssVar("--mono"), size: 11 } },
  }), plotCfg);
}

export async function renderA1c(el, hist) {
  const Plotly = await whenPlotly();
  await Plotly.react(el, [{ x: hist.map((h) => h.date), y: hist.map((h) => h.hba1c), mode: "lines+markers", name: "HbA1c",
    line: { color: cssVar("--pred"), width: 2 }, hovertemplate: "%{y:.1f}%<extra>HbA1c</extra>" }],
  plotLayout({ height: 180, margin: { t: 14 }, yaxis: { title: { text: "HbA1c %", font: { size: 11 } } },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 7, y1: 7, line: { color: cssVar("--low"), dash: "dot", width: 1 } }],
    annotations: [{ xref: "paper", x: 1, y: 7, text: "target 7%", showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 10, color: cssVar("--low") } }] }), plotCfg);
}
