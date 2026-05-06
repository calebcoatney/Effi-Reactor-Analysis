# Effi Reactor Cycle Analysis

A web application for analyzing reactive carbon capture (RCC) experiments.
Load reactor, IR, and oxygen data files, visualize full experiment overviews,
view individual cycles in detail, and export integration results to Excel.

## Installation

### First time

1. Install Python if you don't have it. I recommend the [Miniconda](https://www.anaconda.com/download/success) distribution.
2. Open a terminal in your desired directory and clone the repository:
```bash
git clone https://github.com/calebcoatney/Effi-Reactor-Analysis.git
cd Effi-Reactor-Analysis
```
3. Create a fresh environment (optional but recommended):
```bash
conda create -n effi-env python=3.13 -y
conda activate effi-env
```
4. Install:
```bash
pip install .
```

### Updating

Open a terminal in the project directory and run:
```bash
git pull
pip install .
```

## Launching

```bash
effi-analysis
```

A browser window will open automatically at `http://127.0.0.1:8000/app`.

## Project Structure

```
├── backend/effi/          Python package (FastAPI API + analysis engine)
│   ├── api.py             REST API endpoints
│   ├── cli.py             `effi-analysis` entry point
│   ├── cycle_detection.py Reactor condition-based cycle detection
│   ├── data_loading.py    Reactor/IR/O₂ file parsing
│   ├── integration.py     Species integration (trapezoid)
│   ├── models.py          Data models (Window, Cycle)
│   ├── plotting.py        Plotly helpers (notebook use)
│   └── _static/           Pre-built frontend (served by the API)
├── frontend/              React + TypeScript + Vite UI
└── pyproject.toml         Package configuration
```

---
This project was developed at the [National Laboratory of the Rockies (NLR)](https://www.nlr.gov).
