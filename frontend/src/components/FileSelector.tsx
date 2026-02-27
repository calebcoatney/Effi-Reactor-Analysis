import { useEffect, useState } from "react";
import type { LoadRequest, LoadResponse, BrowseResponse, DiscoverResponse } from "../api";
import { loadExperiment, browseDirectory, discoverFiles } from "../api";

interface Props {
  onLoaded: (resp: LoadResponse) => void;
}

// ── hh:mm:ss unit ──────────────────────────────────────────────────────────

function TimeUnit({
  value,
  onChange,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
  label: string;
}) {
  const btn: React.CSSProperties = {
    width: 28,
    height: 28,
    padding: 0,
    cursor: "pointer",
    borderRadius: 4,
    border: "1px solid #bbb",
    background: "#fff",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <button style={btn} onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <span
        style={{
          width: 30,
          textAlign: "center",
          fontFamily: "monospace",
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        {String(value).padStart(2, "0")}
      </span>
      <button style={btn} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
      <span style={{ fontSize: 11, color: "#888", marginLeft: 1 }}>{label}</span>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function FileSelector({ onLoaded }: Props) {
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoverResponse | null>(null);

  // browser state
  const [browsing, setBrowsing] = useState(false);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);

  // offset
  const [hh, setHH] = useState(0);
  const [mm, setMM] = useState(0);
  const [ss, setSS] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // auto-discover when dataDir changes
  useEffect(() => {
    if (dataDir) {
      discoverFiles(dataDir)
        .then(setDiscovered)
        .catch(() => setDiscovered(null));
    } else {
      setDiscovered(null);
    }
  }, [dataDir]);

  function openBrowser() {
    setBrowsing(true);
    browseDirectory(dataDir ?? ".").then(setBrowseData);
  }

  function navigateTo(path: string) {
    browseDirectory(path).then(setBrowseData);
  }

  function selectDir() {
    if (browseData) {
      setDataDir(browseData.path);
      setBrowsing(false);
    }
  }

  async function handleLoad() {
    if (!discovered || !discovered.ir_file) return;
    setLoading(true);
    setError(null);
    try {
      const req: LoadRequest = {
        reactor_files: discovered.reactor_files,
        ir_file: discovered.ir_file,
        oxygen_file: discovered.oxygen_file ?? undefined,
        offset_hours: hh + mm / 60 + ss / 3600,
      };
      const resp = await loadExperiment(req);
      onLoaded(resp);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const canLoad =
    discovered &&
    discovered.reactor_files.length > 0 &&
    discovered.ir_file != null;

  const dirEntry: React.CSSProperties = {
    padding: "4px 8px",
    cursor: "pointer",
    borderRadius: 4,
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        background: "#f5f5f5",
        borderRadius: 8,
      }}
    >
      <h3 style={{ margin: "0 0 12px" }}>Load Experiment</h3>

      {/* ── data directory ── */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontWeight: 500, fontSize: 13 }}>Data Directory</label>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 4,
          }}
        >
          <code
            style={{
              flex: 1,
              padding: "5px 10px",
              background: "#fff",
              border: "1px solid #ccc",
              borderRadius: 4,
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {dataDir ?? "(none selected)"}
          </code>
          <button onClick={openBrowser}>Browse</button>
        </div>
      </div>

      {/* ── directory browser ── */}
      {browsing && browseData && (
        <div
          style={{
            margin: "0 0 10px",
            padding: 12,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 6,
            maxHeight: 280,
            overflowY: "auto",
            fontSize: 13,
          }}
        >
          <div
            style={{
              marginBottom: 6,
              fontWeight: 600,
              fontSize: 12,
              color: "#555",
              wordBreak: "break-all",
            }}
          >
            {browseData.path}
          </div>

          {browseData.parent && (
            <div
              style={{ ...dirEntry, color: "#0066cc" }}
              onClick={() => navigateTo(browseData.parent!)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#eef4ff")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              ⬆ ..
            </div>
          )}

          {browseData.dirs.map((d) => (
            <div
              key={d}
              style={dirEntry}
              onClick={() => navigateTo(`${browseData.path}/${d}`)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f0f0f0")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              📁 {d}
            </div>
          ))}

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              onClick={selectDir}
              style={{ fontWeight: 600 }}
            >
              Select This Directory
            </button>
            <button onClick={() => setBrowsing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── discovered files summary ── */}
      {discovered && (
        <div style={{ marginBottom: 10, fontSize: 12, color: "#555" }}>
          Found: {discovered.reactor_files.length} reactor file
          {discovered.reactor_files.length !== 1 ? "s" : ""}
          {discovered.ir_file ? ", 1 IR file" : ", ⚠ no IR file"}
          {discovered.oxygen_file ? ", 1 oxygen file" : ""}
        </div>
      )}

      {/* ── offset hh:mm:ss ── */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontWeight: 500, fontSize: 13, display: "block", marginBottom: 4 }}>
          Time Offset
        </label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <TimeUnit value={hh} onChange={setHH} max={99} label="h" />
          <span style={{ fontWeight: 600, fontSize: 16 }}>:</span>
          <TimeUnit value={mm} onChange={setMM} max={59} label="m" />
          <span style={{ fontWeight: 600, fontSize: 16 }}>:</span>
          <TimeUnit value={ss} onChange={setSS} max={59} label="s" />
        </div>
      </div>

      <button
        onClick={handleLoad}
        disabled={loading || !canLoad}
        style={{ fontWeight: 600 }}
      >
        {loading ? "Loading…" : "Load Experiment"}
      </button>
      {error && <p style={{ color: "red", margin: "8px 0 0", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
