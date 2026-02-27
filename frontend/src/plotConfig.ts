/**
 * Shared Plotly configuration used by OverviewPlot and CycleDetailView.
 */

// Plotly default qualitative palette
export const COLORS = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];

export function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export const DEFAULT_VISIBLE = {
  species: new Set(["Methanol"]),
  reactants: new Set(["3#HighPH2 PV"]),
  conditions: new Set(["Reactor P RSP", "Reactor T RSP"]),
};

export const CONDITION_BASES = ["Reactor T", "Reactor P"] as const;

const AXIS_TITLES: Record<string, string> = {
  "Reactor T": "Temperature (°C)",
  "Reactor P": "Pressure (bar)",
};

// ---------------------------------------------------------------------------
// Columnar data helpers
// ---------------------------------------------------------------------------

export interface ColumnarData {
  columns: string[];
  data: (string | number | null)[][];
}

export function speciesCols(d: ColumnarData): string[] {
  return d.columns.filter((c) => c.endsWith(" (%)"));
}

export function reactantCols(d: ColumnarData): string[] {
  // Auto-discover reactant PV/RSP pairs via TOT columns (same as plot_merged)
  const colSet = new Set(d.columns);
  const bases = d.columns
    .filter((c) => c.endsWith(" TOT"))
    .map((c) => c.replace(/ TOT$/, ""))
    .filter((b) => colSet.has(`${b} PV`) && colSet.has(`${b} RSP`));
  const out: string[] = [];
  for (const b of bases) {
    out.push(`${b} PV`, `${b} RSP`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trace builders
// ---------------------------------------------------------------------------

/** Invisible trace that serves as a bold section header in the legend. */
export function headerTrace(label: string, ts0: string): Plotly.Data {
  return {
    x: [ts0],
    y: [null],
    mode: "lines",
    name: `<b>${label}</b>`,
    line: { color: "rgba(0,0,0,0)" },
    hoverinfo: "skip",
    showlegend: true,
  };
}

/** Build species line traces (yaxis y1). */
export function buildSpeciesTraces(
  d: ColumnarData,
  timestamps: string[],
  extra?: Set<string>,
): Plotly.Data[] {
  const cols = speciesCols(d);
  return cols.map((col, i) => {
    const idx = d.columns.indexOf(col);
    const label = col.replace(/ \(%\)$/, "");
    return {
      x: timestamps,
      y: d.data.map((r) => r[idx] as number),
      mode: "lines",
      name: label,
      legendgroup: label,
      line: { color: COLORS[i % COLORS.length] },
      visible:
        DEFAULT_VISIBLE.species.has(label) || extra?.has(label)
          ? true
          : ("legendonly" as const),
    } satisfies Plotly.Data;
  });
}

/** Build reactant line traces (yaxis y2). */
export function buildReactantTraces(
  d: ColumnarData,
  timestamps: string[],
): Plotly.Data[] {
  return reactantCols(d).map((col) => {
    const idx = d.columns.indexOf(col);
    return {
      x: timestamps,
      y: d.data.map((r) => r[idx] as number),
      mode: "lines",
      name: col,
      line: { dash: col.includes("RSP") ? ("dash" as const) : ("solid" as const) },
      yaxis: "y2",
      visible: DEFAULT_VISIBLE.reactants.has(col)
        ? true
        : ("legendonly" as const),
    } satisfies Plotly.Data;
  });
}

/** Build reactor-condition line traces (yaxis y3 = Temp, y4 = Pressure). */
export function buildConditionTraces(
  d: ColumnarData,
  timestamps: string[],
): Plotly.Data[] {
  const out: Plotly.Data[] = [];
  CONDITION_BASES.forEach((base, bi) => {
    for (const [suffix, dash] of [
      ["PV", "solid"],
      ["RSP", "dash"],
    ] as const) {
      const col = `${base} ${suffix}`;
      const idx = d.columns.indexOf(col);
      if (idx < 0) continue;
      out.push({
        x: timestamps,
        y: d.data.map((r) => r[idx] as number),
        mode: "lines",
        name: col,
        line: { dash: dash as Plotly.Dash },
        yaxis: `y${3 + bi}`,
        visible: DEFAULT_VISIBLE.conditions.has(col)
          ? true
          : ("legendonly" as const),
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Multi-axis layout
// ---------------------------------------------------------------------------

/**
 * Returns the shared multi-axis layout object.
 * y1 = Concentration (%), y2 = Flow (sccm), y3 = Temp (°C), y4 = Pressure (bar).
 */
export function multiAxisLayout() {
  const nExtra = CONDITION_BASES.length;
  const domainEnd = 1.0 - (1 + nExtra) * 0.06;

  const extra: Record<string, object> = {};
  CONDITION_BASES.forEach((base, i) => {
    extra[`yaxis${3 + i}`] = {
      title: { text: AXIS_TITLES[base] },
      overlaying: "y",
      side: "right",
      anchor: "free",
      position: domainEnd + 0.06 * (i + 1),
    };
  });

  return {
    domainEnd,
    axes: {
      xaxis: { domain: [0, domainEnd] },
      yaxis: { title: { text: "Concentration (%)" } },
      yaxis2: {
        title: { text: "Flow (sccm)" },
        overlaying: "y" as const,
        side: "right" as const,
      },
      ...extra,
    },
  };
}
