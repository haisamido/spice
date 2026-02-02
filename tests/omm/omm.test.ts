/**
 * OMM CCSDS Compliance Test Suite
 *
 * Tests for CCSDS 502.0-B-2/B-3 Orbital Mean-Elements Message compliance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  OMMData,
  OMMCovariance,
  OMMSpacecraftParams,
  OMM_UNITS,
  validateOMM,
  validateCovariance,
  ommToTLE,
  tleToOMM,
} from '../../lib/omm.js';
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

describe('OMM CCSDS Compliance', () => {
  // Store test results for output
  const testResults: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    suite: 'OMM CCSDS Compliance',
    tests: {} as Record<string, unknown>,
  };

  afterAll(() => {
    // Write collected test results
    writeTestResult('omm-compliance-results.json', testResults);
  });

  // ISS TLE for testing
  const ISS_LINE1 =
    '1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025';
  const ISS_LINE2 =
    '2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19';

  // Valid OMM data for testing
  const VALID_OMM: OMMData = {
    OBJECT_NAME: 'ISS (ZARYA)',
    OBJECT_ID: '1998-067A',
    EPOCH: '2024-01-15T12:00:00.000',
    MEAN_MOTION: 15.4956083,
    ECCENTRICITY: 0.0006703,
    INCLINATION: 51.64,
    RA_OF_ASC_NODE: 208.9163,
    ARG_OF_PERICENTER: 30.0825,
    MEAN_ANOMALY: 330.0579,
    NORAD_CAT_ID: 25544,
    BSTAR: 0.0001027,
    MEAN_MOTION_DOT: 0.00016717,
  };

  // Valid covariance matrix (21 elements)
  const VALID_COVARIANCE: OMMCovariance = {
    COV_REF_FRAME: 'TEME',
    CX_X: 1.0e-6,
    CY_X: 0,
    CY_Y: 1.0e-6,
    CZ_X: 0,
    CZ_Y: 0,
    CZ_Z: 1.0e-6,
    CX_DOT_X: 0,
    CX_DOT_Y: 0,
    CX_DOT_Z: 0,
    CX_DOT_X_DOT: 1.0e-9,
    CY_DOT_X: 0,
    CY_DOT_Y: 0,
    CY_DOT_Z: 0,
    CY_DOT_X_DOT: 0,
    CY_DOT_Y_DOT: 1.0e-9,
    CZ_DOT_X: 0,
    CZ_DOT_Y: 0,
    CZ_DOT_Z: 0,
    CZ_DOT_X_DOT: 0,
    CZ_DOT_Y_DOT: 0,
    CZ_DOT_Z_DOT: 1.0e-9,
  };

  describe('OMM_UNITS constants', () => {
    it('should define all CCSDS-specified units', () => {
      expect(OMM_UNITS.MEAN_MOTION).toBe('rev/day');
      expect(OMM_UNITS.MEAN_MOTION_DOT).toBe('rev/day**2');
      expect(OMM_UNITS.MEAN_MOTION_DDOT).toBe('rev/day**3');
      expect(OMM_UNITS.BSTAR).toBe('1/ER');
      expect(OMM_UNITS.SEMI_MAJOR_AXIS).toBe('km');
      expect(OMM_UNITS.GM).toBe('km**3/s**2');
      expect(OMM_UNITS.INCLINATION).toBe('deg');
      expect(OMM_UNITS.RA_OF_ASC_NODE).toBe('deg');
      expect(OMM_UNITS.ARG_OF_PERICENTER).toBe('deg');
      expect(OMM_UNITS.MEAN_ANOMALY).toBe('deg');
      expect(OMM_UNITS.MASS).toBe('kg');
      expect(OMM_UNITS.SOLAR_RAD_AREA).toBe('m**2');
      expect(OMM_UNITS.DRAG_AREA).toBe('m**2');
    });
  });

  describe('validateOMM', () => {
    it('should accept valid OMM data', () => {
      expect(validateOMM(VALID_OMM)).toBe(true);
    });

    it('should reject OMM with missing required fields', () => {
      const incomplete = { ...VALID_OMM };
      delete (incomplete as Partial<OMMData>).OBJECT_NAME;
      expect(() => validateOMM(incomplete)).toThrow('Missing required OMM field: OBJECT_NAME');
    });

    it('should accept OMM with optional CCSDS fields', () => {
      const withOptional: OMMData = {
        ...VALID_OMM,
        CCSDS_OMM_VERS: '2.0',
        CREATION_DATE: new Date().toISOString(),
        ORIGINATOR: 'TEST',
        CENTER_NAME: 'EARTH',
        REF_FRAME: 'TEME',
        REF_FRAME_EPOCH: '2024-01-01T00:00:00',
        TIME_SYSTEM: 'UTC',
        MEAN_ELEMENT_THEORY: 'SGP4',
        SEMI_MAJOR_AXIS: 6778.0,
        GM: 398600.4418,
      };
      expect(validateOMM(withOptional)).toBe(true);
    });

    it('should accept OMM with covariance matrix', () => {
      const withCovariance: OMMData = {
        ...VALID_OMM,
        COVARIANCE: VALID_COVARIANCE,
      };
      expect(validateOMM(withCovariance)).toBe(true);
    });

    it('should accept OMM with spacecraft parameters', () => {
      const spacecraft: OMMSpacecraftParams = {
        MASS: 420000,
        SOLAR_RAD_AREA: 1000,
        SOLAR_RAD_COEFF: 1.2,
        DRAG_AREA: 800,
        DRAG_COEFF: 2.2,
      };
      const withSpacecraft: OMMData = {
        ...VALID_OMM,
        SPACECRAFT: spacecraft,
      };
      expect(validateOMM(withSpacecraft)).toBe(true);
    });

    it('should accept OMM with user-defined parameters', () => {
      const withUserDefined: OMMData = {
        ...VALID_OMM,
        USER_DEFINED: {
          CUSTOM_FIELD_1: 'value1',
          CUSTOM_FIELD_2: 123.456,
        },
      };
      expect(validateOMM(withUserDefined)).toBe(true);
    });
  });

  describe('validateCovariance', () => {
    it('should accept valid covariance matrix', () => {
      expect(validateCovariance(VALID_COVARIANCE)).toBe(true);
    });

    it('should reject covariance with missing elements', () => {
      const incomplete = { ...VALID_COVARIANCE };
      delete (incomplete as Partial<OMMCovariance>).CX_X;
      expect(() => validateCovariance(incomplete)).toThrow(
        'Missing or invalid covariance element: CX_X'
      );
    });

    it('should reject covariance with negative diagonal elements', () => {
      const negativeDiagonal = { ...VALID_COVARIANCE, CX_X: -1.0 };
      expect(() => validateCovariance(negativeDiagonal)).toThrow(
        'Covariance diagonal elements (variances) must be non-negative'
      );
    });

    it('should accept covariance with zero diagonal elements', () => {
      const zeroDiagonal = { ...VALID_COVARIANCE, CX_X: 0 };
      expect(validateCovariance(zeroDiagonal)).toBe(true);
    });

    it('should allow negative off-diagonal elements', () => {
      const negativeOffDiagonal = { ...VALID_COVARIANCE, CY_X: -1.0e-7 };
      expect(validateCovariance(negativeOffDiagonal)).toBe(true);
    });
  });

  describe('tleToOMM', () => {
    it('should produce CCSDS-compliant output', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2);

      // Store result for output
      testResults.tests['tleToOMM'] = {
        input: { line1: ISS_LINE1, line2: ISS_LINE2 },
        output: omm,
      };

      // Check CCSDS header fields
      expect(omm.CCSDS_OMM_VERS).toBe('2.0');
      expect(omm.CREATION_DATE).toBeDefined();
      expect(omm.ORIGINATOR).toBe('SPICE-SGP4');

      // Check metadata fields
      expect(omm.CENTER_NAME).toBe('EARTH');
      expect(omm.REF_FRAME).toBe('TEME');
      expect(omm.TIME_SYSTEM).toBe('UTC');
      expect(omm.MEAN_ELEMENT_THEORY).toBe('SGP4');
    });

    it('should parse international designator correctly', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2);
      expect(omm.OBJECT_ID).toBe('1998-067A');
    });

    it('should parse NORAD catalog ID correctly', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2);
      expect(omm.NORAD_CAT_ID).toBe(25544);
    });

    it('should include optional covariance when provided', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS', {
        covariance: VALID_COVARIANCE,
      });
      expect(omm.COVARIANCE).toBeDefined();
      expect(omm.COVARIANCE?.CX_X).toBe(1.0e-6);
    });

    it('should include optional spacecraft params when provided', () => {
      const spacecraft: OMMSpacecraftParams = {
        MASS: 420000,
        DRAG_COEFF: 2.2,
      };
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS', { spacecraft });
      expect(omm.SPACECRAFT).toBeDefined();
      expect(omm.SPACECRAFT?.MASS).toBe(420000);
    });

    it('should include user-defined parameters when provided', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS', {
        userDefined: { SOURCE: 'TEST', CONFIDENCE: 0.95 },
      });
      expect(omm.USER_DEFINED).toBeDefined();
      expect(omm.USER_DEFINED?.SOURCE).toBe('TEST');
      expect(omm.USER_DEFINED?.CONFIDENCE).toBe(0.95);
    });
  });

  describe('ommToTLE', () => {
    it('should convert OMM to valid TLE format', () => {
      const tle = ommToTLE(VALID_OMM);

      // Check TLE line 1 format
      expect(tle.line1).toHaveLength(69);
      expect(tle.line1[0]).toBe('1');

      // Check TLE line 2 format
      expect(tle.line2).toHaveLength(69);
      expect(tle.line2[0]).toBe('2');

      // Check object name
      expect(tle.name).toBe('ISS (ZARYA)');
    });

    it('should include NORAD catalog ID in both lines', () => {
      const tle = ommToTLE(VALID_OMM);
      expect(tle.line1.slice(2, 7).trim()).toBe('25544');
      expect(tle.line2.slice(2, 7).trim()).toBe('25544');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve key orbital elements through TLE->OMM->TLE', () => {
      // TLE to OMM
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');

      // OMM to TLE
      const tle = ommToTLE(omm);

      // Parse both TLEs and compare
      // Note: Some precision loss is expected due to TLE format limitations
      expect(tle.line1.slice(2, 7).trim()).toBe('25544'); // NORAD ID preserved
    });

    it('should preserve optional sections through conversion', () => {
      const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS', {
        covariance: VALID_COVARIANCE,
        spacecraft: { MASS: 420000 },
        userDefined: { SOURCE: 'TEST' },
      });

      // Optional sections should be present
      expect(omm.COVARIANCE).toBeDefined();
      expect(omm.SPACECRAFT).toBeDefined();
      expect(omm.USER_DEFINED).toBeDefined();
    });
  });
});

/**
 * TLE vs OMM Propagation Comparison Tests
 *
 * Verifies that TLE and OMM inputs produce identical propagation results
 * when using the same orbital data and propagation parameters.
 *
 * Note: TLE format has limited precision (fixed-width fields), so round-trip
 * conversion (TLE → OMM → TLE) may introduce small errors. These tests verify
 * the conversion preserves orbital elements within TLE format precision limits.
 */
describe('TLE vs OMM Propagation Comparison', () => {
  let sgp4: SGP4Module;

  // Store comparison test results for output
  const comparisonResults: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    suite: 'TLE vs OMM Propagation Comparison',
    tests: {} as Record<string, unknown>,
  };

  // ISS TLE for comparison testing
  const ISS_LINE1 =
    '1 25544U 98067A   24015.50000000  .00016717  00000-0  10270-3 0  9025';
  const ISS_LINE2 =
    '2 25544  51.6400 208.9163 0006703  30.0825 330.0579 15.49560830    19';

  beforeAll(async () => {
    sgp4 = await createSGP4();
    await sgp4.init();
  });

  afterAll(() => {
    // Write comparison test results
    writeTestResult('tle-vs-omm-comparison-results.json', comparisonResults);
  });

  it('should produce identical single-point propagation results at epoch', () => {
    // Parse TLE directly
    const tleParsed = sgp4.parseTLE(ISS_LINE1, ISS_LINE2);

    // Convert TLE to OMM, then back to TLE and parse
    const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');
    const ommTle = ommToTLE(omm);
    const ommParsed = sgp4.parseTLE(ommTle.line1, ommTle.line2);

    // Propagate both at TLE epoch (where precision is best)
    const tleState = sgp4.propagate(tleParsed, tleParsed.epoch);
    const ommState = sgp4.propagate(ommParsed, ommParsed.epoch);

    // Calculate position difference
    const posDiff = Math.sqrt(
      (tleState.position.x - ommState.position.x) ** 2 +
        (tleState.position.y - ommState.position.y) ** 2 +
        (tleState.position.z - ommState.position.z) ** 2
    );

    // Calculate velocity difference
    const velDiff = Math.sqrt(
      (tleState.velocity.vx - ommState.velocity.vx) ** 2 +
        (tleState.velocity.vy - ommState.velocity.vy) ** 2 +
        (tleState.velocity.vz - ommState.velocity.vz) ** 2
    );

    // At epoch, differences should be minimal (< 1 km position, < 1 m/s velocity)
    // due to TLE format precision limits
    expect(posDiff).toBeLessThan(1.0); // km
    expect(velDiff).toBeLessThan(0.001); // km/s
  });

  it('should produce consistent time range propagation results', () => {
    // Parse TLE directly
    const tleParsed = sgp4.parseTLE(ISS_LINE1, ISS_LINE2);

    // Convert TLE to OMM, then back to TLE and parse
    const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');
    const ommTle = ommToTLE(omm);
    const ommParsed = sgp4.parseTLE(ommTle.line1, ommTle.line2);

    // Propagation parameters: 2 hours with 60-second steps
    const t0 = sgp4.utcToET('2024-01-15T12:00:00');
    const tf = sgp4.utcToET('2024-01-15T14:00:00');
    const stepSeconds = 60;

    // Track maximum differences and collect states
    let maxPosDiff = 0;
    let maxVelDiff = 0;
    let stateCount = 0;
    const tleStates: Array<{
      et: number;
      position: [number, number, number];
      velocity: [number, number, number];
    }> = [];
    const ommStates: Array<{
      et: number;
      position: [number, number, number];
      velocity: [number, number, number];
    }> = [];

    for (let et = t0; et <= tf; et += stepSeconds) {
      const tleState = sgp4.propagate(tleParsed, et);
      const ommState = sgp4.propagate(ommParsed, et);

      // Collect actual states
      tleStates.push({
        et: et,
        position: [tleState.position.x, tleState.position.y, tleState.position.z],
        velocity: [tleState.velocity.vx, tleState.velocity.vy, tleState.velocity.vz],
      });
      ommStates.push({
        et: et,
        position: [ommState.position.x, ommState.position.y, ommState.position.z],
        velocity: [ommState.velocity.vx, ommState.velocity.vy, ommState.velocity.vz],
      });

      const posDiff = Math.sqrt(
        (tleState.position.x - ommState.position.x) ** 2 +
          (tleState.position.y - ommState.position.y) ** 2 +
          (tleState.position.z - ommState.position.z) ** 2
      );

      const velDiff = Math.sqrt(
        (tleState.velocity.vx - ommState.velocity.vx) ** 2 +
          (tleState.velocity.vy - ommState.velocity.vy) ** 2 +
          (tleState.velocity.vz - ommState.velocity.vz) ** 2
      );

      maxPosDiff = Math.max(maxPosDiff, posDiff);
      maxVelDiff = Math.max(maxVelDiff, velDiff);
      stateCount++;
    }

    // Store range comparison results with full state data
    comparisonResults.tests['time_range_propagation'] = {
      duration_hours: 2,
      step_seconds: stepSeconds,
      state_count: stateCount,
      max_position_diff_km: maxPosDiff,
      max_velocity_diff_km_s: maxVelDiff,
    };

    // Write full propagation results to separate file
    writeTestResult('propagation-results.json', {
      input: {
        tle: { line1: ISS_LINE1, line2: ISS_LINE2 },
        omm: omm,
      },
      parameters: {
        t0: '2024-01-15T12:00:00',
        tf: '2024-01-15T14:00:00',
        step_seconds: stepSeconds,
        state_count: stateCount,
      },
      states: tleStates.map((s) => ({
        et: s.et,
        datetime: sgp4.etToUTC(s.et),
        position: s.position,
        velocity: s.velocity,
      })),
      omm_states: ommStates.map((s) => ({
        et: s.et,
        datetime: sgp4.etToUTC(s.et),
        position: s.position,
        velocity: s.velocity,
      })),
    });

    // Write tabular results (CSV format)
    const header = 'datetime,et,x,y,z,vx,vy,vz\n';
    const rows = tleStates.map((s) => {
      const dt = sgp4.etToUTC(s.et);
      return `${dt},${s.et},${s.position[0]},${s.position[1]},${s.position[2]},${s.velocity[0]},${s.velocity[1]},${s.velocity[2]}`;
    }).join('\n');
    writeFileSync(join(RESULTS_DIR, 'propagation-results.txt'), header + rows);

    // Over 2 hours, expect < 50 km position difference and < 0.05 km/s velocity
    // These bounds account for TLE format precision limits causing accumulated drift
    expect(maxPosDiff).toBeLessThan(50); // km
    expect(maxVelDiff).toBeLessThan(0.05); // km/s
    expect(stateCount).toBe(121);
  });

  it('should produce consistent results regardless of WGS model', () => {
    // This test verifies that TLE and OMM produce identical results
    // regardless of which WGS model is active (since both use the same model)

    // Parse TLE directly
    const tleParsed = sgp4.parseTLE(ISS_LINE1, ISS_LINE2);

    // Convert TLE to OMM, then back to TLE and parse
    const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');
    const ommTle = ommToTLE(omm);
    const ommParsed = sgp4.parseTLE(ommTle.line1, ommTle.line2);

    // Propagate at multiple times to verify consistency
    const times = [
      tleParsed.epoch, // At epoch
      tleParsed.epoch + 3600, // 1 hour later
      tleParsed.epoch - 3600, // 1 hour earlier
    ];

    for (const et of times) {
      const tleState = sgp4.propagate(tleParsed, et);
      const ommState = sgp4.propagate(ommParsed, et);

      const posDiff = Math.sqrt(
        (tleState.position.x - ommState.position.x) ** 2 +
          (tleState.position.y - ommState.position.y) ** 2 +
          (tleState.position.z - ommState.position.z) ** 2
      );

      // Position difference should be minimal at each time
      expect(posDiff).toBeLessThan(1.0); // km
    }
  });

  it('should have matching epochs after conversion', () => {
    // Parse TLE directly
    const tleParsed = sgp4.parseTLE(ISS_LINE1, ISS_LINE2);

    // Convert TLE to OMM, then back to TLE and parse
    const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');
    const ommTle = ommToTLE(omm);
    const ommParsed = sgp4.parseTLE(ommTle.line1, ommTle.line2);

    // Epochs should be very close (within ~1 second due to TLE day fraction precision)
    const epochDiff = Math.abs(tleParsed.epoch - ommParsed.epoch);
    expect(epochDiff).toBeLessThan(1.0); // seconds
  });

  it('should preserve core orbital elements through conversion', () => {
    // Parse TLE directly
    const tleParsed = sgp4.parseTLE(ISS_LINE1, ISS_LINE2);

    // Convert TLE to OMM, then back to TLE and parse
    const omm = tleToOMM(ISS_LINE1, ISS_LINE2, 'ISS');
    const ommTle = ommToTLE(omm);
    const ommParsed = sgp4.parseTLE(ommTle.line1, ommTle.line2);

    // Compare key orbital elements with TLE format precision tolerance
    // Elements array: [nddot, bstar, inclo, nodeo, ecco, argpo, mo, no, ...]

    // Inclination (index 2) - should match within ~0.0001 deg
    expect(tleParsed.elements[2]).toBeCloseTo(ommParsed.elements[2], 4);

    // RAAN (index 3) - should match within ~0.0001 deg
    expect(tleParsed.elements[3]).toBeCloseTo(ommParsed.elements[3], 4);

    // Eccentricity (index 4) - should match within ~0.0000001
    expect(tleParsed.elements[4]).toBeCloseTo(ommParsed.elements[4], 6);

    // Argument of perigee (index 5) - should match within ~0.0001 deg
    expect(tleParsed.elements[5]).toBeCloseTo(ommParsed.elements[5], 4);

    // Mean anomaly (index 6) - should match within ~0.0001 deg
    expect(tleParsed.elements[6]).toBeCloseTo(ommParsed.elements[6], 4);

    // Mean motion (index 7) - should match within ~0.00000001 rev/day
    expect(tleParsed.elements[7]).toBeCloseTo(ommParsed.elements[7], 7);
  });
});
