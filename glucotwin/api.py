"""FastAPI backend for the GlucoTwin clinician dashboard.

    uvicorn glucotwin.api:app --port 8000      then open http://localhost:8000
"""

from __future__ import annotations

import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config as C
from .service import ClinicalService

DASHBOARD = C.ROOT / "dashboard"

app = FastAPI(title="GlucoTwin India API", version="0.1.0",
              description="Hybrid physiological + ML digital twin for Type 2 Diabetes (synthetic data, proof of concept).")
# The bundled dashboard is same-origin; other origins must be allowed explicitly (comma-separated).
_origins = [o.strip() for o in os.getenv("GLUCOTWIN_CORS_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@lru_cache(maxsize=1)
def svc() -> ClinicalService:
    return ClinicalService()


def _check(pid: str) -> None:
    if pid not in svc().ward_ids:
        raise HTTPException(404, f"Patient {pid} is not in the virtual ward")


def _at(at: str | None) -> pd.Timestamp | None:
    """Parse the replay clock; malformed input is a client error, not a 500."""
    if at is None:
        return None
    try:
        ts = pd.Timestamp(at)
    except (ValueError, TypeError):
        raise HTTPException(422, f"Invalid timestamp '{at}'")
    if ts is pd.NaT:
        raise HTTPException(422, f"Invalid timestamp '{at}'")
    return ts.tz_localize(None) if ts.tzinfo is not None else ts   # the replay clock is naive local time


class MealPlan(BaseModel):
    meal_key: str
    portion: float = Field(1.0, ge=0.25, le=3.0)
    offset_min: int = Field(0, ge=0, le=600)


class WalkPlan(BaseModel):
    offset_min: int = Field(0, ge=0, le=600)
    duration_min: int = Field(15, ge=0, le=180)
    cadence: float = Field(100, ge=0, le=160)


class Scenario(BaseModel):
    label: str = "scenario"
    meals: list[MealPlan] = Field(default_factory=list, max_length=10)
    walks: list[WalkPlan] = Field(default_factory=list, max_length=10)


class WhatIfRequest(BaseModel):
    at: str | None = None
    horizon_min: int = Field(300, ge=60, le=720)
    scenarios: list[Scenario] = Field(min_length=1, max_length=6)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status():
    """Readiness: loads the twins and models, so a failure here means predictions are unavailable."""
    return svc().status()


@app.get("/api/meta")
def meta():
    return svc().meta()


@app.get("/api/ward")
def ward(at: str | None = None):
    return svc().ward(_at(at))


@app.get("/api/patients/{pid}")
def patient(pid: str, at: str | None = None, window_h: float = Query(12, ge=2, le=48), reveal: bool = False):
    _check(pid)
    return svc().patient(pid, _at(at), window_h, reveal)


@app.get("/api/patients/{pid}/timeline")
def timeline(pid: str, at: str | None = None):
    _check(pid)
    return svc().timeline(pid, _at(at))


@app.get("/api/alerts")
def alerts(at: str | None = None, hours: float = Query(24, ge=1, le=72)):
    return svc().alerts(_at(at), hours)


@app.post("/api/patients/{pid}/whatif")
def whatif(pid: str, req: WhatIfRequest):
    _check(pid)
    from .meals import MEALS
    for sc in req.scenarios:
        for m in sc.meals:
            if m.meal_key not in MEALS:
                raise HTTPException(422, f"Unknown meal '{m.meal_key}'")
    return svc().whatif(pid, _at(req.at), [s.model_dump() for s in req.scenarios], req.horizon_min)


@app.get("/api/patients/{pid}/meal-ranking")
def meal_ranking(pid: str, slot: str = Query("lunch", pattern="^(breakfast|lunch|dinner|snack)$"),
                 at: str | None = None, offset_min: int = Query(0, ge=0, le=600),
                 walk_min: int = Query(0, ge=0, le=180)):
    _check(pid)
    return svc().meal_ranking(pid, _at(at), slot, offset_min, walk_min)


@app.get("/api/patients/{pid}/fhir")
def fhir(pid: str):
    _check(pid)
    return svc().fhir(pid)


if DASHBOARD.exists():
    @app.middleware("http")
    async def revalidate_dashboard(request, call_next):
        """Dashboard files are unversioned: make browsers revalidate (cheap 304s) so a new deploy
        never runs against a stale cached stylesheet or module."""
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.mount("/static", StaticFiles(directory=DASHBOARD), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(DASHBOARD / "index.html")
