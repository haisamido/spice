# Test Results Summary

This directory contains the test suites and their results.

## Test Structure

```
tests/
├── README.md                    # This file
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
# Run tests in Docker (results written to ./tests/<test>/results/)
task container:test
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

### API CSV Output

The REST API also supports CSV output format via the `format=csv` query parameter:

```bash
curl -X POST "http://localhost:50000/api/spice/sgp4/propagate?t0=2024-01-15T12:00:00&tf=2024-01-15T14:00:00&step=60&format=csv" \
  -H "Content-Type: application/json" \
  -d '{"line1": "...", "line2": "..."}'
```

## Test Suites

### OMM Tests ([omm/](omm/))

- **OMM CCSDS Compliance**: Validates OMM data structures, covariance matrices, and TLE↔OMM conversions
- **TLE vs OMM Propagation Comparison**: Verifies TLE and OMM produce identical propagation results

### SGP4 Tests ([sgp4/](sgp4/))

- **SGP4 WASM Module**: Tests initialization, TLE parsing, time conversion, and orbit propagation
