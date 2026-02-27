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
}

export default function CycleDetailView({ cycleId }: Props) {
  const [detail, setDetail] = useState<CycleDetail | null>(null);
  const [tsData, setTsData] = useState<CycleDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

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
    const isVis =
      DEFAULT_VISIBLE.species.has(label) || highlighted === label;

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
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 12,
            color: "#888",
          }}
        >
          Updating…
        </div>
      )}
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
        }}
        useResizeHandler
        style={{ width: "100%" }}
      />

      <h4>Integration Results</h4>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #333" }}>
            <th style={{ textAlign: "left", padding: 4 }}>Species</th>
            <th style={{ textAlign: "left", padding: 4 }}>Unit</th>
            <th style={{ textAlign: "right", padding: 4 }}>High-P Area</th>
            <th style={{ textAlign: "right", padding: 4 }}>Low-P Area</th>
            <th style={{ textAlign: "right", padding: 4 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {detail.integration.map((row) => (
            <tr
              key={row.species}
              onClick={() =>
                setHighlighted(
                  highlighted === row.species ? null : row.species
                )
              }
              style={{
                cursor: "pointer",
                borderBottom: "1px solid #ddd",
                background:
                  highlighted === row.species ? "#e8f0fe" : undefined,
              }}
            >
              <td style={{ padding: 4 }}>{row.species}</td>
              <td style={{ padding: 4 }}>{row.unit}</td>
              <td style={{ textAlign: "right", padding: 4 }}>
                {row.high_p_area.toFixed(2)}
              </td>
              <td style={{ textAlign: "right", padding: 4 }}>
                {row.low_p_area.toFixed(2)}
              </td>
              <td style={{ textAlign: "right", padding: 4, fontWeight: 600 }}>
                {(row.high_p_area + row.low_p_area).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
