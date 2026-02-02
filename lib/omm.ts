/**
 * Orbital Mean-Elements Message (OMM) support
 *
 * OMM is a CCSDS standard (Consultative Committee for Space Data Systems)
 * for representing orbital elements in a structured format (XML/JSON).
 * This module provides conversion between OMM JSON and TLE format.
 *
 * Reference: CCSDS 502.0-B-2/B-3 Orbit Data Messages
 */

/**
 * CCSDS OMM Units (for documentation and validation)
 */
export const OMM_UNITS = {
  MEAN_MOTION: 'rev/day',
  MEAN_MOTION_DOT: 'rev/day**2',
  MEAN_MOTION_DDOT: 'rev/day**3',
  BSTAR: '1/ER', // 1/Earth radii
  SEMI_MAJOR_AXIS: 'km',
  GM: 'km**3/s**2',
  INCLINATION: 'deg',
  RA_OF_ASC_NODE: 'deg',
  ARG_OF_PERICENTER: 'deg',
  MEAN_ANOMALY: 'deg',
  MASS: 'kg',
  SOLAR_RAD_AREA: 'm**2',
  DRAG_AREA: 'm**2',
} as const;

/**
 * Covariance matrix (6x6 lower triangular, 21 elements)
 * Position/Velocity covariance in the specified reference frame.
 *
 * Order: [CX_X, CY_X, CY_Y, CZ_X, CZ_Y, CZ_Z,
 *         CX_DOT_X, CX_DOT_Y, CX_DOT_Z, CX_DOT_X_DOT,
 *         CY_DOT_X, CY_DOT_Y, CY_DOT_Z, CY_DOT_X_DOT, CY_DOT_Y_DOT,
 *         CZ_DOT_X, CZ_DOT_Y, CZ_DOT_Z, CZ_DOT_X_DOT, CZ_DOT_Y_DOT, CZ_DOT_Z_DOT]
 */
export interface OMMCovariance {
  COV_REF_FRAME?: string; // Reference frame for covariance
  CX_X: number; // km²
  CY_X: number;
  CY_Y: number;
  CZ_X: number;
  CZ_Y: number;
  CZ_Z: number;
  CX_DOT_X: number; // km²/s
  CX_DOT_Y: number;
  CX_DOT_Z: number;
  CX_DOT_X_DOT: number; // km²/s²
  CY_DOT_X: number;
  CY_DOT_Y: number;
  CY_DOT_Z: number;
  CY_DOT_X_DOT: number;
  CY_DOT_Y_DOT: number;
  CZ_DOT_X: number;
  CZ_DOT_Y: number;
  CZ_DOT_Z: number;
  CZ_DOT_X_DOT: number;
  CZ_DOT_Y_DOT: number;
  CZ_DOT_Z_DOT: number;
}

/**
 * Spacecraft parameters (optional per CCSDS)
 */
export interface OMMSpacecraftParams {
  MASS?: number; // kg
  SOLAR_RAD_AREA?: number; // m²
  SOLAR_RAD_COEFF?: number; // dimensionless
  DRAG_AREA?: number; // m²
  DRAG_COEFF?: number; // dimensionless
}

/**
 * User-defined parameters (optional per CCSDS)
 */
export interface OMMUserDefined {
  [key: string]: string | number;
}

/**
 * OMM JSON structure following CCSDS 502.0-B-2/B-3 standard
 */
export interface OMMData {
  // Header
  CCSDS_OMM_VERS?: string;
  CREATION_DATE?: string;
  ORIGINATOR?: string;
  COMMENT?: string | string[];

  // Metadata
  OBJECT_NAME: string;
  OBJECT_ID: string;
  CENTER_NAME?: string;
  REF_FRAME?: string;
  REF_FRAME_EPOCH?: string; // Reference frame epoch (ISO 8601)
  TIME_SYSTEM?: string;
  MEAN_ELEMENT_THEORY?: string;

  // Mean Keplerian Elements
  EPOCH: string;
  SEMI_MAJOR_AXIS?: number; // km (alternative to MEAN_MOTION)
  MEAN_MOTION: number; // rev/day
  ECCENTRICITY: number;
  INCLINATION: number; // degrees
  RA_OF_ASC_NODE: number; // degrees
  ARG_OF_PERICENTER: number; // degrees
  MEAN_ANOMALY: number; // degrees
  GM?: number; // km³/s² (gravitational parameter)

  // TLE-specific parameters
  EPHEMERIS_TYPE?: number;
  CLASSIFICATION_TYPE?: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO?: number;
  REV_AT_EPOCH?: number;
  BSTAR: number; // 1/Earth radii
  MEAN_MOTION_DOT: number; // rev/day²
  MEAN_MOTION_DDOT?: number; // rev/day³

  // Optional CCSDS sections
  SPACECRAFT?: OMMSpacecraftParams;
  COVARIANCE?: OMMCovariance;
  USER_DEFINED?: OMMUserDefined;
}

/**
 * TLE output from OMM conversion
 */
export interface TLEOutput {
  line1: string;
  line2: string;
  name?: string;
}

/**
 * Validate required OMM fields
 */
export function validateOMM(omm: Partial<OMMData>): omm is OMMData {
  const required = [
    'OBJECT_NAME',
    'OBJECT_ID',
    'EPOCH',
    'MEAN_MOTION',
    'ECCENTRICITY',
    'INCLINATION',
    'RA_OF_ASC_NODE',
    'ARG_OF_PERICENTER',
    'MEAN_ANOMALY',
    'NORAD_CAT_ID',
    'BSTAR',
    'MEAN_MOTION_DOT',
  ];

  for (const field of required) {
    if ((omm as Record<string, unknown>)[field] === undefined) {
      throw new Error(`Missing required OMM field: ${field}`);
    }
  }

  // Validate covariance if present
  if (omm.COVARIANCE) {
    validateCovariance(omm.COVARIANCE);
  }

  return true;
}

/**
 * Validate covariance matrix (21 elements, positive semi-definite check on diagonal)
 */
export function validateCovariance(cov: Partial<OMMCovariance>): boolean {
  const required = [
    'CX_X',
    'CY_X',
    'CY_Y',
    'CZ_X',
    'CZ_Y',
    'CZ_Z',
    'CX_DOT_X',
    'CX_DOT_Y',
    'CX_DOT_Z',
    'CX_DOT_X_DOT',
    'CY_DOT_X',
    'CY_DOT_Y',
    'CY_DOT_Z',
    'CY_DOT_X_DOT',
    'CY_DOT_Y_DOT',
    'CZ_DOT_X',
    'CZ_DOT_Y',
    'CZ_DOT_Z',
    'CZ_DOT_X_DOT',
    'CZ_DOT_Y_DOT',
    'CZ_DOT_Z_DOT',
  ];

  for (const field of required) {
    if (typeof (cov as Record<string, unknown>)[field] !== 'number') {
      throw new Error(`Missing or invalid covariance element: ${field}`);
    }
  }

  // Diagonal elements must be non-negative (variances)
  if (
    cov.CX_X! < 0 ||
    cov.CY_Y! < 0 ||
    cov.CZ_Z! < 0 ||
    cov.CX_DOT_X_DOT! < 0 ||
    cov.CY_DOT_Y_DOT! < 0 ||
    cov.CZ_DOT_Z_DOT! < 0
  ) {
    throw new Error('Covariance diagonal elements (variances) must be non-negative');
  }

  return true;
}

/**
 * Parse epoch string to year and day of year
 */
function parseEpoch(epochStr: string): { year: number; dayOfYear: number } {
  const date = new Date(epochStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid epoch format: ${epochStr}`);
  }

  const year = date.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const diff = date.getTime() - startOfYear.getTime();
  const dayOfYear = diff / (24 * 60 * 60 * 1000) + 1;

  return { year, dayOfYear };
}

/**
 * Format a number with leading zeros
 */
function padNumber(num: number, width: number): string {
  return num.toString().padStart(width, '0');
}

/**
 * Format exponential notation for TLE (e.g., " 00000-0" for 0.0 or " 10270-3" for 0.0001027)
 *
 * TLE exponential format: [sign]NNNNN[exp_sign]N
 * - sign: ' ' for positive, '-' for negative
 * - NNNNN: 5-digit mantissa (implied leading decimal point, so 10270 means 0.10270)
 * - exp_sign: '+' or '-'
 * - N: single digit exponent (power of 10)
 *
 * Example: " 10270-3" = 0.10270 × 10^-3 = 0.0001027
 */
function formatTLEExponential(value: number): string {
  if (value === 0) {
    return ' 00000-0';
  }

  const sign = value >= 0 ? ' ' : '-';
  const absValue = Math.abs(value);

  // Find exponent in scientific notation (e.g., 0.0001027 = 1.027 × 10^-4)
  const scientificExp = Math.floor(Math.log10(absValue));
  const mantissa = absValue / Math.pow(10, scientificExp);

  // Convert mantissa to 5-digit integer (with implied leading decimal point)
  // e.g., 1.027 → 10270 (representing 0.10270)
  const mantissaInt = Math.round(mantissa * 10000);
  const mantissaStr = mantissaInt.toString().padStart(5, '0');

  // TLE exponent = scientific exponent + 1 (because TLE uses 0.xxxxx format)
  // e.g., 1.027 × 10^-4 → 0.1027 × 10^-3, so TLE exp = -4 + 1 = -3
  const tleExp = scientificExp + 1;
  const expSign = tleExp >= 0 ? '+' : '-';

  return `${sign}${mantissaStr}${expSign}${Math.abs(tleExp)}`;
}

/**
 * Calculate TLE checksum (modulo 10 checksum)
 */
function calculateChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const char = line[i];
    if (char >= '0' && char <= '9') {
      sum += parseInt(char, 10);
    } else if (char === '-') {
      sum += 1;
    }
  }
  return sum % 10;
}

/**
 * Convert OMM JSON to Two-Line Element (TLE) format
 *
 * TLE Format Reference:
 * Line 1: 1 NNNNNC NNNNNAAA NNNNN.NNNNNNNN +.NNNNNNNN +NNNNN-N +NNNNN-N N NNNNN
 * Line 2: 2 NNNNN NNN.NNNN NNN.NNNN NNNNNNN NNN.NNNN NNN.NNNN NN.NNNNNNNNNNNNNN
 */
export function ommToTLE(omm: OMMData): TLEOutput {
  validateOMM(omm);

  const { year, dayOfYear } = parseEpoch(omm.EPOCH);

  // Extract international designator from OBJECT_ID (e.g., "1998-067A")
  const intlDesignator = omm.OBJECT_ID.replace('-', '');
  const launchYear = intlDesignator.slice(0, 4);
  const launchNum = intlDesignator.slice(4, 7);
  const launchPiece = intlDesignator.slice(7) || 'A';

  // Classification (default: U for Unclassified)
  const classification = omm.CLASSIFICATION_TYPE || 'U';

  // Element set number (default: 999)
  const elementSetNo = omm.ELEMENT_SET_NO || 999;

  // Revolution number at epoch
  const revAtEpoch = omm.REV_AT_EPOCH || 0;

  // Ephemeris type (default: 0 for SGP4)
  const ephemerisType = omm.EPHEMERIS_TYPE || 0;

  // Format mean motion dot (revs/day^2 / 2 in TLE)
  const meanMotionDot = omm.MEAN_MOTION_DOT / 2;
  const mmDotSign = meanMotionDot >= 0 ? ' ' : '-';
  const mmDotStr = Math.abs(meanMotionDot).toFixed(8).slice(1); // Remove leading 0

  // Format mean motion double dot
  const meanMotionDdot = omm.MEAN_MOTION_DDOT || 0;
  const mmDdotStr = formatTLEExponential(meanMotionDdot / 6);

  // Format BSTAR
  const bstarStr = formatTLEExponential(omm.BSTAR);

  // Build Line 1
  // Columns: 1-1: Line number, 3-7: Catalog number, 8: Classification
  // 10-17: Int'l designator, 19-32: Epoch, 34-43: Mean motion dot
  // 45-52: Mean motion ddot, 54-61: BSTAR, 63: Ephemeris type, 65-68: Element set
  let line1 =
    `1 ${padNumber(omm.NORAD_CAT_ID, 5)}${classification} ` +
    `${launchYear.slice(2)}${launchNum}${launchPiece.padEnd(3)} ` +
    `${(year % 100).toString().padStart(2, '0')}${dayOfYear.toFixed(8).padStart(12, '0')} ` +
    `${mmDotSign}${mmDotStr} ${mmDdotStr} ${bstarStr} ${ephemerisType} ` +
    `${padNumber(elementSetNo % 10000, 4)}`;

  // Pad to 68 characters and add checksum
  line1 = line1.padEnd(68);
  line1 = line1 + calculateChecksum(line1 + '0');

  // Build Line 2
  // Columns: 1-1: Line number, 3-7: Catalog number, 9-16: Inclination
  // 18-25: RAAN, 27-33: Eccentricity, 35-42: Arg of perigee
  // 44-51: Mean anomaly, 53-63: Mean motion, 64-68: Rev number at epoch
  const eccentricityStr = omm.ECCENTRICITY.toFixed(7).slice(2); // Remove "0."

  let line2 =
    `2 ${padNumber(omm.NORAD_CAT_ID, 5)} ` +
    `${omm.INCLINATION.toFixed(4).padStart(8)} ` +
    `${omm.RA_OF_ASC_NODE.toFixed(4).padStart(8)} ` +
    `${eccentricityStr} ` +
    `${omm.ARG_OF_PERICENTER.toFixed(4).padStart(8)} ` +
    `${omm.MEAN_ANOMALY.toFixed(4).padStart(8)} ` +
    `${omm.MEAN_MOTION.toFixed(8).padStart(11)}` +
    `${padNumber(revAtEpoch % 100000, 5)}`;

  // Pad to 68 characters and add checksum
  line2 = line2.padEnd(68);
  line2 = line2 + calculateChecksum(line2 + '0');

  return {
    line1,
    line2,
    name: omm.OBJECT_NAME,
  };
}

/**
 * Options for TLE to OMM conversion
 */
export interface TLEToOMMOptions {
  /** Optional covariance matrix to include */
  covariance?: OMMCovariance;
  /** Optional spacecraft parameters to include */
  spacecraft?: OMMSpacecraftParams;
  /** Optional user-defined parameters to include */
  userDefined?: OMMUserDefined;
}

/**
 * Convert TLE to OMM JSON format
 */
export function tleToOMM(
  line1: string,
  line2: string,
  objectName?: string,
  options?: TLEToOMMOptions
): OMMData {
  // Parse Line 1
  const catalogNumber = parseInt(line1.slice(2, 7).trim(), 10);
  const classification = line1[7];
  const intlDesignatorYear = line1.slice(9, 11);
  const intlDesignatorLaunch = line1.slice(11, 14);
  const intlDesignatorPiece = line1.slice(14, 17).trim();

  const epochYear = parseInt(line1.slice(18, 20), 10);
  const epochDay = parseFloat(line1.slice(20, 32));

  // Convert 2-digit year to 4-digit
  const fullYear = epochYear >= 57 ? 1900 + epochYear : 2000 + epochYear;

  // Convert day of year to ISO date
  const epochDate = new Date(Date.UTC(fullYear, 0, 1));
  epochDate.setTime(epochDate.getTime() + (epochDay - 1) * 24 * 60 * 60 * 1000);
  const epochStr = epochDate.toISOString().replace('Z', '');

  // Mean motion derivatives
  const meanMotionDot = parseFloat(line1.slice(33, 43).trim()) * 2;

  // Parse exponential format (e.g., " 00000-0")
  const mmDdotStr = line1.slice(44, 52).trim();
  const meanMotionDdot = parseExponential(mmDdotStr) * 6;

  const bstarStr = line1.slice(53, 61).trim();
  const bstar = parseExponential(bstarStr);

  const ephemerisType = parseInt(line1.slice(62, 63), 10);
  const elementSetNo = parseInt(line1.slice(64, 68).trim(), 10);

  // Parse Line 2
  const inclination = parseFloat(line2.slice(8, 16).trim());
  const raan = parseFloat(line2.slice(17, 25).trim());
  const eccentricity = parseFloat('0.' + line2.slice(26, 33).trim());
  const argOfPerigee = parseFloat(line2.slice(34, 42).trim());
  const meanAnomaly = parseFloat(line2.slice(43, 51).trim());
  const meanMotion = parseFloat(line2.slice(52, 63).trim());
  const revAtEpoch = parseInt(line2.slice(63, 68).trim(), 10);

  // Build international designator
  const fullIntlYear = parseInt(intlDesignatorYear, 10) >= 57 ? '19' + intlDesignatorYear : '20' + intlDesignatorYear;
  const objectId = `${fullIntlYear}-${intlDesignatorLaunch}${intlDesignatorPiece}`;

  const omm: OMMData = {
    CCSDS_OMM_VERS: '2.0',
    CREATION_DATE: process.env.MODE === 'test' ? '<TESTING_MODE>' : new Date().toISOString(),
    ORIGINATOR: 'SPICE-SGP4',
    OBJECT_NAME: objectName || 'NOT_PROVIDED',
    OBJECT_ID: objectId,
    CENTER_NAME: 'EARTH',
    REF_FRAME: 'TEME',
    TIME_SYSTEM: 'UTC',
    MEAN_ELEMENT_THEORY: 'SGP4',
    EPOCH: epochStr,
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: eccentricity,
    INCLINATION: inclination,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: argOfPerigee,
    MEAN_ANOMALY: meanAnomaly,
    EPHEMERIS_TYPE: ephemerisType,
    CLASSIFICATION_TYPE: classification,
    NORAD_CAT_ID: catalogNumber,
    ELEMENT_SET_NO: elementSetNo,
    REV_AT_EPOCH: revAtEpoch,
    BSTAR: bstar,
    MEAN_MOTION_DOT: meanMotionDot,
    MEAN_MOTION_DDOT: meanMotionDdot,
  };

  // Add optional sections if provided
  if (options?.covariance) {
    omm.COVARIANCE = options.covariance;
  }
  if (options?.spacecraft) {
    omm.SPACECRAFT = options.spacecraft;
  }
  if (options?.userDefined) {
    omm.USER_DEFINED = options.userDefined;
  }

  return omm;
}

/**
 * Parse TLE exponential format (e.g., " 12345-4" -> 0.000012345)
 */
function parseExponential(str: string): number {
  if (!str || str.trim() === '' || str.trim() === '00000-0' || str.trim() === '00000+0') {
    return 0;
  }

  const trimmed = str.trim();
  const sign = trimmed[0] === '-' ? -1 : 1;
  const mantissaStr = trimmed[0] === '-' || trimmed[0] === '+' ? trimmed.slice(1, 6) : trimmed.slice(0, 5);
  const expSign = trimmed.includes('+') ? 1 : -1;
  const expStr = trimmed.slice(-1);

  const mantissa = parseInt(mantissaStr, 10) / 100000;
  const exponent = parseInt(expStr, 10) * expSign;

  return sign * mantissa * Math.pow(10, exponent);
}
