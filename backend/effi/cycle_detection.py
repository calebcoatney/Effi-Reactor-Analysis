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
            high_p_hydrogenation=Window(
                label="high_p_hydro",
                start=timestamps.iloc[hp_start],
                end=timestamps.iloc[hp_end],
                start_idx=hp_start,
                end_idx=hp_end,
            ),
            low_p_hydrogenation=Window(
                label="low_p_hydro",
                start=timestamps.iloc[lp_start],
                end=timestamps.iloc[lp_end],
                start_idx=lp_start,
                end_idx=lp_end,
            ),
        ))

    return cycles


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
    """Detect capture and purge windows from N2 RSP patterns.
    
    Algorithm:
    1. Find N2 baseline: most common RSP value above the off threshold
    2. Scan for "dips" - when N2 drops below baseline * (1 - n2_drop_frac) 
       but stays above n2_off_threshold
    3. If co2_mfc_col provided, confirm CO2 is flowing during the dip
    4. Capture window: from dip start to when N2 recovers above threshold
    5. Purge window: from N2 recovery to when N2 goes below n2_off_threshold
    
    Parameters
    ----------
    df : DataFrame
        Merged DataFrame with N2 and CO2 signals
    n2_rsp_col : str
        Column name for N2 RSP signal
    co2_mfc_col : str | None
        Optional CO2 MFC column name for confirmation
    co2_mfc_on : float
        Threshold for CO2 flow confirmation
    n2_drop_frac : float
        Fraction drop from baseline to detect capture (default 0.10 = 10%)
    n2_off_threshold : float
        Threshold below which N2 is considered "off"
    time_col : str
        Timestamp column name
        
    Returns
    -------
    list of (capture_window, purge_window) tuples
    """
    n2_rsp = df[n2_rsp_col].values
    timestamps = df[time_col]
    
    # Step 1: Find N2 baseline (most common value above off threshold)
    n2_on_values = n2_rsp[n2_rsp > n2_off_threshold]
    if len(n2_on_values) == 0:
        return []
    
    # Round to nearest integer for grouping discrete setpoints
    n2_on_rounded = np.round(n2_on_values).astype(int)
    baseline = pd.Series(n2_on_rounded).mode().iloc[0]
    
    # Step 2: Scan for dips
    dip_threshold = baseline * (1 - n2_drop_frac)
    
    windows = []
    i = 0
    while i < len(n2_rsp):
        # Find start of dip
        if (n2_rsp[i] < dip_threshold and 
            n2_rsp[i] > n2_off_threshold):
            
            dip_start = i
            
            # Step 3: Optional CO2 confirmation during dip
            if co2_mfc_col is not None:
                co2_mfc = df[co2_mfc_col].iloc[dip_start]
                if co2_mfc < co2_mfc_on:
                    i += 1
                    continue
            
            # Find end of dip (recovery back above threshold)
            recovery_threshold = baseline * (1 - n2_drop_frac/2)  # Half-way back
            dip_end = None
            j = dip_start + 1
            while j < len(n2_rsp):
                if n2_rsp[j] > recovery_threshold:
                    dip_end = j
                    break
                j += 1
            
            if dip_end is None:
                break  # No recovery found
            
            # Step 4: Capture window (dip start to recovery)
            capture_window = Window(
                label="capture",
                start=timestamps.iloc[dip_start],
                end=timestamps.iloc[dip_end],
                start_idx=dip_start,
                end_idx=dip_end,
            )
            
            # Step 5: Purge window (recovery to N2 off)
            purge_start = dip_end
            purge_end = None
            j = purge_start + 1
            while j < len(n2_rsp):
                if n2_rsp[j] < n2_off_threshold:
                    purge_end = j
                    break
                j += 1
            
            if purge_end is None:
                purge_end = len(n2_rsp) - 1  # End of data
                
            purge_window = Window(
                label="purge",
                start=timestamps.iloc[purge_start],
                end=timestamps.iloc[purge_end],
                start_idx=purge_start,
                end_idx=purge_end,
            )
            
            windows.append((capture_window, purge_window))
            
            i = purge_end + 1
        else:
            i += 1
    
    return windows


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
) -> list[Cycle]:
    """Build full cycles pairing capture/purge with hydrogenation windows.
    
    Logic:
    1. Call detect_cycles() to get hydrogenation windows
    2. Call detect_capture_purge_windows() to get capture/purge pairs
    3. For each hydrogenation cycle, find the most recent capture/purge pair
       that ended before the hydrogenation started (purge.end_idx <= hydro_start_idx)
    4. For ZA catalyst: merge high_p_hydrogenation and low_p_hydrogenation into
       single hydrogenation window
    5. For CZA catalyst: keep separate high_p_hydrogenation and low_p_hydrogenation
    
    Parameters
    ----------
    df : DataFrame
        Merged DataFrame with all signals
    catalyst_type : str
        "ZA" or "CZA" - affects hydrogenation window handling
    co2_mfc_col : str | None
        CO2 MFC column for capture confirmation (passed to detect_capture_purge_windows)
    n2_rsp_col, h2_rsp_col, h2_pv_col, p_rsp_col, t_rsp_col : str
        Column names for cycle detection
    time_col : str
        Timestamp column name
        
    Returns
    -------
    list of Cycle
        Full cycles with capture, purge, and hydrogenation windows
    """
    # Step 1: Get hydrogenation windows
    hydro_cycles = detect_cycles(
        df,
        h2_rsp_col=h2_rsp_col,
        h2_pv_col=h2_pv_col,
        p_rsp_col=p_rsp_col,
        t_rsp_col=t_rsp_col,
        time_col=time_col,
    )
    
    # Step 2: Get capture/purge pairs
    capture_purge_pairs = detect_capture_purge_windows(
        df,
        n2_rsp_col=n2_rsp_col,
        co2_mfc_col=co2_mfc_col,
        time_col=time_col,
    )
    
    # Step 3: Pair capture/purge with hydrogenation
    # Greedy forward matching: each pair is consumed at most once.
    full_cycles = []
    available_pairs = list(capture_purge_pairs)
    
    for hydro_cycle in hydro_cycles:
        # Find hydrogenation start index
        if hydro_cycle.high_p_hydrogenation is not None:
            hydro_start_idx = hydro_cycle.high_p_hydrogenation.start_idx
        elif hydro_cycle.low_p_hydrogenation is not None:
            hydro_start_idx = hydro_cycle.low_p_hydrogenation.start_idx
        else:
            continue  # Skip malformed cycle
            
        # Find most recent *unconsumed* capture/purge pair that ended before hydro
        best_pair = None
        best_idx = -1
        best_purge_end = -1
        
        for pi, (capture_win, purge_win) in enumerate(available_pairs):
            if purge_win.end_idx <= hydro_start_idx and purge_win.end_idx > best_purge_end:
                best_pair = (capture_win, purge_win)
                best_idx = pi
                best_purge_end = purge_win.end_idx
        
        if best_idx >= 0:
            available_pairs.pop(best_idx)
        
        # Step 4: Handle catalyst-specific hydrogenation merging
        if catalyst_type.upper() == "ZA":
            # Merge high_p and low_p hydrogenation into single window
            high_p = hydro_cycle.high_p_hydrogenation
            low_p = hydro_cycle.low_p_hydrogenation
            
            if high_p is not None and low_p is not None:
                # Span from earliest start to latest end
                merged_start_idx = min(high_p.start_idx, low_p.start_idx)
                merged_end_idx = max(high_p.end_idx, low_p.end_idx)
                timestamps = df[time_col]
                
                hydrogenation_window = Window(
                    label="hydrogenation",
                    start=timestamps.iloc[merged_start_idx],
                    end=timestamps.iloc[merged_end_idx],
                    start_idx=merged_start_idx,
                    end_idx=merged_end_idx,
                )
            elif high_p is not None:
                hydrogenation_window = Window(
                    label="hydrogenation",
                    start=high_p.start,
                    end=high_p.end,
                    start_idx=high_p.start_idx,
                    end_idx=high_p.end_idx,
                )
            elif low_p is not None:
                hydrogenation_window = Window(
                    label="hydrogenation",
                    start=low_p.start,
                    end=low_p.end,
                    start_idx=low_p.start_idx,
                    end_idx=low_p.end_idx,
                )
            else:
                hydrogenation_window = None
                
            # Create cycle with merged hydrogenation
            cycle = Cycle(
                cycle_id=hydro_cycle.cycle_id,
                capture=best_pair[0] if best_pair else None,
                purge=best_pair[1] if best_pair else None,
                hydrogenation=hydrogenation_window,
            )
        else:
            # CZA: Keep separate high_p and low_p hydrogenation
            cycle = Cycle(
                cycle_id=hydro_cycle.cycle_id,
                capture=best_pair[0] if best_pair else None,
                purge=best_pair[1] if best_pair else None,
                high_p_hydrogenation=hydro_cycle.high_p_hydrogenation,
                low_p_hydrogenation=hydro_cycle.low_p_hydrogenation,
            )
            
        full_cycles.append(cycle)
    
    return full_cycles


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
