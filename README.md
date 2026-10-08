# Geospatial File Measurement API

A FastAPI service and small React dashboard for uploading KML files or ZIP archives containing Shapefiles, inspecting their features, and producing CRS-safe area and length measurements.

## Features

- `POST /api/files/` accepts `.kml` and `.zip` Shapefile archives.
- Durable SQLite records: returned IDs work after an application reload or restart.
- Feature geometry (GeoJSON), attributes, geometry type, source CRS, and measurement result are returned.
- Polygon areas and line lengths are calculated only after geographic coordinates are projected.
- Points have an explicit no-measurement result; unsupported and invalid geometries do not crash the upload.
- ZIP traversal checks, file size limit, companion-file validation, CORS configuration, and clear errors.

## Architecture

```text
Client / React dashboard
          |
          v
FastAPI
  |-- upload validation --> data/uploads/<id>/original file
  |-- GeoPandas reader --> CRS detection --> UTM / EPSG:6933 fallback --> measurement engine
  |-- SQLite (data/app.db): metadata + compact serialized API feature results
          |
          v
GET /api/files/{id}/ and /measurements/
```

The prior implementation used a module-level `FILES` dictionary. It disappeared when FastAPI's reloader spawned a new process (or after restart), causing valid upload IDs to return 404. SQLite is now the source of truth; uploads and their result payloads are persisted after successful processing.

## CRS and measurement strategy

Inputs in a geographic CRS such as EPSG:4326 are transformed to an estimated local UTM CRS. If UTM cannot be determined, EPSG:6933 is used as a projected fallback. Existing projected CRSs are retained. A file with no CRS is not measured: the service refuses to report area/length from ambiguous native coordinates. Areas use `m²`; lengths use `m` for the supported projected workflow.

## API

`GET /health` returns `{"status":"ok"}`.

`POST /api/files/` receives multipart field `file` and returns:

```json
{"id":"abc123","filename":"survey.zip","feature_count":3,"crs":"EPSG:4326","status":"COMPLETED"}
```

`GET /api/files/{id}/` returns persisted file information. `GET /api/files/{id}/measurements/` returns source and measurement CRS plus features, for example:

```json
{"file_id":"abc123","source_crs":"EPSG:4326","measurement_crs":"EPSG:32643","measurements":[{"feature_id":0,"geometry_type":"Polygon","geometry":{"type":"Polygon","coordinates":[]},"properties":{},"measurement_type":"area","measurement":12345.67,"measurement_unit":"m²","status":"MEASURED"}]}
```

Errors include invalid extension, corrupt/unsafe ZIP, missing `.shp`/`.shx`/`.dbf`, empty data, oversized uploads, malformed source files, and unknown IDs.

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000`; interactive docs are at `/docs`. Configuration is in `.env.example`: `MAX_UPLOAD_SIZE_MB`, `DATA_DIR`, `DATABASE_PATH`, and comma-separated `CORS_ORIGINS`.

## Frontend

```powershell
cd frontend
npm install
$env:VITE_API_BASE_URL="http://127.0.0.1:8000"
npm run dev
```

The Vite app provides a drag-and-drop upload, real API results table, statistics, CRS explanation, and JSON download. It is deliberately kept separate and small for assignment presentation.

## Tests and Docker

```powershell
pytest -q
docker compose up --build
```

Tests cover health, Shapefile upload, persisted file and measurement retrieval, polygon area/CRS transformation, lines, points, unsupported geometry, invalid ZIPs, missing files, and repository reinitialisation persistence.

## Design decisions, learning, and future scope

FastAPI keeps the HTTP surface compact; GeoPandas/Shapely/PyProj provide reliable format and CRS tooling; SQLite removes mutable-process-state failures without needing an external service. The main limitation is synchronous processing: very large files will hold a request open. Natural next steps are Postgres/PostGIS, background jobs, object storage, map preview, spatial indexing, and stronger upload quotas.

