"""Effi reactor cycle analysis tools."""

# Single source of the version: pyproject.toml reads it from here.  Bump it
# with every fix that ships, so the version the app shows tells you whether
# an install has picked the fix up.
__version__ = "0.2.0"

from .data_loading import (
    load_effi_reactor_data,
    load_ir_data,
    load_oxygen_data,
    load_experiment,
    merge_reactor_ir,
    merge_oxygen_into_ir,
)
from .models import Window, Cycle
from .cycle_detection import detect_cycles
from .integration import integrate_species, analyze_experiment
from .plotting import plot_cycle, plot_merged, plot_species
