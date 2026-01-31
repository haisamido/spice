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
 * Propagate TLE to a specific time
 *
 * Query: ?model=wgs84 (optional, default: wgs72)
 * Body: { line1: string, line2: string, time: string | number, model?: string }
 *   time can be:
 *   - UTC string (e.g., "2024-01-15T12:00:00")
 *   - Ephemeris time (number)
 *   - Minutes from epoch (if minutes_from_epoch: true)
 *
 * Returns: { position: {x,y,z}, velocity: {vx,vy,vz}, epoch: number, model: string }
 */
app.post(
  '/api/spice/sgp4/propagate',
  asyncHandler(async (req: Request, res: Response) => {
    const { line1, line2, time, minutes_from_epoch, model: bodyModel } = req.body;
    const queryModel = req.query.model as string | undefined;

    if (!line1 || !line2) {
      res.status(400).json({ error: 'Missing line1 or line2' });
      return;
    }

    // Model selection: query param > body param > default
    const modelName = queryModel || bodyModel || DEFAULT_MODEL;
    const constants = getWgsConstants(modelName);

    if (!constants) {
      res.status(400).json({ error: `Unknown model: ${modelName}` });
      return;
    }

    // Set geophysical constants for this propagation
    sgp4.setGeophysicalConstants(constants, modelName);

    const tle = sgp4.parseTLE(line1, line2);
    let state;

    if (minutes_from_epoch && typeof time === 'number') {
      // Propagate minutes from TLE epoch
      state = sgp4.propagateMinutes(tle, time);
    } else if (typeof time === 'string') {
      // Convert UTC to ET and propagate
      const et = sgp4.utcToET(time);
      state = sgp4.propagate(tle, et);
    } else if (typeof time === 'number') {
      // Use ET directly
      state = sgp4.propagate(tle, time);
    } else {
      // Default: propagate to TLE epoch
      state = sgp4.propagate(tle, tle.epoch);
    }

    res.json({
      position: state.position,
      velocity: state.velocity,
      epoch: tle.epoch,
      model: modelName,
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
      console.log(`  POST /api/spice/sgp4/parse      - Parse TLE`);
      console.log(`  POST /api/spice/sgp4/propagate  - Propagate TLE`);
      console.log(`  GET  /api/spice/sgp4/time/utc-to-et - Convert UTC to ET`);
      console.log(`  GET  /api/spice/sgp4/time/et-to-utc - Convert ET to UTC`);
      console.log(`  GET  /api/spice/sgp4/health     - Health check`);
      console.log(`  GET  /api/models/               - List models`);
      console.log(`  GET  /api/models/wgs/:name      - Get WGS model details`);
      console.log(``);
      console.log(`Press Ctrl+C to stop the server`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize SGP4:', err);
    process.exit(1);
  });

export default app;
