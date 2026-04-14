import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import type { CycleDataResponse, CycleDetail } from "../api";
import { getCycle, getCycleData } from "../api";
import {
  COLORS,
  parseColor,
  DEFAULT_VISIBLE,
  headerTrace,
  speciesCols,
  buildReactantTraces,
  buildConditionTraces,
  multiAxisLayout,
} from "../plotConfig";

interface Props {
  cycleId: number;
  onExport?: () => void;
  catalystType: string;
}

export default function CycleDetailView({ cycleId, onExport, catalystType }: Props) {
  // Note: catalystType will be used for mode-specific rendering in future updates
  catalystType; // suppress unused variable warning
  const [detail, setDetail] = useState<CycleDetail | null>(null);
  const [tsData, setTsData] = useState<CycleDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(
    () => new Set(DEFAULT_VISIBLE.species)
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCycle(cycleId), getCycleData(cycleId)]).then(([d, t]) => {
      if (!cancelled) {
        setDetail(d);
        setTsData(t);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  if (!detail || !tsData) return <p>Loading cycle {cycleId}…</p>;

  const timestamps = tsData.data.map((row) => row[0] as string);
  const colData = { columns: tsData.columns, data: tsData.data };
  const ts0 = timestamps[0];

  const sCols = speciesCols(colData);
  const traces: Plotly.Data[] = [];

  // ── Species + fill-under-curve ──
  traces.push(headerTrace("Species", ts0));

  for (let i = 0; i < sCols.length; i++) {
    const col = sCols[i];
    const idx = tsData.columns.indexOf(col);
    const label = col.replace(/ \(%\)$/, "");
    const color = COLORS[i % COLORS.length];
    const [r, g, b] = parseColor(color);
    const isVis = highlighted.has(label);

    // main line
    traces.push({
      x: timestamps,
      y: tsData.data.map((row) => row[idx] as number),
      mode: "lines",
      name: label,
      legendgroup: label,
      line: { color },
      visible: isVis ? true : "legendonly",
    });

    // fill traces for high-P and low-P windows
    for (const [window, alpha] of [
      [detail.high_p, 0.3],
      [detail.low_p, 0.15],
    ] as const) {
      const wStart = new Date(window.start).getTime();
      const wEnd = new Date(window.end).getTime();
      const wTs: string[] = [];
      const wVals: (number | null)[] = [];
      for (let j = 0; j < timestamps.length; j++) {
        const t = new Date(timestamps[j]).getTime();
        if (t >= wStart && t <= wEnd) {
          wTs.push(timestamps[j]);
          wVals.push(tsData.data[j][idx] as number);
        }
      }
      if (wTs.length > 0) {
        traces.push({
          x: wTs,
          y: wVals,
          mode: "lines",
          line: { width: 0 },
          fill: "tozeroy",
          fillcolor: `rgba(${r},${g},${b},${alpha})`,
          legendgroup: label,
          showlegend: false,
          hoverinfo: "skip",
          visible: isVis ? true : "legendonly",
        });
      }
    }
  }

  // ── Reactants (y2) ──
  traces.push(headerTrace("Reactants", ts0));
  traces.push(...buildReactantTraces(colData, timestamps));

  // ── Reactor Conditions (y3, y4) ──
  traces.push(headerTrace("Reactor Conditions", ts0));
  traces.push(...buildConditionTraces(colData, timestamps));

  // ── Window shading vrects ──
  const shapes: Partial<Plotly.Shape>[] = [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: detail.high_p.start,
      x1: detail.high_p.end,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(0,100,255,0.06)",
      line: { width: 0 },
    },
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: detail.low_p.start,
      x1: detail.low_p.end,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(255,100,0,0.06)",
      line: { width: 0 },
    },
  ];

  const annotations: Partial<Plotly.Annotations>[] = [
    {
      x: detail.high_p.start,
      y: 1,
      xref: "x",
      yref: "paper",
      text: "High P",
      showarrow: false,
      font: { size: 11, color: "#0064ff" },
      yanchor: "bottom",
    },
    {
      x: detail.low_p.start,
      y: 1,
      xref: "x",
      yref: "paper",
      text: "Low P",
      showarrow: false,
      font: { size: 11, color: "#ff6400" },
      yanchor: "bottom",
    },
  ];

  const { axes } = multiAxisLayout();

  return (
    <div style={{ minHeight: 700, position: "relative" }}>
      {loading && <div className="loading-badge">Updating…</div>}

      <div className="plot-section">
        <h3>Cycle {cycleId} Detail</h3>
        <Plot
          data={traces}
          layout={{
            height: 550,
            margin: { t: 30, b: 50, l: 60, r: 120 },
            hovermode: "x unified",
            ...axes,
            shapes,
            annotations,
            legend: { tracegroupgap: 0 },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            font: { family: "Inter, system-ui, sans-serif" },
          }}
          useResizeHandler
          style={{ width: "100%" }}
        />
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h4 style={{ margin: 0 }}>Integration Results</h4>
          {onExport && (
            <button className="btn btn-success btn-sm" onClick={onExport}>
              Export Results (.xlsx)
            </button>
          )}
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Species</th>
                <th className="text-left">Unit</th>
                <th className="text-right">High-P Area</th>
                <th className="text-right">Low-P Area</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.integration.map((row) => (
                <tr
                  key={row.species}
                  onClick={() =>
                    setHighlighted((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.species)) next.delete(row.species);
                      else next.add(row.species);
                      return next;
                    })
                  }
                  className={highlighted.has(row.species) ? "row-highlighted" : ""}
                  style={{ cursor: "pointer" }}
                >
                  <td>{row.species}</td>
                  <td>{row.unit}</td>
                  <td className="text-right">{row.high_p_area.toFixed(2)}</td>
                  <td className="text-right">{row.low_p_area.toFixed(2)}</td>
                  <td className="text-right font-semibold">
                    {(row.high_p_area + row.low_p_area).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
