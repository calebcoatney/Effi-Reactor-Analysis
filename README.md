# Effi Reactor Cycle Analysis

A web application for analyzing pressure-swing reactor cycle experiments.
Load reactor, IR, and oxygen data files, visualize full experiment overviews,
drill into individual cycles, and export integration results to Excel.

## Quick Start
1. Install Python if you don't have it. I recommend the [Miniconda](https://www.anaconda.com/download/success) distribution.
2. Create a fresh environment (optional but recommended):
```bash
conda create -n effi-env python=3.13 -y
conda activate effi-env
```
3. Install (from the project root)
```
pip install .
```
4. Launch
```
effi-analysis
```

A browser window will open automatically at `http://127.0.0.1:8000/app`.

## Command-Line Options

```
effi-analysis --port 9000        # use a different port
effi-analysis --no-browser       # don't auto-open the browser
effi-analysis --host 0.0.0.0    # listen on all interfaces
```

## Analyzing a Blank Run

A blank run (no catalyst) produces reactor + IR + oxygen files identical in
structure to a sample run. To get cycle-by-cycle blank integrals for manual
subtraction:

1. Load the blank's reactor `ExportData_*.txt`, IR `*_Data_All.csv`, and
   `*_oxygen.csv` files into the app exactly like a sample experiment.
2. The app detects the same capture / purge / hydrogenation windows it would
   for a sample.
3. The integration table gives you per-cycle, per-species %·s values you can
   subtract from corresponding sample values in Excel (matching cycles to
   conditions by hand, as in `corrected sheet_Anh`).

Automated blank/sample pairing and subtraction is not yet implemented.

## Project Structure

```
├── backend/effi/          Python package (FastAPI API + analysis engine)
│   ├── api.py             REST API endpoints
│   ├── cli.py             `effi-analysis` entry point
│   ├── cycle_detection.py Pressure-based cycle detection
│   ├── data_loading.py    Reactor/IR/O₂ file parsing
│   ├── integration.py     Species integration (trapezoid)
│   ├── models.py          Data models (Window, Cycle)
│   ├── plotting.py        Plotly helpers (notebook use)
│   └── _static/           Pre-built frontend (served by the API)
├── frontend/              React + TypeScript + Vite UI
├── notebooks/             Jupyter exploration notebooks
└── pyproject.toml         Package configuration
```

---
This project was developed at the [National Laboratory of the Rockies (NLR)](https://www.nlr.gov).
