/**
 * SGP4-WASM Node.js Example
 *
 * Demonstrates how to use the SGP4-WASM module to:
 * - Parse TLE (Two-Line Element) data
 * - Propagate satellite position and velocity
 * - Convert between UTC and Ephemeris Time
 *
 * Usage:
 *   node examples/node-example.js
 */

import { createSGP4 } from '../dist/index.js';

async function main() {
  console.log('=== SGP4-WASM Example ===\n');

  // Create and initialize the SGP4 module
  console.log('Initializing SGP4 module...');
  const sgp4 = await createSGP4();
  await sgp4.init();
  console.log('SGP4 module initialized.\n');

  // ISS TLE (International Space Station)
  // Note: TLE data becomes stale quickly - use current data for production
  const issLine1 = '1 25544U 98067A   21275.52628786  .00001878  00000-0  42420-4 0  9993';
  const issLine2 = '2 25544  51.6442 208.5455 0003632 357.8838  93.5765 15.48919755305790';

  console.log('ISS TLE:');
  console.log(`  Line 1: ${issLine1}`);
  console.log(`  Line 2: ${issLine2}\n`);

  // Parse the TLE
  console.log('Parsing TLE...');
  const tle = sgp4.parseTLE(issLine1, issLine2);

  console.log(`  Epoch (ET): ${tle.epoch.toFixed(3)} seconds past J2000`);
  console.log(`  Epoch (UTC): ${sgp4.etToUTC(tle.epoch)}\n`);

  // Propagate to TLE epoch (should give initial state)
  console.log('State at TLE epoch:');
  const stateAtEpoch = sgp4.propagate(tle, tle.epoch);
  printState(stateAtEpoch);

  // Propagate 1 hour into the future
  const oneHourLater = tle.epoch + 3600;
  console.log(`\nState 1 hour later (${sgp4.etToUTC(oneHourLater)}):`);
  const stateFuture = sgp4.propagate(tle, oneHourLater);
  printState(stateFuture);

  // Propagate using minutes from epoch
  console.log('\nState 90 minutes from TLE epoch (approx 1 orbit):');
  const stateOrbit = sgp4.propagateMinutes(tle, 90);
  printState(stateOrbit);

  // Propagate to a specific UTC time
  const targetTime = '2021-10-02T12:00:00';
  console.log(`\nState at ${targetTime}:`);
  const targetET = sgp4.utcToET(targetTime);
  const stateTarget = sgp4.propagate(tle, targetET);
  printState(stateTarget);

  // Generate ephemeris over time
  console.log('\n=== Ephemeris (10-minute intervals) ===\n');
  console.log('Time (UTC)                   | Position (km)                        | Range (km)');
  console.log('-'.repeat(90));

  const startET = tle.epoch;
  const stepMinutes = 10;
  const numSteps = 10;

  for (let i = 0; i < numSteps; i++) {
    const minutes = i * stepMinutes;
    const et = startET + minutes * 60;
    const state = sgp4.propagate(tle, et);
    const utc = sgp4.etToUTC(et);
    const range = Math.sqrt(
      state.position.x ** 2 +
      state.position.y ** 2 +
      state.position.z ** 2
    );

    const posStr = `[${state.position.x.toFixed(2)}, ${state.position.y.toFixed(2)}, ${state.position.z.toFixed(2)}]`;
    console.log(`${utc} | ${posStr.padEnd(36)} | ${range.toFixed(3)}`);
  }

  console.log('\n=== Example Complete ===');
}

/**
 * Print a state vector in a readable format
 */
function printState(state) {
  const { position, velocity } = state;

  // Calculate magnitudes
  const r = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);
  const v = Math.sqrt(velocity.vx ** 2 + velocity.vy ** 2 + velocity.vz ** 2);

  console.log('  Position (TEME frame):');
  console.log(`    X: ${position.x.toFixed(6)} km`);
  console.log(`    Y: ${position.y.toFixed(6)} km`);
  console.log(`    Z: ${position.z.toFixed(6)} km`);
  console.log(`    |R|: ${r.toFixed(3)} km (altitude: ${(r - 6371).toFixed(1)} km)`);

  console.log('  Velocity (TEME frame):');
  console.log(`    VX: ${velocity.vx.toFixed(6)} km/s`);
  console.log(`    VY: ${velocity.vy.toFixed(6)} km/s`);
  console.log(`    VZ: ${velocity.vz.toFixed(6)} km/s`);
  console.log(`    |V|: ${v.toFixed(6)} km/s`);
}

// Run the example
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
