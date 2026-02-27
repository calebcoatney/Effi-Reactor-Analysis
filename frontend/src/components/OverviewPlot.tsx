import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import type { OverviewResponse } from "../api";
import { getOverview } from "../api";

interface Props {
  onCycleClick: (cycleId: number) => void;
}

export default function OverviewPlot({ onCycleClick }: Props) {
  const [data, setData] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    getOverview().then(setData);
  }, []);

  if (!data) return <p>Loading overview…</p>;

  const timestamps = data.data.map((row) => row[0] as string);
  const colIdx = (name: string) => data.columns.indexOf(name);

  const traces: Plotly.Data[] = [];

  // Reactor conditions
  for (const col of [
    "Reactor T PV",
    "Reactor T RSP",
    "Reactor P PV",
    "Reactor P RSP",
    "3#HighPH2 PV",
    "3#HighPH2 RSP",
  ]) {
    const idx = colIdx(col);
    if (idx < 0) continue;
    traces.push({
      x: timestamps,
      y: data.data.map((row) => row[idx] as number),
      name: col,
      mode: "lines",
      line: { dash: col.includes("RSP") ? "dash" : "solid" },
      yaxis: col.startsWith("Reactor T") ? "y2" : undefined,
      visible: col.includes("RSP") ? "legendonly" : true,
    });
  }

  // Key species
  for (const col of [
    "Methanol (%)",
    "Dimethyl Ether (%)",
    "Carbon Dioxide (%)",
    "Water (%)",
  ]) {
    const idx = colIdx(col);
    if (idx < 0) continue;
    traces.push({
      x: timestamps,
      y: data.data.map((row) => row[idx] as number),
      name: col,
      mode: "lines",
      yaxis: "y3",
      visible: "legendonly",
    });
  }

  // Cycle marker shapes
  const shapes: Partial<Plotly.Shape>[] = data.cycles.map((c) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: c.hp_start,
    x1: c.lp_end,
    y0: 0,
    y1: 1,
    fillcolor: "rgba(0,100,255,0.05)",
    line: { width: 0 },
  }));

  // Cycle label annotations
  const annotations: Partial<Plotly.Annotations>[] = data.cycles
    .filter((_, i) => i % 3 === 0)
    .map((c) => ({
      x: c.hp_start,
      y: 1,
      xref: "x",
      yref: "paper",
      text: `${c.cycle_id}`,
      showarrow: false,
      font: { size: 9, color: "#666" },
      yanchor: "bottom",
    }));

  return (
    <div>
      <h3>Experiment Overview</h3>
      <Plot
        data={traces}
        layout={{
          height: 400,
          margin: { t: 30, b: 50, l: 60, r: 120 },
          hovermode: "x unified",
          xaxis: { title: { text: "Time" }, domain: [0, 0.85] },
          yaxis: { title: { text: "Pressure (bar) / Flow (sccm)" } },
          yaxis2: {
            title: { text: "Temperature (°C)" },
            overlaying: "y",
            side: "right",
          },
          yaxis3: {
            title: { text: "Concentration (%)" },
            overlaying: "y",
            side: "right",
            anchor: "free",
            position: 0.92,
          },
          shapes,
          annotations,
          legend: { orientation: "h", y: -0.2 },
        }}
        useResizeHandler
        style={{ width: "100%" }}
        onClick={(event: Plotly.PlotMouseEvent) => {
          if (!event.points.length) return;
          const clickX = new Date(event.points[0].x as string).getTime();
          // Find nearest cycle
          let bestCycle = data.cycles[0];
          let bestDist = Infinity;
          for (const c of data.cycles) {
            const mid =
              (new Date(c.hp_start).getTime() +
                new Date(c.lp_end).getTime()) /
              2;
            const dist = Math.abs(clickX - mid);
            if (dist < bestDist) {
              bestDist = dist;
              bestCycle = c;
            }
          }
          onCycleClick(bestCycle.cycle_id);
        }}
      />
      <p style={{ fontSize: 12, color: "#888" }}>
        Click on the plot near a cycle to view its detail.
      </p>
    </div>
  );
}
