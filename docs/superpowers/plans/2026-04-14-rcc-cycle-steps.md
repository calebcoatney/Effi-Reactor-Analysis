# RCC Full-Cycle Step Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the cycle analysis pipeline to model the full RCC cycle (Capture → Purge → Hydrogenation) with catalyst-type-aware hydrogenation (ZA: single atmospheric-P step; CZA: high-P + low-P sub-steps), and add integration output for Capture and Purge steps.

**Architecture:** Discard the uncommitted "reaction mode" changes and rebuild. The `Cycle` model gains named `Window` fields for each step (`capture`, `purge`, `hydrogenation` for ZA; `capture`, `purge`, `high_p_hydrogenation`, `low_p_hydrogenation` for CZA). Cycle detection is rewritten to use the N2 RSP signal (with CO2 MFC confirmation) for Capture/Purge boundaries, and retains the existing H2-based hydrogenation detection. The API, Excel export, and frontend are updated to present all steps. A user-facing CO2 MFC selector is added to FileSelector.

**Tech Stack:** Python 3.11+ / FastAPI / pandas / NumPy / React 19 / TypeScript / Plotly.js / Vite

**Python environment:** `~/miniforge3/envs/effi-env/bin/python`

---

## Pre-Implementation: Discard Uncommitted Changes

Before any task begins, restore the working tree to match HEAD (commit `b237bc0`):

```bash
cd "/Users/ccoatney/Library/CloudStorage/OneDrive-NREL/Effi Analysis"
git checkout -- .
```

This removes all uncommitted "reaction mode" changes across 9 files. All tasks below build from the clean committed state.

---

## File Structure

### Files to modify:
- `backend/effi/models.py` — Replace `Cycle` with catalyst-type-aware step windows
- `backend/effi/cycle_detection.py` — Add `detect_capture_purge()`, update `detect_cycles()` to compose full cycles
- `backend/effi/integration.py` — Extend `analyze_experiment()` to integrate all step windows
- `backend/effi/api.py` — New `catalyst_type` + `co2_mfc` fields; update all endpoints for multi-step cycles
- `backend/effi/plotting.py` — Update `plot_cycle()` for multi-window shading (Optional/low priority)
- `frontend/src/api.ts` — Update types for multi-step cycle model
- `frontend/src/components/FileSelector.tsx` — Add catalyst type selector + CO2 MFC picker
- `frontend/src/components/CycleDetailView.tsx` — Render all step windows + integration table
- `frontend/src/components/OverviewPlot.tsx` — Multi-step cycle markers
- `frontend/src/App.tsx` — Pass catalyst type through component tree

### Files unchanged:
- `backend/effi/data_loading.py` — No changes needed
- `backend/effi/cli.py` — No changes needed
- `frontend/src/plotConfig.ts` — No changes needed
- `frontend/src/components/CycleNavigator.tsx` — No changes needed

---

## Task 1: Rewrite the Cycle Model

**Files:**
- Modify: `backend/effi/models.py` (entire file, 33 lines)

- [ ] **Step 1: Rewrite models.py**

Replace the entire file with a catalyst-type-aware model. The `Window` dataclass stays the same. `Cycle` gains explicit fields for each step:

```python
"""Data classes for cycle analysis."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd


@dataclass
class Window:
    """A time window within a cycle step."""

    label: str  # "capture", "purge", "high_p_hydro", "low_p_hydro", "hydro"
    start: pd.Timestamp
    end: pd.Timestamp
    start_idx: int
    end_idx: int


@dataclass
class Cycle:
    """One full RCC cycle with its analysis windows.

    All catalyst types have capture and purge windows.
    CZA has high_p_hydrogenation + low_p_hydrogenation.
    ZA has a single hydrogenation window.
    """

    cycle_id: int
    capture: Optional[Window] = None
    purge: Optional[Window] = None
    high_p_hydrogenation: Optional[Window] = None
    low_p_hydrogenation: Optional[Window] = None
    hydrogenation: Optional[Window] = None

    @property
    def hydro_windows(self) -> list[Window]:
        """Return the hydrogenation window(s) present on this cycle."""
        if self.hydrogenation is not None:
            return [self.hydrogenation]
        return [w for w in (self.high_p_hydrogenation, self.low_p_hydrogenation) if w is not None]
```

- [ ] **Step 2: Verify syntax**

Run: `~/miniforge3/envs/effi-env/bin/python -c "from backend.effi.models import Cycle, Window; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/effi/models.py
git commit -m "refactor: rewrite Cycle model with named step windows

Cycle now has explicit fields for capture, purge, and hydrogenation
windows. CZA experiments use high_p_hydrogenation + low_p_hydrogenation;
ZA experiments use a single hydrogenation window.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Add Capture/Purge Detection to cycle_detection.py

**Files:**
- Modify: `backend/effi/cycle_detection.py`

This is the most algorithmically complex task. We add a function to detect Capture and Purge windows from the N2 RSP signal, then compose full cycles by pairing them with existing hydrogenation detection.

- [ ] **Step 1: Add `detect_capture_purge_windows()` function**

Add this function after the existing `detect_cycles()` function (before the helper functions at the bottom). This detects Capture and Purge windows from N2 RSP transitions:

```python
def detect_capture_purge_windows(
    df: pd.DataFrame,
    *,
    n2_rsp_col: str = "6#HighPN2 RSP",
    co2_mfc_col: str | None = None,
    co2_mfc_on: float = 1.0,
    n2_drop_frac: float = 0.10,
    n2_off_threshold: float = 1.0,
    time_col: str = "Timestamp",
) -> list[tuple[Window, Window]]:
    """Detect Capture and Purge window pairs from N2 RSP signal.

    Algorithm
    ---------
    1. Identify the N2 "baseline" as the most common high RSP value.
    2. Scan for N2 RSP dips: a drop of at least ``n2_drop_frac`` fraction
       from baseline while a CO2 MFC is flowing (if ``co2_mfc_col`` given).
       - Capture start = first row where N2 drops below baseline * (1 - n2_drop_frac).
       - Capture end = first row where N2 returns to within n2_drop_frac of baseline.
    3. Purge window:
       - Start = Capture end.
       - End = first row where N2 RSP drops below n2_off_threshold (N2 turned off).

    Parameters
    ----------
    df : DataFrame
        Merged DataFrame at IR cadence.
    n2_rsp_col : str
        Column name for N2 RSP signal.
    co2_mfc_col : str, optional
        Column name for CO2 MFC RSP. If provided, Capture windows are only
        detected when CO2 is actively flowing (value > co2_mfc_on).
    co2_mfc_on : float
        Threshold above which CO2 MFC is considered "on".
    n2_drop_frac : float
        Fractional drop from baseline that marks start of Capture.
    n2_off_threshold : float
        N2 RSP below this value = N2 turned off (end of Purge).
    time_col : str
        Timestamp column name.

    Returns
    -------
    list of (capture_window, purge_window) tuples.
    """
    n2_rsp = df[n2_rsp_col].values
    timestamps = df[time_col]
    co2 = df[co2_mfc_col].values if co2_mfc_col and co2_mfc_col in df.columns else None

    # Step 1: find N2 baseline — the most common RSP value above n2_off_threshold
    high_values = n2_rsp[n2_rsp > n2_off_threshold]
    if len(high_values) == 0:
        return []
    # Round to nearest integer for grouping discrete setpoints
    baseline = float(pd.Series(np.round(high_values, 0)).mode().iloc[0])
    drop_threshold = baseline * (1.0 - n2_drop_frac)
    recovery_threshold = baseline * (1.0 - n2_drop_frac)

    pairs: list[tuple[Window, Window]] = []
    i = 0
    n = len(n2_rsp)

    while i < n:
        # Find N2 at baseline (high)
        if n2_rsp[i] < drop_threshold or n2_rsp[i] < n2_off_threshold:
            i += 1
            continue

        # We're at baseline. Scan forward for a dip.
        j = i + 1
        while j < n and n2_rsp[j] >= drop_threshold:
            j += 1
        if j >= n:
            break

        # j is where N2 drops. Check if N2 is still "on" (not turned off entirely).
        if n2_rsp[j] < n2_off_threshold:
            # N2 turned off — this is not a capture dip, skip to after the off period.
            i = j + 1
            continue

        # Confirm CO2 is flowing if we have the signal.
        capture_start = j
        if co2 is not None and co2[capture_start] <= co2_mfc_on:
            i = j + 1
            continue

        # Capture window: scan until N2 recovers to baseline.
        k = capture_start + 1
        while k < n and n2_rsp[k] < recovery_threshold:
            k += 1
        if k >= n:
            break
        capture_end = k

        # Purge window: from recovery until N2 is turned off.
        purge_start = capture_end
        m = purge_start + 1
        while m < n and n2_rsp[m] >= n2_off_threshold:
            m += 1
        if m >= n:
            break
        purge_end = m

        pairs.append((
            Window(
                label="capture",
                start=timestamps.iloc[capture_start],
                end=timestamps.iloc[capture_end],
                start_idx=capture_start,
                end_idx=capture_end,
            ),
            Window(
                label="purge",
                start=timestamps.iloc[purge_start],
                end=timestamps.iloc[purge_end],
                start_idx=purge_start,
                end_idx=purge_end,
            ),
        ))
        i = purge_end + 1

    return pairs
```

- [ ] **Step 2: Add `build_full_cycles()` function**

Add this function right after `detect_capture_purge_windows()`. It pairs capture/purge windows with hydrogenation windows to produce full `Cycle` objects:

```python
def build_full_cycles(
    df: pd.DataFrame,
    *,
    catalyst_type: str = "CZA",
    co2_mfc_col: str | None = None,
    n2_rsp_col: str = "6#HighPN2 RSP",
    h2_rsp_col: str = "3#HighPH2 RSP",
    h2_pv_col: str = "3#HighPH2 PV",
    p_rsp_col: str = "Reactor P RSP",
    t_rsp_col: str = "Reactor T RSP",
    time_col: str = "Timestamp",
    **kwargs,
) -> list[Cycle]:
    """Detect full RCC cycles with Capture, Purge, and Hydrogenation windows.

    Parameters
    ----------
    catalyst_type : str
        "CZA" for pressure-swing hydrogenation (high-P + low-P),
        "ZA" for single atmospheric-pressure hydrogenation.
    co2_mfc_col : str, optional
        CO2 MFC column name for capture window confirmation.
    **kwargs
        Additional thresholds passed to detect_cycles() and
        detect_capture_purge_windows().
    """
    # Get hydrogenation windows from existing detect_cycles()
    hydro_cycles = detect_cycles(
        df,
        h2_rsp_col=h2_rsp_col,
        h2_pv_col=h2_pv_col,
        p_rsp_col=p_rsp_col,
        t_rsp_col=t_rsp_col,
        time_col=time_col,
    )

    # Get capture/purge windows
    cp_pairs = detect_capture_purge_windows(
        df,
        n2_rsp_col=n2_rsp_col,
        co2_mfc_col=co2_mfc_col,
        time_col=time_col,
    )

    # Pair each hydrogenation with the most recent capture/purge that ended
    # before it started.
    cycles: list[Cycle] = []
    for hc in hydro_cycles:
        # The hydrogenation start is the earliest window start
        if catalyst_type == "ZA":
            hydro_start_idx = hc.high_p.start_idx if hc.high_p else hc.low_p.start_idx
        else:
            hydro_start_idx = hc.high_p.start_idx if hc.high_p else hc.low_p.start_idx

        # Find matching capture/purge pair (most recent one ending before hydro starts)
        matched_cp: tuple[Window, Window] | None = None
        for cap, pur in reversed(cp_pairs):
            if pur.end_idx <= hydro_start_idx:
                matched_cp = (cap, pur)
                break

        if catalyst_type == "ZA":
            # Combine high_p + low_p into single hydrogenation window
            start_win = hc.high_p if hc.high_p else hc.low_p
            end_win = hc.low_p
            cycle = Cycle(
                cycle_id=hc.cycle_id,
                capture=matched_cp[0] if matched_cp else None,
                purge=matched_cp[1] if matched_cp else None,
                hydrogenation=Window(
                    label="hydro",
                    start=start_win.start,
                    end=end_win.end,
                    start_idx=start_win.start_idx,
                    end_idx=end_win.end_idx,
                ),
            )
        else:
            # CZA: keep high_p and low_p as separate hydrogenation sub-steps
            cycle = Cycle(
                cycle_id=hc.cycle_id,
                capture=matched_cp[0] if matched_cp else None,
                purge=matched_cp[1] if matched_cp else None,
                high_p_hydrogenation=hc.high_p,
                low_p_hydrogenation=hc.low_p,
            )
        cycles.append(cycle)

    return cycles
```

- [ ] **Step 3: Verify imports and syntax**

The file needs `import numpy as np` (already present) and the updated `Cycle` import. At the top of cycle_detection.py, the import line reads:
```python
from .models import Cycle, Window
```
This is already correct — no change needed.

Run: `~/miniforge3/envs/effi-env/bin/python -c "from backend.effi.cycle_detection import build_full_cycles, detect_capture_purge_windows; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/effi/cycle_detection.py
git commit -m "feat: add Capture/Purge detection and full-cycle composition

detect_capture_purge_windows() uses N2 RSP dip + optional CO2 MFC
confirmation to find Capture and Purge windows. build_full_cycles()
pairs these with existing hydrogenation detection to produce complete
Cycle objects with all step windows.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Update Integration for Multi-Step Cycles

**Files:**
- Modify: `backend/effi/integration.py`

- [ ] **Step 1: Rewrite `analyze_experiment()` to handle all step windows**

Replace the `analyze_experiment` function (lines 69-101) with:

```python
def analyze_experiment(
    df: pd.DataFrame,
    cycles: list[Cycle],
    species_cols: list[str] | None = None,
    catalyst_type: str = "CZA",
) -> dict[str, pd.DataFrame]:
    """Integrate all species for every step window of every cycle.

    Returns a dict of DataFrames keyed by step name. Each DataFrame has columns:
    ``cycle_id | species | unit | area``

    For CZA: keys are "capture", "purge", "high_p_hydrogenation", "low_p_hydrogenation".
    For ZA: keys are "capture", "purge", "hydrogenation".
    """
    if species_cols is None:
        species_cols = [c for c in NATIVE_SPECIES if c in df.columns]

    # Define which step fields to integrate based on catalyst type
    if catalyst_type == "ZA":
        step_fields = [
            ("capture", "capture"),
            ("purge", "purge"),
            ("hydrogenation", "hydrogenation"),
        ]
    else:
        step_fields = [
            ("capture", "capture"),
            ("purge", "purge"),
            ("high_p_hydrogenation", "high_p_hydrogenation"),
            ("low_p_hydrogenation", "low_p_hydrogenation"),
        ]

    result: dict[str, pd.DataFrame] = {}
    for step_name, attr_name in step_fields:
        rows = []
        for cycle in cycles:
            window = getattr(cycle, attr_name, None)
            if window is not None:
                areas = integrate_species(df, window, species_cols)
            else:
                areas = {col: float("nan") for col in species_cols}

            for col in species_cols:
                rows.append({
                    "cycle_id": cycle.cycle_id,
                    "species": col.removesuffix(" (%)"),
                    "unit": "%·s",
                    "area": areas[col],
                })
        result[step_name] = pd.DataFrame(rows)

    return result
```

- [ ] **Step 2: Verify syntax**

Run: `~/miniforge3/envs/effi-env/bin/python -c "from backend.effi.integration import analyze_experiment; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/effi/integration.py
git commit -m "feat: integrate all cycle steps (capture, purge, hydrogenation)

analyze_experiment() now returns a dict of DataFrames keyed by step
name, supporting both ZA (single hydrogenation) and CZA (high-P +
low-P hydrogenation) catalyst types.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Update the API Layer

**Files:**
- Modify: `backend/effi/api.py`

This task updates the FastAPI endpoints to support the new cycle model, catalyst type selection, CO2 MFC column selection, and multi-step integration results.

- [ ] **Step 1: Update imports and AppState**

At the top of api.py, change the import line (line 16):
```python
from .cycle_detection import detect_cycles, detect_cycles_reaction_mode
```
to:
```python
from .cycle_detection import build_full_cycles
```

Update `AppState` (lines 27-32):
```python
@dataclass
class AppState:
    df: pd.DataFrame | None = None
    cycles: list[Cycle] = field(default_factory=list)
    results: dict[str, pd.DataFrame] = field(default_factory=dict)
    reactant_bases: list[str] = field(default_factory=list)
    catalyst_type: str = "CZA"
```

- [ ] **Step 2: Update LoadRequest and load endpoint**

Replace `LoadRequest` (lines 112-117):
```python
class LoadRequest(BaseModel):
    reactor_files: list[str]
    ir_file: str
    oxygen_file: str | None = None
    offset_hours: float = 0.0
    catalyst_type: str = "CZA"  # "CZA" or "ZA"
    co2_mfc_col: str | None = None  # e.g. "5#10%CO2 RSP"
```

Replace the `load_experiment_endpoint` function (lines 120-158):
```python
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
    state.catalyst_type = req.catalyst_type
    state.cycles = build_full_cycles(
        state.df,
        catalyst_type=req.catalyst_type,
        co2_mfc_col=req.co2_mfc_col,
    )
    state.results = analyze_experiment(state.df, state.cycles, catalyst_type=req.catalyst_type)

    # Auto-discover reactant base names
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
        "catalyst_type": state.catalyst_type,
        "time_range": {
            "start": state.df["Timestamp"].min().isoformat(),
            "end": state.df["Timestamp"].max().isoformat(),
        },
    }
```

- [ ] **Step 3: Update `_cycle_summary()` and cycle endpoints**

Replace `_cycle_summary` (lines 166-181):
```python
def _window_dict(w: Window | None) -> dict | None:
    if w is None:
        return None
    return {
        "label": w.label,
        "start": w.start.isoformat(),
        "end": w.end.isoformat(),
        "start_idx": w.start_idx,
        "end_idx": w.end_idx,
    }


def _cycle_summary(c: Cycle) -> dict:
    return {
        "cycle_id": c.cycle_id,
        "capture": _window_dict(c.capture),
        "purge": _window_dict(c.purge),
        "high_p_hydrogenation": _window_dict(c.high_p_hydrogenation),
        "low_p_hydrogenation": _window_dict(c.low_p_hydrogenation),
        "hydrogenation": _window_dict(c.hydrogenation),
    }
```

Replace the `get_cycle` endpoint (lines 195-213):
```python
@app.get("/cycles/{cycle_id}")
def get_cycle(cycle_id: int):
    _require_loaded()
    cycle = next((c for c in state.cycles if c.cycle_id == cycle_id), None)
    if cycle is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found")

    # Integration results for this cycle, organized by step
    integration = {}
    for step_name, step_df in state.results.items():
        cycle_rows = step_df[step_df["cycle_id"] == cycle_id]
        rows = cycle_rows[["species", "unit", "area"]].to_dict(orient="records")
        for row in rows:
            for k, v in row.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    row[k] = None
        integration[step_name] = rows

    return {
        **_cycle_summary(cycle),
        "integration": integration,
    }
```

- [ ] **Step 4: Update cycle data endpoint window logic**

In `get_cycle_data` (lines 221-263), update the window start/end calculation. Replace lines 230-233:
```python
    pad = pd.Timedelta(minutes=pad_minutes)
    window_start = cycle.high_p.start if cycle.high_p is not None else cycle.low_p.start
    t_start = window_start - pad
    t_end = cycle.low_p.end + pad
```
with:
```python
    pad = pd.Timedelta(minutes=pad_minutes)
    # Find earliest and latest window timestamps across all steps
    all_windows = [w for w in (cycle.capture, cycle.purge, cycle.high_p_hydrogenation,
                               cycle.low_p_hydrogenation, cycle.hydrogenation) if w is not None]
    t_start = min(w.start for w in all_windows) - pad
    t_end = max(w.end for w in all_windows) + pad
```

- [ ] **Step 5: Update overview endpoint cycle markers**

In `get_overview` (lines 271-311), replace the cycle_markers block (lines 297-305):
```python
    cycle_markers = []
    for c in state.cycles:
        all_windows = [w for w in (c.capture, c.purge, c.high_p_hydrogenation,
                                   c.low_p_hydrogenation, c.hydrogenation) if w is not None]
        cycle_markers.append({
            "cycle_id": c.cycle_id,
            "start": min(w.start for w in all_windows).isoformat() if all_windows else None,
            "end": max(w.end for w in all_windows).isoformat() if all_windows else None,
            "capture": _window_dict(c.capture),
            "purge": _window_dict(c.purge),
        })
```

- [ ] **Step 6: Update Excel export**

Replace the `export_excel` function (lines 319-351):
```python
@app.get("/export/excel")
def export_excel():
    """Return an Excel workbook with a sheet per cycle step."""
    _require_loaded()
    if not state.results:
        raise HTTPException(status_code=400, detail="No integration results available.")

    import io
    from fastapi.responses import StreamingResponse

    SHEET_NAMES = {
        "capture": "Capture Integration (% s)",
        "purge": "Purge Integration (% s)",
        "high_p_hydrogenation": "High P Hydrogenation (% s)",
        "low_p_hydrogenation": "Low P Hydrogenation (% s)",
        "hydrogenation": "Hydrogenation (% s)",
    }

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for step_name, step_df in state.results.items():
            if step_df.empty:
                continue
            pivot = step_df.pivot(index="cycle_id", columns="species", values="area")
            pivot.index.name = "Cycle"
            sheet = SHEET_NAMES.get(step_name, step_name)
            pivot.to_excel(writer, sheet_name=sheet)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=integration_results.xlsx"},
    )
```

- [ ] **Step 7: Verify API compiles**

Run: `~/miniforge3/envs/effi-env/bin/python -c "from backend.effi.api import app; print('OK')"`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add backend/effi/api.py
git commit -m "feat: update API for multi-step cycles and catalyst type

- LoadRequest takes catalyst_type and co2_mfc_col instead of mode
- Cycle endpoints return named step windows (capture, purge, hydrogenation)
- Integration results organized by step name
- Excel export produces one sheet per step
- Overview markers span full cycle time range

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Update Frontend Types and API Client

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Update types and LoadRequest**

Replace the full contents of `frontend/src/api.ts`:

```typescript
const BASE = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadRequest {
  reactor_files: string[];
  ir_file: string;
  oxygen_file?: string;
  offset_hours?: number;
  catalyst_type?: "CZA" | "ZA";
  co2_mfc_col?: string;
}

export interface LoadResponse {
  rows: number;
  columns: number;
  column_names: string[];
  n_cycles: number;
  catalyst_type: string;
  time_range: { start: string; end: string };
}

export interface BrowseResponse {
  path: string;
  parent: string | null;
  dirs: string[];
  files: string[];
}

export interface DiscoverResponse {
  path: string;
  reactor_files: string[];
  ir_file: string | null;
  oxygen_file: string | null;
  all_txt: string[];
  all_csv: string[];
}

export interface WindowInfo {
  label: string;
  start: string;
  end: string;
  start_idx: number;
  end_idx: number;
}

export interface CycleSummary {
  cycle_id: number;
  capture: WindowInfo | null;
  purge: WindowInfo | null;
  high_p_hydrogenation: WindowInfo | null;
  low_p_hydrogenation: WindowInfo | null;
  hydrogenation: WindowInfo | null;
}

export interface IntegrationRow {
  species: string;
  unit: string;
  area: number | null;
}

export interface CycleDetail extends CycleSummary {
  integration: Record<string, IntegrationRow[]>;
}

export interface CycleDataResponse {
  cycle_id: number;
  columns: string[];
  data: (string | number | null)[][];
}

export interface CycleMarker {
  cycle_id: number;
  start: string | null;
  end: string | null;
  capture: WindowInfo | null;
  purge: WindowInfo | null;
}

export interface OverviewResponse {
  columns: string[];
  data: (string | number | null)[][];
  cycles: CycleMarker[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function loadExperiment(req: LoadRequest): Promise<LoadResponse> {
  return apiFetch("/experiment/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function browseDirectory(path = "."): Promise<BrowseResponse> {
  return apiFetch(`/browse?path=${encodeURIComponent(path)}`);
}

export function discoverFiles(path: string): Promise<DiscoverResponse> {
  return apiFetch(`/discover?path=${encodeURIComponent(path)}`);
}

export function listCycles(): Promise<{ cycles: CycleSummary[] }> {
  return apiFetch("/cycles");
}

export function getCycle(id: number): Promise<CycleDetail> {
  return apiFetch(`/cycles/${id}`);
}

export function getCycleData(
  id: number,
  padMinutes = 2
): Promise<CycleDataResponse> {
  return apiFetch(`/cycles/${id}/data?pad_minutes=${padMinutes}`);
}

export function getOverview(maxPoints = 2000): Promise<OverviewResponse> {
  return apiFetch(`/overview?max_points=${maxPoints}`);
}

export function downloadExcel(): void {
  window.open(`${BASE}/export/excel`, "_blank");
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: update frontend types for multi-step cycle model

Replace mode/high_p/low_p types with catalyst_type and named step
windows (capture, purge, hydrogenation variants). Integration results
keyed by step name.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Update FileSelector with Catalyst Type and CO2 MFC Picker

**Files:**
- Modify: `frontend/src/components/FileSelector.tsx`

- [ ] **Step 1: Replace mode selector with catalyst type + CO2 MFC selector**

Replace the `mode` state (line 82):
```typescript
  const [mode, setMode] = useState<"pressure_swing" | "reaction">("pressure_swing");
```
with:
```typescript
  const [catalystType, setCatalystType] = useState<"CZA" | "ZA">("CZA");
  const [co2MfcCol, setCo2MfcCol] = useState<string | null>(null);
```

In the `handleLoad` function, replace the `req` construction (lines 151-159):
```typescript
      const req: LoadRequest = {
        reactor_files: reactorFiles,
        ir_file: `${discovered.path}/${irFile}`,
        oxygen_file: oxygenFile
          ? `${discovered.path}/${oxygenFile}`
          : undefined,
        offset_hours: hh + mm / 60 + ss / 3600,
        catalyst_type: catalystType,
        co2_mfc_col: co2MfcCol ?? undefined,
      };
```

Replace the "Analysis Mode" section (lines 290-314) with:
```tsx
      {/* ── catalyst type ── */}
      <div style={{ marginBottom: 16 }}>
        <label>Catalyst Type</label>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              { value: "CZA", label: "CZA (Pressure Swing)" },
              { value: "ZA", label: "ZA (Atmospheric)" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              className={`role-btn${catalystType === opt.value ? " role-btn--active" : ""}`}
              style={
                catalystType === opt.value
                  ? { background: "#2563eb", borderColor: "#2563eb" }
                  : undefined
              }
              onClick={() => setCatalystType(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CO2 MFC column selector ── */}
      {loadResult == null && discovered && (
        <div style={{ marginBottom: 16 }}>
          <label>CO₂ MFC (for Capture detection)</label>
          <select
            value={co2MfcCol ?? ""}
            onChange={(e) => setCo2MfcCol(e.target.value || null)}
            className="select-input"
          >
            <option value="">Auto / None</option>
            {discovered.all_txt.length > 0 && reactorFiles.length > 0 && co2MfcOptions.map((col) => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
          <p className="hint-text">
            Select the MFC that flows CO₂ during the capture step.
            Options are populated after loading reactor files.
          </p>
        </div>
      )}
```

We also need to compute `co2MfcOptions` from the column names. Add this state and effect after the `discovered` state:
```typescript
  const [co2MfcOptions, setCo2MfcOptions] = useState<string[]>([]);
```

And update the `useEffect` that fires on `dataDir` change. After `setRoles(initRoles(d))`, add logic to detect potential CO2 MFC columns. However, since we don't have column names until we actually load reactor data, we should populate this list from the `LoadResponse.column_names` or from a new lightweight endpoint.

**Simpler approach**: since the MFC column names follow a pattern (`#...CO2 RSP`, `#...flueCO2 RSP`), list them as hardcoded common options plus any auto-discovered ones from the load response:
```typescript
  // Known CO2 MFC column names across experiments
  const co2MfcOptions = [
    "5#10%CO2 RSP",
    "4#CO2 RSP",
    "2#flueCO2 RSP",
  ];
```

This is a reasonable starting point. The user can see all options and pick the right one for their experiment.

- [ ] **Step 2: Update the `onLoaded` prop in App.tsx**

In `App.tsx`, replace the `mode` derivation (line 13):
```typescript
  const mode = loadResult?.mode ?? "pressure_swing";
```
with:
```typescript
  const catalystType = loadResult?.catalyst_type ?? "CZA";
```

Update the component props that pass `mode`:
- Line 30: `<OverviewPlot onCycleClick={setSelectedCycle} mode={mode} />` → `<OverviewPlot onCycleClick={setSelectedCycle} catalystType={catalystType} />`
- Line 37: `<CycleDetailView cycleId={selectedCycle} onExport={downloadExcel} mode={mode} />` → `<CycleDetailView cycleId={selectedCycle} onExport={downloadExcel} catalystType={catalystType} />`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FileSelector.tsx frontend/src/App.tsx
git commit -m "feat: catalyst type selector and CO2 MFC picker in FileSelector

Replace mode toggle with CZA/ZA catalyst type buttons. Add dropdown
for selecting the CO2 MFC column used in capture window detection.
Pass catalystType through component tree.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Update CycleDetailView for Multi-Step Windows

**Files:**
- Modify: `frontend/src/components/CycleDetailView.tsx`

- [ ] **Step 1: Update props and window rendering**

Change the `Props` interface:
```typescript
interface Props {
  cycleId: number;
  onExport?: () => void;
  catalystType?: string;
}
```

Update the component signature:
```typescript
export default function CycleDetailView({ cycleId, onExport, catalystType = "CZA" }: Props) {
```

Replace the `win1Label`/`win2Label` logic (lines 47-48) and window shading shapes (lines 122-147) and annotations (lines 149-172).

Build a `stepWindows` array from the detail object that drives all rendering:

```typescript
  // Collect all windows present on this cycle
  type StepWindow = { key: string; label: string; color: string; fillAlpha: number; info: WindowInfo };
  const stepWindows: StepWindow[] = [];
  if (detail.capture)
    stepWindows.push({ key: "capture", label: "Capture", color: "#10b981", fillAlpha: 0.2, info: detail.capture });
  if (detail.purge)
    stepWindows.push({ key: "purge", label: "Purge", color: "#8b5cf6", fillAlpha: 0.15, info: detail.purge });
  if (detail.high_p_hydrogenation)
    stepWindows.push({ key: "high_p_hydrogenation", label: "High P Hydro", color: "#0064ff", fillAlpha: 0.3, info: detail.high_p_hydrogenation });
  if (detail.low_p_hydrogenation)
    stepWindows.push({ key: "low_p_hydrogenation", label: "Low P Hydro", color: "#ff6400", fillAlpha: 0.15, info: detail.low_p_hydrogenation });
  if (detail.hydrogenation)
    stepWindows.push({ key: "hydrogenation", label: "Hydrogenation", color: "#0064ff", fillAlpha: 0.25, info: detail.hydrogenation });
```

Update the fill-under-curve loop (lines 79-110) to iterate over `stepWindows`:
```typescript
    // fill traces for each step window
    for (const sw of stepWindows) {
      const wStart = new Date(sw.info.start).getTime();
      const wEnd = new Date(sw.info.end).getTime();
      const wTs: string[] = [];
      const wVals: (number | null)[] = [];
      for (let j = 0; j < timestamps.length; j++) {
        const t = new Date(timestamps[j]).getTime();
        if (t >= wStart && t <= wEnd) {
          wTs.push(timestamps[j]);
          wVals.push(tsData.data[j][idx] as number);
        }
      }
      if (wTs.length > 0) {
        traces.push({
          x: wTs,
          y: wVals,
          mode: "lines",
          line: { width: 0 },
          fill: "tozeroy",
          fillcolor: `rgba(${r},${g},${b},${sw.fillAlpha})`,
          legendgroup: label,
          showlegend: false,
          hoverinfo: "skip",
          visible: isVis ? true : "legendonly",
        });
      }
    }
```

Update the shapes array (lines 122-147):
```typescript
  const shapes: Partial<Plotly.Shape>[] = stepWindows.map((sw) => ({
    type: "rect" as const,
    xref: "x" as const,
    yref: "paper" as const,
    x0: sw.info.start,
    x1: sw.info.end,
    y0: 0,
    y1: 1,
    fillcolor: sw.color.replace(")", ",0.06)").replace("rgb", "rgba").startsWith("rgba") ? sw.color.replace(")", ",0.06)") : `${sw.color}0F`,
    line: { width: 0 },
  }));
```

Simplify the shape fillcolor — since we're using hex colors:
```typescript
  function hexToRgba(hex: string, alpha: number): string {
    const [r, g, b] = parseColor(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  const shapes: Partial<Plotly.Shape>[] = stepWindows.map((sw) => ({
    type: "rect" as const,
    xref: "x" as const,
    yref: "paper" as const,
    x0: sw.info.start,
    x1: sw.info.end,
    y0: 0,
    y1: 1,
    fillcolor: hexToRgba(sw.color, 0.06),
    line: { width: 0 },
  }));

  const annotations: Partial<Plotly.Annotations>[] = stepWindows.map((sw) => ({
    x: sw.info.start,
    y: 1,
    xref: "x" as const,
    yref: "paper" as const,
    text: sw.label,
    showarrow: false,
    font: { size: 11, color: sw.color },
    yanchor: "bottom" as const,
  }));
```

- [ ] **Step 2: Update integration results table**

Replace the integration table (lines 210-250) with a multi-step table:

```tsx
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Species</th>
                <th className="text-left">Unit</th>
                {stepWindows.map((sw) => (
                  <th key={sw.key} className="text-right">{sw.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Get species list from first available step */}
              {(() => {
                const firstStep = stepWindows[0]?.key;
                const rows = firstStep ? (detail.integration[firstStep] ?? []) : [];
                return rows.map((row) => (
                  <tr
                    key={row.species}
                    onClick={() =>
                      setHighlighted((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.species)) next.delete(row.species);
                        else next.add(row.species);
                        return next;
                      })
                    }
                    className={highlighted.has(row.species) ? "row-highlighted" : ""}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{row.species}</td>
                    <td>{row.unit}</td>
                    {stepWindows.map((sw) => {
                      const stepRows = detail.integration[sw.key] ?? [];
                      const match = stepRows.find((r) => r.species === row.species);
                      const val = match?.area;
                      return (
                        <td key={sw.key} className="text-right">
                          {val != null ? val.toFixed(2) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CycleDetailView.tsx
git commit -m "feat: render all cycle step windows in CycleDetailView

Window shading, fill-under-curve, and integration table now adapt
dynamically to however many step windows are present on the cycle
(capture, purge, and 1-2 hydrogenation windows).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Update OverviewPlot for Multi-Step Markers

**Files:**
- Modify: `frontend/src/components/OverviewPlot.tsx`

- [ ] **Step 1: Update props and cycle markers**

Change the `Props` interface:
```typescript
interface Props {
  onCycleClick: (cycleId: number) => void;
  catalystType?: string;
}
```

Update the component signature to accept and destructure `catalystType` (even if unused for now):
```typescript
export default function OverviewPlot({ onCycleClick }: Props) {
```

Update the cycle marker shapes (lines 43-53) to use the new `start`/`end` fields:
```typescript
  const shapes: Partial<Plotly.Shape>[] = data.cycles.map((c) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: c.start ?? c.end,
    x1: c.end ?? c.start,
    y0: 0,
    y1: 1,
    fillcolor: "rgba(0,100,255,0.05)",
    line: { width: 0 },
  }));
```

Update annotations (lines 56-67):
```typescript
  const annotations: Partial<Plotly.Annotations>[] = data.cycles
    .filter((_, i) => i % 3 === 0)
    .map((c) => ({
      x: c.start,
      y: 1,
      xref: "x",
      yref: "paper",
      text: `${c.cycle_id}`,
      showarrow: false,
      font: { size: 9, color: "#666" },
      yanchor: "bottom",
    }));
```

Update the click handler (lines 90-106) to use new fields:
```typescript
        onClick={(event: Plotly.PlotMouseEvent) => {
          if (!event.points.length) return;
          const clickX = new Date(event.points[0].x as string).getTime();
          let bestCycle = data.cycles[0];
          let bestDist = Infinity;
          for (const c of data.cycles) {
            const s = c.start ? new Date(c.start).getTime() : 0;
            const e = c.end ? new Date(c.end).getTime() : s;
            const mid = (s + e) / 2;
            const dist = Math.abs(clickX - mid);
            if (dist < bestDist) {
              bestDist = dist;
              bestCycle = c;
            }
          }
          onCycleClick(bestCycle.cycle_id);
        }}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/OverviewPlot.tsx
git commit -m "feat: update OverviewPlot for new cycle marker format

Cycle markers use start/end fields that span the full cycle
(capture through hydrogenation). Click handler updated accordingly.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Build and Smoke Test

- [ ] **Step 1: Build the frontend**

```bash
cd "/Users/ccoatney/Library/CloudStorage/OneDrive-NREL/Effi Analysis/frontend"
npm run build
```

Expected: Build succeeds with no TypeScript errors. Fix any type errors that arise.

- [ ] **Step 2: Start the backend and verify it launches**

```bash
cd "/Users/ccoatney/Library/CloudStorage/OneDrive-NREL/Effi Analysis"
~/miniforge3/envs/effi-env/bin/python -m backend.effi.cli --no-browser &
```

Then test the API:
```bash
curl -s http://127.0.0.1:8000/discover?path=$(pwd)/251013_K-ZA_Cycles%201-20_good | python3 -m json.tool | head -20
```

Expected: JSON response with discovered files.

- [ ] **Step 3: Test loading a ZA experiment**

```bash
curl -s -X POST http://127.0.0.1:8000/experiment/load \
  -H "Content-Type: application/json" \
  -d '{
    "reactor_files": ["'"$(pwd)"'/251013_K-ZA_Cycles 1-20_good/ExportData_20251008163721_20251013164234.txt"],
    "ir_file": "'"$(pwd)"'/251013_K-ZA_Cycles 1-20_good/251013_Data_All.csv",
    "oxygen_file": "'"$(pwd)"'/251013_K-ZA_Cycles 1-20_good/251013_oxygen.csv",
    "catalyst_type": "ZA",
    "co2_mfc_col": "5#10%CO2 RSP"
  }' | python3 -m json.tool
```

Expected: JSON with `n_cycles > 0` and `catalyst_type: "ZA"`.

- [ ] **Step 4: Verify cycle detail returns all steps**

```bash
curl -s http://127.0.0.1:8000/cycles/1 | python3 -m json.tool | head -40
```

Expected: JSON with `capture`, `purge`, and `hydrogenation` fields (not null for at least one cycle).

- [ ] **Step 5: Verify Excel export**

```bash
curl -s -o /tmp/test_export.xlsx http://127.0.0.1:8000/export/excel
~/miniforge3/envs/effi-env/bin/python -c "
import openpyxl
wb = openpyxl.load_workbook('/tmp/test_export.xlsx')
print('Sheets:', wb.sheetnames)
"
```

Expected: Sheets include "Capture Integration (% s)", "Purge Integration (% s)", "Hydrogenation (% s)".

- [ ] **Step 6: Kill the server and commit any fixes**

```bash
kill %1  # stop background server
```

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: address smoke test issues

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Future Work (Not in Scope)

- **Blank subtraction**: Load blank experiment separately, integrate same windows, compute difference. Separate session.
- **Air MFC alignment**: Some cycles flow air during capture; air MFC signal aligns with CO2 capture step.
- **Auto-detect CO2 MFC**: Use a lightweight endpoint that reads reactor column headers before full data load.
- **Update `plotting.py`**: The notebook-oriented `plot_cycle()` still references `cycle.high_p`/`cycle.low_p`. Update if notebook usage continues.
