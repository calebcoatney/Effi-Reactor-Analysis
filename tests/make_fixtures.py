"""Regenerate the cycle-detection regression fixtures.

Extracts, from each local experiment folder, just the columns that
``build_full_cycles`` reads, plus the expected cycle windows it currently
produces.  The raw data folders are gitignored (and ~68 MB per reactor file),
so these small slices are what the regression test actually runs against.

Run from the repo root, with the experiment folders present:

    ~/miniforge3/envs/effi-env/bin/python tests/make_fixtures.py

Only re-run this when the golden output is *intentionally* changing, and say
so in the commit message.
"""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.effi.cycle_detection import build_full_cycles  # noqa: E402
from backend.effi.data_loading import load_experiment  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"

# (folder, catalyst_type, offset_hours) -> fixture name
DATASETS = [
    ("250929_Blanks", "ZA", 0, "250929_blanks_za"),
    ("260121_CZA-flueCO2", "CZA", 0, "260121_cza_flueco2"),
    ("260209_10NaCZA_100 cycles", "CZA", 0, "260209_nacza_100cyc"),
    ("260717_NaCZA_Cond6", "CZA", 0, "260717_nacza_cond6"),
    ("260810_KZA_Cond0", "ZA", 0, "260810_kza_cond0"),
]

# Every column build_full_cycles touches: the detection signals plus each
# CO2 MFC candidate, so co2_mfc_col auto-detection behaves identically.
SIGNAL_COLS = [
    "Timestamp",
    "6#HighPN2 RSP",
    "3#HighPH2 RSP",
    "3#HighPH2 PV",
    "Reactor P RSP",
    "Reactor T RSP",
    "5#10%CO2 RSP",
    "4#CO2 RSP",
    "2#flueCO2 RSP",
    "2#pureCO2 RSP",
]


def window_dict(w):
    if w is None:
        return None
    return {
        "label": w.label,
        "start": w.start.isoformat(),
        "end": w.end.isoformat(),
        "start_idx": int(w.start_idx),
        "end_idx": int(w.end_idx),
    }


def main() -> None:
    FIXTURES.mkdir(exist_ok=True)
    index = []

    for folder, catalyst, offset_hours, name in DATASETS:
        reactor = sorted(glob.glob(f"{folder}/ExportData_*.txt"))
        ir = sorted(glob.glob(f"{folder}/*_Data_All.csv"))
        oxygen = sorted(glob.glob(f"{folder}/*_oxygen.csv"))
        if not reactor or not ir:
            print(f"SKIP {folder}: reactor={len(reactor)} ir={len(ir)}")
            continue

        df = load_experiment(
            reactor, ir[0], oxygen[0] if oxygen else None,
            offset=pd.Timedelta(hours=offset_hours),
        )
        cycles = build_full_cycles(df, catalyst_type=catalyst)

        cols = [c for c in SIGNAL_COLS if c in df.columns]
        slim = df[cols].copy()
        slim.to_csv(FIXTURES / f"{name}.csv.gz", index=False, compression="gzip")

        golden = {
            "name": name,
            "source_folder": folder,
            "catalyst_type": catalyst,
            "offset_hours": offset_hours,
            "n_rows": int(len(slim)),
            "columns": cols,
            "cycles": [
                {
                    "cycle_id": c.cycle_id,
                    "capture": window_dict(c.capture),
                    "purge": window_dict(c.purge),
                    "hydrogenation": window_dict(c.hydrogenation),
                    "high_p_hydrogenation": window_dict(c.high_p_hydrogenation),
                    "low_p_hydrogenation": window_dict(c.low_p_hydrogenation),
                }
                for c in cycles
            ],
        }
        (FIXTURES / f"{name}.golden.json").write_text(json.dumps(golden, indent=1))
        index.append(name)
        size_kb = (FIXTURES / f"{name}.csv.gz").stat().st_size / 1024
        print(f"{name:24s} rows={len(slim):6d} cycles={len(cycles):4d} fixture={size_kb:7.1f} KB")

    (FIXTURES / "index.json").write_text(json.dumps(sorted(index), indent=1))
    print(f"\nwrote {len(index)} fixtures to {FIXTURES}")


if __name__ == "__main__":
    main()
