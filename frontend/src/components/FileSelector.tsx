import { useEffect, useState } from "react";
import type { LoadRequest, LoadResponse, BrowseResponse, DiscoverResponse } from "../api";
import { loadExperiment, browseDirectory, discoverFiles } from "../api";

interface Props {
  onLoaded: (resp: LoadResponse) => void;
}

type FileRole = "reactor" | "ir" | "oxygen" | "none";

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
  return (
    <div className="time-unit">
      <button className="btn btn-icon" onClick={() => onChange(Math.max(0, value - 1))}>
        −
      </button>
      <span className="time-value">
        {String(value).padStart(2, "0")}
      </span>
      <button className="btn btn-icon" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
      <span className="time-label">{label}</span>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Build initial role map from auto-discovery results. */
function initRoles(disc: DiscoverResponse): Record<string, FileRole> {
  const roles: Record<string, FileRole> = {};
  const allFiles = [...disc.all_txt, ...disc.all_csv];
  const reactorBasenames = new Set(
    disc.reactor_files.map((p) => p.split("/").pop()!),
  );
  const irBasename = disc.ir_file?.split("/").pop() ?? null;
  const oxyBasename = disc.oxygen_file?.split("/").pop() ?? null;

  for (const f of allFiles) {
    if (reactorBasenames.has(f)) roles[f] = "reactor";
    else if (f === irBasename) roles[f] = "ir";
    else if (f === oxyBasename) roles[f] = "oxygen";
    else roles[f] = "none";
  }
  return roles;
}

// ── main component ─────────────────────────────────────────────────────────

export default function FileSelector({ onLoaded }: Props) {
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoverResponse | null>(null);

  // manual file role overrides
  const [roles, setRoles] = useState<Record<string, FileRole>>({});
  const [expanded, setExpanded] = useState(false);

  // browser state
  const [browsing, setBrowsing] = useState(false);
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);

  // offset
  const [hh, setHH] = useState(0);
  const [mm, setMM] = useState(0);
  const [ss, setSS] = useState(0);

  // catalyst type and CO2 MFC column selection
  const [catalystType, setCatalystType] = useState<"CZA" | "ZA">("CZA");
  const [co2MfcCol, setCo2MfcCol] = useState<string | null>(null);

  // known CO2 MFC options
  const co2MfcOptions = [
    "5#10%CO2 RSP",
    "4#CO2 RSP", 
    "2#flueCO2 RSP",
    "2#pureCO2 RSP",
  ];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // auto-discover when dataDir changes
  useEffect(() => {
    if (dataDir) {
      discoverFiles(dataDir)
        .then((d) => {
          setDiscovered(d);
          setRoles(initRoles(d));
          setExpanded(false);
        })
        .catch(() => {
          setDiscovered(null);
          setRoles({});
        });
    } else {
      setDiscovered(null);
      setRoles({});
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

  function setRole(file: string, role: FileRole) {
    setRoles((prev) => {
      const next = { ...prev };
      // ir and oxygen are single-select: clear any previous assignment
      if (role === "ir" || role === "oxygen") {
        for (const k of Object.keys(next)) {
          if (next[k] === role) next[k] = "none";
        }
      }
      next[file] = role;
      return next;
    });
  }

  // derive file lists from roles
  const reactorFiles = discovered
    ? Object.entries(roles)
        .filter(([, r]) => r === "reactor")
        .map(([f]) => `${discovered.path}/${f}`)
    : [];
  const irFile = discovered
    ? Object.entries(roles).find(([, r]) => r === "ir")?.[0] ?? null
    : null;
  const oxygenFile = discovered
    ? Object.entries(roles).find(([, r]) => r === "oxygen")?.[0] ?? null
    : null;

  async function handleLoad() {
    if (!discovered || !irFile) return;
    setLoading(true);
    setError(null);
    try {
      const req: LoadRequest = {
        reactor_files: reactorFiles,
        ir_file: `${discovered.path}/${irFile}`,
        oxygen_file: oxygenFile
          ? `${discovered.path}/${oxygenFile}`
          : undefined,
        offset_hours: hh + mm / 60 + ss / 3600,
        catalyst_type: catalystType,
        co2_mfc_col: co2MfcCol ?? undefined,
      };
      const resp = await loadExperiment(req);
      onLoaded(resp);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const canLoad = reactorFiles.length > 0 && irFile != null;

  const allFiles = discovered
    ? [...discovered.all_txt, ...discovered.all_csv]
    : [];

  const roleCounts = {
    reactor: Object.values(roles).filter((r) => r === "reactor").length,
    ir: Object.values(roles).filter((r) => r === "ir").length,
    oxygen: Object.values(roles).filter((r) => r === "oxygen").length,
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-header">Load Experiment</h3>

      {/* ── data directory ── */}
      <div style={{ marginBottom: 14 }}>
        <label>Data Directory</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code className="code-display">
            {dataDir ?? "(none selected)"}
          </code>
          <button className="btn" onClick={openBrowser}>Browse</button>
        </div>
      </div>

      {/* ── directory browser ── */}
      {browsing && browseData && (
        <div className="browser-panel">
          <div className="browser-path">{browseData.path}</div>

          {browseData.parent && (
            <div
              className="browser-entry browser-entry--parent"
              onClick={() => navigateTo(browseData.parent!)}
            >
              ⬆ ..
            </div>
          )}

          {browseData.dirs.map((d) => (
            <div
              key={d}
              className="browser-entry"
              onClick={() => navigateTo(`${browseData.path}/${d}`)}
            >
              📁 {d}
            </div>
          ))}

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={selectDir}>
              Select This Directory
            </button>
            <button className="btn" onClick={() => setBrowsing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── discovered files summary + expandable detail ── */}
      {discovered && allFiles.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            className="discovery-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            <span
              className="discovery-arrow"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            <span>
              Found: {roleCounts.reactor} reactor file
              {roleCounts.reactor !== 1 ? "s" : ""}
              {roleCounts.ir ? ", 1 IR file" : ", ⚠ no IR file"}
              {roleCounts.oxygen ? ", 1 oxygen file" : ""}
              <span style={{ color: "var(--color-text-muted)", marginLeft: 6 }}>
                ({allFiles.length} file{allFiles.length !== 1 ? "s" : ""} in
                directory)
              </span>
            </span>
          </div>

          {expanded && (
            <div className="discovery-panel">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "6px 12px",
                  alignItems: "center",
                }}
              >
                {allFiles.map((f) => (
                  <FileRoleRow
                    key={f}
                    file={f}
                    role={roles[f] ?? "none"}
                    onChange={(r) => setRole(f, r)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── offset hh:mm:ss ── */}
      <div style={{ marginBottom: 16 }}>
        <label>Time Offset</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <TimeUnit value={hh} onChange={setHH} max={99} label="h" />
          <span className="time-separator">:</span>
          <TimeUnit value={mm} onChange={setMM} max={59} label="m" />
          <span className="time-separator">:</span>
          <TimeUnit value={ss} onChange={setSS} max={59} label="s" />
        </div>
      </div>

      {/* ── catalyst type ── */}
      <div style={{ marginBottom: 16 }}>
        <label>Catalyst Type</label>
        <div style={{ display: "flex", gap: 6 }}>
          {(
            [
              { value: "CZA", label: "CZA (Pressure Swing)" },
              { value: "ZA", label: "ZA (Atmospheric)" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              className={`role-btn${catalystType === opt.value ? " role-btn--active" : ""}`}
              style={
                catalystType === opt.value
                  ? { background: "#2563eb", borderColor: "#2563eb" }
                  : undefined
              }
              onClick={() => setCatalystType(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── CO2 MFC column selector ── */}
      <div style={{ marginBottom: 16 }}>
        <label>CO₂ MFC (for Capture detection)</label>
        <select
          value={co2MfcCol ?? ""}
          onChange={(e) => setCo2MfcCol(e.target.value || null)}
          style={{
            display: "block",
            marginTop: 4,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg)",
            color: "var(--color-text)",
            fontSize: "0.85rem",
          }}
        >
          <option value="">Auto / None</option>
          {co2MfcOptions.map((col) => (
            <option key={col} value={col}>{col}</option>
          ))}
        </select>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleLoad}
        disabled={loading || !canLoad}
      >
        {loading ? "Loading…" : "Load Experiment"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// ── file role selector row ─────────────────────────────────────────────────

const ROLE_OPTIONS: { value: FileRole; label: string; color: string }[] = [
  { value: "reactor", label: "Reactor", color: "#2563eb" },
  { value: "ir", label: "IR", color: "#059669" },
  { value: "oxygen", label: "O₂", color: "#d97706" },
  { value: "none", label: "—", color: "#999" },
];

function FileRoleRow({
  file,
  role,
  onChange,
}: {
  file: string;
  role: FileRole;
  onChange: (r: FileRole) => void;
}) {
  return (
    <>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          color: role === "none" ? "var(--color-text-muted)" : "var(--color-text)",
        }}
      >
        {file}
      </span>
      <div style={{ display: "flex", gap: 3 }}>
        {ROLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`role-btn${role === opt.value ? " role-btn--active" : ""}`}
            style={
              role === opt.value
                ? { background: opt.color, borderColor: opt.color }
                : undefined
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}
