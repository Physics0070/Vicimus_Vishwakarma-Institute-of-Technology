"""Render docs/architecture.pdf and docs/presentation.pdf from the HTML sources. Slide numbers come from
reports/metrics.json and reports/real_data_metrics.json; the dashboard screenshots and the patient-specific
example are taken from the running API, so the deck always matches the code. Requires Google Chrome or
Microsoft Edge (headless) and the trained artifacts (`python -m glucotwin.pipeline`).

    python scripts/build_docs.py
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SRC = DOCS / "src"
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "chromium-browser", "msedge",
]


def browser() -> str:
    for b in BROWSERS:
        if Path(b).exists() or shutil.which(b):
            return b
    raise SystemExit("Chrome/Edge not found: needed for headless PDF rendering")


def render(html: Path, pdf: Path, png: Path | None = None, size: str | None = None) -> None:
    b = browser()
    url = html.resolve().as_uri()
    subprocess.run([b, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf}", url], check=True, capture_output=True)
    if png and size:
        subprocess.run([b, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={size}",
                        f"--screenshot={png}", url], check=True, capture_output=True)
    print(f"  wrote {pdf.relative_to(ROOT)}")


# the moment shown on the dashboard slides: an alert fires at 12:05 while glucose is still 123 mg/dL
DEMO_PID, DEMO_AT = "P050", "2026-09-11T12:10"


def _get(base: str, path: str):
    with urllib.request.urlopen(base + path, timeout=120) as r:
        return json.load(r)


@contextmanager
def api_server():
    """Run the API on a free port for the duration of the build."""
    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        port = sk.getsockname()[1]
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "glucotwin.api:app", "--port", str(port)], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(90):
            try:
                _get(base, "/api/health")
                break
            except OSError:
                time.sleep(1)
        else:
            raise SystemExit("API did not start: run `python -m glucotwin.pipeline` first")
        # the first request loads the models and twins; do it now so the headless screenshots see data
        for path in ("/api/status", f"/api/ward?at={DEMO_AT}", f"/api/alerts?at={DEMO_AT}&hours=24",
                     f"/api/patients/{DEMO_PID}?at={DEMO_AT}&window_h=6"):
            _get(base, path)
        yield base
    finally:
        proc.terminate()


def screenshot(url: str, png: Path, size: str) -> None:
    with tempfile.TemporaryDirectory() as prof:
        subprocess.run([browser(), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-prefers-reduced-motion",
                        "--virtual-time-budget=25000", f"--user-data-dir={prof}", f"--window-size={size}",
                        f"--screenshot={png}", url], check=True, capture_output=True)
    print(f"  wrote {png.relative_to(ROOT)}")


def demo_facts(base: str) -> dict:
    """Patient-specific numbers for the slides, read from the same API the dashboard uses."""
    d = _get(base, f"/api/patients/{DEMO_PID}?at={DEMO_AT}")
    fr = d["insights"]["food_response"]
    when = DEMO_AT.replace("T", " ")
    if len(fr) >= 2:
        hi, lo = fr[0], fr[-1]
        food = (f"From {d['patient']['name']}'s own logs: {hi['name']} +{hi['rise']} mg/dL on average ({hi['n']} meals) "
                f"vs {lo['name']} +{lo['rise']} mg/dL ({lo['n']}).")
    else:
        food = "Average rise after each logged meal, from the patient's own CGM."
    sys.path.insert(0, str(ROOT))
    from glucotwin.features import feature_groups
    import pyarrow.parquet as pq
    cols = pq.read_schema(ROOT / "artifacts" / "features.parquet").names
    return {"food_text": food, "demo_when": when, "n_features": str(sum(len(v) for v in feature_groups(cols).values()))}


def fill_presentation(extra: dict) -> Path:
    m = json.loads((ROOT / "reports" / "metrics.json").read_text())
    f = m["final"]
    vals = {
        "lead": f"{f['events']['median_lead_min']:.0f}",
        "rmse60": f"{f['60']['rmse']:.1f}", "pers60": f"{m['baselines']['Persistence']['60']['rmse']:.1f}",
        "mard60": f"{f['60']['mard_pct']:.1f}", "clarke": f"{f['60']['clarke_AB_pct']:.1f}",
        "coverage": f"{f['60']['coverage_pct']:.0f}",
        "detected_pct": f"{f['events']['sensitivity_pct']:.0f}",
        "detected": f"{f['events']['detected']}/{f['events']['excursions']}",
        "fa": f"{f['events']['false_alerts_per_patient_day']:.2f}",
        "rho_kx": f"{m['twin_fidelity']['spearman_kx']:.2f}", "rho_gb": f"{m['twin_fidelity']['spearman_gb']:.2f}",
        "calib_gain": f"{m['twin_fidelity']['mean_loss_reduction_pct']:.0f}",
        "final_rows": "".join(
            f"<tr><td>{h} min</td><td class='n'>{f[h]['rmse']:.1f}</td><td class='n'>{f[h]['mard_pct']:.1f}%</td>"
            f"<td class='n'>{f[h]['clarke_A_pct']:.1f}%</td><td class='n'>{f[h]['coverage_pct']:.1f}%</td></tr>"
            for h in ("30", "60", "120")),
    }
    rp = ROOT / "reports" / "real_data_metrics.json"
    if rp.exists():
        r = json.loads(rp.read_text())
        sc = r["status_counts"]
        rows = []
        for name, src in list(r["baselines"].items()) + list(r["ablation"].items()):
            cls = " class='hl'" if name.startswith("+ Twin") else ""
            rows.append(f"<tr{cls}><td>{name}</td>" + "".join(f"<td class='n'>{src[h]['rmse']:.1f}</td>" for h in ("30", "60", "120")) + "</tr>")
        e = r.get("events_180", {})
        vals.update({
            "real_n": str(r["participants"]),
            "real_mix": f"{sc.get('Healthy', 0)} healthy, {sc.get('Prediabetes', 0)} prediabetes, {sc.get('T2D', 0)} T2D",
            "real_rows": "".join(rows),
            "real_events": (f"Spikes &gt;180 flagged in advance: <b>{e['detected']}/{e['excursions']}</b>, median lead "
                            f"<b>{e['median_lead_min']:.0f} min</b>." if e.get("median_lead_min") else ""),
        })
    vals.update(extra)
    html = (SRC / "presentation.html").read_text(encoding="utf-8")
    for k, v in vals.items():
        html = html.replace("{{" + k + "}}", v)
    missing = [seg.split("}}")[0] for seg in html.split("{{")[1:]]
    if missing:
        raise SystemExit(f"unfilled placeholders: {missing}")
    out = SRC / "_presentation.rendered.html"
    out.write_text(html, encoding="utf-8")
    return out


def main() -> None:
    render(SRC / "architecture.html", DOCS / "architecture.pdf", DOCS / "architecture.png", "1587,1122")
    with api_server() as base:
        screenshot(f"{base}/#/?t={DEMO_AT}", SRC / "dashboard_top.png", "1600,900")
        screenshot(f"{base}/#/simulate/{DEMO_PID}?t={DEMO_AT}", SRC / "whatif.png", "1600,900")
        extra = demo_facts(base)
    rendered = fill_presentation(extra)
    render(rendered, DOCS / "presentation.pdf")
    rendered.unlink()


if __name__ == "__main__":
    main()
