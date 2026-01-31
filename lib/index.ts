/**
 * SGP4-WASM
 *
 * WebAssembly bindings for NAIF CSPICE SGP4 satellite propagator.
 *
 * @example
 * ```typescript
 * import { createSGP4 } from 'sgp4-wasm';
 *
 * const sgp4 = await createSGP4();
 * await sgp4.init();
 *
 * // ISS TLE
 * const line1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9025';
 * const line2 = '2 25544  51.6400 208.9163 0006703  30.1694  52.4571 15.49560603484012';
 *
 * const tle = sgp4.parseTLE(line1, line2);
 * const state = sgp4.propagate(tle, tle.epoch);
 *
 * console.log('Position (km):', state.position);
 * console.log('Velocity (km/s):', state.velocity);
 * ```
 */

import type {
  SGP4Module,
  TLEElements,
  StateVector,
  GeophysicalConstants,
  EmscriptenModule,
  CreateSGP4Module,
} from './types.js';

// Re-export types
export type {
  TLE,
  TLEElements,
  Position,
  Velocity,
  StateVector,
  PropagationResult,
  SGP4Module,
  GeophysicalConstants,
  GeophysicalModel,
} from './types.js';

// Dynamic import for the Emscripten module
let createModuleFactory: CreateSGP4Module | null = null;

/**
 * Load the Emscripten module factory
 */
async function getModuleFactory(): Promise<CreateSGP4Module> {
  if (createModuleFactory) {
    return createModuleFactory;
  }

  // Dynamic import of the Emscripten-generated module
  // This allows the module to work in both Node.js and browser environments
  // @ts-expect-error - WASM module is generated at build time, no type declarations
  const module = await import('../dist/sgp4.js');
  createModuleFactory = module.default as CreateSGP4Module;
  return createModuleFactory;
}

/**
 * Create a new SGP4 module instance.
 *
 * This is the main entry point for using the SGP4-WASM library.
 * Call init() on the returned module before using other methods.
 *
 * @returns Promise resolving to an SGP4 module instance
 *
 * @example
 * ```typescript
 * const sgp4 = await createSGP4();
 * await sgp4.init();
 * ```
 */
export async function createSGP4(): Promise<SGP4Module> {
  const factory = await getModuleFactory();
  const Module: EmscriptenModule = await factory();

  // Wrap C functions using cwrap for better performance
  const _sgp4_init = Module.cwrap('sgp4_init', 'number', []) as () => number;

  const _sgp4_parse_tle = Module.cwrap('sgp4_parse_tle', 'number', [
    'string',
    'string',
    'number',
  ]) as (line1: string, line2: string, elemsPtr: number) => number;

  const _sgp4_propagate = Module.cwrap('sgp4_propagate', 'number', [
    'number',
    'number',
    'number',
  ]) as (et: number, elemsPtr: number, statePtr: number) => number;

  const _sgp4_propagate_minutes = Module.cwrap(
    'sgp4_propagate_minutes',
    'number',
    ['number', 'number', 'number', 'number']
  ) as (
    tleEpoch: number,
    minutes: number,
    elemsPtr: number,
    statePtr: number
  ) => number;

  const _sgp4_utc_to_et = Module.cwrap('sgp4_utc_to_et', 'number', [
    'string',
  ]) as (utcString: string) => number;

  const _sgp4_et_to_utc = Module.cwrap('sgp4_et_to_utc', 'number', [
    'number',
    'number',
    'number',
  ]) as (et: number, bufferPtr: number, maxLen: number) => number;

  const _sgp4_get_last_error = Module.cwrap('sgp4_get_last_error', 'string', []) as () => string;

  const _sgp4_clear_error = Module.cwrap('sgp4_clear_error', null, []) as () => void;

  const _sgp4_set_geophs = Module.cwrap('sgp4_set_geophs', null, [
    'number', 'number', 'number', 'number',
    'number', 'number', 'number', 'number',
    'string',
  ]) as (
    j2: number, j3: number, j4: number, ke: number,
    qo: number, so: number, re: number, ae: number,
    modelName: string
  ) => void;

  const _sgp4_get_model = Module.cwrap('sgp4_get_model', 'string', []) as () => string;

  const _sgp4_get_geophs = Module.cwrap('sgp4_get_geophs', null, [
    'number',
  ]) as (geophsPtr: number) => void;

  // Pre-allocate reusable WASM memory buffers
  const ELEMS_SIZE = 10 * 8; // 10 doubles
  const STATE_SIZE = 6 * 8; // 6 doubles
  const GEOPHS_SIZE = 8 * 8; // 8 doubles
  const UTC_BUFFER_SIZE = 64;

  const elemsPtr = Module._malloc(ELEMS_SIZE);
  const statePtr = Module._malloc(STATE_SIZE);
  const geophsPtr = Module._malloc(GEOPHS_SIZE);
  const utcBufferPtr = Module._malloc(UTC_BUFFER_SIZE);

  let initialized = false;

  // Error sentinel value (matches wrapper.c)
  const ERROR_SENTINEL = -1.0e30;

  /**
   * Copy elements from WASM memory to Float64Array
   */
  function readElements(): Float64Array {
    const elements = new Float64Array(10);
    for (let i = 0; i < 10; i++) {
      elements[i] = Module.getValue(elemsPtr + i * 8, 'double');
    }
    return elements;
  }

  /**
   * Copy elements from Float64Array to WASM memory
   */
  function writeElements(elements: Float64Array): void {
    for (let i = 0; i < 10; i++) {
      Module.setValue(elemsPtr + i * 8, elements[i], 'double');
    }
  }

  /**
   * Read state vector from WASM memory
   */
  function readState(): StateVector {
    return {
      position: {
        x: Module.getValue(statePtr + 0 * 8, 'double'),
        y: Module.getValue(statePtr + 1 * 8, 'double'),
        z: Module.getValue(statePtr + 2 * 8, 'double'),
      },
      velocity: {
        vx: Module.getValue(statePtr + 3 * 8, 'double'),
        vy: Module.getValue(statePtr + 4 * 8, 'double'),
        vz: Module.getValue(statePtr + 5 * 8, 'double'),
      },
    };
  }

  return {
    async init(): Promise<void> {
      if (initialized) {
        return;
      }

      const result = _sgp4_init();
      if (result !== 0) {
        throw new Error(`SGP4 initialization failed: ${_sgp4_get_last_error()}`);
      }

      initialized = true;
    },

    parseTLE(line1: string, line2: string): TLEElements {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const epoch = _sgp4_parse_tle(line1, line2, elemsPtr);

      if (epoch < ERROR_SENTINEL + 1e20) {
        throw new Error(`TLE parsing failed: ${_sgp4_get_last_error()}`);
      }

      return {
        epoch,
        elements: readElements(),
      };
    },

    propagate(tle: TLEElements, epochET: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      writeElements(tle.elements);

      const result = _sgp4_propagate(epochET, elemsPtr, statePtr);

      if (result !== 0) {
        throw new Error(`Propagation failed: ${_sgp4_get_last_error()}`);
      }

      return readState();
    },

    propagateMinutes(tle: TLEElements, minutes: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      writeElements(tle.elements);

      const result = _sgp4_propagate_minutes(
        tle.epoch,
        minutes,
        elemsPtr,
        statePtr
      );

      if (result !== 0) {
        throw new Error(`Propagation failed: ${_sgp4_get_last_error()}`);
      }

      return readState();
    },

    utcToET(utcString: string): number {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const et = _sgp4_utc_to_et(utcString);

      if (et < ERROR_SENTINEL + 1e20) {
        throw new Error(`UTC conversion failed: ${_sgp4_get_last_error()}`);
      }

      return et;
    },

    etToUTC(et: number): string {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const result = _sgp4_et_to_utc(et, utcBufferPtr, UTC_BUFFER_SIZE);

      if (result !== 0) {
        throw new Error(`ET conversion failed: ${_sgp4_get_last_error()}`);
      }

      return Module.UTF8ToString(utcBufferPtr);
    },

    getLastError(): string {
      return _sgp4_get_last_error();
    },

    clearError(): void {
      _sgp4_clear_error();
    },

    setGeophysicalConstants(constants: GeophysicalConstants, modelName?: string): void {
      _sgp4_set_geophs(
        constants.J2,
        constants.J3,
        constants.J4,
        constants.KE,
        constants.QO,
        constants.SO,
        constants.RE,
        constants.AE,
        modelName || 'custom'
      );
    },

    getGeophysicalConstants(): GeophysicalConstants {
      _sgp4_get_geophs(geophsPtr);
      return {
        J2: Module.getValue(geophsPtr + 0 * 8, 'double'),
        J3: Module.getValue(geophsPtr + 1 * 8, 'double'),
        J4: Module.getValue(geophsPtr + 2 * 8, 'double'),
        KE: Module.getValue(geophsPtr + 3 * 8, 'double'),
        QO: Module.getValue(geophsPtr + 4 * 8, 'double'),
        SO: Module.getValue(geophsPtr + 5 * 8, 'double'),
        RE: Module.getValue(geophsPtr + 6 * 8, 'double'),
        AE: Module.getValue(geophsPtr + 7 * 8, 'double'),
      };
    },

    getModelName(): string {
      return _sgp4_get_model();
    },
  };
}
