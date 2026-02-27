const BASE = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadRequest {
  reactor_files: string[];
  ir_file: string;
  oxygen_file?: string;
  offset_hours?: number;
}

export interface LoadResponse {
  rows: number;
  columns: number;
  column_names: string[];
  n_cycles: number;
  time_range: { start: string; end: string };
}

export interface BrowseResponse {
  path: string;
  parent: string | null;
  dirs: string[];
  files: string[];
}

export interface DiscoverResponse {
  path: string;
  reactor_files: string[];
  ir_file: string | null;
  oxygen_file: string | null;
  all_txt: string[];
  all_csv: string[];
}

export interface WindowInfo {
  start: string;
  end: string;
  start_idx: number;
  end_idx: number;
}

export interface CycleSummary {
  cycle_id: number;
  high_p: WindowInfo;
  low_p: WindowInfo;
}

export interface IntegrationRow {
  species: string;
  unit: string;
  high_p_area: number;
  low_p_area: number;
}

export interface CycleDetail extends CycleSummary {
  integration: IntegrationRow[];
}

export interface CycleDataResponse {
  cycle_id: number;
  columns: string[];
  data: (string | number | null)[][];
}

export interface CycleMarker {
  cycle_id: number;
  hp_start: string;
  hp_end: string;
  lp_start: string;
  lp_end: string;
}

export interface OverviewResponse {
  columns: string[];
  data: (string | number | null)[][];
  cycles: CycleMarker[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export function loadExperiment(req: LoadRequest): Promise<LoadResponse> {
  return apiFetch("/experiment/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function browseDirectory(path = "."): Promise<BrowseResponse> {
  return apiFetch(`/browse?path=${encodeURIComponent(path)}`);
}

export function discoverFiles(path: string): Promise<DiscoverResponse> {
  return apiFetch(`/discover?path=${encodeURIComponent(path)}`);
}

export function listCycles(): Promise<{ cycles: CycleSummary[] }> {
  return apiFetch("/cycles");
}

export function getCycle(id: number): Promise<CycleDetail> {
  return apiFetch(`/cycles/${id}`);
}

export function getCycleData(
  id: number,
  padMinutes = 2
): Promise<CycleDataResponse> {
  return apiFetch(`/cycles/${id}/data?pad_minutes=${padMinutes}`);
}

export function getOverview(maxPoints = 2000): Promise<OverviewResponse> {
  return apiFetch(`/overview?max_points=${maxPoints}`);
}
