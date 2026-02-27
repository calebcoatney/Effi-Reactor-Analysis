# Effi Analysis — User Guide

This guide walks you through installing and using the Effi Reactor Cycle
Analysis tool. No programming experience is required — just follow the
steps below.

---

## 1. Install Miniconda

Miniconda is a lightweight Python installer. If you already have Anaconda or
Miniconda installed, skip to Step 2.

1. Visit **<https://www.anaconda.com/download/success>**
2. Download the installer for your operating system (macOS or Windows)
3. Run the installer and accept the defaults

When it finishes, open a **terminal** (macOS: Terminal.app / Windows:
Anaconda Prompt).

---

## 2. Create a Python Environment

In your terminal, run these two commands:

```
conda create -n effi-env python=3.13 -y
conda activate effi-env
```

> **What this does:** Creates an isolated Python 3.13 environment called
> `effi-env` so the tool's dependencies don't interfere with anything else
> on your computer. You'll need to run `conda activate effi-env` each time
> you open a new terminal before using the tool.

You should see `(effi-env)` at the beginning of your terminal prompt.

---

## 3. Install Effi Analysis

Navigate to the project folder and install:

```
cd path/to/Effi-Analysis
pip install .
```

Replace `path/to/Effi-Analysis` with the actual path where you downloaded
or cloned the project. For example:

```
cd ~/Documents/Effi-Analysis
pip install .
```

> **Tip:** You only need to run `pip install .` once (or again if the
> software is updated).

---

## 4. Launch the Application

```
effi-analysis
```

A browser window will automatically open to the application. If it doesn't,
open your browser and go to:

```
http://127.0.0.1:8000/app
```

To stop the application, press **Ctrl+C** in the terminal.

---

## 5. Using the Application

### Loading an Experiment

1. In the **Load Experiment** card, click **Browse** to navigate to your
   data directory
2. Select the folder containing your experiment files and click
   **Select This Directory**
3. The tool auto-detects which files are reactor data, IR data, and oxygen
   data. You can expand the file list to manually reassign roles if needed:
   - **Reactor** — reactor log files (typically `.txt`)
   - **IR** — infrared gas analyzer data (typically `.csv`)
   - **O₂** — oxygen sensor data (optional)
4. Set the **Time Offset** if your IR data timestamps need adjustment
   (hours : minutes : seconds)
5. Click **Load Experiment**

### Experiment Overview

After loading, you'll see a full-experiment plot showing all species
concentrations, reactant flows, and reactor conditions over time. Cycle
boundaries are shaded in light blue.

- **Toggle traces** by clicking items in the legend
- **Click on the plot** near a cycle to jump to its detail view

### Cycle Detail View

The cycle detail view shows a zoomed-in plot for a single cycle with
high-pressure (blue) and low-pressure (orange) windows highlighted.

- Use the **◀ Prev / Next ▶** buttons or the dropdown to navigate between
  cycles
- **Click a row** in the Integration Results table to highlight that species
  on the plot (showing its area under the curve). Click again to deselect.
  You can select multiple species at once.

### Exporting Results

Click **Export Results (.xlsx)** in the Integration Results section to
download an Excel workbook with high-P and low-P integration tables for all
cycles.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `effi-analysis` command not found | Make sure you ran `conda activate effi-env` first |
| Browser doesn't open | Manually go to `http://127.0.0.1:8000/app` |
| Port already in use | Use a different port: `effi-analysis --port 9000` |
| "No data loaded" errors | Make sure you loaded an experiment first |
| Files not detected correctly | Expand the file list and manually assign roles |

---

## Quick Reference

| Action | Command |
|---|---|
| Activate environment | `conda activate effi-env` |
| Launch the app | `effi-analysis` |
| Launch on a different port | `effi-analysis --port 9000` |
| Stop the app | **Ctrl+C** in the terminal |
| Update after a new version | `cd path/to/Effi-Analysis && pip install .` |
