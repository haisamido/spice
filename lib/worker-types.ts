/**
 * Worker Pool Type Definitions
 *
 * Message types for communication between main thread and worker threads.
 */

/**
 * State object returned in propagation results
 */
export interface PropagateState {
  datetime: string;
  et: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

// =============================================================================
// Main Thread → Worker Messages
// =============================================================================

/**
 * Task to propagate a TLE over a time range
 */
export interface PropagateTask {
  type: 'propagate';
  taskId: string;
  tle: { line1: string; line2: string };
  times: { et0: number; etf: number; step: number };
  model: string;
}

/**
 * Task to initialize the worker's SGP4 module
 */
export interface InitTask {
  type: 'init';
}

/**
 * Union type of all tasks that can be sent to workers
 */
export type WorkerTask = PropagateTask | InitTask;

// =============================================================================
// Worker → Main Thread Messages
// =============================================================================

/**
 * Successful propagation result
 */
export interface PropagateResult {
  type: 'propagate-result';
  taskId: string;
  states: PropagateState[];
  epoch: number;
  model: string;
}

/**
 * Error result from worker
 */
export interface ErrorResult {
  type: 'error';
  taskId: string;
  error: string;
}

/**
 * Worker initialization complete message
 */
export interface ReadyMessage {
  type: 'ready';
}

/**
 * Union type of all messages that workers can send
 */
export type WorkerMessage = PropagateResult | ErrorResult | ReadyMessage;
