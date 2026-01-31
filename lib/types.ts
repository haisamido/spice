/**
 * SGP4-WASM Type Definitions
 *
 * Type definitions for the NAIF CSPICE SGP4 WebAssembly module.
 */

/**
 * Two-Line Element (TLE) data structure
 */
export interface TLE {
  /** Optional satellite name (line 0) */
  name?: string;
  /** TLE line 1 (69 characters) */
  line1: string;
  /** TLE line 2 (69 characters) */
  line2: string;
}

/**
 * Parsed orbital elements from a TLE
 *
 * Contains the epoch and 10-element array used by the SGP4 propagator.
 * The elements array follows NAIF CSPICE conventions:
 *
 * | Index | Element | Units |
 * |-------|---------|-------|
 * | 0 | NDT20 | radians/minute^2 |
 * | 1 | NDD60 | radians/minute^3 |
 * | 2 | BSTAR | 1/Earth-radii |
 * | 3 | INCL | radians |
 * | 4 | NODE0 | radians |
 * | 5 | ECC | dimensionless |
 * | 6 | OMEGA | radians |
 * | 7 | M0 | radians |
 * | 8 | N0 | radians/minute |
 * | 9 | EPOCH | seconds past J2000 |
 */
export interface TLEElements {
  /** Epoch as ephemeris time (seconds past J2000 TDB) */
  epoch: number;
  /** Raw orbital elements array for CSPICE evsgp4 (10 elements) */
  elements: Float64Array;
}

/**
 * 3D position vector in kilometers
 */
export interface Position {
  /** X coordinate (km) */
  x: number;
  /** Y coordinate (km) */
  y: number;
  /** Z coordinate (km) */
  z: number;
}

/**
 * 3D velocity vector in kilometers per second
 */
export interface Velocity {
  /** X velocity component (km/s) */
  vx: number;
  /** Y velocity component (km/s) */
  vy: number;
  /** Z velocity component (km/s) */
  vz: number;
}

/**
 * Satellite state vector in TEME reference frame
 *
 * TEME (True Equator Mean Equinox) is the standard reference frame
 * for SGP4 propagation. Position is in kilometers, velocity in km/s.
 */
export interface StateVector {
  /** Position vector (km) */
  position: Position;
  /** Velocity vector (km/s) */
  velocity: Velocity;
}

/**
 * Propagation result with timestamp
 */
export interface PropagationResult extends StateVector {
  /** Ephemeris time of the state (seconds past J2000 TDB) */
  epochET: number;
  /** UTC time string in ISO format */
  epochUTC: string;
}

/**
 * Geophysical constants for SGP4 propagation
 *
 * Different geodetic systems (WGS-72, WGS-84) use slightly different
 * values for Earth's gravitational field parameters.
 */
export interface GeophysicalConstants {
  /** J2 gravitational harmonic (dimensionless) */
  J2: number;
  /** J3 gravitational harmonic (dimensionless) */
  J3: number;
  /** J4 gravitational harmonic (dimensionless) */
  J4: number;
  /** sqrt(GM) in earth-radii^(3/2) / minute */
  KE: number;
  /** Atmospheric model parameter (km) */
  QO: number;
  /** Atmospheric model parameter (km) */
  SO: number;
  /** Earth equatorial radius (km) */
  RE: number;
  /** Distance units per Earth radius */
  AE: number;
}

/**
 * Geophysical model metadata from JSON files
 */
export interface GeophysicalModel {
  /** Model name (e.g., "WGS-72", "WGS-84") */
  name: string;
  /** Description of the model */
  description: string;
  /** Source reference */
  source: string;
  /** Geophysical constants */
  constants: GeophysicalConstants;
  /** Units for each constant */
  units: Record<keyof GeophysicalConstants, string>;
}

/**
 * SGP4 module interface
 *
 * Provides methods for:
 * - Initializing the module (loading kernels)
 * - Parsing TLE data into orbital elements
 * - Propagating satellite state to any epoch
 * - Converting between UTC and ephemeris time
 */
export interface SGP4Module {
  /**
   * Initialize the SGP4 module.
   * Must be called before any other methods.
   * Loads the leapseconds kernel required for time conversions.
   *
   * @throws Error if initialization fails
   */
  init(): Promise<void>;

  /**
   * Parse a Two-Line Element set into orbital elements.
   *
   * @param line1 - First line of TLE (69 characters)
   * @param line2 - Second line of TLE (69 characters)
   * @returns Parsed orbital elements with epoch
   * @throws Error if parsing fails
   */
  parseTLE(line1: string, line2: string): TLEElements;

  /**
   * Propagate satellite state to a given ephemeris time.
   *
   * @param elements - Orbital elements from parseTLE()
   * @param epochET - Target ephemeris time (seconds past J2000 TDB)
   * @returns State vector in TEME reference frame
   * @throws Error if propagation fails
   */
  propagate(elements: TLEElements, epochET: number): StateVector;

  /**
   * Propagate satellite state to a given number of minutes from TLE epoch.
   *
   * @param elements - Orbital elements from parseTLE()
   * @param minutes - Minutes from TLE epoch (can be negative)
   * @returns State vector in TEME reference frame
   * @throws Error if propagation fails
   */
  propagateMinutes(elements: TLEElements, minutes: number): StateVector;

  /**
   * Convert a UTC time string to ephemeris time.
   *
   * Accepts various formats:
   * - ISO 8601: "2024-01-15T12:00:00"
   * - Calendar: "2024 Jan 15 12:00:00"
   *
   * @param utcString - UTC time string
   * @returns Ephemeris time (seconds past J2000 TDB)
   * @throws Error if conversion fails
   */
  utcToET(utcString: string): number;

  /**
   * Convert ephemeris time to UTC string.
   *
   * @param et - Ephemeris time (seconds past J2000 TDB)
   * @returns UTC time string in ISO format
   * @throws Error if conversion fails
   */
  etToUTC(et: number): string;

  /**
   * Get the last error message from CSPICE.
   *
   * @returns Error message string
   */
  getLastError(): string;

  /**
   * Clear the error state.
   */
  clearError(): void;

  /**
   * Set geophysical constants for SGP4 propagation.
   * Use this to switch between WGS-72 and WGS-84 models.
   *
   * @param constants - Geophysical constants object
   * @param modelName - Name of the model (e.g., "wgs72", "wgs84")
   */
  setGeophysicalConstants(constants: GeophysicalConstants, modelName?: string): void;

  /**
   * Get the current geophysical constants.
   *
   * @returns Current geophysical constants
   */
  getGeophysicalConstants(): GeophysicalConstants;

  /**
   * Get the current geophysical model name.
   *
   * @returns Model name (e.g., "wgs72", "wgs84")
   */
  getModelName(): string;
}

/**
 * Emscripten module interface (internal)
 */
export interface EmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  ccall(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ): unknown;
  cwrap(
    name: string,
    returnType: string | null,
    argTypes: string[]
  ): (...args: unknown[]) => unknown;
  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: number, type: string): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, ptr: number, maxLen: number): void;
  lengthBytesUTF8(str: string): number;
  HEAPF64: Float64Array;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
  };
}

/**
 * Module factory function type (from Emscripten)
 */
export type CreateSGP4Module = () => Promise<EmscriptenModule>;
