/**
 * SGP4 Native Addon
 *
 * Native Node.js addon with SIMD-optimized SGP4 propagation.
 * Provides the same interface as the WASM module for comparison.
 *
 * @example
 * ```typescript
 * import { createNativeSGP4 } from './sgp4-native';
 *
 * const sgp4 = await createNativeSGP4();
 * await sgp4.init();
 *
 * const tle = sgp4.parseTLE(line1, line2);
 * const state = sgp4.propagate(tle, tle.epoch);
 * ```
 */

import type {
  SGP4Module,
  TLEElements,
  StateVector,
  GeophysicalConstants,
} from './types.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Create require function for loading native addon in ES module context
const require = createRequire(import.meta.url);

// Native addon interface
interface NativeAddon {
  init(): void;
  parseTLE(line1: string, line2: string): { epoch: number; elements: Float64Array };
  propagate(elements: Float64Array, et: number): {
    position: { x: number; y: number; z: number };
    velocity: { vx: number; vy: number; vz: number };
  };
  propagateRange(
    elements: Float64Array,
    et0: number,
    etf: number,
    step: number
  ): Array<{
    et: number;
    position: { x: number; y: number; z: number };
    velocity: { vx: number; vy: number; vz: number };
  }>;
  utcToET(utc: string): number;
  etToUTC(et: number): string;
  setGeophysicalConstants(constants: GeophysicalConstants, modelName?: string): void;
  getGeophysicalConstants(): GeophysicalConstants;
  getModelName(): string;
  getLastError(): string;
  clearError(): void;
  getSimdName(): string;
}

// Singleton addon instance
let addon: NativeAddon | null = null;

/**
 * Load the native addon
 */
function loadAddon(): NativeAddon {
  if (addon) {
    return addon;
  }

  // Try multiple possible paths
  const possiblePaths = [
    // Development build path (node-gyp)
    '../build/Release/sgp4_native.node',
    // Alternative development path
    './build/Release/sgp4_native.node',
    // Installed package path
    '../native-addon/build/Release/sgp4_native.node',
  ];

  // Get directory of this module
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  let loadError: Error | null = null;

  for (const addonPath of possiblePaths) {
    try {
      const fullPath = path.resolve(__dirname, addonPath);
      // Dynamic require for native addon
      const module = require(fullPath);
      addon = module as NativeAddon;
      return addon;
    } catch (e) {
      loadError = e as Error;
      continue;
    }
  }

  throw new Error(
    `Failed to load native SGP4 addon. Build it first with: npm run build:native\n` +
      `Last error: ${loadError?.message}`
  );
}

/**
 * Create a new native SGP4 module instance.
 *
 * This provides the same interface as the WASM module but uses
 * native SIMD-optimized code for maximum performance.
 *
 * @returns Promise resolving to an SGP4 module instance
 */
export async function createNativeSGP4(): Promise<SGP4Module> {
  const native = loadAddon();
  let initialized = false;

  return {
    async init(): Promise<void> {
      if (initialized) {
        return;
      }

      native.init();
      initialized = true;
    },

    parseTLE(line1: string, line2: string): TLEElements {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const result = native.parseTLE(line1, line2);
      return {
        epoch: result.epoch,
        elements: result.elements,
      };
    },

    propagate(tle: TLEElements, epochET: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.propagate(tle.elements, epochET);
    },

    propagateMinutes(tle: TLEElements, minutes: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      // Convert minutes to ET
      const et = tle.epoch + minutes * 60.0;
      return native.propagate(tle.elements, et);
    },

    utcToET(utcString: string): number {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.utcToET(utcString);
    },

    etToUTC(et: number): string {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.etToUTC(et);
    },

    getLastError(): string {
      return native.getLastError();
    },

    clearError(): void {
      native.clearError();
    },

    setGeophysicalConstants(
      constants: GeophysicalConstants,
      modelName?: string
    ): void {
      native.setGeophysicalConstants(constants, modelName);
    },

    getGeophysicalConstants(): GeophysicalConstants {
      return native.getGeophysicalConstants();
    },

    getModelName(): string {
      return native.getModelName();
    },
  };
}

/**
 * Extended interface for native-specific features
 */
export interface NativeSGP4Module extends SGP4Module {
  /**
   * Propagate over a time range in a single call.
   * More efficient than calling propagate() in a loop.
   */
  propagateRange(
    tle: TLEElements,
    et0: number,
    etf: number,
    step: number
  ): Array<{
    et: number;
    position: { x: number; y: number; z: number };
    velocity: { vx: number; vy: number; vz: number };
  }>;

  /**
   * Get the name of the SIMD implementation in use.
   */
  getSimdName(): string;
}

/**
 * Create a native SGP4 module with extended features.
 *
 * Includes additional methods like propagateRange() and getSimdName()
 * that are not available in the WASM version.
 */
export async function createExtendedNativeSGP4(): Promise<NativeSGP4Module> {
  const native = loadAddon();
  let initialized = false;

  return {
    async init(): Promise<void> {
      if (initialized) {
        return;
      }

      native.init();
      initialized = true;
    },

    parseTLE(line1: string, line2: string): TLEElements {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const result = native.parseTLE(line1, line2);
      return {
        epoch: result.epoch,
        elements: result.elements,
      };
    },

    propagate(tle: TLEElements, epochET: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.propagate(tle.elements, epochET);
    },

    propagateMinutes(tle: TLEElements, minutes: number): StateVector {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      const et = tle.epoch + minutes * 60.0;
      return native.propagate(tle.elements, et);
    },

    propagateRange(
      tle: TLEElements,
      et0: number,
      etf: number,
      step: number
    ): Array<{
      et: number;
      position: { x: number; y: number; z: number };
      velocity: { vx: number; vy: number; vz: number };
    }> {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.propagateRange(tle.elements, et0, etf, step);
    },

    utcToET(utcString: string): number {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.utcToET(utcString);
    },

    etToUTC(et: number): string {
      if (!initialized) {
        throw new Error('SGP4 module not initialized. Call init() first.');
      }

      return native.etToUTC(et);
    },

    getLastError(): string {
      return native.getLastError();
    },

    clearError(): void {
      native.clearError();
    },

    setGeophysicalConstants(
      constants: GeophysicalConstants,
      modelName?: string
    ): void {
      native.setGeophysicalConstants(constants, modelName);
    },

    getGeophysicalConstants(): GeophysicalConstants {
      return native.getGeophysicalConstants();
    },

    getModelName(): string {
      return native.getModelName();
    },

    getSimdName(): string {
      return native.getSimdName();
    },
  };
}
