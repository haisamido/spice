# SPICE SGP4 Architecture

## Overview

SPICE SGP4 is a REST API service that provides satellite orbit propagation using the SGP4 algorithm implemented via NASA/JPL NAIF CSPICE compiled to WebAssembly.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client                                  │
│              (Browser, curl, Application)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Server                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │ Request Logger│  │  Swagger UI   │  │  API Routes   │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SGP4 Module (TypeScript)                    │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  TLE Parser   │  │  Propagator   │  │ Time Converter│       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CSPICE WASM Module                           │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │  SGP4 Core    │  │ Leapseconds   │  │  Geophysical  │       │
│  │  Algorithm    │  │   Kernel      │  │   Constants   │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

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

### TLE Propagation Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server as Express Server
    participant Logger as Request Logger
    participant SGP4 as SGP4 Module
    participant Models as Models Module
    participant WASM as CSPICE WASM

    Client->>Server: POST /api/spice/sgp4/propagate
    Server->>Logger: Log request

    alt Model specified
        Server->>Models: getWgsConstants(modelName)
        Models-->>Server: GeophysicalConstants
        Server->>SGP4: setGeophysicalConstants()
        SGP4->>WASM: sgp4_set_geophs()
    end

    Server->>SGP4: parseTLE(line1, line2)
    SGP4->>WASM: sgp4_parse_tle()
    WASM-->>SGP4: TLE object

    alt UTC string provided
        Server->>SGP4: utcToET(utcString)
        SGP4->>WASM: sgp4_utc_to_et()
        WASM-->>SGP4: ephemerisTime
    end

    alt minutes_from_epoch flag
        Server->>SGP4: propagateMinutes(tle, minutes)
        SGP4->>WASM: sgp4_propagate_minutes()
    else ET or default
        Server->>SGP4: propagate(tle, et)
        SGP4->>WASM: sgp4_propagate()
    end

    WASM-->>SGP4: position, velocity
    SGP4-->>Server: StateVector
    Server->>Logger: Log response
    Server-->>Client: { position, velocity, epoch, model }
```

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
    participant WASM as CSPICE WASM
    participant FS as Filesystem

    Node->>Server: Start server.js
    Server->>SGP4: createSGP4()
    SGP4->>WASM: Load sgp4.wasm
    WASM->>FS: Load naif0012.tls (leapseconds)
    FS-->>WASM: Kernel loaded
    WASM-->>SGP4: Module ready
    Server->>SGP4: init()
    SGP4->>WASM: sgp4_init()
    WASM-->>SGP4: Initialized
    SGP4-->>Server: Ready
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
| `format` | `json`, `csv` | `json` | Output format |

### Output Formats

**JSON format** (default):
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

**CSV format** (`format=csv`):
```
datetime,et,x,y,z,vx,vy,vz
2024-01-15T12:00:00.000,758592069.18,-5945.93,-3284.80,0.29,2.31,-4.16,6.01
```

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
