/**
 * SGP4 Worker Pool Manager
 *
 * Manages a pool of worker threads, each with its own SGP4 WASM instance.
 * Provides task queuing, worker lifecycle management, and graceful shutdown.
 */

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import type {
  WorkerMessage,
  PropagateTask,
  PropagateResult,
} from './worker-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Internal representation of a worker in the pool
 */
interface PoolWorker {
  worker: Worker;
  busy: boolean;
  id: number;
}

/**
 * Pending task with its promise callbacks
 */
interface PendingTask {
  task: PropagateTask;
  resolve: (result: PropagateResult) => void;
  reject: (error: Error) => void;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  poolSize: number;
  busyWorkers: number;
  availableWorkers: number;
  queueLength: number;
  pendingTasks: number;
}

/**
 * SGP4 Worker Pool
 *
 * Creates and manages a pool of worker threads for parallel propagation.
 * Each worker has its own independent SGP4 WASM instance.
 */
export class SGP4WorkerPool {
  private workers: PoolWorker[] = [];
  private taskQueue: PendingTask[] = [];
  private pendingTasks = new Map<string, PendingTask>();
  private initialized = false;
  private poolSize: number;

  /**
   * Create a new worker pool
   * @param poolSize - Number of workers (defaults to CPU core count)
   */
  constructor(poolSize?: number) {
    this.poolSize =
      poolSize ||
      parseInt(process.env.SGP4_POOL_SIZE || '', 10) ||
      cpus().length;
  }

  /**
   * Initialize the worker pool
   *
   * Creates worker threads and waits for them all to be ready.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const workerPath = join(__dirname, 'worker.js');
    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(workerPath);
      const poolWorker: PoolWorker = { worker, busy: false, id: i };

      // Wait for worker to signal ready
      const initPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Worker ${i} initialization timed out`));
        }, 30000); // 30 second timeout

        const messageHandler = (msg: WorkerMessage) => {
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            worker.off('message', messageHandler);
            resolve();
          }
        };

        worker.on('message', messageHandler);
        worker.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Set up permanent message handler
      worker.on('message', (msg: WorkerMessage) => {
        this.handleMessage(poolWorker, msg);
      });

      worker.on('error', (err) => {
        console.error(`Worker ${i} error:`, err);
        this.handleWorkerError(poolWorker, err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker ${i} exited with code ${code}`);
        }
      });

      this.workers.push(poolWorker);
      initPromises.push(initPromise);
    }

    await Promise.all(initPromises);
    this.initialized = true;
    console.log(`SGP4 worker pool initialized with ${this.poolSize} workers`);
  }

  /**
   * Handle incoming messages from workers
   */
  private handleMessage(poolWorker: PoolWorker, msg: WorkerMessage): void {
    if (msg.type === 'ready') {
      return; // Already handled during initialization
    }

    const taskId =
      msg.type === 'propagate-result'
        ? msg.taskId
        : msg.type === 'error'
          ? msg.taskId
          : null;

    if (!taskId) {
      return;
    }

    const pending = this.pendingTasks.get(taskId);
    if (!pending) {
      console.warn(`Received result for unknown task: ${taskId}`);
      return;
    }

    this.pendingTasks.delete(taskId);
    poolWorker.busy = false;

    if (msg.type === 'propagate-result') {
      pending.resolve(msg);
    } else if (msg.type === 'error') {
      pending.reject(new Error(msg.error));
    }

    // Process next task in queue
    this.processQueue();
  }

  /**
   * Handle worker errors by logging and marking worker as available
   */
  private handleWorkerError(poolWorker: PoolWorker, error: Error): void {
    // We don't track which worker has which task, so we can't be certain
    // which task failed. Log the error - the task will timeout eventually.
    console.error(`Worker ${poolWorker.id} error:`, error);
    poolWorker.busy = false;
    this.processQueue();
  }

  /**
   * Process the next task in the queue if a worker is available
   */
  private processQueue(): void {
    const availableWorker = this.workers.find((w) => !w.busy);
    if (!availableWorker || this.taskQueue.length === 0) {
      return;
    }

    const pending = this.taskQueue.shift()!;
    availableWorker.busy = true;
    this.pendingTasks.set(pending.task.taskId, pending);
    availableWorker.worker.postMessage(pending.task);
  }

  /**
   * Submit a propagation task to the pool
   *
   * @param task - Propagation task parameters (without type and taskId)
   * @returns Promise that resolves with the propagation result
   */
  async propagate(
    task: Omit<PropagateTask, 'type' | 'taskId'>
  ): Promise<PropagateResult> {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized. Call initialize() first.');
    }

    const taskId = crypto.randomUUID();
    const fullTask: PropagateTask = { type: 'propagate', taskId, ...task };

    return new Promise((resolve, reject) => {
      const pending: PendingTask = { task: fullTask, resolve, reject };

      const availableWorker = this.workers.find((w) => !w.busy);
      if (availableWorker) {
        // Dispatch immediately to available worker
        availableWorker.busy = true;
        this.pendingTasks.set(taskId, pending);
        availableWorker.worker.postMessage(fullTask);
      } else {
        // Queue for later processing
        this.taskQueue.push(pending);
      }
    });
  }

  /**
   * Gracefully shut down the worker pool
   */
  async shutdown(): Promise<void> {
    // Reject any queued tasks
    for (const pending of this.taskQueue) {
      pending.reject(new Error('Worker pool shutting down'));
    }
    this.taskQueue = [];

    // Terminate all workers
    await Promise.all(
      this.workers.map(async (pw) => {
        await pw.worker.terminate();
      })
    );

    this.workers = [];
    this.pendingTasks.clear();
    this.initialized = false;
    console.log('SGP4 worker pool shut down');
  }

  /**
   * Get current pool statistics
   */
  get stats(): PoolStats {
    const busyWorkers = this.workers.filter((w) => w.busy).length;
    return {
      poolSize: this.poolSize,
      busyWorkers,
      availableWorkers: this.poolSize - busyWorkers,
      queueLength: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
    };
  }

  /**
   * Check if the pool is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton worker pool instance
 */
export const workerPool = new SGP4WorkerPool();
