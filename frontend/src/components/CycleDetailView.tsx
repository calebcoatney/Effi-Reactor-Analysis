import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import type { CycleDataResponse, CycleDetail } from "../api";
import { getCycle, getCycleData } from "../api";

interface Props {
  cycleId: number;
}

export default function CycleDetailView({ cycleId }: Props) {
  const [detail, setDetail] = useState<CycleDetail | null>(null);
  const [tsData, setTsData] = useState<CycleDataResponse | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setTsData(null);
    getCycle(cycleId).then(setDetail);
    getCycleData(cycleId).then(setTsData);
  }, [cycleId]);

  if (!detail || !tsData) return <p>Loading cycle {cycleId}…</p>;

  // Build traces
  const timestamps = tsData.data.map((row) => row[0] as string);
  const colIdx = (name: string) => tsData.columns.indexOf(name);

  const speciesCols = tsData.columns.filter(
    (c) => c.endsWith(" (%)") || c.endsWith(" (ppm)")
  );
  const conditionCols = tsData.columns.filter(
    (c) =>
      c.startsWith("Reactor P") ||
      c.startsWith("Reactor T") ||
      c.startsWith("3#HighPH2")
  );

  const traces: Plotly.Data[] = [];

  for (const col of speciesCols) {
    const idx = colIdx(col);
    const label = col.replace(/ \(%\)$/, "").replace(/ \(ppm\)$/, "");
    const isHighlighted = highlighted === label;
    traces.push({
      x: timestamps,
      y: tsData.data.map((row) => row[idx] as number),
      name: col,
      mode: "lines",
      visible:
        isHighlighted ||
        [
          "Methanol (%)",
          "Dimethyl Ether (%)",
          "Carbon Dioxide (%)",
        ].includes(col)
          ? true
          : "legendonly",
      line: isHighlighted ? { width: 3 } : undefined,
    });
  }

  for (const col of conditionCols) {
    const idx = colIdx(col);
    traces.push({
      x: timestamps,
      y: tsData.data.map((row) => row[idx] as number),
      name: col,
      mode: "lines",
      line: { dash: col.includes("RSP") ? "dash" : "solid" },
      yaxis: "y2",
      visible: col.includes("RSP") ? true : "legendonly",
    });
  }

  const shapes: Partial<Plotly.Shape>[] = [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: detail.high_p.start,
      x1: detail.high_p.end,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(0,100,255,0.1)",
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
      fillcolor: "rgba(255,100,0,0.1)",
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

  return (
    <div>
      <h3>Cycle {cycleId} Detail</h3>
      <Plot
        data={traces}
        layout={{
          height: 450,
          margin: { t: 30, b: 50, l: 60, r: 80 },
          hovermode: "x unified",
          xaxis: { title: { text: "Time" }, domain: [0, 0.88] },
          yaxis: { title: { text: "Concentration (% or ppm)" } },
          yaxis2: {
            title: { text: "RSP (°C / bar / sccm)" },
            overlaying: "y",
            side: "right",
          },
          shapes,
          annotations,
          legend: { orientation: "h", y: -0.2 },
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
