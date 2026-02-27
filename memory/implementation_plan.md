# Effi Reactor Cycle Analysis — Implementation Plan

## Context

Researchers run catalytic reactor experiments consisting of multiple cycles. Each
cycle flows H2 at high temperature and pressure to produce products (methanol,
ethanol, DME, etc.) measured by IR spectroscopy. They need to quantify products
by integrating IR species signals within two windows per cycle: a **high pressure**
window and a **low pressure** (desorption) window. This app automates the full
pipeline from raw data to tabulated integration results.

---

## Repository Structure

```
Effi Analysis/                            # git root
├── backend/
│   └── effi/                             # Python package
│       ├── __init__.py
│       ├── data_loading.py               # moved from 260121_CZA-flueCO2/
│       ├── plotting.py                   # moved from 260121_CZA-flueCO2/
│       ├── models.py                     # Window + Cycle dataclasses
│       ├── cycle_detection.py            # detect_cycles()
│       └── integration.py               # integrate_species(), analyze_experiment()
├── notebooks/
│   └── cycle_analysis.ipynb              # validation notebook
├── memory/
│   ├── project_context.md                # experiment description
│   └── implementation_plan.md            # this file
├── 260121_CZA-flueCO2/                   # raw data (git-ignored)
│   ├── ExportData_*.txt  (×4)
│   ├── 260121_Data_All.csv
│   ├── 260121_oxygen.csv
│   └── eda.ipynb
├── .gitignore
└── pyproject.toml
```

---

## Phase 1: Backend — COMPLETED

### 1. Repo Scaffolding ✅
- `git init` at `Effi Analysis/`
- `.gitignore`: excludes `__pycache__/`, `*.pyc`, `.DS_Store`, `*.xlsx`,
  `ExportData*.txt`, `260121_*.csv`, `.ipynb_checkpoints/`, `~$*`,
  `260121_CZA-flueCO2/`, `.claude/`
- `pyproject.toml`: minimal config with numpy, pandas, plotly dependencies
- Moved `data_loading.py` and `plotting.py` → `backend/effi/`
- Created `memory/project_context.md`

### 2. `data_loading.py` ✅
- `load_effi_reactor_data(files: list[str])` — takes explicit paths instead of glob
- `load_ir_data(filepath: str)` — loads IR CSV, parses Timestamp, auto-generates (%) columns for ppm species
- `load_oxygen_data(filepath: str)` — loads oxygen CSV
- `merge_reactor_ir(reactor_df, ir_df, offset, trim, tolerance, smoothing)` — nearest-backward merge at IR cadence
- `merge_oxygen_into_ir(ir_df, oxygen_df, tolerance)` — nearest merge
- `load_experiment(reactor_files, ir_file, oxygen_file, **merge_kwargs)` — convenience chain

### 3. `models.py` ✅
```python
@dataclass
class Window:
    label: str       # "high_p" or "low_p"
    start: pd.Timestamp
    end: pd.Timestamp
    start_idx: int   # index into merged DataFrame
    end_idx: int

@dataclass
class Cycle:
    cycle_id: int
    high_p: Window
    low_p: Window
```

### 4. `cycle_detection.py` ✅

Function: `detect_cycles(df, ...) -> list[Cycle]`

Algorithm:
1. Find H2 ON/OFF transitions from `3#HighPH2 RSP`:
   - ON when > 50, OFF when < 1. Each ON→OFF pair = one cycle.
2. High-P window:
   - **Start**: first row where `3#HighPH2 PV > 5.0` (H2 actually flowing)
   - **End**: first row where `Reactor P RSP < 1.0` after being `> 5.0`
3. Low-P window:
   - **Start**: same as high-P end
   - **End**: first row where `Reactor T RSP < 110` after being `> 150`

Thresholds (all configurable parameters):

| Column | "High" | "Low" | Why |
|--------|--------|-------|-----|
| `3#HighPH2 RSP` | > 50 | < 1 | Binary: 0 or 94.9 |
| `3#HighPH2 PV` | > 5.0 | — | Ramps up over ~90s |
| `Reactor P RSP` | > 5.0 | < 1.0 | Steps 0→30 in ~5 bar increments |
| `Reactor T RSP` | > 150 | < 110 | Ramps 100→200; baseline ~100 |

### 5. `integration.py` ✅

`integrate_species(df, window, species_cols, time_col) -> dict[str, float]`
- Slices `df.iloc[start_idx : end_idx + 1]`
- Converts Timestamp to seconds from window start
- Uses `numpy.trapezoid(y, x)` for each species
- Returns `{species_col: area}` in units of `% * s` or `ppm * s`

`analyze_experiment(df, cycles, species_cols) -> pd.DataFrame`
- Calls `integrate_species` for both windows of every cycle
- Returns tidy DataFrame: `cycle_id | species | unit | high_p_area | low_p_area`

15 native species integrated (9 in %, 6 in ppm — auto-generated % copies excluded):
- `%`: Acetaldehyde, Ethylene, Methane, Carbon Monoxide, Carbon Dioxide,
  Dimethyl Ether, Water, Methanol, Sulfur Dioxide
- `ppm`: Ethanol, Formaldehyde, Ammonia, Nitric Oxide, Nitrogen Dioxide, Nitrous Oxide

### 6. Validation Notebook ✅
`notebooks/cycle_analysis.ipynb`:
1. Load data via `load_experiment()` with `offset=pd.Timedelta("5h")`
2. Run `detect_cycles()`, print count + timestamps table
3. Run `analyze_experiment()`, display results
4. Plot 3 cycles (early, middle, late) with fill-between window shading + reactor RSP overlays
5. Sanity checks: negative areas, NaN counts, STATUS column uniqueness

---

## Phase 2: FastAPI Backend — PLANNED

REST API (single-user local use, in-memory state):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/experiment/load` | Load files, return merged df shape + column list |
| GET | `/cycles` | Return list of detected cycles with window timestamps |
| GET | `/cycles/{id}` | Return single cycle detail |
| GET | `/overview` | Return metadata for overview plot |

---

## Phase 3: React Frontend — PLANNED

Stack: Vite + React + TypeScript + Plotly.js

Components:
- **FileSelector** — pick reactor/IR/oxygen files
- **OverviewPlot** — full-experiment view with cycle markers
- **CycleNavigator** — previous/next cycle buttons
- **CycleDetailView** — fill-between plot + integration table
  - Row-click on table highlights corresponding species on plot

---

## Verification Checklist (Phase 1)

- [ ] Run `notebooks/cycle_analysis.ipynb` end-to-end (no errors)
- [ ] Confirm cycle count ~37
- [ ] Confirm no negative areas, no NaN in integration results
- [ ] Visually verify window boundaries on cycles 1, ~18, and last
- [ ] Confirm STATUS columns contain only {0, 1} values after pipeline
