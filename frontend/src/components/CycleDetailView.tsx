import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import type { CycleDataResponse, CycleDetail } from "../api";
import { getCycle, getCycleData } from "../api";

interface Props {
  cycleId: number;
}

// Plotly default color sequence
const COLORS = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const DEFAULT_VISIBLE_SPECIES = new Set(["Methanol"]);
const DEFAULT_VISIBLE_REACTANTS = new Set(["3#HighPH2 PV"]);
const DEFAULT_VISIBLE_CONDITIONS = new Set(["Reactor P RSP", "Reactor T RSP"]);

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

  const timestamps = tsData.data.map((row) => row[0] as string);
  const colIdx = (name: string) => tsData.columns.indexOf(name);

  const speciesCols = tsData.columns.filter((c) => c.endsWith(" (%)"));
  const reactantCols = tsData.columns.filter((c) => c.startsWith("3#HighPH2"));
  const conditionBases = ["Reactor T", "Reactor P"];

  const traces: Plotly.Data[] = [];

  // --- Header helper ---
  const addHeader = (label: string) => {
    traces.push({
      x: [timestamps[0]],
      y: [null],
      mode: "lines",
      name: `<b>${label}</b>`,
      line: { color: "rgba(0,0,0,0)" },
      hoverinfo: "skip",
      showlegend: true,
    });
  };

  // --- Species (left axis) + fill-under-curve ---
  addHeader("Species");
  for (let i = 0; i < speciesCols.length; i++) {
    const col = speciesCols[i];
    const idx = colIdx(col);
    const label = col.replace(/ \(%\)$/, "");
    const color = COLORS[i % COLORS.length];
    const [r, g, b] = parseColor(color);
    const isVis = DEFAULT_VISIBLE_SPECIES.has(label) || highlighted === label;

    traces.push({
      x: timestamps,
      y: tsData.data.map((row) => row[idx] as number),
      mode: "lines",
      name: label,
      legendgroup: label,
      line: { color },
      visible: isVis ? true : "legendonly",
    });

    // Fill traces for high-P and low-P windows
    for (const [window, alpha] of [
      [detail.high_p, 0.3],
      [detail.low_p, 0.15],
    ] as const) {
      const wStart = new Date(window.start).getTime();
      const wEnd = new Date(window.end).getTime();
      const wTimestamps: string[] = [];
      const wValues: (number | null)[] = [];
      for (let j = 0; j < timestamps.length; j++) {
        const t = new Date(timestamps[j]).getTime();
        if (t >= wStart && t <= wEnd) {
          wTimestamps.push(timestamps[j]);
          wValues.push(tsData.data[j][idx] as number);
        }
      }
      if (wTimestamps.length > 0) {
        traces.push({
          x: wTimestamps,
          y: wValues,
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

  // --- Reactants (y2) ---
  addHeader("Reactants");
  for (const col of reactantCols) {
    const idx = colIdx(col);
    traces.push({
      x: timestamps,
      y: tsData.data.map((row) => row[idx] as number),
      mode: "lines",
      name: col,
      line: { dash: col.includes("RSP") ? "dash" : "solid" },
      yaxis: "y2",
      visible: DEFAULT_VISIBLE_REACTANTS.has(col) ? true : "legendonly",
    });
  }

  // --- Reactor Conditions (y3, y4) ---
  addHeader("Reactor Conditions");
  const conditionAxes: Record<string, string> = {};
  const axisTitles: Record<string, string> = {
    "Reactor T": "Temperature (°C)",
    "Reactor P": "Pressure (bar)",
  };
  conditionBases.forEach((base, i) => {
    conditionAxes[base] = `y${3 + i}`;
  });

  for (const base of conditionBases) {
    for (const [suffix, dash] of [["PV", "solid"], ["RSP", "dash"]] as const) {
      const col = `${base} ${suffix}`;
      const idx = colIdx(col);
      if (idx < 0) continue;
      traces.push({
        x: timestamps,
        y: tsData.data.map((row) => row[idx] as number),
        mode: "lines",
        name: col,
        line: { dash },
        yaxis: conditionAxes[base],
        visible: DEFAULT_VISIBLE_CONDITIONS.has(col) ? true : "legendonly",
      });
    }
  }

  // --- Window shading vrects ---
  const shapes: Partial<Plotly.Shape>[] = [
    {
      type: "rect", xref: "x", yref: "paper",
      x0: detail.high_p.start, x1: detail.high_p.end,
      y0: 0, y1: 1,
      fillcolor: "rgba(0,100,255,0.06)", line: { width: 0 },
    },
    {
      type: "rect", xref: "x", yref: "paper",
      x0: detail.low_p.start, x1: detail.low_p.end,
      y0: 0, y1: 1,
      fillcolor: "rgba(255,100,0,0.06)", line: { width: 0 },
    },
  ];

  const annotations: Partial<Plotly.Annotations>[] = [
    {
      x: detail.high_p.start, y: 1, xref: "x", yref: "paper",
      text: "High P", showarrow: false,
      font: { size: 11, color: "#0064ff" }, yanchor: "bottom",
    },
    {
      x: detail.low_p.start, y: 1, xref: "x", yref: "paper",
      text: "Low P", showarrow: false,
      font: { size: 11, color: "#ff6400" }, yanchor: "bottom",
    },
  ];

  // Multi-axis layout matching plot_merged
  const domainEnd = 1.0 - (1 + conditionBases.length) * 0.06;

  return (
    <div>
      <h3>Cycle {cycleId} Detail</h3>
      <Plot
        data={traces}
        layout={{
          height: 550,
          margin: { t: 30, b: 50, l: 60, r: 120 },
          hovermode: "x unified",
          xaxis: { domain: [0, domainEnd] },
          yaxis: { title: { text: "Concentration (%)" } },
          yaxis2: {
            title: { text: "Flow (sccm)" },
            overlaying: "y",
            side: "right",
          },
          ...Object.fromEntries(
            conditionBases.map((base, i) => [
              `yaxis${3 + i}`,
              {
                title: { text: axisTitles[base] || base },
                overlaying: "y",
                side: "right",
                anchor: "free",
                position: domainEnd + 0.06 * (i + 1),
              },
            ])
          ),
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
