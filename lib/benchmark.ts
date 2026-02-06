/**
 * SGP4 WASM Benchmark - Raw performance without HTTP overhead
 *
 * Usage: npx tsx lib/benchmark.ts [satellites] [step]
 *   satellites: number of satellites to simulate (default: 9534)
 *   step: time step in seconds (default: 60)
 */

import { createSGP4, type SGP4Module } from './index.js';
import { getWgsConstants } from './models.js';

const TLE = {
  line1: '1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025',
  line2: '2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19',
};

async function benchmark(satellites: number, stepSeconds: number): Promise<void> {
  console.log('Initializing SGP4 WASM module...');
  const sgp4: SGP4Module = await createSGP4();
  await sgp4.init();

  // Set up constants
  const constants = getWgsConstants('wgs72');
  if (!constants) {
    throw new Error('Failed to load wgs72 constants');
  }
  sgp4.setGeophysicalConstants(constants, 'wgs72');

  // Parse TLE once
  const tle = sgp4.parseTLE(TLE.line1, TLE.line2);

  // Calculate time range (24 hours)
  const t0 = '2024-01-15T12:00:00';
  const et0 = sgp4.utcToET(t0);
  const etf = et0 + 86400; // 24 hours
  const pointsPerSat = Math.floor((etf - et0) / stepSeconds) + 1;
  const totalProps = satellites * pointsPerSat;

  console.log(`\nBenchmark Configuration:`);
  console.log(`  Satellites:     ${satellites.toLocaleString()}`);
  console.log(`  Step size:      ${stepSeconds}s`);
  console.log(`  Points/sat:     ${pointsPerSat.toLocaleString()}`);
  console.log(`  Total props:    ${totalProps.toLocaleString()}`);
  console.log(`\nRunning benchmark...`);

  const startTime = performance.now();

  // Simulate N satellites, each propagated for 24 hours
  for (let sat = 0; sat < satellites; sat++) {
    for (let et = et0; et <= etf; et += stepSeconds) {
      sgp4.propagate(tle, et);
    }
  }

  const endTime = performance.now();
  const wallTimeMs = endTime - startTime;
  const wallTimeSec = wallTimeMs / 1000;
  const propsPerSec = totalProps / wallTimeSec;

  console.log(`\n=== Results ===`);
  console.log(`  Wall time:      ${wallTimeSec.toFixed(3)}s`);
  console.log(`  Propagations:   ${totalProps.toLocaleString()}`);
  console.log(`  Throughput:     ${propsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })} prop/s`);
  console.log(`  Per satellite:  ${(wallTimeMs / satellites).toFixed(3)}ms`);
}

// Parse CLI arguments
const satellites = parseInt(process.argv[2] || '9534', 10);
const step = parseInt(process.argv[3] || '60', 10);

benchmark(satellites, step).catch(console.error);
