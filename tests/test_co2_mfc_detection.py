"""CO2 MFC column auto-detection.

The rig's MFC slots get relabelled between campaigns, and each relabel used to
need a code change before capture detection worked again (2#pureCO2 in July,
5#flueCO2 in October).  These run without the real-data fixtures.
"""

from __future__ import annotations

import pandas as pd

from backend.effi.cycle_detection import (
    co2_mfc_columns,
    detect_co2_mfc_col,
    resolve_co2_mfc_col,
)


def test_unlisted_co2_mfc_is_a_candidate():
    cols = ["6#HighPN2 RSP", "4#CO2 RSP", "5#flueCO2 PV", "5#flueCO2 RSP", "5#flueCO2 TOT"]
    assert co2_mfc_columns(cols) == ["4#CO2 RSP", "5#flueCO2 RSP"]


def test_non_co2_channels_are_ignored():
    cols = ["5#dilNO RSP", "7#ZeroAir RSP", "Reactor P RSP", "CO2 (%)", "4#CO2 PV"]
    assert co2_mfc_columns(cols) == []


def test_known_names_keep_priority():
    cols = ["9#newCO2 RSP", "2#pureCO2 RSP", "5#10%CO2 RSP"]
    assert co2_mfc_columns(cols) == ["5#10%CO2 RSP", "2#pureCO2 RSP", "9#newCO2 RSP"]


def test_active_channel_is_picked_over_idle_known_ones():
    # October 2026 export: 4#CO2 and 2#pureCO2 are present but idle.
    df = pd.DataFrame({
        "4#CO2 RSP": [0.0, 0.0, 0.0],
        "2#pureCO2 RSP": [0.0, 0.0, 0.0],
        "5#flueCO2 RSP": [0.0, 90.0, 0.0],
    })
    assert detect_co2_mfc_col(df) == "5#flueCO2 RSP"


def test_no_active_channel_returns_none():
    df = pd.DataFrame({"4#CO2 RSP": [0.0, 0.2], "5#dilNO RSP": [0.0, 50.0]})
    assert detect_co2_mfc_col(df) is None


def test_missing_or_idle_pick_falls_back_to_auto():
    # A pick the file doesn't have used to raise KeyError; an idle one gave 0 cycles.
    df = pd.DataFrame({
        "4#CO2 RSP": [0.0, 0.0, 0.0],
        "5#flueCO2 RSP": [0.0, 90.0, 0.0],
    })
    assert resolve_co2_mfc_col(df, "2#flueCO2 RSP") == "5#flueCO2 RSP"
    assert resolve_co2_mfc_col(df, "4#CO2 RSP") == "5#flueCO2 RSP"
    assert resolve_co2_mfc_col(df, None) == "5#flueCO2 RSP"


def test_active_pick_is_kept():
    df = pd.DataFrame({"4#CO2 RSP": [0.0, 20.0], "5#flueCO2 RSP": [0.0, 90.0]})
    assert resolve_co2_mfc_col(df, "5#flueCO2 RSP") == "5#flueCO2 RSP"
