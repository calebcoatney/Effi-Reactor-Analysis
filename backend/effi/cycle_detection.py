"""Detect reactor cycles from merged data using threshold comparisons."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .models import Cycle, Window


def detect_cycles(
    df: pd.DataFrame,
    *,
    h2_rsp_col: str = "3#HighPH2 RSP",
    h2_pv_col: str = "3#HighPH2 PV",
    p_rsp_col: str = "Reactor P RSP",
    t_rsp_col: str = "Reactor T RSP",
    h2_rsp_on: float = 50.0,
    h2_rsp_off: float = 1.0,
    h2_pv_on: float = 5.0,
    p_rsp_high: float = 5.0,
    p_rsp_low: float = 1.0,
    t_rsp_high: float = 150.0,
    t_rsp_low: float = 110.0,
    time_col: str = "Timestamp",
) -> list[Cycle]:
    """Detect cycles from the merged DataFrame.

    Algorithm
    ---------
    1. Find H2 ON/OFF transitions from ``h2_rsp_col``: ON when value crosses
       above ``h2_rsp_on``, OFF when it crosses below ``h2_rsp_off``.
       Each ON→OFF pair = one candidate cycle.

    2. Skip pretreatment: reject any ON→OFF pair where ``t_rsp_col`` never
       exceeds ``t_rsp_high`` (temperature never ramps to reaction conditions).

    3. High-pressure window for each cycle:
       - Start: first row where ``h2_pv_col > h2_pv_on`` (H2 actually flowing).
       - End: first row where ``p_rsp_col`` begins to decrease from its high
         plateau (first value below the plateau maximum minus a small margin).

    4. Low-pressure window for each cycle:
       - Start: same as high-P window end (captures the ramp-down).
       - End: first row where ``t_rsp_col < t_rsp_low`` after it was
         ``> t_rsp_high`` (temperature setpoint drops back to baseline).

    Parameters
    ----------
    df : DataFrame
        Merged DataFrame at IR cadence.
    h2_rsp_col, h2_pv_col, p_rsp_col, t_rsp_col : str
        Column names for cycle detection signals.
    h2_rsp_on, h2_rsp_off : float
        Thresholds for H2 RSP on/off transitions.
    h2_pv_on : float
        Threshold for H2 PV confirming flow has started.
    p_rsp_high, p_rsp_low : float
        Thresholds for reactor pressure RSP transitions.
    t_rsp_high, t_rsp_low : float
        Thresholds for reactor temperature RSP transitions.
    time_col : str
        Timestamp column name.

    Returns
    -------
    list of Cycle
    """
    h2_rsp = df[h2_rsp_col].values
    h2_pv = df[h2_pv_col].values
    p_rsp = df[p_rsp_col].values
    t_rsp = df[t_rsp_col].values
    timestamps = df[time_col]

    # Step 1: find H2 ON→OFF transition pairs
    on_indices = []
    off_indices = []
    is_on = False
    for i in range(len(h2_rsp)):
        if not is_on and h2_rsp[i] > h2_rsp_on:
            on_indices.append(i)
            is_on = True
        elif is_on and h2_rsp[i] < h2_rsp_off:
            off_indices.append(i)
            is_on = False

    # If H2 was still on at end, drop the unpaired ON
    n_pairs = min(len(on_indices), len(off_indices))

    cycles = []
    cycle_num = 0
    for c in range(n_pairs):
        cycle_start = on_indices[c]
        cycle_end = off_indices[c]

        # Step 2: skip pretreatment — T RSP must exceed t_rsp_high at least
        # once during this H2-on period
        t_slice = t_rsp[cycle_start : cycle_end + 1]
        if not np.any(t_slice > t_rsp_high):
            continue

        # Step 3: High-P window
        hp_start = _first_where_above(h2_pv, h2_pv_on, cycle_start, cycle_end)
        if hp_start is None:
            continue  # skip malformed cycle

        # End of high-P: first row where P RSP starts dropping from its
        # plateau.  We detect this as the first decrease from the stable
        # high value (first value < plateau_max - small margin).
        hp_end = _first_ramp_down(p_rsp, p_rsp_high, hp_start, cycle_end)
        if hp_end is None:
            hp_end = cycle_end

        # Step 4: Low-P window — starts immediately when pressure begins
        # ramping down (same point as hp_end)
        lp_start = hp_end

        # End of low-P: first row where T RSP drops below t_rsp_low
        # after having been above t_rsp_high, searching past cycle_end
        # (temperature ramp-down can extend beyond H2 off)
        search_end = min(
            off_indices[c + 1] if c + 1 < n_pairs else len(df) - 1,
            len(df) - 1,
        )
        lp_end = _first_drop_below(t_rsp, t_rsp_high, t_rsp_low, lp_start, search_end)
        if lp_end is None:
            lp_end = cycle_end

        cycle_num += 1
        cycles.append(Cycle(
            cycle_id=cycle_num,
            high_p=Window(
                label="high_p",
                start=timestamps.iloc[hp_start],
                end=timestamps.iloc[hp_end],
                start_idx=hp_start,
                end_idx=hp_end,
            ),
            low_p=Window(
                label="low_p",
                start=timestamps.iloc[lp_start],
                end=timestamps.iloc[lp_end],
                start_idx=lp_start,
                end_idx=lp_end,
            ),
        ))

    return cycles


def _first_where_above(arr, threshold: float, start: int, end: int) -> int | None:
    """Return first index in [start, end] where arr[i] > threshold."""
    for i in range(start, end + 1):
        if arr[i] > threshold:
            return i
    return None


def _first_ramp_down(
    arr, high_threshold: float, start: int, end: int
) -> int | None:
    """Return first index where arr begins to decrease from a high plateau.

    Finds the stable plateau value (first sustained value > high_threshold),
    then returns the first index where the value drops below that plateau
    by more than a small margin (2 units).
    """
    plateau_val = None
    for i in range(start, end + 1):
        if arr[i] > high_threshold:
            if plateau_val is None:
                plateau_val = arr[i]
            else:
                # Track the plateau (take max in case it ramps up)
                plateau_val = max(plateau_val, arr[i])
        if plateau_val is not None and arr[i] < plateau_val - 2.0:
            return i
    return None


def _first_drop_below(
    arr, high_threshold: float, low_threshold: float, start: int, end: int
) -> int | None:
    """Return first index where arr drops below *low_threshold* after being above *high_threshold*."""
    was_high = False
    for i in range(start, end + 1):
        if arr[i] > high_threshold:
            was_high = True
        elif was_high and arr[i] < low_threshold:
            return i
    return None
