/**
 * Type declarations for the Emscripten-generated SGP4 WASM module
 */

declare module '../dist/sgp4.js' {
  import type { CreateSGP4Module } from './types.js';
  const createSGP4Module: CreateSGP4Module;
  export default createSGP4Module;
}
