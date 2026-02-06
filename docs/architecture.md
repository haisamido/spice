# SPICE SGP4 Architecture

## Overview

SPICE SGP4 is a REST API service that provides satellite orbit propagation using the SGP4 algorithm. Two implementations are available:

- **WASM Server** (port 50000): CSPICE compiled to WebAssembly - portable, runs anywhere
- **Native Server** (port 50001): SIMD-optimized native add-on - maximum performance

## Dual-Server Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client                                          │
│                   (Browser, curl, Application)                               │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                               │
                    ▼                               ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────────┐
│     WASM Server (port 50000)      │ │     Native Server (port 50001)        │
│  ┌─────────────────────────────┐  │ │  ┌─────────────────────────────────┐  │
│  │     Express.js + Workers    │  │ │  │     Express.js + Workers        │  │
│  └─────────────────────────────┘  │ │  └─────────────────────────────────┘  │
│              │                    │ │              │                        │
│  ┌───────────┼───────────┐       │ │  ┌───────────┼───────────┐            │
│  ▼           ▼           ▼       │ │  ▼           ▼           ▼            │
│ ┌────┐     ┌────┐     ┌────┐     │ │ ┌────┐     ┌────┐     ┌────┐         │
│ │WASM│     │WASM│     │WASM│     │ │ │SIMD│     │SIMD│     │SIMD│         │
│ │64MB│     │64MB│     │64MB│     │ │ │ C  │     │ C  │     │ C  │         │
│ └────┘     └────┘     └────┘     │ │ └────┘     └────┘     └────┘         │
│                                   │ │                                       │
│  ~750K prop/s                     │ │  ~5-10M prop/s (Docker)               │
│                                   │ │  ~55M prop/s (Host ARM NEON)          │
└───────────────────────────────────┘ └───────────────────────────────────────┘
```

### Implementation Comparison

| Aspect | WASM Server | Native Server |
|--------|-------------|---------------|
| Port | 50000 | 50001 |
| Implementation | CSPICE → WebAssembly | C + SIMD (AVX2/NEON) |
| Portability | Any platform | Platform-specific binary |
| Performance | ~750K prop/s | ~5-55M prop/s |
| Memory per worker | ~64MB | ~1MB |
| Build dependency | Emscripten | node-gyp |

## System Architecture (WASM Server)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client                                  │
│              (Browser, curl, Application)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Server (Main Thread)              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  Compression  │  │ Request Logger│  │  Swagger UI   │       │
│  │    (gzip)     │  │               │  │               │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  API Routes   │  │  HTTP Cache   │  │  Worker Pool  │       │
│  │               │  │ (ETag/304)    │  │   Manager     │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ▼                 ▼                 ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   Worker 1    │   │   Worker 2    │   │   Worker N    │
│  ┌─────────┐  │   │  ┌─────────┐  │   │  ┌─────────┐  │
│  │  SGP4   │  │   │  │  SGP4   │  │   │  │  SGP4   │  │
│  │  WASM   │  │   │  │  WASM   │  │   │  │  WASM   │  │
│  │  64MB   │  │   │  │  64MB   │  │   │  │  64MB   │  │
│  └─────────┘  │   │  └─────────┘  │   │  └─────────┘  │
└───────────────┘   └───────────────┘   └───────────────┘
  (independent)       (independent)       (independent)
```

## Worker Pool Architecture

The server uses Node.js `worker_threads` to parallelize SGP4 propagation requests. Each worker has its own independent WASM instance, eliminating race conditions and enabling multi-core utilization.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Thread                                  │
│  ┌──────────┐    ┌────────────────┐    ┌─────────────────┐      │
│  │ Express  │───▶│  Worker Pool   │───▶│  Task Queue     │      │
│  │ Server   │    │  Manager       │    │  (pending)      │      │
│  └──────────┘    └────────────────┘    └─────────────────┘      │
│                         │                                        │
└─────────────────────────┼────────────────────────────────────────┘
                          │ postMessage / on('message')
    ┌─────────────────────┼─────────────────────┐
    ▼                     ▼                     ▼
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Worker 1│         │ Worker 2│         │ Worker N│
│ ┌─────┐ │         │ ┌─────┐ │         │ ┌─────┐ │
│ │SGP4 │ │         │ │SGP4 │ │         │ │SGP4 │ │
│ │WASM │ │         │ │WASM │ │         │ │WASM │ │
│ │64MB │ │         │ │64MB │ │         │ │64MB │ │
│ └─────┘ │         │ └─────┘ │         │ └─────┘ │
└─────────┘         └─────────┘         └─────────┘
```

### Benefits

| Aspect | Single-threaded | Worker Pool |
|--------|-----------------|-------------|
| Concurrency | Sequential | N workers (CPU cores) |
| Race conditions | Possible | Eliminated |
| Request isolation | Shared state | Per-worker state |
| Memory | ~64MB | ~64MB × N workers |
| Throughput | ~50-100 req/s | ~500 req/s |

### Configuration

The pool size is configurable via environment variable:

```yaml
# compose.yaml
environment:
  - SGP4_POOL_SIZE=${SGP4_POOL_SIZE:-12}
```

Optimal concurrency: `PARALLEL = 2 × SGP4_POOL_SIZE`

## Entity Relationship Diagram

```mermaid
erDiagram
    TLE {
        string line1 "TLE Line 1"
        string line2 "TLE Line 2"
        number epoch "Ephemeris Time"
        array elements "Orbital Elements"
    }

    StateVector {
        string datetime "UTC timestamp"
        number et "Ephemeris Time"
        array position "[x, y, z] in km"
        array velocity "[vx, vy, vz] in km/s"
    }

    Position {
        number x "km (index 0)"
        number y "km (index 1)"
        number z "km (index 2)"
    }

    Velocity {
        number vx "km/s (index 0)"
        number vy "km/s (index 1)"
        number vz "km/s (index 2)"
    }

    WGSModel {
        string name "wgs72 or wgs84"
        string description "Model description"
        object constants "Geophysical constants"
    }

    GeophysicalConstants {
        number radiusearthkm "Earth radius"
        number xke "SGP4 constant"
        number tumin "Time units per minute"
        number j2 "J2 perturbation"
        number j3 "J3 perturbation"
        number j4 "J4 perturbation"
        number j3oj2 "J3/J2 ratio"
    }

    PropagationRequest {
        string line1 "TLE Line 1"
        string line2 "TLE Line 2"
        string t0 "Start time (UTC)"
        string tf "End time (UTC, optional)"
        number step "Time step (optional)"
        string unit "sec or min"
        string model "wgs72 or wgs84"
        string input_type "tle or omm"
        string format "json or csv"
    }

    PropagationResponse {
        array states "Array of StateVectors"
        number epoch "TLE epoch in ET"
        string model "Model used"
        number count "Number of states"
        string format "Output format used"
    }

    TLE ||--|| StateVector : "propagates to"
    StateVector ||--|| Position : "contains"
    StateVector ||--|| Velocity : "contains"
    WGSModel ||--|| GeophysicalConstants : "defines"
    PropagationRequest ||--|| TLE : "contains"
    PropagationRequest ||--o| WGSModel : "uses"
    PropagationResponse ||--|| StateVector : "returns"
```

## Sequence Diagrams

### TLE Parse Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server as Express Server
    participant Logger as Request Logger
    participant SGP4 as SGP4 Module
    participant WASM as CSPICE WASM

    Client->>Server: POST /api/spice/sgp4/parse
    Server->>Logger: Log request
    Server->>SGP4: parseTLE(line1, line2)
    SGP4->>WASM: sgp4_parse_tle()
    WASM-->>SGP4: epoch, elements[]
    SGP4-->>Server: TLE object
    Server->>Logger: Log response
    Server-->>Client: { epoch, elements }
```

### TLE Propagation Flow (Worker Pool)

```mermaid
sequenceDiagram
    participant Client
    participant Server as Express Server
    participant Pool as Worker Pool
    participant Worker as Worker Thread
    participant WASM as SGP4 WASM

    Client->>Server: POST /api/spice/sgp4/propagate
    Server->>Server: Validate request, parse TLE

    Server->>Pool: propagate(tle, times, model)
    Pool->>Pool: Find available worker or queue task

    Pool->>Worker: postMessage(PropagateTask)
    Worker->>WASM: setGeophysicalConstants(model)
    Worker->>WASM: parseTLE(line1, line2)

    loop For each time step
        Worker->>WASM: propagate(tle, et)
        WASM-->>Worker: position, velocity
    end

    Worker-->>Pool: postMessage(PropagateResult)
    Pool-->>Server: Promise resolved with states[]

    Server-->>Client: { states, epoch, model, count }
```

**Key Points:**

- Each worker has its own isolated WASM instance
- Workers set geophysical constants independently (no race conditions)
- Task queue handles back-pressure when all workers are busy
- Results are streamed back via message passing

### Time Conversion Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server as Express Server
    participant Logger as Request Logger
    participant SGP4 as SGP4 Module
    participant WASM as CSPICE WASM

    alt UTC to ET
        Client->>Server: GET /api/spice/sgp4/time/utc-to-et?utc=...
        Server->>Logger: Log request
        Server->>SGP4: utcToET(utcString)
        SGP4->>WASM: sgp4_utc_to_et()
        WASM-->>SGP4: ephemerisTime
        SGP4-->>Server: ET value
        Server->>Logger: Log response
        Server-->>Client: { et }
    else ET to UTC
        Client->>Server: GET /api/spice/sgp4/time/et-to-utc?et=...
        Server->>Logger: Log request
        Server->>SGP4: etToUTC(et)
        SGP4->>WASM: sgp4_et_to_utc()
        WASM-->>SGP4: utcString
        SGP4-->>Server: UTC string
        Server->>Logger: Log response
        Server-->>Client: { utc }
    end
```

### Server Initialization Flow

```mermaid
sequenceDiagram
    participant Node as Node.js
    participant Server as Express Server
    participant SGP4 as SGP4 Module
    participant Pool as Worker Pool
    participant Workers as Worker Threads
    participant WASM as CSPICE WASM

    Node->>Server: Start server.js
    Server->>SGP4: createSGP4()
    SGP4->>WASM: Load sgp4.wasm
    WASM-->>SGP4: Module ready
    Server->>SGP4: init()
    SGP4-->>Server: Main thread ready

    Server->>Pool: initialize()
    Pool->>Workers: Spawn N workers (SGP4_POOL_SIZE)

    par Worker initialization
        Workers->>WASM: Each worker loads sgp4.wasm
        WASM-->>Workers: Independent WASM instances
    end

    Workers-->>Pool: All workers ready
    Pool-->>Server: Pool initialized

    Server->>Node: Listen on PORT
    Node-->>Server: Server running
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/spice/sgp4/parse` | Parse TLE and return orbital elements |
| POST | `/api/spice/sgp4/propagate` | Propagate TLE/OMM (supports JSON/CSV output) |
| POST | `/api/spice/sgp4/omm/parse` | Parse OMM JSON and return orbital elements |
| POST | `/api/spice/sgp4/omm/to-tle` | Convert OMM to TLE format |
| POST | `/api/spice/sgp4/tle/to-omm` | Convert TLE to OMM format |
| GET | `/api/spice/sgp4/time/utc-to-et` | Convert UTC to Ephemeris Time |
| GET | `/api/spice/sgp4/time/et-to-utc` | Convert Ephemeris Time to UTC |
| GET | `/api/spice/sgp4/health` | Health check endpoint |
| GET | `/api/spice/sgp4/pool/stats` | Worker pool statistics |
| GET | `/api/models/` | List available geophysical models |
| GET | `/api/models/wgs/:name` | Get specific WGS model details |
| GET | `/api/docs` | Interactive Swagger UI documentation |
| GET | `/api/openapi.json` | OpenAPI specification |

### Propagate Query Parameters

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `t0` | UTC string | (required) | Start time |
| `tf` | UTC string | - | End time (for range mode) |
| `step` | number | - | Time step (for range mode) |
| `unit` | `sec`, `min` | `sec` | Step unit |
| `wgs` | `wgs72`, `wgs84` | `wgs72` | Geophysical model |
| `input_type` | `tle`, `omm` | `tle` | Input format |
| `output_type` | `json`, `txt` | `txt` | Output format |
| `batch_size` | 1-1209602 | 1209 | Rows per batch (txt only) |

**Limits:** Maximum of 1,209,602 points per request (14 days at 1-second resolution).

### Output Formats

**TXT format** (default, `output_type=txt`):

```
datetime,et,x,y,z,vx,vy,vz
2024-01-15T12:00:00.000,758592069.18,-5945.93,-3284.80,0.29,2.31,-4.16,6.01
```

**JSON format** (`output_type=json`):

```json
{
  "states": [
    {
      "datetime": "2024-01-15T12:00:00.000",
      "et": 758592069.18,
      "position": [-5945.93, -3284.80, 0.29],
      "velocity": [2.31, -4.16, 6.01]
    }
  ],
  "epoch": 758592069.18,
  "model": "wgs72",
  "count": 1
}
```

## Performance Optimizations

### Worker Pool Parallelization

The server uses a pool of worker threads to parallelize SGP4 propagation requests:

- **Multi-core utilization**: N workers process requests concurrently (default: 12)
- **Isolated WASM instances**: Each worker has independent state, eliminating race conditions
- **Task queue**: Handles back-pressure when all workers are busy
- **Throughput**: ~500 req/s with optimal configuration (vs ~50-100 req/s single-threaded)

```bash
# Check pool statistics
curl http://localhost:50000/api/spice/sgp4/pool/stats
# {"poolSize":12,"busyWorkers":0,"availableWorkers":12,"queueLength":0,"pendingTasks":0}
```

### Response Compression

All responses are automatically compressed using gzip via the `compression` middleware, reducing transfer sizes by 60-80% for typical payloads.

### HTTP Caching

The propagate endpoint implements HTTP caching:

- **ETag**: Generated from request parameters (t0, tf, step, unit, model, body)
- **Cache-Control**: `public, max-age=3600` (1 hour)
- **304 Not Modified**: Returned when client sends matching `If-None-Match` header

```
Client Request:
If-None-Match: "abc123..."

Server Response (cache hit):
HTTP/1.1 304 Not Modified
```

### JSON Streaming

Large JSON responses are streamed incrementally using `res.write()` for O(1) memory usage instead of buffering the entire response:

```
res.write('{"states":[')
for each state:
    res.write(JSON.stringify(state))
res.write('],"metadata":...}')
res.end()
```

This prevents memory exhaustion when returning up to 1.2 million state vectors.

### TXT Batching

TXT output uses configurable batch sizes (default: 1,209 rows per flush) to balance memory usage with I/O efficiency.

## Container Architecture

```mermaid
graph TB
    subgraph "Build Stage: base"
        A[node:20-bookworm] --> B[Install Emscripten SDK]
    end

    subgraph "Build Stage: cspice"
        B --> C[Download CSPICE Toolkit]
        C --> D[Download Leapseconds Kernel]
    end

    subgraph "Build Stage: npm-deps"
        E[node:20-bookworm] --> F[npm install]
    end

    subgraph "Build Stage: wasm-build"
        D --> G[Compile CSPICE to WASM]
        G --> H[Link sgp4.js + sgp4.wasm]
    end

    subgraph "Final Stage"
        F --> I[Copy node_modules]
        H --> J[Copy WASM artifacts]
        I --> K[Copy TypeScript source]
        J --> K
        K --> L[npm run build]
        L --> M[Final Image]
    end
```

## CI/CD Pipeline

### GitHub Actions

| Workflow | Concurrency | Description |
|----------|-------------|-------------|
| CI | `cancel-in-progress: true` | New commits cancel old test runs for faster feedback |
| Publish | `cancel-in-progress: false` | Builds queue to prevent partial deployments |

### GitLab CI

| Job | Interruptible | Description |
|-----|---------------|-------------|
| build | `true` | Can be cancelled by newer pipelines |
| test:unit | `true` | Can be cancelled by newer pipelines |
| test:api | `true` | Can be cancelled by newer pipelines |
| publish | `false` | Completes to prevent partial deployments |

## Data Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│   TLE    │────▶│  Parse   │────▶│ Propagate│────▶│  State   │
│  Input   │     │          │     │          │     │  Vector  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                      │                │
                      ▼                ▼
                ┌──────────┐     ┌──────────┐
                │  Epoch   │     │   WGS    │
                │   (ET)   │     │  Model   │
                └──────────┘     └──────────┘
```
