import pandas as pd
import plotly.graph_objects as go


def plot_species(
    df: pd.DataFrame,
    time_col: str = "Timestamp",
    species: list[str] | None = None,
    hidden: list[str] | None = None,
) -> go.Figure:
    """Plot species concentration columns (those ending in '(%)') over time.

    The Plotly legend is interactive by default:
      - Click a trace  → toggle it on/off
      - Double-click   → isolate that trace (hide all others)
      - Double-click again → restore all

    Parameters
    ----------
    df : DataFrame
        Must contain *time_col* and one or more columns ending in '(%)'.
    time_col : str
        Datetime column used as the x-axis (default 'Timestamp').
    species : list of str, optional
        Species names to include (without the ' (%)' suffix), e.g.
        ``['Carbon Dioxide', 'Methanol']``. If None, all species are plotted.
    hidden : list of str, optional
        Species to render as 'legendonly' — present in the legend but hidden
        by default. Useful for noisy or secondary species you want available
        without cluttering the initial view.

    Returns
    -------
    plotly Figure with one togglable trace per species.
    """
    all_species_cols = [c for c in df.columns if c.endswith("(%)")]

    if species is not None:
        wanted = set(species)
        species_cols = [c for c in all_species_cols if c.removesuffix(" (%)") in wanted]
    else:
        species_cols = all_species_cols

    fig = go.Figure()
    for col in species_cols:
        label = col.removesuffix(" (%)")
        fig.add_trace(
            go.Scatter(
                x=df[time_col],
                y=df[col],
                mode="lines",
                name=label,
                visible="legendonly",
            )
        )

    fig.update_layout(
        xaxis_title="Time",
        yaxis_title="Concentration (%)",
        legend_title="Species",
        hovermode="x unified",
    )

    return fig


def plot_merged(
    df: pd.DataFrame,
    time_col: str = "Timestamp",
    species: list[str] | None = None,
    reactants: list[str] | None = None,
    conditions: list[str] | None = None,
    hidden_species: list[str] | None = None,
    hidden_reactants: list[str] | None = None,
    hidden_conditions: list[str] | None = None,
) -> go.Figure:
    """Plot species (%), reactor flows (sccm), and reactor conditions on three axes.

    Axes:
      - Left  (y1): Species concentration columns ending in '(%)'.
      - Right (y2): Reactor flow PV/RSP (auto-detected MFC channels).
      - Right (y3): Reactor condition PV/RSP (default: Reactor T & Reactor P).

    PV is plotted as a solid line; RSP as a dashed line of the same colour.

    The Plotly legend is interactive:
      - Click a trace  → toggle it on/off
      - Double-click   → isolate that trace (hide all others)
      - Double-click again → restore all

    Parameters
    ----------
    df : DataFrame
        Merged reactor + IR DataFrame with a *time_col* column.
    time_col : str
        Datetime column used as the x-axis (default 'Timestamp').
    species : list of str, optional
        Species names to include (without the ' (%)' suffix). If None, all
        species columns are plotted.
    reactants : list of str, optional
        Reactor gas base names to include (e.g. ``['4#CO2', '2#flueCO2']``).
        If None, all auto-detected flow channels are plotted.
    conditions : list of str, optional
        Reactor condition base names to include (e.g. ``['Reactor T']``).
        Defaults to ``['Reactor T', 'Reactor P']``.
    hidden_species : list of str, optional
        Species to render as 'legendonly' by default.
    hidden_reactants : list of str, optional
        Reactant base names to render as 'legendonly' by default.
    hidden_conditions : list of str, optional
        Condition base names to render as 'legendonly' by default.

    Returns
    -------
    plotly Figure with species on the left y-axis, flows and conditions on
    two right y-axes.
    """
    hidden_sp = set(hidden_species or [])
    hidden_rx = set(hidden_reactants or [])
    hidden_cd = set(hidden_conditions or [])

    # --- Species columns (left axis) ---
    all_species_cols = [c for c in df.columns if c.endswith(" (%)")]
    if species is not None:
        wanted = set(species)
        species_cols = [c for c in all_species_cols if c.removesuffix(" (%)") in wanted]
    else:
        species_cols = all_species_cols

    # --- Reactant columns (right axis) ---
    # Auto-detect MFC channels: base names that have PV, RSP, *and* TOT columns.
    # This naturally excludes temperature controllers (have MVA, no TOT) and
    # the HPLC pump (has TOT but no RSP).
    if reactants is not None:
        reactant_names = list(reactants)
    else:
        tot_bases = {c.removesuffix(" TOT") for c in df.columns if c.endswith(" TOT")}
        reactant_names = [
            b for b in tot_bases
            if f"{b} PV" in df.columns and f"{b} RSP" in df.columns
        ]
        # Preserve original column order
        col_order = {c: i for i, c in enumerate(df.columns)}
        reactant_names.sort(key=lambda b: col_order.get(f"{b} PV", 0))

    def _header(label):
        """Invisible dummy trace used as a bold legend section divider."""
        return go.Scatter(
            x=[df[time_col].iloc[0]],
            y=[float("nan")],
            mode="lines",
            name=f"<b>{label}</b>",
            line=dict(color="rgba(0,0,0,0)"),
            hoverinfo="skip",
            showlegend=True,
        )

    fig = go.Figure()

    fig.add_trace(_header("Species"))
    for col in species_cols:
        label = col.removesuffix(" (%)")
        fig.add_trace(go.Scatter(
            x=df[time_col],
            y=df[col],
            mode="lines",
            name=label,
            visible="legendonly",
        ))

    fig.add_trace(_header("Reactants"))
    for name in reactant_names:
        for suffix, dash in [("PV", "solid"), ("RSP", "dash")]:
            col = f"{name} {suffix}"
            if col not in df.columns:
                continue
            fig.add_trace(go.Scatter(
                x=df[time_col],
                y=df[col],
                mode="lines",
                name=f"{name} {suffix}",
                line=dict(dash=dash),
                visible="legendonly",
                yaxis="y2",
            ))

    # --- Reactor conditions (third & fourth axes) ---
    condition_names = conditions if conditions is not None else ["Reactor T", "Reactor P"]

    # Map each condition base name to its own y-axis, starting at y3.
    condition_axes = {}
    axis_titles = {"Reactor T": "Temperature (°C)", "Reactor P": "Pressure (bar)"}
    for i, name in enumerate(condition_names):
        axis_num = 3 + i
        condition_axes[name] = f"y{axis_num}"

    fig.add_trace(_header("Reactor Conditions"))
    for name in condition_names:
        for suffix, dash in [("PV", "solid"), ("RSP", "dash")]:
            col = f"{name} {suffix}"
            if col not in df.columns:
                continue
            fig.add_trace(go.Scatter(
                x=df[time_col],
                y=df[col],
                mode="lines",
                name=f"{name} {suffix}",
                line=dict(dash=dash),
                visible="legendonly",
                yaxis=condition_axes[name],
            ))

    # Build axis layout: y1 left, y2–yN stacked on the right.
    # Shrink x-domain to leave room for each right-side axis.
    right_axes_count = 1 + len(condition_names)  # y2 + one per condition
    domain_end = 1.0 - right_axes_count * 0.06
    axis_layout = dict(
        xaxis=dict(domain=[0, domain_end]),
        yaxis=dict(title="Concentration (%)"),
        yaxis2=dict(title="Flow (sccm)", overlaying="y", side="right"),
    )
    for i, name in enumerate(condition_names):
        axis_num = 3 + i
        axis_layout[f"yaxis{axis_num}"] = dict(
            title=axis_titles.get(name, name),
            overlaying="y",
            side="right",
            anchor="free",
            position=domain_end + 0.06 * (i + 1),
        )

    fig.update_layout(
        hovermode="x unified",
        legend=dict(tracegroupgap=0),
        **axis_layout,
    )

    return fig
