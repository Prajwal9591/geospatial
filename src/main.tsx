import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type FileSummary = { id: string; filename: string; feature_count: number; crs?: string | null; status: string };
type FeatureMeasurement = {
  feature_id: number; geometry_type: string; measurement_type?: string | null;
  measurement?: number | null; measurement_unit?: string | null; measurement_crs?: string | null;
  supported: boolean; message?: string | null; status: string;
};
type MeasurementResponse = {
  file_id: string; filename: string; source_crs?: string | null;
  measurement_crs?: string | null; measurements: FeatureMeasurement[];
};

function friendlyError(status: number, detail?: string): string {
  if (status === 404) return "The uploaded file could not be found. Please upload it again.";
  if (status === 400) return "Invalid geospatial file. Please upload a KML or a ZIP containing a Shapefile.";
  if (status === 413) return "The file is too large to process.";
  const reason = detail?.toLowerCase() ?? "";
  if (reason.includes("valid zip") || reason.includes("bad zip")) return "Invalid ZIP file. Please upload a valid ZIP containing a Shapefile.";
  if (reason.includes("does not contain a .shp") || reason.includes("does not contain a shapefile")) return "This ZIP does not contain a Shapefile.";
  if (reason.includes("could not process geospatial file") && (reason.includes("kml") || reason.includes("xml"))) return "The KML appears to be corrupted or invalid. Check the file and try again.";
  if (detail) return `Processing failed: ${detail.replace(/^Could not process geospatial file:\s*/i, "")}`;
  return "The file could not be processed. Please check it and try again.";
}

function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File>();
  const [summary, setSummary] = useState<FileSummary>();
  const [results, setResults] = useState<MeasurementResponse>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const choose = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".kml") && !file.name.toLowerCase().endsWith(".zip")) {
      setError("Invalid file type. Please upload a KML or Shapefile ZIP.");
      setSelectedFile(undefined);
      setSummary(undefined);
      setResults(undefined);
      const picker = document.getElementById("file") as HTMLInputElement | null;
      if (picker) picker.value = "";
      return;
    }
    setSelectedFile(file);
    setSummary(undefined);
    setResults(undefined);
    setError("");
  };

  async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, options);
    } catch {
      throw new Error("Backend unavailable. Confirm the FastAPI server is running at 127.0.0.1:8000.");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(friendlyError(response.status, body.detail));
    }
    return response.json() as Promise<T>;
  }

  async function upload() {
    if (!selectedFile) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const uploaded = await requestJson<FileSummary>(`${api}/api/files/`, { method: "POST", body: form });
      const persistedSummary = await requestJson<FileSummary>(`${api}/api/files/${uploaded.id}/`);
      const measurements = await requestJson<MeasurementResponse>(`${api}/api/files/${uploaded.id}/measurements/`);
      setSummary(persistedSummary);
      setResults(measurements);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Processing failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSelectedFile(undefined);
    setSummary(undefined);
    setResults(undefined);
    setError("");
    setDragging(false);
    const picker = document.getElementById("file") as HTMLInputElement | null;
    if (picker) picker.value = "";
  }

  const stats = useMemo(() => {
    const features = results?.measurements ?? [];
    return {
      "Total features": features.length,
      "Measured features": features.filter((row) => row.status === "MEASURED").length,
      Points: features.filter((row) => row.geometry_type.includes("Point")).length,
      LineStrings: features.filter((row) => row.geometry_type.includes("LineString")).length,
      Polygons: features.filter((row) => row.geometry_type.includes("Polygon")).length,
      Unsupported: features.filter((row) => !row.supported).length,
    };
  }, [results]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }

  function downloadCsv() {
    if (!results) return;
    const columns = ["feature_id", "geometry_type", "measurement_type", "measurement", "measurement_unit", "status"] as const;
    const rows = results.measurements.map((feature) => columns.map((column) => csvValue(feature[column])).join(","));
    download([columns.join(","), ...rows].join("\r\n"), `${results.file_id}-measurements.csv`, "text/csv;charset=utf-8");
  }

  return <main>
    <header><p className="eyebrow">GEOSPATIAL TOOLKIT</p><h1>Geospatial File Measurement API</h1><p>Upload geospatial files and calculate CRS-safe measurements.</p></header>
    <section
      className={`upload${dragging ? " is-dragging" : ""}${selectedFile ? " has-file" : ""}${busy ? " is-uploading" : ""}${summary && results ? " is-complete" : ""}`}
      onDrop={onDrop}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={onDragLeave}
      aria-label="File upload dropzone"
    >
      <input id="file" className="file-input" type="file" accept=".kml,.zip" onChange={(event: ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])} />
      <p className="drop-prompt">Drop a KML or Shapefile ZIP here, or <label className="browse-link" htmlFor="file">browse</label></p>
      <label className="choose-file" htmlFor="file">Choose file</label>
      {selectedFile ? <p className="selected-file"><b>Selected file:</b> {selectedFile.name}</p> : <small>KML and ZIP files only</small>}
      <div className="upload-actions">
        <button onClick={upload} disabled={!selectedFile || busy} aria-busy={busy}>{busy ? "Processing file…" : "Upload and measure"}</button>
        {selectedFile && <button className="secondary remove-file" onClick={reset} disabled={busy}>{summary && results ? "Upload another file" : "Remove file"}</button>}
      </div>
      {busy && <p className="loading" role="status">Uploading, parsing, and calculating measurements…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {summary && results && <p className="success" role="status">Upload complete. {summary.feature_count} features measured and ready.</p>}
    </section>

    {summary && results && <>
      <section className="card"><div className="title"><h2>File summary</h2><button className="secondary" onClick={reset}>Upload another file</button></div>
        <div className="summary"><span><b>Filename</b>{summary.filename}</span><span><b>File ID</b>{summary.id}</span><span><b>Feature count</b>{summary.feature_count}</span><span><b>Source CRS</b>{summary.crs ?? "Not supplied"}</span><span><b>Status</b>{summary.status}</span></div>
      </section>
      <section className="stats">{Object.entries(stats).map(([label, value]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</section>
      <section className="card"><div className="title"><h2>Measurement results</h2><div className="actions"><button className="secondary" onClick={() => download(JSON.stringify(results, null, 2), `${results.file_id}-measurements.json`, "application/json")}>Download JSON</button><button className="secondary" onClick={downloadCsv}>Download CSV</button></div></div>
        <div className="table"><table><thead><tr><th>Feature ID</th><th>Geometry</th><th>Measurement</th><th>Value</th><th>Unit</th><th>Status</th></tr></thead><tbody>{results.measurements.map((feature) => <tr key={feature.feature_id}><td>{feature.feature_id}</td><td>{feature.geometry_type}</td><td>{feature.measurement_type ? feature.measurement_type[0].toUpperCase() + feature.measurement_type.slice(1) : "—"}</td><td>{feature.measurement == null ? "—" : feature.measurement}</td><td>{feature.measurement_unit ?? "—"}</td><td>{feature.status === "NO_MEASUREMENT" ? "No Measurement" : feature.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card crs"><h2>CRS information</h2><p><b>Source CRS:</b> {results.source_crs ?? "Not supplied"}</p><p><b>Measurement CRS:</b> {results.measurement_crs ?? "Not available"}</p><p>Measurements are calculated after transforming geographic coordinates into a suitable projected CRS.</p></section>
      <section className="flow" aria-label="Processing flow">{["Upload", "Parse", "Detect CRS", "Transform", "Measure", "Results"].map((step, index) => <span key={step}>{index > 0 && <i>→</i>}{step}</span>)}</section>
    </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
