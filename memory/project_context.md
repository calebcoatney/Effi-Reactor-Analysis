# Effi Reactor Experiment Context

## Experiment Overview

Researchers run catalytic reactor experiments consisting of multiple cycles. Each
cycle flows H2 at high temperature (~200 °C) and pressure (~30 bar) over a
catalyst (CZA — copper/zinc/alumina with 10% sodium, testing flue-CO2 feed) to
produce products such as methanol, ethanol, DME, etc.

Products are measured by IR spectroscopy at ~2-second cadence (~37K rows for a
multi-day run). The reactor system logs setpoints and process values at ~1 Hz.

## Data Files (260121 experiment)

- **ExportData_*.txt** (×4): Tab-separated reactor data with elapsed-time
  first column. Filename encodes start datetime.
- **260121_Data_All.csv**: IR species concentrations (15 species) + metadata.
- **260121_oxygen.csv**: Oxygen analyzer readings.

## IR Species (15 total)

Native % columns (9):
  Acetaldehyde, Ethylene, Methane, Carbon Monoxide, Carbon Dioxide,
  Dimethyl Ether, Water, Methanol, Sulfur Dioxide

Native ppm columns (6):
  Ethanol, Formaldehyde, Ammonia, Nitric Oxide, Nitrogen Dioxide, Nitrous Oxide

The data_loading module auto-generates (%) versions of ppm species for plotting.
For integration, use only the 15 native columns to avoid double-counting.

## Reactor Channels

MFC (mass flow controller) channels: 3#HighPH2, 4#CO2, 2#flueCO2, 1#ZeroAir,
7#ZeroAir, 5#10%CO2, 6#HighPN2. Each has PV, RSP, and TOT columns.

Temperature controllers: Hot box T, Condenser T, Outlet T, bubbler T,
Feed in T, Reactor T. Each has MVA, PV, RSP columns.

Pressure: Reactor P (MVA, PV, RSP), LIC01 (MVA, PV, RSP).

STATUS columns: HPLC pump, Reactor bypass, Cond. bypass, CO2 bypass, HB BLOW.

## Cycle Structure

Each cycle consists of:
1. H2 setpoint ramps up (3#HighPH2 RSP goes 0→94.9)
2. Temperature ramps to ~200 °C, pressure to ~30 bar
3. **High pressure window**: products formed under reaction conditions
4. Pressure setpoint drops → **Low pressure window** (desorption)
5. Temperature setpoint drops back to ~100 °C baseline
6. Repeat

The dataset contains ~37 cycles.
