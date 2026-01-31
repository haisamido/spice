/**
 * SPICE SGP4 REST API Server
 *
 * Provides RESTful endpoints for SGP4 satellite propagation.
 */

import express, { Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createSGP4, type SGP4Module } from './index.js';
import { getAllModels, getWgsModel, getWgsConstants, DEFAULT_MODEL } from './models.js';
import { OMMData, ommToTLE, tleToOMM, validateOMM } from './omm.js';
import { execSync } from 'child_process';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

let sgp4: SGP4Module;

// Server identification
const SERVER_ID = crypto.randomBytes(4).toString('hex');
let GIT_HASH = process.env.GIT_COMMIT || '-';

// Try to get git hash if not provided
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
      `${timestamp} - ${ip} - [hash:${GIT_HASH} srv:${SERVER_ID}] "${method} ${path} ${protocol}" ${status} ${responseSize}`
    );
  });

  next();
}

app.use(requestLogger);

// Load OpenAPI spec and serve Swagger UI
const openapiPath = join(__dirname, 'openapi.yaml');
const openapiSpec = YAML.load(openapiPath);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'SPICE SGP4 API',
  customCss: '.swagger-ui .topbar { display: none }'
}));

// Serve OpenAPI spec as JSON
app.get('/api/openapi.json', (_req: Request, res: Response) => {
  res.json(openapiSpec);
});

// Initialize SGP4 module
async function initSGP4(): Promise<void> {
  sgp4 = await createSGP4();
  await sgp4.init();
  console.log('SGP4 module initialized');
}

// Error handler middleware
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * POST /api/spice/sgp4/parse
 * Parse TLE and return orbital elements
 *
 * Body: { line1: string, line2: string }
 * Returns: { epoch: number, elements: number[] }
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
 * POST /api/spice/sgp4/propagate
 * Unified propagation endpoint for TLE or OMM input
 *
 * Query: ?t0=<UTC>[&tf=<UTC>&step=<number>&unit=sec|min][&wgs=wgs72|wgs84][&input_type=tle|omm]
 * Body for TLE (default): { line1: string, line2: string }
 * Body for OMM: { omm: OMMData }
 *
 * If only t0 is provided: returns single state at t0
 * If t0, tf, step provided: returns array of states from t0 to tf
 */
app.post(
  '/api/spice/sgp4/propagate',
  asyncHandler(async (req: Request, res: Response) => {
    const t0 = req.query.t0 as string | undefined;
    const tf = req.query.tf as string | undefined;
    const stepStr = req.query.step as string | undefined;
    const unit = (req.query.unit as string) || 'sec';
    const queryModel = req.query.wgs as string | undefined;
    const inputType = (req.query.input_type as string) || 'tle';

    if (!t0) {
      res.status(400).json({ error: 'Missing t0 query parameter' });
      return;
    }

    if (inputType !== 'tle' && inputType !== 'omm') {
      res.status(400).json({ error: 'Invalid input_type (must be tle or omm)' });
      return;
    }

    // Model selection
    const modelName = queryModel || DEFAULT_MODEL;
    const constants = getWgsConstants(modelName);

    if (!constants) {
      res.status(400).json({ error: `Unknown model: ${modelName}` });
      return;
    }

    sgp4.setGeophysicalConstants(constants, modelName);

    // Parse input based on input_type
    let tle;
    if (inputType === 'omm') {
      const { omm } = req.body;
      if (!omm) {
        res.status(400).json({ error: 'Missing omm object in request body' });
        return;
      }
      try {
        validateOMM(omm);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      const tleOutput = ommToTLE(omm as OMMData);
      tle = sgp4.parseTLE(tleOutput.line1, tleOutput.line2);
    } else {
      const { line1, line2 } = req.body;
      if (!line1 || !line2) {
        res.status(400).json({ error: 'Missing line1 or line2' });
        return;
      }
      tle = sgp4.parseTLE(line1, line2);
    }

    const et0 = sgp4.utcToET(t0);

    // Single time mode: only t0 provided
    if (!tf && !stepStr) {
      const state = sgp4.propagate(tle, et0);
      const utc = sgp4.etToUTC(et0);
      res.json({
        states: [
          {
            time: utc,
            et: et0,
            position: state.position,
            velocity: state.velocity,
          },
        ],
        epoch: tle.epoch,
        model: modelName,
        count: 1,
        t0,
        input_type: inputType,
      });
      return;
    }

    // Range mode: t0, tf, step all required
    if (!tf || !stepStr) {
      res.status(400).json({ error: 'For range mode, both tf and step are required' });
      return;
    }

    const step = parseFloat(stepStr);
    if (isNaN(step) || step <= 0) {
      res.status(400).json({ error: 'Invalid step value (must be positive number)' });
      return;
    }

    if (unit !== 'sec' && unit !== 'min') {
      res.status(400).json({ error: 'Invalid unit (must be sec or min)' });
      return;
    }

    const etf = sgp4.utcToET(tf);

    if (etf <= et0) {
      res.status(400).json({ error: 'tf must be greater than t0' });
      return;
    }

    // Convert step to seconds
    const stepSeconds = unit === 'min' ? step * 60 : step;

    // Limit number of points to prevent memory issues
    const maxPoints = 10000;
    const estimatedPoints = Math.ceil((etf - et0) / stepSeconds) + 1;
    if (estimatedPoints > maxPoints) {
      res.status(400).json({
        error: `Too many points (${estimatedPoints}). Maximum allowed is ${maxPoints}. Increase step size.`,
      });
      return;
    }

    // Propagate over time range
    const states: Array<{
      time: string;
      et: number;
      position: { x: number; y: number; z: number };
      velocity: { vx: number; vy: number; vz: number };
    }> = [];

    for (let et = et0; et <= etf; et += stepSeconds) {
      const state = sgp4.propagate(tle, et);
      const utc = sgp4.etToUTC(et);
      states.push({
        time: utc,
        et: et,
        position: state.position,
        velocity: state.velocity,
      });
    }

    res.json({
      states,
      epoch: tle.epoch,
      model: modelName,
      count: states.length,
      t0,
      tf,
      step,
      unit,
      input_type: inputType,
    });
  })
);

/**
 * GET /api/spice/sgp4/time/utc-to-et
 * Convert UTC string to Ephemeris Time
 *
 * Query: ?utc=2024-01-15T12:00:00
 * Returns: { et: number }
 */
app.get(
  '/api/spice/sgp4/time/utc-to-et',
  asyncHandler(async (req: Request, res: Response) => {
    const utc = req.query.utc as string;

    if (!utc) {
      res.status(400).json({ error: 'Missing utc query parameter' });
      return;
    }

    const et = sgp4.utcToET(utc);
    res.json({ et });
  })
);

/**
 * GET /api/spice/sgp4/time/et-to-utc
 * Convert Ephemeris Time to UTC string
 *
 * Query: ?et=686491269.184
 * Returns: { utc: string }
 */
app.get(
  '/api/spice/sgp4/time/et-to-utc',
  asyncHandler(async (req: Request, res: Response) => {
    const etStr = req.query.et as string;

    if (!etStr) {
      res.status(400).json({ error: 'Missing et query parameter' });
      return;
    }

    const et = parseFloat(etStr);
    if (isNaN(et)) {
      res.status(400).json({ error: 'Invalid et value' });
      return;
    }

    const utc = sgp4.etToUTC(et);
    res.json({ utc });
  })
);

/**
 * GET /api/spice/sgp4/health
 * Health check endpoint
 */
app.get('/api/spice/sgp4/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', initialized: !!sgp4 });
});

// =============================================================================
// OMM (Orbital Mean-Elements Message) Endpoints
// =============================================================================

/**
 * POST /api/spice/sgp4/omm/parse
 * Parse OMM JSON and return orbital elements
 *
 * Body: OMM JSON object
 * Returns: { epoch: number, elements: number[], tle: { line1, line2 } }
 */
app.post(
  '/api/spice/sgp4/omm/parse',
  asyncHandler(async (req: Request, res: Response) => {
    const omm = req.body as Partial<OMMData>;

    try {
      validateOMM(omm);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    // Convert OMM to TLE
    const tle = ommToTLE(omm as OMMData);

    // Parse the generated TLE
    const parsed = sgp4.parseTLE(tle.line1, tle.line2);

    res.json({
      epoch: parsed.epoch,
      elements: Array.from(parsed.elements),
      tle: {
        line1: tle.line1,
        line2: tle.line2,
      },
    });
  })
);

/**
 * POST /api/spice/sgp4/omm/to-tle
 * Convert OMM JSON to TLE format
 *
 * Body: OMM JSON object
 * Returns: { line1: string, line2: string, name?: string }
 */
app.post(
  '/api/spice/sgp4/omm/to-tle',
  asyncHandler(async (req: Request, res: Response) => {
    const omm = req.body as Partial<OMMData>;

    try {
      validateOMM(omm);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const tle = ommToTLE(omm as OMMData);
    res.json(tle);
  })
);

/**
 * POST /api/spice/sgp4/tle/to-omm
 * Convert TLE to OMM JSON format
 *
 * Body: { line1: string, line2: string, name?: string }
 * Returns: OMM JSON object
 */
app.post(
  '/api/spice/sgp4/tle/to-omm',
  asyncHandler(async (req: Request, res: Response) => {
    const { line1, line2, name } = req.body;

    if (!line1 || !line2) {
      res.status(400).json({ error: 'Missing line1 or line2' });
      return;
    }

    const omm = tleToOMM(line1, line2, name);
    res.json(omm);
  })
);

/**
 * GET /api/models/
 * List all available geophysical models
 */
app.get('/api/models/', (_req: Request, res: Response) => {
  res.json(getAllModels());
});

/**
 * GET /api/models/wgs/:name
 * Get details for a specific WGS model
 */
app.get('/api/models/wgs/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const model = getWgsModel(name);

  if (!model) {
    res.status(404).json({ error: `Model '${name}' not found` });
    return;
  }

  res.json(model);
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;

// Start server
initSGP4()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`=== SPICE SGP4 REST API Server ===`);
      console.log(`Serving on http://0.0.0.0:${PORT}`);
      console.log(``);
      console.log(`Git commit: ${GIT_HASH}`);
      console.log(`Server ID: ${SERVER_ID}`);
      console.log(``);
      console.log(`API Documentation: http://localhost:${PORT}/api/docs`);
      console.log(`OpenAPI Spec:      http://localhost:${PORT}/api/openapi.json`);
      console.log(``);
      console.log(`Endpoints:`);
      console.log(`  POST /api/spice/sgp4/parse       - Parse TLE`);
      console.log(`  POST /api/spice/sgp4/propagate   - Propagate TLE/OMM (input_type=tle|omm)`);
      console.log(`  POST /api/spice/sgp4/omm/parse   - Parse OMM JSON`);
      console.log(`  POST /api/spice/sgp4/omm/to-tle  - Convert OMM to TLE`);
      console.log(`  POST /api/spice/sgp4/tle/to-omm  - Convert TLE to OMM`);
      console.log(`  GET  /api/spice/sgp4/time/utc-to-et - Convert UTC to ET`);
      console.log(`  GET  /api/spice/sgp4/time/et-to-utc - Convert ET to UTC`);
      console.log(`  GET  /api/spice/sgp4/health      - Health check`);
      console.log(`  GET  /api/models/                - List models`);
      console.log(`  GET  /api/models/wgs/:name       - Get WGS model details`);
      console.log(``);
      console.log(`Press Ctrl+C to stop the server`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize SGP4:', err);
    process.exit(1);
  });

export default app;
