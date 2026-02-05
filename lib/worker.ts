/**
 * SGP4 Worker Thread
 *
 * Each worker owns an independent SGP4 WASM module instance.
 * Workers receive propagation tasks from the main thread and return results.
 */

import { parentPort } from 'worker_threads';
import { createSGP4, type SGP4Module } from './index.js';
import { getWgsConstants } from './models.js';
import type { WorkerTask, WorkerMessage, PropagateState } from './worker-types.js';

let sgp4: SGP4Module;

/**
 * Initialize the SGP4 module for this worker
 */
async function initialize(): Promise<void> {
  sgp4 = await createSGP4();
  await sgp4.init();
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

      // Propagate over the time range
      const states: PropagateState[] = [];
      const { et0, etf, step } = task.times;

      for (let et = et0; et <= etf; et += step) {
        const state = sgp4.propagate(tle, et);
        const utc = sgp4.etToUTC(et);
        states.push({
          datetime: utc,
          et,
          position: [state.position.x, state.position.y, state.position.z],
          velocity: [state.velocity.vx, state.velocity.vy, state.velocity.vz],
        });
      }

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
  console.error('Worker initialization failed:', err);
  process.exit(1);
});
