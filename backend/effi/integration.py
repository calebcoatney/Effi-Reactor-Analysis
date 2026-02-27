"""Trapezoidal integration of IR species over cycle windows."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .models import Cycle, Window

# The 15 native IR species, all integrated in (%) units.
# For the 6 ppm-native species, data_loading auto-generates (%) columns
# by dividing by 10,000.
NATIVE_SPECIES = [
    "Acetaldehyde (%)",
    "Ethylene (%)",
    "Methane (%)",
    "Carbon Monoxide (%)",
    "Carbon Dioxide (%)",
    "Dimethyl Ether (%)",
    "Water (%)",
    "Methanol (%)",
    "Sulfur Dioxide (%)",
    "Ethanol (%)",
    "Formaldehyde (%)",
    "Ammonia (%)",
    "Nitric Oxide (%)",
    "Nitrogen Dioxide (%)",
    "Nitrous Oxide (%)",
]


def integrate_species(
    df: pd.DataFrame,
    window: Window,
    species_cols: list[str] | None = None,
    time_col: str = "Timestamp",
) -> dict[str, float]:
    """Integrate species concentrations over a time window using the trapezoidal rule.

    Parameters
    ----------
    df : DataFrame
        Merged DataFrame with species columns and *time_col*.
    window : Window
        Defines the slice of *df* to integrate over.
    species_cols : list of str, optional
        Columns to integrate. Defaults to :data:`NATIVE_SPECIES`.
    time_col : str
        Timestamp column name.

    Returns
    -------
    dict mapping species column name to integrated area (units: ``%·s``).
    """
    if species_cols is None:
        species_cols = [c for c in NATIVE_SPECIES if c in df.columns]

    sliced = df.iloc[window.start_idx : window.end_idx + 1]
    t_seconds = (sliced[time_col] - sliced[time_col].iloc[0]).dt.total_seconds().values

    results = {}
    for col in species_cols:
        y = sliced[col].values.astype(float)
        results[col] = float(np.trapezoid(y, t_seconds))

    return results


def analyze_experiment(
    df: pd.DataFrame,
    cycles: list[Cycle],
    species_cols: list[str] | None = None,
) -> pd.DataFrame:
    """Integrate all species for both windows of every cycle.

    Returns a tidy DataFrame with columns:
    ``cycle_id | species | unit | high_p_area | low_p_area``
    """
    if species_cols is None:
        species_cols = [c for c in NATIVE_SPECIES if c in df.columns]

    rows = []
    for cycle in cycles:
        hp = integrate_species(df, cycle.high_p, species_cols)
        lp = integrate_species(df, cycle.low_p, species_cols)

        for col in species_cols:
            species_name = col.removesuffix(" (%)")

            rows.append({
                "cycle_id": cycle.cycle_id,
                "species": species_name,
                "unit": "%·s",
                "high_p_area": hp[col],
                "low_p_area": lp[col],
            })

    return pd.DataFrame(rows)
