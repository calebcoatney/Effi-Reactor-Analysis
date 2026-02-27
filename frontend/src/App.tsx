import { useState } from "react";
import type { LoadResponse } from "./api";
import { downloadExcel } from "./api";
import FileSelector from "./components/FileSelector";
import OverviewPlot from "./components/OverviewPlot";
import CycleNavigator from "./components/CycleNavigator";
import CycleDetailView from "./components/CycleDetailView";

function App() {
  const [loadResult, setLoadResult] = useState<LoadResponse | null>(null);
  const [selectedCycle, setSelectedCycle] = useState(1);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Effi Reactor Cycle Analysis</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        {loadResult
          ? `${loadResult.rows.toLocaleString()} rows · ${loadResult.n_cycles} cycles · ${loadResult.time_range.start.slice(0, 10)} to ${loadResult.time_range.end.slice(0, 10)}`
          : "Load an experiment to begin."}
      </p>

      <FileSelector onLoaded={(resp) => { setLoadResult(resp); setSelectedCycle(1); }} />

      {loadResult && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              onClick={downloadExcel}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                borderRadius: 4,
                border: "1px solid #059669",
                background: "#059669",
                color: "#fff",
              }}
            >
              📥 Export Integration Results (.xlsx)
            </button>
          </div>
          <OverviewPlot onCycleClick={setSelectedCycle} />
          <hr />
          <CycleNavigator
            cycleId={selectedCycle}
            totalCycles={loadResult.n_cycles}
            onChange={setSelectedCycle}
          />
          <CycleDetailView cycleId={selectedCycle} />
        </>
      )}
    </div>
  );
}

export default App;
