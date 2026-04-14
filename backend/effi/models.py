"""Data classes for cycle analysis."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd


@dataclass
class Window:
    """A time window within a cycle step."""

    label: str  # "capture", "purge", "high_p_hydro", "low_p_hydro", "hydro"
    start: pd.Timestamp
    end: pd.Timestamp
    start_idx: int
    end_idx: int


@dataclass
class Cycle:
    """One full RCC cycle with its analysis windows.

    All catalyst types have capture and purge windows.
    CZA has high_p_hydrogenation + low_p_hydrogenation.
    ZA has a single hydrogenation window.
    """

    cycle_id: int
    capture: Optional[Window] = None
    purge: Optional[Window] = None
    high_p_hydrogenation: Optional[Window] = None
    low_p_hydrogenation: Optional[Window] = None
    hydrogenation: Optional[Window] = None

    @property
    def hydro_windows(self) -> list[Window]:
        """Return the hydrogenation window(s) present on this cycle."""
        if self.hydrogenation is not None:
            return [self.hydrogenation]
        return [w for w in (self.high_p_hydrogenation, self.low_p_hydrogenation) if w is not None]
