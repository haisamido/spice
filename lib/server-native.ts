/**
 * SPICE SGP4 Native REST API Server
 *
 * Native SIMD-optimized version of the SGP4 API.
 * Runs on port 50001 (vs WASM on port 50000) for comparison.
 */

import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import { createExtendedNativeSGP4, type NativeSGP4Module } from './sgp4-native.js';
import { getAllModels, getWgsModel, getWgsConstants, DEFAULT_MODEL } from './models.js';
import { nativeWorkerPool } from './worker-pool-native.js';
import { OMMData, ommToTLE, tleToOMM, validateOMM } from './omm.js';
import { execSync } from 'child_process';
import crypto from 'crypto';

const app = express();
app.use(compression());
app.use(express.json());

let sgp4: NativeSGP4Module;

// Server identification
const SERVER_ID = crypto.randomBytes(4).toString('hex');
let GIT_HASH = process.env.GIT_COMMIT || '-';

// Propagation limits (same as WASM server)
const MAX_POINTS = 1209602;
const CACHE_MAX_AGE = 3600;

function generateETag(params: Record<string, unknown>): string {
  const hash = crypto.createHash('md5').update(JSON.stringify(params)).digest('hex');
  return `"${hash}"`;
}

// Try to get git hash
if (GIT_HASH === '-') {
  try {
    GIT_HASH = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    GIT_HASH = '-';
  }
}

// Request logging middleware
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const originalSend = res.send;
  let responseSize = 0;

  res.send = function (body): Response {
    if (body) {
      responseSize = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
    }
    return originalSend.call(this, body);
  };

  res.on('finish', () => {
    const timestamp = new Date().toISOString().replace('Z', '+00:00');
    const ip = req.ip || req.socket.remoteAddress || '-';
    const method = req.method;
    const path = req.originalUrl;
    const protocol = `HTTP/${req.httpVersion}`;
    const status = res.statusCode;

    console.log(
      `${timestamp} - ${ip} - [native hash:${GIT_HASH} srv:${SERVER_ID}] "${method} ${path} ${protocol}" ${status} ${responseSize}`
    );
  });

  next();
}

app.use(requestLogger);

// Error handler
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * GET /api/spice/sgp4/health
 */
app.get('/api/spice/sgp4/health', (_req: Request, res: Response) => {
  const stats = nativeWorkerPool.stats;
  res.json({
    status: 'ok',
    implementation: 'native-simd',
    version: GIT_HASH,
    pool: {
      size: stats.poolSize,
      busy: stats.busyWorkers,
      available: stats.availableWorkers,
      queued: stats.queueLength,
    },
  });
});

/**
 * GET /api/spice/sgp4/pool/stats
 */
app.get('/api/spice/sgp4/pool/stats', (_req: Request, res: Response) => {
  res.json(nativeWorkerPool.stats);
});

/**
 * POST /api/spice/sgp4/parse
 */
app.post(
  '/api/spice/sgp4/parse',
  asyncHandler(async (req: Request, res: Response) => {
    const { line1, line2 } = req.body;

    if (!line1 || !line2) {
      res.status(400).json({ error: 'Missing line1 or line2' });
      return;
    }

    const tle = sgp4.parseTLE(line1, line2);
    res.json({
      epoch: tle.epoch,
      elements: Array.from(tle.elements),
    });
  })
);

/**
 * GET/POST /api/spice/sgp4/propagate
 */
async function handlePropagate(req: Request, res: Response): Promise<void> {
  // Parse query parameters
  const t0 = (req.query.t0 as string) || '';
  const tf = req.query.tf as string | undefined;
  const stepStr = req.query.step as string | undefined;
  const unit = (req.query.unit as string) || 'sec';
  const modelName = (req.query.wgs as string) || DEFAULT_MODEL;
  const inputType = (req.query.input_type as string) || 'tle';
  const outputType = (req.query.output_type as string) || 'txt';

  // Get body from POST or from body query param
  let bodyData = req.body;
  if (req.method === 'GET' && req.query.body) {
    try {
      bodyData = JSON.parse(req.query.body as string);
    } catch {
      res.status(400).json({ error: 'Invalid JSON in body query parameter' });
      return;
    }
  }

  // Validate t0
  if (!t0) {
    res.status(400).json({ error: 'Missing required parameter: t0' });
    return;
  }

  // Set geophysical constants
  const constants = getWgsConstants(modelName);
  if (!constants) {
    res.status(400).json({ error: `Unknown model: ${modelName}` });
    return;
  }
  sgp4.setGeophysicalConstants(constants, modelName);

  // Get TLE lines from input
  let line1: string;
  let line2: string;

  if (inputType === 'omm') {
    const ommData = bodyData.omm || bodyData;
    try {
      validateOMM(ommData);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    const tlePair = ommToTLE(ommData as OMMData);
    line1 = tlePair.line1;
    line2 = tlePair.line2;
  } else {
    line1 = bodyData.line1;
    line2 = bodyData.line2;
  }

  if (!line1 || !line2) {
    res.status(400).json({ error: 'Missing TLE lines in request body' });
    return;
  }

  // Convert times
  const et0 = sgp4.utcToET(t0);

  // Single time propagation
  if (!tf && !stepStr) {
    const tle = sgp4.parseTLE(line1, line2);
    const state = sgp4.propagate(tle, et0);
    const datetime = sgp4.etToUTC(et0);

    const result = {
      states: [
        {
          datetime,
          et: et0,
          position: [state.position.x, state.position.y, state.position.z],
          velocity: [state.velocity.vx, state.velocity.vy, state.velocity.vz],
        },
      ],
      epoch: tle.epoch,
      model: modelName,
      count: 1,
      t0,
      input_type: inputType,
    };

    const etag = generateETag({ line1, line2, t0, modelName });
    res.set('ETag', etag);
    res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);

    if (outputType === 'json') {
      res.json(result);
    } else {
      res.type('text/plain');
      res.send(
        'datetime,et,x,y,z,vx,vy,vz\n' +
          `${datetime},${et0},${state.position.x},${state.position.y},${state.position.z},${state.velocity.vx},${state.velocity.vy},${state.velocity.vz}`
      );
    }
    return;
  }

  // Time range propagation
  const etf = tf ? sgp4.utcToET(tf) : et0;
  let step = stepStr ? parseFloat(stepStr) : 60;
  if (unit === 'min') {
    step *= 60;
  }

  const numPoints = Math.floor((etf - et0) / step) + 1;
  if (numPoints > MAX_POINTS) {
    res.status(400).json({
      error: `Too many points: ${numPoints}. Maximum is ${MAX_POINTS}.`,
    });
    return;
  }

  // Use worker pool for time range propagation
  const result = await nativeWorkerPool.propagate({
    tle: { line1, line2 },
    times: { et0, etf, step },
    model: modelName,
  });

  const etag = generateETag({ line1, line2, t0, tf, step, modelName });
  res.set('ETag', etag);
  res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}`);

  if (outputType === 'json') {
    res.json({
      states: result.states,
      epoch: result.epoch,
      model: result.model,
      count: result.states.length,
      t0,
      tf,
      step: stepStr ? parseFloat(stepStr) : 60,
      unit,
      input_type: inputType,
    });
  } else {
    // Text output (CSV)
    res.type('text/plain');

    let output = 'datetime,et,x,y,z,vx,vy,vz\n';
    for (const s of result.states) {
      output += `${s.datetime},${s.et},${s.position[0]},${s.position[1]},${s.position[2]},${s.velocity[0]},${s.velocity[1]},${s.velocity[2]}\n`;
    }
    res.send(output);
  }
}

app.get('/api/spice/sgp4/propagate', asyncHandler(handlePropagate));
app.post('/api/spice/sgp4/propagate', asyncHandler(handlePropagate));

/**
 * GET /api/spice/sgp4/time/utc-to-et
 */
app.get(
  '/api/spice/sgp4/time/utc-to-et',
  asyncHandler(async (req: Request, res: Response) => {
    const utc = req.query.utc as string;
    if (!utc) {
      res.status(400).json({ error: 'Missing utc parameter' });
      return;
    }
    const et = sgp4.utcToET(utc);
    res.json({ utc, et });
  })
);

/**
 * GET /api/spice/sgp4/time/et-to-utc
 */
app.get(
  '/api/spice/sgp4/time/et-to-utc',
  asyncHandler(async (req: Request, res: Response) => {
    const etStr = req.query.et as string;
    if (!etStr) {
      res.status(400).json({ error: 'Missing et parameter' });
      return;
    }
    const et = parseFloat(etStr);
    const utc = sgp4.etToUTC(et);
    res.json({ et, utc });
  })
);

/**
 * GET /api/models
 */
app.get('/api/models', (_req: Request, res: Response) => {
  res.json(getAllModels());
});

/**
 * GET /api/models/:name
 */
app.get('/api/models/:name', (req: Request, res: Response) => {
  const model = getWgsModel(req.params.name);
  if (!model) {
    res.status(404).json({ error: `Unknown model: ${req.params.name}` });
    return;
  }
  res.json(model);
});

/**
 * POST /api/spice/sgp4/omm/parse
 */
app.post(
  '/api/spice/sgp4/omm/parse',
  asyncHandler(async (req: Request, res: Response) => {
    const ommData = req.body;
    try {
      validateOMM(ommData);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const tlePair = ommToTLE(ommData as OMMData);
    const tle = sgp4.parseTLE(tlePair.line1, tlePair.line2);

    res.json({
      tle: tlePair,
      epoch: tle.epoch,
      elements: Array.from(tle.elements),
    });
  })
);

/**
 * POST /api/spice/sgp4/tle/to-omm
 */
app.post(
  '/api/spice/sgp4/tle/to-omm',
  asyncHandler(async (req: Request, res: Response) => {
    const { line1, line2 } = req.body;
    if (!line1 || !line2) {
      res.status(400).json({ error: 'Missing line1 or line2' });
      return;
    }

    const omm = tleToOMM(line1, line2);
    res.json(omm);
  })
);

/**
 * POST /api/spice/sgp4/omm/to-tle
 */
app.post(
  '/api/spice/sgp4/omm/to-tle',
  asyncHandler(async (req: Request, res: Response) => {
    const ommData = req.body;
    try {
      validateOMM(ommData);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const tlePair = ommToTLE(ommData as OMMData);
    res.json(tlePair);
  })
);

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Initialize and start server
async function main() {
  const PORT = parseInt(process.env.NATIVE_PORT || '50001', 10);

  try {
    // Initialize single native SGP4 module for simple operations
    sgp4 = await createExtendedNativeSGP4();
    await sgp4.init();
    console.log('Native SGP4 module initialized');

    // Initialize native worker pool
    await nativeWorkerPool.initialize();

    app.listen(PORT, () => {
      console.log(`Native SGP4 server listening on port ${PORT}`);
      console.log(`  Health:    http://localhost:${PORT}/api/spice/sgp4/health`);
      console.log(`  Propagate: http://localhost:${PORT}/api/spice/sgp4/propagate`);
    });
  } catch (err) {
    console.error('Failed to start native server:', err);
    process.exit(1);
  }
}

main();
