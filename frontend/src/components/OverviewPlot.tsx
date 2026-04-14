import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import type { OverviewResponse } from "../api";
import { getOverview } from "../api";
import {
  headerTrace,
  buildSpeciesTraces,
  buildReactantTraces,
  buildConditionTraces,
  multiAxisLayout,
} from "../plotConfig";

interface Props {
  onCycleClick: (cycleId: number) => void;
  catalystType: string;
}

export default function OverviewPlot({ onCycleClick, catalystType }: Props) {
  // Note: catalystType will be used for mode-specific rendering in future updates
  catalystType; // suppress unused variable warning
  const [data, setData] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    getOverview().then(setData);
  }, []);

  if (!data) return <p>Loading overview…</p>;

  const timestamps = data.data.map((row) => row[0] as string);
  const colData = { columns: data.columns, data: data.data };
  const ts0 = timestamps[0];

  const traces: Plotly.Data[] = [];

  traces.push(headerTrace("Species", ts0));
  traces.push(...buildSpeciesTraces(colData, timestamps));

  traces.push(headerTrace("Reactants", ts0));
  traces.push(...buildReactantTraces(colData, timestamps));

  traces.push(headerTrace("Reactor Conditions", ts0));
  traces.push(...buildConditionTraces(colData, timestamps));

  // Cycle marker shapes
  const shapes: Partial<Plotly.Shape>[] = data.cycles
    .filter((c) => c.start && c.end)
    .map((c) => ({
      type: "rect" as const,
      xref: "x" as const,
      yref: "paper" as const,
      x0: c.start!,
      x1: c.end!,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(0,100,255,0.05)",
      line: { width: 0 },
    }));

  // Cycle label annotations (every 3rd)
  const annotations: Partial<Plotly.Annotations>[] = data.cycles
    .filter((_, i) => i % 3 === 0)
    .filter((c) => c.start)
    .map((c) => ({
      x: c.start!,
      y: 1,
      xref: "x" as const,
      yref: "paper" as const,
      text: `${c.cycle_id}`,
      showarrow: false,
      font: { size: 9, color: "#666" },
      yanchor: "bottom" as const,
    }));

  const { axes } = multiAxisLayout();

  return (
    <div className="plot-section">
      <h3>Experiment Overview</h3>
      <Plot
        data={traces}
        layout={{
          height: 450,
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
        onClick={(event: Plotly.PlotMouseEvent) => {
          if (!event.points.length) return;
          const clickX = new Date(event.points[0].x as string).getTime();
          let bestCycle = data.cycles[0];
          let bestDist = Infinity;
          for (const c of data.cycles) {
            if (!c.start || !c.end) continue;
            const mid =
              (new Date(c.start).getTime() +
                new Date(c.end).getTime()) /
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
      <p className="plot-hint">
        Click on the plot near a cycle to view its detail.
      </p>
    </div>
  );
}
