import { useEffect, useState } from "react";
import type { LoadResponse } from "./api";
import { downloadExcel, getVersion } from "./api";
import FileSelector from "./components/FileSelector";
import OverviewPlot from "./components/OverviewPlot";
import CycleNavigator from "./components/CycleNavigator";
import CycleDetailView from "./components/CycleDetailView";

function App() {
  const [loadResult, setLoadResult] = useState<LoadResponse | null>(null);
  const [selectedCycle, setSelectedCycle] = useState(1);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then((v) => setVersion(v.version)).catch(() => setVersion(null));
  }, []);

  const catalystType = loadResult?.catalyst_type ?? "CZA";

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Effi Reactor Cycle Analysis</h1>
        <p className="app-subtitle">
          {loadResult
            ? `${loadResult.rows.toLocaleString()} rows · ${loadResult.n_cycles} cycles · ${loadResult.time_range.start.slice(0, 10)} to ${loadResult.time_range.end.slice(0, 10)} · CO₂ MFC: ${loadResult.co2_mfc_col ?? "none active"}`
            : "Load an experiment to begin."}
          {version && ` · v${version}`}
        </p>
      </header>

      <FileSelector onLoaded={(resp) => { setLoadResult(resp); setSelectedCycle(1); }} />

      {loadResult && loadResult.n_cycles === 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="card-header">No cycles detected</h3>
          <p className="error-text">
            {loadResult.co2_mfc_col
              ? `Capture detection used ${loadResult.co2_mfc_col} but found no complete cycles. Check the catalyst type, then send Caleb this folder and a screenshot of this page.`
              : "No CO₂ MFC is switched on in this reactor file, so no capture steps could be found. Send Caleb this folder and a screenshot of this page."}
          </p>
        </div>
      )}

      {loadResult && (
        <>
          <OverviewPlot key={loadResult.time_range.start} onCycleClick={setSelectedCycle} catalystType={catalystType} />
          {loadResult.n_cycles > 0 && (
            <>
              <div className="section-divider" />
              <CycleNavigator
                cycleId={selectedCycle}
                totalCycles={loadResult.n_cycles}
                onChange={setSelectedCycle}
              />
              <CycleDetailView cycleId={selectedCycle} onExport={downloadExcel} catalystType={catalystType} />
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
