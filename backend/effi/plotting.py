import pandas as pd
import plotly.graph_objects as go
import plotly.colors as pc

from .models import Cycle

# Plotly default color sequence
_COLORS = pc.qualitative.Plotly


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
    visible_species: list[str] | None = None,
    visible_reactants: list[str] | None = None,
    visible_conditions: list[str] | None = None,
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
    visible_species : list of str, optional
        Species names to show by default (rest become 'legendonly').
        Mutually exclusive with *hidden_species*.
    visible_reactants : list of str, optional
        Reactant column names (e.g. ``['3#HighPH2 PV']``) to show by default.
    visible_conditions : list of str, optional
        Condition column names (e.g. ``['Reactor T RSP']``) to show by default.

    Returns
    -------
    plotly Figure with species on the left y-axis, flows and conditions on
    two right y-axes.
    """
    hidden_sp = set(hidden_species or [])
    hidden_rx = set(hidden_reactants or [])
    hidden_cd = set(hidden_conditions or [])
    vis_sp = set(visible_species or [])
    vis_rx = set(visible_reactants or [])
    vis_cd = set(visible_conditions or [])

    def _species_vis(label: str):
        if vis_sp:
            return True if label in vis_sp else "legendonly"
        return "legendonly" if label in hidden_sp else True

    def _reactant_vis(col_name: str):
        if vis_rx:
            return True if col_name in vis_rx else "legendonly"
        base = col_name.rsplit(" ", 1)[0]
        return "legendonly" if base in hidden_rx else True

    def _condition_vis(col_name: str):
        if vis_cd:
            return True if col_name in vis_cd else "legendonly"
        base = col_name.rsplit(" ", 1)[0]
        return "legendonly" if base in hidden_cd else True

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
            legendgroup=label,
            visible=_species_vis(label),
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
                visible=_reactant_vis(col),
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
                visible=_condition_vis(col),
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


def plot_cycle(
    df: pd.DataFrame,
    cycle: Cycle,
    visible_species: list[str] | None = None,
    visible_reactants: list[str] | None = None,
    visible_conditions: list[str] | None = None,
    pad: str = "2min",
    time_col: str = "Timestamp",
    **merged_kwargs,
) -> go.Figure:
    """Plot a single cycle using the plot_merged layout with window shading.

    Default visible traces: Methanol, 3#HighPH2 PV, Reactor P RSP,
    Reactor T RSP. Shading under the curve of each visible species
    differentiates the high-P (darker) and low-P (lighter) windows.

    Parameters
    ----------
    df : DataFrame
        Full merged DataFrame.
    cycle : Cycle
        The cycle to plot.
    visible_species : list of str, optional
        Species names (without suffix) to show by default.
        Defaults to ``['Methanol']``.
    visible_reactants : list of str, optional
        Reactant column names to show by default.
        Defaults to ``['3#HighPH2 PV']``.
    visible_conditions : list of str, optional
        Condition column names to show by default.
        Defaults to ``['Reactor P RSP', 'Reactor T RSP']``.
    pad : str
        Time padding on each side of the cycle view (default ``'2min'``).
    time_col : str
        Timestamp column name.
    **merged_kwargs
        Extra keyword arguments forwarded to :func:`plot_merged`.
    """
    if visible_species is None:
        visible_species = ["Methanol"]
    if visible_reactants is None:
        visible_reactants = ["3#HighPH2 PV"]
    if visible_conditions is None:
        visible_conditions = ["Reactor P RSP", "Reactor T RSP"]

    # Slice to cycle time range with padding
    td = pd.Timedelta(pad)
    t_start = cycle.high_p.start - td
    t_end = cycle.low_p.end + td
    mask = (df[time_col] >= t_start) & (df[time_col] <= t_end)
    view = df.loc[mask].reset_index(drop=True)

    fig = plot_merged(
        view,
        time_col=time_col,
        visible_species=visible_species,
        visible_reactants=visible_reactants,
        visible_conditions=visible_conditions,
        **merged_kwargs,
    )

    # --- Window shading vrects ---
    fig.add_vrect(
        x0=cycle.high_p.start, x1=cycle.high_p.end,
        fillcolor="rgba(0,100,255,0.06)", line_width=0,
        annotation_text="High P", annotation_position="top left",
        annotation_font_color="#0064ff",
    )
    fig.add_vrect(
        x0=cycle.low_p.start, x1=cycle.low_p.end,
        fillcolor="rgba(255,100,0,0.06)", line_width=0,
        annotation_text="Low P", annotation_position="top left",
        annotation_font_color="#ff6400",
    )

    # --- Fill under species curves, split by window ---
    # For each visible species, add two filled traces (high-P and low-P)
    # grouped with the main trace so legend toggles them together.
    all_species_cols = [c for c in view.columns if c.endswith(" (%)")]
    vis_set = set(visible_species)

    for i, col in enumerate(all_species_cols):
        label = col.removesuffix(" (%)")
        color = _COLORS[i % len(_COLORS)]
        is_visible = label in vis_set

        for window, alpha in [(cycle.high_p, 0.3), (cycle.low_p, 0.15)]:
            w_mask = (view[time_col] >= window.start) & (view[time_col] <= window.end)
            w_slice = view.loc[w_mask]
            if w_slice.empty:
                continue

            r, g, b = _parse_color(color)
            fig.add_trace(go.Scatter(
                x=w_slice[time_col],
                y=w_slice[col],
                mode="lines",
                line=dict(width=0),
                fill="tozeroy",
                fillcolor=f"rgba({r},{g},{b},{alpha})",
                legendgroup=label,
                showlegend=False,
                hoverinfo="skip",
                visible=True if is_visible else "legendonly",
            ))

    fig.update_layout(
        title=f"Cycle {cycle.cycle_id}",
        height=550,
    )

    return fig


def _parse_color(color_str: str) -> tuple[int, int, int]:
    """Extract (r, g, b) ints from a hex (#RRGGBB) or rgb() color string."""
    s = color_str.strip()
    if s.startswith("#"):
        s = s.lstrip("#")
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    if s.startswith("rgb"):
        nums = s.split("(")[1].rstrip(")").split(",")
        return int(nums[0]), int(nums[1]), int(nums[2])
    return 100, 100, 100
