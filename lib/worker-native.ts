/**
 * SGP4 Native Worker Thread
 *
 * Worker thread using the native SIMD addon instead of WASM.
 * Each worker owns an independent native SGP4 instance.
 */

import { parentPort } from 'worker_threads';
import { createExtendedNativeSGP4, type NativeSGP4Module } from './sgp4-native.js';
import { getWgsConstants } from './models.js';
import type { WorkerTask, WorkerMessage, PropagateState } from './worker-types.js';

let sgp4: NativeSGP4Module;

/**
 * Initialize the native SGP4 module for this worker
 */
async function initialize(): Promise<void> {
  sgp4 = await createExtendedNativeSGP4();
  await sgp4.init();

  // Log SIMD implementation in use
  console.log(`Native worker initialized with ${sgp4.getSimdName()}`);

  parentPort?.postMessage({ type: 'ready' } as WorkerMessage);
}

/**
 * Handle incoming tasks from the main thread
 */
parentPort?.on('message', async (task: WorkerTask) => {
  try {
    if (task.type === 'init') {
      await initialize();
      return;
    }

    if (task.type === 'propagate') {
      // Set geophysical constants for this propagation
      const constants = getWgsConstants(task.model);
      if (constants) {
        sgp4.setGeophysicalConstants(constants, task.model);
      }

      // Parse TLE
      const tle = sgp4.parseTLE(task.tle.line1, task.tle.line2);

      // Propagate over the time range using batch function
      const { et0, etf, step } = task.times;

      // Use native batch propagation for efficiency
      const rawStates = sgp4.propagateRange(tle, et0, etf, step);

      // Convert to expected format
      const states: PropagateState[] = rawStates.map((s) => ({
        datetime: sgp4.etToUTC(s.et),
        et: s.et,
        position: [s.position.x, s.position.y, s.position.z] as [
          number,
          number,
          number,
        ],
        velocity: [s.velocity.vx, s.velocity.vy, s.velocity.vz] as [
          number,
          number,
          number,
        ],
      }));

      parentPort?.postMessage({
        type: 'propagate-result',
        taskId: task.taskId,
        states,
        epoch: tle.epoch,
        model: task.model,
      } as WorkerMessage);
    }
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      taskId: (task as { taskId?: string }).taskId || 'unknown',
      error: err instanceof Error ? err.message : String(err),
    } as WorkerMessage);
  }
});

// Auto-initialize on worker startup
initialize().catch((err) => {
  console.error('Native worker initialization failed:', err);
  process.exit(1);
});
