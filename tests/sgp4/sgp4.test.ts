/**
 * SGP4-WASM Test Suite
 *
 * Tests for the NAIF CSPICE SGP4 WebAssembly module.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSGP4, type SGP4Module } from '../../dist/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Results directory for this test suite
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, 'results');

// Ensure results directory exists
mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * Write test results to the results directory
 */
function writeTestResult(filename: string, data: unknown): void {
  const filepath = join(RESULTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

describe('SGP4 WASM Module', () => {
  let sgp4: SGP4Module;

  // ISS TLE for testing (same as OMM tests for consistency)
  const ISS_TLE = {
    line1: '1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025',
    line2: '2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19',
  };

  // Test satellite with known expected values
  const TEST_TLE = {
    line1: '1 43908U 18111AJ  20146.60805006  .00000806  00000-0  34965-4 0  9999',
    line2: '2 43908  97.2676  47.2136 0020001 220.6050 139.3698 15.24999521 78544',
  };

  // Store test results for output
  const testResults: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    suite: 'SGP4 WASM Module',
    tests: {} as Record<string, unknown>,
  };

  beforeAll(async () => {
    sgp4 = await createSGP4();
    await sgp4.init();
  });

  afterAll(() => {
    // Write collected test results
    writeTestResult('sgp4-test-results.json', testResults);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const testModule = await createSGP4();
      await expect(testModule.init()).resolves.not.toThrow();
    });

    it('should handle multiple init calls gracefully', async () => {
      // Second init should be a no-op
      await expect(sgp4.init()).resolves.not.toThrow();
    });
  });

  describe('TLE parsing', () => {
    it('should parse valid ISS TLE', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);

      expect(tle.epoch).toBeDefined();
      expect(typeof tle.epoch).toBe('number');
      expect(tle.elements).toBeInstanceOf(Float64Array);
      expect(tle.elements.length).toBe(10);
    });

    it('should parse test TLE with known epoch', () => {
      const tle = sgp4.parseTLE(TEST_TLE.line1, TEST_TLE.line2);

      expect(tle.epoch).toBeDefined();
      // Epoch should be positive (after J2000)
      expect(tle.epoch).toBeGreaterThan(0);
    });

    it('should throw on invalid TLE line 1', () => {
      expect(() => sgp4.parseTLE('invalid line 1', ISS_TLE.line2)).toThrow();
    });

    it('should throw on invalid TLE line 2', () => {
      expect(() => sgp4.parseTLE(ISS_TLE.line1, 'invalid line 2')).toThrow();
    });

    it('should extract orbital elements correctly', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);

      // Check that elements are finite numbers
      for (let i = 0; i < 10; i++) {
        expect(Number.isFinite(tle.elements[i])).toBe(true);
      }

      // Inclination should be around 51.6 degrees (in radians ~0.9 rad)
      const incl = tle.elements[3];
      expect(incl).toBeGreaterThan(0.8);
      expect(incl).toBeLessThan(1.0);

      // Eccentricity should be small for ISS (near circular)
      const ecc = tle.elements[5];
      expect(ecc).toBeGreaterThan(0);
      expect(ecc).toBeLessThan(0.01);
    });
  });

  describe('time conversion', () => {
    it('should convert UTC to ET', () => {
      const et = sgp4.utcToET('2021-10-02T12:00:00');
      expect(typeof et).toBe('number');
      expect(et).toBeGreaterThan(0); // Past J2000
    });

    it('should convert ET to UTC', () => {
      const et = 686491269.184; // Example ET
      const utc = sgp4.etToUTC(et);
      expect(typeof utc).toBe('string');
      expect(utc).toContain('2021');
    });

    it('should round-trip UTC correctly', () => {
      const original = '2024-01-15T12:00:00';
      const et = sgp4.utcToET(original);
      const recovered = sgp4.etToUTC(et);
      expect(recovered).toContain('2024-01-15');
      expect(recovered).toContain('12:00:00');
    });

    it('should handle different UTC formats', () => {
      // ISO format
      const et1 = sgp4.utcToET('2024-06-15T18:30:00');
      expect(Number.isFinite(et1)).toBe(true);

      // Space-separated format
      const et2 = sgp4.utcToET('2024 Jun 15 18:30:00');
      expect(Number.isFinite(et2)).toBe(true);

      // Both should give similar results
      expect(Math.abs(et1 - et2)).toBeLessThan(1); // Within 1 second
    });

    it('should throw on invalid UTC string', () => {
      expect(() => sgp4.utcToET('not a date')).toThrow();
    });
  });

  describe('propagation', () => {
    it('should propagate to TLE epoch', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const state = sgp4.propagate(tle, tle.epoch);

      // Check state vector structure
      expect(state.position).toBeDefined();
      expect(state.velocity).toBeDefined();
      expect(typeof state.position.x).toBe('number');
      expect(typeof state.position.y).toBe('number');
      expect(typeof state.position.z).toBe('number');
      expect(typeof state.velocity.vx).toBe('number');
      expect(typeof state.velocity.vy).toBe('number');
      expect(typeof state.velocity.vz).toBe('number');
    });

    it('should produce reasonable LEO position', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const state = sgp4.propagate(tle, tle.epoch);

      // Calculate distance from Earth center
      const r = Math.sqrt(
        state.position.x ** 2 +
          state.position.y ** 2 +
          state.position.z ** 2
      );

      // Store result for output
      testResults.tests['LEO position'] = {
        position: state.position,
        velocity: state.velocity,
        distance_km: r,
        epoch_et: tle.epoch,
      };

      // ISS should be in LEO: above Earth surface (~6371 km) and below ~7000 km
      expect(r).toBeGreaterThan(6400);
      expect(r).toBeLessThan(6900);
    });

    it('should produce reasonable LEO velocity', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const state = sgp4.propagate(tle, tle.epoch);

      // Calculate velocity magnitude
      const v = Math.sqrt(
        state.velocity.vx ** 2 +
          state.velocity.vy ** 2 +
          state.velocity.vz ** 2
      );

      // ISS velocity should be around 7.5-7.8 km/s
      expect(v).toBeGreaterThan(7.0);
      expect(v).toBeLessThan(8.0);
    });

    it('should propagate to future epoch', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const futureET = tle.epoch + 3600; // 1 hour later
      const state = sgp4.propagate(tle, futureET);

      expect(Number.isFinite(state.position.x)).toBe(true);
      expect(Number.isFinite(state.velocity.vx)).toBe(true);
    });

    it('should propagate to past epoch', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const pastET = tle.epoch - 3600; // 1 hour earlier
      const state = sgp4.propagate(tle, pastET);

      expect(Number.isFinite(state.position.x)).toBe(true);
      expect(Number.isFinite(state.velocity.vx)).toBe(true);
    });

    it('should produce different states at different times', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);
      const state1 = sgp4.propagate(tle, tle.epoch);
      const state2 = sgp4.propagate(tle, tle.epoch + 60);

      expect(state1.position.x).not.toEqual(state2.position.x);
      expect(state1.position.y).not.toEqual(state2.position.y);
      expect(state1.position.z).not.toEqual(state2.position.z);
    });

    it('should generate full propagation results over time range', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);

      const states: Array<{
        et: number;
        minutes_from_epoch: number;
        position: [number, number, number];
        velocity: [number, number, number];
      }> = [];

      // Propagation: 2 hours with 1-minute steps
      for (let minutes = 0; minutes <= 120; minutes++) {
        const state = sgp4.propagateMinutes(tle, minutes);
        states.push({
          et: tle.epoch + minutes * 60,
          minutes_from_epoch: minutes,
          position: [state.position.x, state.position.y, state.position.z],
          velocity: [state.velocity.vx, state.velocity.vy, state.velocity.vz],
        });
      }

      // Write full propagation results (same format as OMM tests for comparison)
      writeTestResult('propagation-results.json', {
        input: {
          tle: ISS_TLE,
        },
        parameters: {
          t0: '2024-01-15T12:00:00',
          tf: '2024-01-15T14:00:00',
          step_seconds: 60,
          state_count: states.length,
        },
        states: states.map((s) => ({
          et: s.et,
          datetime: sgp4.etToUTC(s.et),
          position: s.position,
          velocity: s.velocity,
        })),
      });

      // Write tabular results (CSV format)
      const header = 'datetime,et,x,y,z,vx,vy,vz\n';
      const rows = states.map((s) => {
        const dt = sgp4.etToUTC(s.et);
        return `${dt},${s.et},${s.position[0]},${s.position[1]},${s.position[2]},${s.velocity[0]},${s.velocity[1]},${s.velocity[2]}`;
      }).join('\n');
      writeFileSync(join(RESULTS_DIR, 'propagation-results.txt'), header + rows);

      // Store summary in test results
      (testResults.tests as Record<string, unknown>)['propagation_range'] = {
        duration_hours: 2,
        step_minutes: 1,
        state_count: states.length,
        first_state: states[0],
        last_state: states[states.length - 1],
      };

      expect(states.length).toBe(121);
      expect(Number.isFinite(states[0].position[0])).toBe(true);
      expect(Number.isFinite(states[120].position[0])).toBe(true);
    });

    it('should propagate using minutes from epoch', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);

      // Propagate 10 minutes from epoch
      const state = sgp4.propagateMinutes(tle, 10);

      expect(Number.isFinite(state.position.x)).toBe(true);
      expect(Number.isFinite(state.velocity.vx)).toBe(true);

      // Should give same result as propagate with calculated ET
      const stateFromET = sgp4.propagate(tle, tle.epoch + 10 * 60);

      expect(state.position.x).toBeCloseTo(stateFromET.position.x, 6);
      expect(state.position.y).toBeCloseTo(stateFromET.position.y, 6);
      expect(state.position.z).toBeCloseTo(stateFromET.position.z, 6);
    });

    it('should handle negative minutes (past propagation)', () => {
      const tle = sgp4.parseTLE(ISS_TLE.line1, ISS_TLE.line2);

      // Propagate 30 minutes before epoch
      const state = sgp4.propagateMinutes(tle, -30);

      expect(Number.isFinite(state.position.x)).toBe(true);
      expect(Number.isFinite(state.velocity.vx)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error messages', () => {
      try {
        sgp4.parseTLE('bad', 'data');
      } catch {
        const error = sgp4.getLastError();
        expect(error.length).toBeGreaterThan(0);
      }
    });

    it('should clear error state', () => {
      try {
        sgp4.parseTLE('bad', 'data');
      } catch {
        // Error occurred
      }
      sgp4.clearError();
      const error = sgp4.getLastError();
      expect(error).toBe('');
    });
  });
});
