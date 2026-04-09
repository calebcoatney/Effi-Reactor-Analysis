import glob
import os
from datetime import datetime

import pandas as pd


def load_effi_reactor_data(files: list[str]) -> pd.DataFrame:
    """Load and combine Effi reactor export files.

    Each filename encodes a start datetime (YYYYMMDDHHMMSS) which is combined
    with the per-row elapsed time to produce an absolute DateTime column.

    Parameters
    ----------
    files : list of str
        Paths to ExportData_*.txt files.

    Returns a DataFrame sorted by DateTime with DateTime and Elapsed Time as
    the first two columns.
    """

    dates = []
    for file in files:
        date_str = os.path.basename(file).split("_")[1]
        dates.append(datetime.strptime(date_str, "%Y%m%d%H%M%S"))

    dataframes = []
    for file, date in zip(files, dates):
        df = pd.read_csv(file, sep="\t")
        df["Elapsed Time"] = pd.to_timedelta(df.iloc[:, 0])
        df["DateTime"] = date + df["Elapsed Time"]
        dataframes.append(df)

    df = pd.concat(dataframes, ignore_index=True)
    df = df.drop(df.columns[0], axis=1)

    cols = df.columns.tolist()
    cols = ["DateTime", "Elapsed Time"] + [
        c for c in cols if c not in ("DateTime", "Elapsed Time")
    ]
    return (
        df[cols]
        .sort_values("DateTime")
        .drop_duplicates(subset="DateTime", keep="last")
        .reset_index(drop=True)
    )


def load_ir_data(filepath="260121_Data_All.csv") -> pd.DataFrame:
    """Load the IR species CSV.

    Handles the mixed-type Batch Number column (col 53) and parses Timestamp
    to datetime.
    """
    df = pd.read_csv(filepath, low_memory=False)
    if "Batch Number" in df.columns:
        df["Batch Number"] = df["Batch Number"].fillna("").astype(str)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")

    # Add a (%) column right after each (ppm) column for use in plot_species.
    for col in [c for c in df.columns if c.endswith(" (ppm)")]:
        species = col.removesuffix(" (ppm)")
        pct_col = f"{species} (%)"
        if pct_col not in df.columns:
            df.insert(df.columns.get_loc(col) + 1, pct_col, df[col] / 10_000)

    return df


def load_oxygen_data(filepath="260121_oxygen.csv") -> pd.DataFrame:
    """Load the oxygen analyzer CSV.

    Returns a two-column DataFrame with Timestamp and Oxygen (%).
    """
    df = pd.read_csv(filepath, header=None)
    df = df.dropna(axis=1, how="all")
    df["Timestamp"] = pd.to_datetime(
        df[0].astype(str) + " " + df[1].astype(str),
        format="%m/%d/%Y %I:%M:%S %p",
        errors="coerce",
    )
    df["Oxygen (%)"] = pd.to_numeric(df[3], errors="coerce")
    return (
        df[["Timestamp", "Oxygen (%)"]]
        .dropna(subset=["Timestamp"])
        .reset_index(drop=True)
    )


def merge_reactor_ir(
    reactor_df: pd.DataFrame,
    ir_df: pd.DataFrame,
    offset: pd.Timedelta | None = None,
    trim: bool = True,
    tolerance: str = "60s",
    smoothing: str | None = None,
) -> pd.DataFrame:
    """Merge reactor data into ir_df via nearest-prior-timestamp matching.

    Each IR row is matched to the most recent reactor reading within
    *tolerance*. No signal filtering or decimation is applied, preserving
    exact reactor values (zeros stay zero, STATUS flags stay 0/1).

    Parameters
    ----------
    reactor_df : DataFrame
        1-Hz reactor data with a 'DateTime' column.
    ir_df : DataFrame
        IR (+ O2) data with a 'Timestamp' column.
    offset : pd.Timedelta, optional
        Shift applied to reactor_df timestamps before merging. A positive
        value shifts reactor times forward (use when the reactor clock lags
        the IR clock).
    trim : bool
        If True (default), restrict the result to the time window where both
        sources have data, removing partially-overlapping rows at the edges.
    tolerance : str
        Maximum time gap for a valid match. IR rows with no reactor reading
        within this window get NaN in reactor columns. Default ``"60s"``.
    smoothing : str, optional
        If set (e.g. ``"25s"``), apply a centered rolling mean to numeric
        reactor columns before merging. STATUS columns (containing only 0/1)
        are excluded from smoothing.

    Returns
    -------
    DataFrame aligned to ir_df's Timestamp with reactor columns appended.
    The reactor 'DateTime' and 'Elapsed Time' columns are dropped.
    """
    # 1. Prepare reactor data — drop file-relative Elapsed Time, apply offset
    drop_cols = [c for c in ("Elapsed Time",) if c in reactor_df.columns]
    reactor = reactor_df.drop(columns=drop_cols).copy()
    if offset is not None:
        reactor["DateTime"] = reactor["DateTime"] + offset
    reactor = reactor.sort_values("DateTime")

    # 2. Optional smoothing (rolling mean), excluding binary STATUS columns
    if smoothing is not None:
        numeric_cols = reactor.select_dtypes(include="number").columns
        status_cols = [
            c for c in numeric_cols
            if reactor[c].dropna().isin([0, 1]).all()
        ]
        smooth_cols = [c for c in numeric_cols if c not in status_cols]
        reactor[smooth_cols] = (
            reactor[smooth_cols]
            .rolling(smoothing, on=reactor["DateTime"], center=True, min_periods=1)
            .mean()
        )

    # 3. merge_asof: backward (most recent reactor reading at or before IR ts)
    merged = pd.merge_asof(
        ir_df.sort_values("Timestamp"),
        reactor.sort_values("DateTime"),
        left_on="Timestamp",
        right_on="DateTime",
        direction="backward",
        tolerance=pd.Timedelta(tolerance),
    )
    merged = merged.drop(columns=["DateTime"])

    # 4. Optionally restrict to the overlapping time window
    if trim:
        start = max(ir_df["Timestamp"].min(), reactor["DateTime"].min())
        end = min(ir_df["Timestamp"].max(), reactor["DateTime"].max())
        merged = merged[
            (merged["Timestamp"] >= start) & (merged["Timestamp"] <= end)
        ]

    return merged.reset_index(drop=True)


def merge_oxygen_into_ir(
    ir_df: pd.DataFrame,
    oxygen_df: pd.DataFrame,
    tolerance: str = "1min",
) -> pd.DataFrame:
    """Nearest-timestamp join of oxygen data into the IR DataFrame.

    The Oxygen (%) column is inserted immediately before Batch Number.
    """
    merged = pd.merge_asof(
        ir_df.sort_values("Timestamp"),
        oxygen_df.sort_values("Timestamp"),
        on="Timestamp",
        direction="nearest",
        tolerance=pd.Timedelta(tolerance),
    )
    cols = merged.columns.tolist()
    oxy_col = cols.pop(cols.index("Oxygen (%)"))
    if "Batch Number" in cols:
        cols.insert(cols.index("Batch Number"), oxy_col)
    else:
        cols.append(oxy_col)
    return merged[cols]


def load_experiment(
    reactor_files: list[str],
    ir_file: str,
    oxygen_file: str | None = None,
    **merge_kwargs,
) -> pd.DataFrame:
    """Load all data sources and return a single merged DataFrame.

    Parameters
    ----------
    reactor_files : list of str
        Paths to ExportData_*.txt files.
    ir_file : str
        Path to the IR species CSV.
    oxygen_file : str, optional
        Path to the oxygen CSV. If None, oxygen data is not included.
    **merge_kwargs
        Passed to :func:`merge_reactor_ir` (e.g. ``offset``, ``tolerance``).

    Returns
    -------
    Merged DataFrame at IR cadence with reactor columns appended.
    """
    reactor_df = load_effi_reactor_data(reactor_files)
    ir_df = load_ir_data(ir_file)
    if oxygen_file is not None:
        oxygen_df = load_oxygen_data(oxygen_file)
        ir_df = merge_oxygen_into_ir(ir_df, oxygen_df)
    return merge_reactor_ir(reactor_df, ir_df, **merge_kwargs)
