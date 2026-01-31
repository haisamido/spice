# SPICE

This project provides NASA/JPL NAIF CSPICE functionality compiled to WebAssembly.

## SPICE: SGP4-WASM

Current work: SGP4 satellite orbit propagation using CSPICE compiled to WebAssembly.

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

| Task | Description |
|------|-------------|
| `test:api:health` | Test health endpoint |
| `test:api:parse` | Test TLE parse endpoint |
| `test:api:propagate` | Test TLE propagate endpoint |
| `test:api:utc-to-et` | Test UTC to ET conversion |
| `test:api:et-to-utc` | Test ET to UTC conversion |
| `test:api:all` | Run all API tests (server must be running) |

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

### Propagate TLE
```bash
curl -X POST http://localhost:50000/api/spice/sgp4/propagate \
  -H "Content-Type: application/json" \
  -d '{
    "line1": "1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025",
    "line2": "2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19",
    "time": "2024-01-15T12:00:00"
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
