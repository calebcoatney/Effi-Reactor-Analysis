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
    <div className="app-container">
      <header className="app-header">
        <h1>Effi Reactor Cycle Analysis</h1>
        <p className="app-subtitle">
          {loadResult
            ? `${loadResult.rows.toLocaleString()} rows · ${loadResult.n_cycles} cycles · ${loadResult.time_range.start.slice(0, 10)} to ${loadResult.time_range.end.slice(0, 10)}`
            : "Load an experiment to begin."}
        </p>
      </header>

      <FileSelector onLoaded={(resp) => { setLoadResult(resp); setSelectedCycle(1); }} />

      {loadResult && (
        <>
          <OverviewPlot onCycleClick={setSelectedCycle} />
          <div className="section-divider" />
          <CycleNavigator
            cycleId={selectedCycle}
            totalCycles={loadResult.n_cycles}
            onChange={setSelectedCycle}
          />
          <CycleDetailView cycleId={selectedCycle} onExport={downloadExcel} />
        </>
      )}
    </div>
  );
}

export default App;
