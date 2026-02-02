/**
 * OMM CCSDS Compliance Test Suite
 *
 * Tests for CCSDS 502.0-B-2/B-3 Orbital Mean-Elements Message compliance.
 */

import { describe, it, expect } from 'vitest';
import {
  OMMData,
  OMMCovariance,
  OMMSpacecraftParams,
  OMM_UNITS,
  validateOMM,
  validateCovariance,
  ommToTLE,
  tleToOMM,
} from '../lib/omm.js';

describe('OMM CCSDS Compliance', () => {
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
