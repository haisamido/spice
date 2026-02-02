# Test Results Summary

This directory contains the test suites and their results.

## Test Structure

```
tests/
├── README.md                    # This file
├── Taskfile.yaml                # API test tasks (included by root Taskfile)
├── setup.ts                     # Shared test utilities
├── omm/
│   ├── omm.test.ts              # OMM CCSDS compliance tests
│   └── results/                 # Test results
│       ├── omm-compliance-results.json
│       └── tle-vs-omm-comparison-results.json
└── sgp4/
    ├── sgp4.test.ts             # SGP4 WASM module tests
    └── results/                 # Test results
        └── sgp4-test-results.json
```

## Results by Test Suite

### OMM Results

| Result File | Description |
|-------------|-------------|
| [omm-compliance-results.json](omm/results/omm-compliance-results.json) | TLE↔OMM conversion results |
| [tle-vs-omm-comparison-results.json](omm/results/tle-vs-omm-comparison-results.json) | Propagation comparison metrics |
| [propagation-results.json](omm/results/propagation-results.json) | Full state vectors (121 points, 2 hours) |
| [propagation-results.txt](omm/results/propagation-results.txt) | Tabular state vectors (CSV format) |

### SGP4 Results

| Result File | Description |
|-------------|-------------|
| [sgp4-test-results.json](sgp4/results/sgp4-test-results.json) | Test summary with LEO position/velocity |
| [propagation-results.json](sgp4/results/propagation-results.json) | Full state vectors (121 points, 2 hours) |
| [propagation-results.txt](sgp4/results/propagation-results.txt) | Tabular state vectors (CSV format) |

## Running Tests

```bash
# Run unit tests in Docker (results written to ./tests/<test>/results/)
task container:test

# Run API tests (server must be running)
task test:api:all

# Start server, run all API tests, then stop
task container:test:api

# Run individual API test
task test:api:health
task test:api:propagate:tle:t0:json

# Run parallel load test (default: 10 requests, 100 concurrent)
task test:api:propagate:tle:t0:tf:txt:parallel

# Custom load test (10000 requests, 200 concurrent)
task test:api:propagate:tle:t0:tf:txt:parallel RUNS=10000 PARALLEL=200
```

## Output Format

### State Vector Format

Each propagation state contains:

```json
{
  "et": 758592069.1843241,
  "datetime": "2024-01-15T12:00:00.000",
  "position": [ -5945.93, -3284.80, 0.29 ],
  "velocity": [ 2.31, -4.16, 6.01 ]
}
```

| Field | Description | Units |
|-------|-------------|-------|
| `et` | SPICE Ephemeris Time (seconds past J2000) | seconds |
| `datetime` | UTC calendar representation | ISO 8601 |
| `position` | Cartesian position [x, y, z] in TEME frame | km |
| `velocity` | Cartesian velocity [vx, vy, vz] in TEME frame | km/s |

### Tabular Format (CSV)

Results are also available in tabular CSV format:

```
datetime,et,x,y,z,vx,vy,vz
2024-01-15T12:00:00.000,758592069.18,-5945.93,-3284.80,0.29,2.31,-4.16,6.01
2024-01-15T12:01:00.000,758592129.18,-5805.12,-3528.69,360.46,2.62,-3.84,5.92
...
```

| Column | Description | Units |
|--------|-------------|-------|
| `datetime` | UTC calendar representation | ISO 8601 |
| `et` | SPICE Ephemeris Time (seconds past J2000) | seconds |
| `x`, `y`, `z` | Cartesian position in TEME frame | km |
| `vx`, `vy`, `vz` | Cartesian velocity in TEME frame | km/s |

### API TXT Output

The REST API supports TXT (CSV) output format via the `output_type=txt` query parameter (default):

```bash
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00&tf=2024-01-15T14:00:00&step=60&output_type=txt" \
  -H "Content-Type: application/json" \
  -d '{"line1": "...", "line2": "..."}'
```

## Test Suites

### OMM Tests ([omm/](omm/))

- **OMM CCSDS Compliance**: Validates OMM data structures, covariance matrices, and TLE↔OMM conversions
- **TLE vs OMM Propagation Comparison**: Verifies TLE and OMM produce identical propagation results

### SGP4 Tests ([sgp4/](sgp4/))

- **SGP4 WASM Module**: Tests initialization, TLE parsing, time conversion, and orbit propagation

## Load Testing

The parallel load test task (`test:api:propagate:tle:t0:tf:txt:parallel`) runs concurrent requests against the propagate endpoint.

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `RUNS` | 10 | Total number of requests to send |
| `PARALLEL` | 100 | Maximum concurrent connections |

### Usage

```bash
# Default: 10 requests with up to 100 concurrent
task test:api:propagate:tle:t0:tf:txt:parallel

# High volume: 100,000 requests with 200 concurrent
task test:api:propagate:tle:t0:tf:txt:parallel RUNS=100000 PARALLEL=200
```

### Output

The task outputs a summary with:

- **Start/Stop time**: UTC timestamps with milliseconds
- **Concurrency**: Maximum parallel connections used
- **Total requests**: Number of requests completed
- **Successful/Failed**: HTTP 200 vs other responses
- **Response times**: Min, mean, and max response times
- **Wall time**: Total elapsed time
- **Throughput**: Requests per second

Example output:

```
=== Summary ===
Start time:      2024-01-15 12:00:00.123+00:00
Stop time:       2024-01-15 12:00:05.456+00:00
Concurrency:     100
Total requests:  1000
Successful:      1000 (HTTP 200)
Failed:          0
Response times:  min=0.045s  mean=0.123s  max=0.456s
Wall time:       5.333s
Throughput:      187.50 req/s
```
