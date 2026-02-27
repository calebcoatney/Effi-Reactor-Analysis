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

  const dirEntry: React.CSSProperties = {
    padding: "4px 8px",
    cursor: "pointer",
    borderRadius: 4,
  };

  const allFiles = discovered
    ? [...discovered.all_txt, ...discovered.all_csv]
    : [];

  const roleCounts = {
    reactor: Object.values(roles).filter((r) => r === "reactor").length,
    ir: Object.values(roles).filter((r) => r === "ir").length,
    oxygen: Object.values(roles).filter((r) => r === "oxygen").length,
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
            <button onClick={selectDir} style={{ fontWeight: 600 }}>
              Select This Directory
            </button>
            <button onClick={() => setBrowsing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── discovered files summary + expandable detail ── */}
      {discovered && allFiles.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              fontSize: 12,
              color: "#555",
              userSelect: "none",
            }}
            onClick={() => setExpanded(!expanded)}
          >
            <span
              style={{
                display: "inline-block",
                transition: "transform 0.15s",
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▶
            </span>
            <span>
              Found: {roleCounts.reactor} reactor file
              {roleCounts.reactor !== 1 ? "s" : ""}
              {roleCounts.ir ? ", 1 IR file" : ", ⚠ no IR file"}
              {roleCounts.oxygen ? ", 1 oxygen file" : ""}
              <span style={{ color: "#999", marginLeft: 6 }}>
                ({allFiles.length} file{allFiles.length !== 1 ? "s" : ""} in
                directory)
              </span>
            </span>
          </div>

          {expanded && (
            <div
              style={{
                marginTop: 6,
                padding: 10,
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                fontSize: 12,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "4px 12px",
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
      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            fontWeight: 500,
            fontSize: 13,
            display: "block",
            marginBottom: 4,
          }}
        >
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
      {error && (
        <p style={{ color: "red", margin: "8px 0 0", fontSize: 13 }}>
          {error}
        </p>
      )}
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
          fontFamily: "monospace",
          fontSize: 12,
          color: role === "none" ? "#999" : "#333",
        }}
      >
        {file}
      </span>
      <div style={{ display: "flex", gap: 2 }}>
        {ROLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "2px 6px",
              fontSize: 11,
              border: "1px solid",
              borderColor: role === opt.value ? opt.color : "#ccc",
              borderRadius: 3,
              background: role === opt.value ? opt.color : "#fff",
              color: role === opt.value ? "#fff" : "#666",
              cursor: "pointer",
              fontWeight: role === opt.value ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}
