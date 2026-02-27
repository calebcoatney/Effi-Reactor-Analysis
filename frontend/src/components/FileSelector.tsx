import { useState } from "react";
import type { LoadRequest, LoadResponse } from "../api";
import { loadExperiment } from "../api";

interface Props {
  onLoaded: (resp: LoadResponse) => void;
}

const DEFAULT_DATA_DIR = "../260121_CZA-flueCO2";

export default function FileSelector({ onLoaded }: Props) {
  const [dataDir, setDataDir] = useState(DEFAULT_DATA_DIR);
  const [offsetHours, setOffsetHours] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    try {
      const req: LoadRequest = {
        reactor_files: [
          `${dataDir}/ExportData_20260110155819_20260122155903.txt`,
          `${dataDir}/ExportData_20260112110215_20260122155936.txt`,
          `${dataDir}/ExportData_20260113170209_20260121143403.txt`,
          `${dataDir}/ExportData_20260116201025_20260121143239.txt`,
        ],
        ir_file: `${dataDir}/260121_Data_All.csv`,
        oxygen_file: `${dataDir}/260121_oxygen.csv`,
        offset_hours: offsetHours,
      };
      const resp = await loadExperiment(req);
      onLoaded(resp);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "#f5f5f5", borderRadius: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Load Experiment</h3>
      <label>
        Data directory:{" "}
        <input
          value={dataDir}
          onChange={(e) => setDataDir(e.target.value)}
          style={{ width: 400, marginRight: 12 }}
        />
      </label>
      <label>
        Offset (h):{" "}
        <input
          type="number"
          value={offsetHours}
          onChange={(e) => setOffsetHours(Number(e.target.value))}
          style={{ width: 60, marginRight: 12 }}
        />
      </label>
      <button onClick={handleLoad} disabled={loading}>
        {loading ? "Loading…" : "Load"}
      </button>
      {error && <p style={{ color: "red", margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
