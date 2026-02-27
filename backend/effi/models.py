"""Data classes for cycle analysis."""

from dataclasses import dataclass

import pandas as pd


@dataclass
class Window:
    """A time window within a cycle (high-pressure or low-pressure)."""

    label: str  # "high_p" or "low_p"
    start: pd.Timestamp
    end: pd.Timestamp
    start_idx: int  # index into merged DataFrame
    end_idx: int


@dataclass
class Cycle:
    """One reactor cycle with its two integration windows."""

    cycle_id: int
    high_p: Window
    low_p: Window
