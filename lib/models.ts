/**
 * Geophysical Models Loader
 *
 * Loads and caches WGS geophysical constants from JSON files.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { GeophysicalModel, GeophysicalConstants } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to data directory (relative to lib/)
const DATA_DIR = join(__dirname, '..', 'data');

// Cached models
const wgsModels: Map<string, GeophysicalModel> = new Map();

/**
 * Load all WGS models from data/wgs/ directory
 */
function loadWgsModels(): void {
  if (wgsModels.size > 0) {
    return; // Already loaded
  }

  const wgsDir = join(DATA_DIR, 'wgs');
  const files = readdirSync(wgsDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const name = file.replace('.json', '');
    const content = readFileSync(join(wgsDir, file), 'utf-8');
    const model = JSON.parse(content) as GeophysicalModel;
    wgsModels.set(name, model);
  }
}

/**
 * Get list of available WGS model names
 */
export function getWgsModelNames(): string[] {
  loadWgsModels();
  return Array.from(wgsModels.keys()).sort();
}

/**
 * Get a specific WGS model by name
 */
export function getWgsModel(name: string): GeophysicalModel | undefined {
  loadWgsModels();
  return wgsModels.get(name);
}

/**
 * Get geophysical constants for a WGS model
 */
export function getWgsConstants(name: string): GeophysicalConstants | undefined {
  const model = getWgsModel(name);
  return model?.constants;
}

/**
 * Get all available models organized by category
 */
export function getAllModels(): { wgs: string[] } {
  return {
    wgs: getWgsModelNames(),
  };
}

/**
 * Default model name
 */
export const DEFAULT_MODEL = 'wgs72';
