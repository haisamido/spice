# SPICE

This project provides NASA/JPL NAIF CSPICE functionality compiled to WebAssembly.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Available Tasks](#available-tasks)
- [API Documentation](#api-documentation)
- [REST API Endpoints](#rest-api-endpoints)
- [Configuration](#configuration)
- [Architecture](docs/architecture.md) - System design, ERD, and sequence diagrams
- [License](#license)

## SPICE: SGP4-WASM

Current work: SGP4 satellite orbit propagation using CSPICE compiled to WebAssembly.

Supports both **TLE** (Two-Line Element) and **OMM** (Orbital Mean-Elements Message) formats.

## Quick Start

```bash
task container:start
```

This builds the container image (compiles CSPICE to WASM, installs npm deps, compiles TypeScript) and starts the REST API server in the background at http://localhost:50000. Use `task container:logs` to view output or `task container:stop` to stop.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Task](https://taskfile.dev/installation/) (go-task)

## Available Tasks

```bash
task --list
```

### Container Tasks

| Task | Description |
|------|-------------|
| `container:build` | Build image locally (WASM + npm + TypeScript) |
| `container:pull` | Pull remote image from registry |
| `container:start` | Build and start the REST API server (detached) |
| `container:start:pull` | Pull remote image and start server (detached) |
| `container:stop` | Stop the running server |
| `container:logs` | View server logs |
| `container:logs:follow` | Follow server logs |
| `container:test` | Run unit tests |
| `container:test:api` | Start server, run all API tests, stop |
| `container:shell` | Open shell in build environment |
| `container:expunge` | Remove all containers and images |

### API Test Tasks

Defined in [tests/Taskfile.yaml](tests/Taskfile.yaml) and included via the root Taskfile.

| Task | Description |
|------|-------------|
| `test:api:health` | Test health endpoint |
| `test:api:parse:tle` | Test TLE parse endpoint |
| `test:api:parse:omm` | Test OMM parse endpoint |
| `test:api:propagate:tle:t0` | Test TLE propagate (single time) |
| `test:api:propagate:tle:t0:txt` | Test TLE propagate (single time, txt output) |
| `test:api:propagate:tle:t0:json` | Test TLE propagate (single time, json output) |
| `test:api:propagate:tle:t0:tf` | Test TLE propagate (time range) |
| `test:api:propagate:tle:t0:tf:txt` | Test TLE propagate (time range, txt output) |
| `test:api:propagate:tle:t0:tf:json` | Test TLE propagate (time range, json output) |
| `test:api:propagate:omm:t0:tf` | Test OMM propagate (time range) |
| `test:api:propagate:omm:t0:tf:txt` | Test OMM propagate (time range, txt output) |
| `test:api:propagate:omm:t0:tf:json` | Test OMM propagate (time range, json output) |
| `test:api:propagate:wgs84` | Test propagate with WGS-84 model |
| `test:api:utc-to-et` | Test UTC to ET conversion |
| `test:api:et-to-utc` | Test ET to UTC conversion |
| `test:api:models` | Test models list endpoint |
| `test:api:models:wgs72` | Test WGS-72 model details |
| `test:api:models:wgs84` | Test WGS-84 model details |
| `test:api:omm:to-tle` | Test OMM to TLE conversion |
| `test:api:tle:to-omm` | Test TLE to OMM conversion |
| `test:api:all` | Run all API tests (server must be running) |

## API Documentation

Interactive API documentation is available when the server is running:

- **Swagger UI**: <http://localhost:50000/api/docs>
- **OpenAPI Spec (JSON)**: <http://localhost:50000/api/openapi.json>

## REST API Endpoints

### Health Check
```bash
curl http://localhost:50000/api/spice/sgp4/health
```

### Parse TLE
```bash
curl -X POST http://localhost:50000/api/spice/sgp4/parse \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19"
  }'
```

### Propagate (Unified Endpoint)

The unified `/api/spice/sgp4/propagate` endpoint supports both TLE and OMM input formats via `input_type` parameter, and JSON or CSV output via `format` parameter.

**Query Parameters:**
| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `t0` | UTC string | (required) | Start time |
| `tf` | UTC string | - | End time (for range mode) |
| `step` | number | - | Time step (for range mode) |
| `unit` | `sec`, `min` | `sec` | Step unit |
| `wgs` | `wgs72`, `wgs84` | `wgs72` | Geophysical model |
| `input_type` | `tle`, `omm` | `tle` | Input format |
| `output_type` | `json`, `txt` | `txt` | Output format |

**Limits:** Maximum of 1,209,602 points per request (14 days at 1-second resolution).

```bash
# Single time propagation (TLE input, default)
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00" \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19"
  }'

# Time range propagation (2 hours with 60-second steps)
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00&tf=2024-01-15T14:00:00&step=60&unit=sec" \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19"
  }'

# TXT output format (CSV)
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00&tf=2024-01-15T14:00:00&step=60&output_type=txt" \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19"
  }'
# Returns: datetime,et,x,y,z,vx,vy,vz

# Propagate with OMM input
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00&tf=2024-01-15T14:00:00&step=60&unit=sec&input_type=omm" \
  -H "Content-Type: application/json" \
  -d '{
    "omm": {
      "OBJECT_NAME": "ISS (ZARYA)",
      "OBJECT_ID": "1998-067A",
      "EPOCH": "2024-01-15T12:00:00.000",
      "MEAN_MOTION": 15.49560830,
      "ECCENTRICITY": 0.0006703,
      "INCLINATION": 51.6400,
      "RA_OF_ASC_NODE": 208.9163,
      "ARG_OF_PERICENTER": 30.0825,
      "MEAN_ANOMALY": 330.0579,
      "NORAD_CAT_ID": 25544,
      "BSTAR": 0.00010270,
      "MEAN_MOTION_DOT": 0.00016717
    }
  }'
```

### OMM (Orbital Mean-Elements Message)

OMM is a modern CCSDS standard (JSON format) that replaces the legacy TLE format.

```bash
# Parse OMM
curl -X POST http://localhost:50000/api/spice/sgp4/omm/parse \
  -H "Content-Type: application/json" \
  -d '{
    "OBJECT_NAME": "ISS (ZARYA)",
    "OBJECT_ID": "1998-067A",
    "EPOCH": "2024-01-15T12:00:00.000",
    "MEAN_MOTION": 15.49560830,
    "ECCENTRICITY": 0.0006703,
    "INCLINATION": 51.6400,
    "RA_OF_ASC_NODE": 208.9163,
    "ARG_OF_PERICENTER": 30.0825,
    "MEAN_ANOMALY": 330.0579,
    "NORAD_CAT_ID": 25544,
    "BSTAR": 0.00010270,
    "MEAN_MOTION_DOT": 0.00016717
  }'

# Convert TLE to OMM
curl -X POST http://localhost:50000/api/spice/sgp4/tle/to-omm \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19"
  }'
```

### Time Conversions
```bash
# UTC to Ephemeris Time
curl "http://localhost:50000/api/spice/sgp4/time/utc-to-et?utc=2024-01-15T12:00:00"

# Ephemeris Time to UTC
curl "http://localhost:50000/api/spice/sgp4/time/et-to-utc?et=758592069.184"
```

## Configuration

Override defaults via task variables:

```bash
# Use a different port
task container:start SERVICE_HOST_PORT=8080

# Use podman instead of docker
task container:start CONTAINER_BIN=podman

# Pull remote image with specific platform
task container:pull PLATFORM=linux/arm64

# Pull specific tag from registry
task container:start:pull REMOTE_TAG=v1.0.0
```

## License

[GPL-3.0](LICENSE)
