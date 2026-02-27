"""FastAPI REST API for Effi reactor cycle analysis."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .cycle_detection import detect_cycles
from .data_loading import load_experiment
from .integration import NATIVE_SPECIES, analyze_experiment, integrate_species
from .models import Cycle

# ---------------------------------------------------------------------------
# In-memory application state (single-user, single-experiment)
# ---------------------------------------------------------------------------


@dataclass
class AppState:
    df: pd.DataFrame | None = None
    cycles: list[Cycle] = field(default_factory=list)
    results: pd.DataFrame | None = None
    reactant_bases: list[str] = field(default_factory=list)  # e.g. ["3#HighPH2", "4#CO2", ...]


state = AppState()


def _sanitize(data: list[list]) -> list[list]:
    """Replace NaN/Inf with None for JSON serialization."""
    return [
        [None if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else v for v in row]
        for row in data
    ]

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Effi Reactor Analysis", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_loaded():
    if state.df is None:
        raise HTTPException(status_code=400, detail="No experiment loaded. POST /experiment/load first.")


# ---------------------------------------------------------------------------
# GET /browse  –  directory browser
# ---------------------------------------------------------------------------


@app.get("/browse")
def browse_directory(path: str = "."):
    """List contents of a directory for the file browser."""
    p = Path(path).resolve()
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")
    dirs = sorted(d.name for d in p.iterdir() if d.is_dir() and not d.name.startswith("."))
    files = sorted(f.name for f in p.iterdir() if f.is_file() and not f.name.startswith("."))
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None, "dirs": dirs, "files": files}


# ---------------------------------------------------------------------------
# GET /discover  –  auto-discover experiment files in a directory
# ---------------------------------------------------------------------------


@app.get("/discover")
def discover_files(path: str):
    """Find reactor, IR, and oxygen files in a directory."""
    p = Path(path).resolve()
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")
    reactor_files = sorted(str(f) for f in p.glob("ExportData_*.txt"))
    ir_files = sorted(str(f) for f in p.glob("*_Data_All.csv"))
    oxygen_files = sorted(str(f) for f in p.glob("*_oxygen.csv"))
    # All .txt and .csv files for manual override
    all_txt = sorted(f.name for f in p.glob("*.txt"))
    all_csv = sorted(f.name for f in p.glob("*.csv"))
    return {
        "path": str(p),
        "reactor_files": reactor_files,
        "ir_file": ir_files[0] if ir_files else None,
        "oxygen_file": oxygen_files[0] if oxygen_files else None,
        "all_txt": all_txt,
        "all_csv": all_csv,
    }


# ---------------------------------------------------------------------------
# POST /experiment/load
# ---------------------------------------------------------------------------


class LoadRequest(BaseModel):
    reactor_files: list[str]
    ir_file: str
    oxygen_file: str | None = None
    offset_hours: float = 0.0


@app.post("/experiment/load")
def load_experiment_endpoint(req: LoadRequest):
    """Load data files, merge, detect cycles, and compute integration results."""
    for f in req.reactor_files + [req.ir_file] + ([req.oxygen_file] if req.oxygen_file else []):
        if not Path(f).exists():
            raise HTTPException(status_code=404, detail=f"File not found: {f}")

    state.df = load_experiment(
        req.reactor_files,
        req.ir_file,
        req.oxygen_file,
        offset=pd.Timedelta(hours=req.offset_hours),
    )
    state.cycles = detect_cycles(state.df)
    state.results = analyze_experiment(state.df, state.cycles)

    # Auto-discover reactant base names (same logic as plot_merged)
    cols = state.df.columns
    tot_bases = [c.replace(" TOT", "") for c in cols if c.endswith(" TOT")]
    state.reactant_bases = sorted(
        [b for b in tot_bases if f"{b} PV" in cols and f"{b} RSP" in cols],
        key=lambda b: list(cols).index(f"{b} PV"),
    )

    return {
        "rows": state.df.shape[0],
        "columns": state.df.shape[1],
        "column_names": state.df.columns.tolist(),
        "n_cycles": len(state.cycles),
        "time_range": {
            "start": state.df["Timestamp"].min().isoformat(),
            "end": state.df["Timestamp"].max().isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# GET /cycles
# ---------------------------------------------------------------------------


def _cycle_summary(c: Cycle) -> dict:
    return {
        "cycle_id": c.cycle_id,
        "high_p": {
            "start": c.high_p.start.isoformat(),
            "end": c.high_p.end.isoformat(),
            "start_idx": c.high_p.start_idx,
            "end_idx": c.high_p.end_idx,
        },
        "low_p": {
            "start": c.low_p.start.isoformat(),
            "end": c.low_p.end.isoformat(),
            "start_idx": c.low_p.start_idx,
            "end_idx": c.low_p.end_idx,
        },
    }


@app.get("/cycles")
def list_cycles():
    _require_loaded()
    return {"cycles": [_cycle_summary(c) for c in state.cycles]}


# ---------------------------------------------------------------------------
# GET /cycles/{cycle_id}
# ---------------------------------------------------------------------------


@app.get("/cycles/{cycle_id}")
def get_cycle(cycle_id: int):
    _require_loaded()
    cycle = next((c for c in state.cycles if c.cycle_id == cycle_id), None)
    if cycle is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found")

    # Integration results for this cycle
    cycle_results = state.results[state.results["cycle_id"] == cycle_id]
    integration = cycle_results[["species", "unit", "high_p_area", "low_p_area"]].to_dict(orient="records")
    for row in integration:
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                row[k] = None

    return {
        **_cycle_summary(cycle),
        "integration": integration,
    }


# ---------------------------------------------------------------------------
# GET /cycles/{cycle_id}/data
# ---------------------------------------------------------------------------


@app.get("/cycles/{cycle_id}/data")
def get_cycle_data(cycle_id: int, pad_minutes: float = 2.0):
    """Return time-series data for a single cycle (for detailed plotting)."""
    _require_loaded()
    cycle = next((c for c in state.cycles if c.cycle_id == cycle_id), None)
    if cycle is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found")

    pad = pd.Timedelta(minutes=pad_minutes)
    t_start = cycle.high_p.start - pad
    t_end = cycle.low_p.end + pad
    mask = (state.df["Timestamp"] >= t_start) & (state.df["Timestamp"] <= t_end)
    view = state.df.loc[mask]

    # Species columns
    species_cols = [c for c in NATIVE_SPECIES if c in view.columns]
    # Also include auto-generated (%) versions for ppm species
    pct_cols = [c for c in view.columns if c.endswith(" (%)")]
    all_species = list(dict.fromkeys(species_cols + pct_cols))  # dedupe, preserve order

    # Reactant columns (auto-discovered PV/RSP/TOT triples)
    condition_cols = []
    for base in state.reactant_bases:
        for suffix in ("PV", "RSP", "TOT"):
            col = f"{base} {suffix}"
            if col in view.columns:
                condition_cols.append(col)
    # Reactor condition columns
    for col in ("Reactor P RSP", "Reactor P PV", "Reactor T RSP", "Reactor T PV"):
        if col in view.columns:
            condition_cols.append(col)

    cols_to_send = ["Timestamp"] + all_species + condition_cols
    cols_to_send = [c for c in cols_to_send if c in view.columns]
    subset = view[cols_to_send].copy()
    subset["Timestamp"] = subset["Timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S.%f")

    return {
        "cycle_id": cycle_id,
        "columns": cols_to_send,
        "data": _sanitize(subset.values.tolist()),
    }


# ---------------------------------------------------------------------------
# GET /overview
# ---------------------------------------------------------------------------


@app.get("/overview")
def get_overview(max_points: int = 2000):
    """Return downsampled overview data for the full-experiment plot."""
    _require_loaded()
    df = state.df

    # Downsample if needed
    step = max(1, len(df) // max_points)
    sampled = df.iloc[::step]

    # All species (%) + reactant + condition columns for full legend support
    overview_cols = ["Timestamp"]
    overview_cols.extend(c for c in sampled.columns if c.endswith(" (%)"))
    for base in state.reactant_bases:
        for suffix in ("PV", "RSP", "TOT"):
            col = f"{base} {suffix}"
            if col in sampled.columns:
                overview_cols.append(col)
    for col in ["Reactor T PV", "Reactor T RSP", "Reactor P PV", "Reactor P RSP"]:
        if col in sampled.columns:
            overview_cols.append(col)

    subset = sampled[overview_cols].copy()
    subset["Timestamp"] = subset["Timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S.%f")

    # Cycle markers
    cycle_markers = []
    for c in state.cycles:
        cycle_markers.append({
            "cycle_id": c.cycle_id,
            "hp_start": c.high_p.start.isoformat(),
            "hp_end": c.high_p.end.isoformat(),
            "lp_start": c.low_p.start.isoformat(),
            "lp_end": c.low_p.end.isoformat(),
        })

    return {
        "columns": overview_cols,
        "data": _sanitize(subset.values.tolist()),
        "cycles": cycle_markers,
    }


# ---------------------------------------------------------------------------
# GET /export/excel  –  download integration results as .xlsx
# ---------------------------------------------------------------------------


@app.get("/export/excel")
def export_excel():
    """Return an Excel workbook with High-P and Low-P integration tables."""
    _require_loaded()
    if state.results is None or state.results.empty:
        raise HTTPException(status_code=400, detail="No integration results available.")

    import io
    from fastapi.responses import StreamingResponse

    results = state.results

    # Pivot to wide: rows = cycle, columns = species
    hp = results.pivot(index="cycle_id", columns="species", values="high_p_area")
    lp = results.pivot(index="cycle_id", columns="species", values="low_p_area")
    hp.index.name = "Cycle"
    lp.index.name = "Cycle"

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        hp.to_excel(writer, sheet_name="High P Integration (% s)")
        lp.to_excel(writer, sheet_name="Low P Integration (% s)")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=integration_results.xlsx"},
    )


# ---------------------------------------------------------------------------
# Static file serving for the production frontend build
# ---------------------------------------------------------------------------

_pkg_static = Path(__file__).resolve().parent / "_static"
_dev_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
_frontend_dist = _pkg_static if _pkg_static.is_dir() else _dev_dist
if _frontend_dist.is_dir():
    from fastapi.responses import FileResponse

    @app.get("/app/{rest_of_path:path}")
    def serve_spa(rest_of_path: str):
        """Serve the SPA; fall back to index.html for client-side routing."""
        file = _frontend_dist / rest_of_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(_frontend_dist / "index.html")

    @app.get("/app")
    def serve_spa_root():
        return FileResponse(_frontend_dist / "index.html")

    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="assets")
