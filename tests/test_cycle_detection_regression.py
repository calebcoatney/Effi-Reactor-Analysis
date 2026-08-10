"""Regression tests locking down cycle detection across every known experiment.

Each fixture in ``tests/fixtures/`` is the merged signal frame from one real
experiment folder, paired with the exact cycle windows ``build_full_cycles``
produces for it.  Any change to the detection logic that shifts a window
boundary on a previously-working dataset fails here.

The fixtures hold real experimental traces, so they are gitignored and are not
part of this public repo.  Generate them locally, from a checkout that has the
experiment folders alongside it::

    ~/miniforge3/envs/effi-env/bin/python tests/make_fixtures.py

Without them the whole module skips, so a fresh clone still gets a green run.
Regenerate only when the golden output is *meant* to change.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from backend.effi.cycle_detection import (
    build_full_cycles,
    detect_capture_purge_co2,
    detect_capture_purge_cza,
    detect_capture_purge_windows,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CO2_CANDIDATES = ["5#10%CO2 RSP", "4#CO2 RSP", "2#flueCO2 RSP", "2#pureCO2 RSP"]


def fixture_names() -> list[str]:
    index = FIXTURES / "index.json"
    return json.loads(index.read_text()) if index.exists() else []


def load_fixture(name: str) -> tuple[pd.DataFrame, dict]:
    golden = json.loads((FIXTURES / f"{name}.golden.json").read_text())
    df = pd.read_csv(FIXTURES / f"{name}.csv.gz", parse_dates=["Timestamp"])
    return df, golden


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


def detected_co2_col(df: pd.DataFrame) -> str | None:
    """Mirror the auto-detection in build_full_cycles."""
    for cand in CO2_CANDIDATES:
        if cand in df.columns and (df[cand].fillna(0).abs() > 0.5).any():
            return cand
    return None


pytestmark = pytest.mark.skipif(
    not fixture_names(), reason="fixtures missing; run tests/make_fixtures.py"
)


@pytest.mark.parametrize("name", fixture_names())
def test_cycle_windows_match_golden(name):
    """Every cycle window on every known dataset is unchanged."""
    df, golden = load_fixture(name)
    assert len(df) == golden["n_rows"]

    cycles = build_full_cycles(df, catalyst_type=golden["catalyst_type"])

    assert len(cycles) == len(golden["cycles"]), (
        f"{name}: cycle count changed "
        f"{len(golden['cycles'])} -> {len(cycles)}"
    )

    for actual, expected in zip(cycles, golden["cycles"]):
        got = {
            "cycle_id": actual.cycle_id,
            "capture": window_dict(actual.capture),
            "purge": window_dict(actual.purge),
            "hydrogenation": window_dict(actual.hydrogenation),
            "high_p_hydrogenation": window_dict(actual.high_p_hydrogenation),
            "low_p_hydrogenation": window_dict(actual.low_p_hydrogenation),
        }
        assert got == expected, f"{name}: cycle {expected['cycle_id']} changed"


@pytest.mark.parametrize("name", fixture_names())
def test_every_cycle_has_a_capture(name):
    """A detected cycle with no capture means capture/purge detection slipped."""
    df, golden = load_fixture(name)
    cycles = build_full_cycles(df, catalyst_type=golden["catalyst_type"])
    assert cycles, f"{name}: no cycles detected at all"
    missing = [c.cycle_id for c in cycles if c.capture is None]
    assert not missing, f"{name}: cycles without a capture window: {missing}"


# Which capture/purge strategy each dataset resolves to.  The fallback chain is
# ordered, and 260121/260717 would get *different* (wrong) pairs from the CO2
# strategy if it ever ran ahead of the CZA one — so pin the resolution.
EXPECTED_STRATEGY = {
    "250929_blanks_za": "n2_dip",
    "260121_cza_flueco2": "cza",
    "260209_nacza_100cyc": "n2_dip",
    "260717_nacza_cond6": "cza",
    "260810_kza_cond0": "co2",
}


@pytest.mark.parametrize("name", fixture_names())
def test_capture_purge_strategy_is_stable(name):
    """Pin which detector wins, so reordering the fallback chain fails loudly."""
    df, golden = load_fixture(name)
    co2_col = detected_co2_col(df)

    if detect_capture_purge_windows(df, co2_mfc_col=co2_col):
        strategy = "n2_dip"
    elif golden["catalyst_type"].upper() == "CZA" and detect_capture_purge_cza(
        df, co2_mfc_col=co2_col
    ):
        strategy = "cza"
    elif co2_col and detect_capture_purge_co2(df, co2_mfc_col=co2_col):
        strategy = "co2"
    else:
        strategy = "none"

    assert strategy == EXPECTED_STRATEGY[name]


def test_atmospheric_za_capture_is_co2_keyed():
    """Martha's 260810_KZA_Cond0: N2 never dips, so capture must key off CO2.

    The N2 setpoint steps 201.1 -> 193.5 sccm mid-capture, a 3.8% drop that
    sits under detect_capture_purge_windows' 5% n2_drop_frac, so the N2-dip
    detector finds nothing and every cycle used to be discarded as
    pretreatment.
    """
    df, golden = load_fixture("260810_kza_cond0")

    assert detect_capture_purge_windows(df, co2_mfc_col="2#pureCO2 RSP") == []

    pairs = detect_capture_purge_co2(df, co2_mfc_col="2#pureCO2 RSP")
    assert len(pairs) == 10

    for capture, purge in pairs:
        cap_min = (capture.end - capture.start).total_seconds() / 60
        purge_min = (purge.end - purge.start).total_seconds() / 60
        assert 49 <= cap_min <= 50, f"capture {cap_min:.1f} min"
        assert 14 <= purge_min <= 15, f"purge {purge_min:.1f} min"
        assert purge.start_idx > capture.end_idx

    cycles = build_full_cycles(df, catalyst_type="ZA")
    assert len(cycles) == 10
    assert [c.cycle_id for c in cycles] == list(range(1, 11))
    # The 12.7 h pretreatment hydrogenation has no preceding capture and is dropped.
    assert cycles[0].hydrogenation.start > pd.Timestamp("2026-08-06 06:00")
