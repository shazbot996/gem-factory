import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import pool from './db/pool.js';
import migrate from './db/migrate.js';
import authMiddleware from './middleware/auth.js';
import gemsRouter from './routes/gems.js';
import usersRouter from './routes/users.js';
import statsRouter from './routes/stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 9090;

app.use(express.json({ limit: '1mb' }));

// CORS — allow extension and local SPA origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = ['http://localhost:3000', 'http://localhost:5173'];
  // Chrome extension origins look like chrome-extension://<id>
  if (allowed.includes(origin) || (origin && origin.startsWith('chrome-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dev-User-Email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Health check — no auth required
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Auth middleware for all other /api routes
app.use('/api', authMiddleware);

// Routes
app.use('/api/gems', gemsRouter);
app.use('/api/users', usersRouter);
app.use('/api/stats', statsRouter);

// Serve SPA static files (only if the public directory exists)
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback — all non-API routes return index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  // API-only mode — no frontend build present
  app.get('/', (req, res) => res.json({ service: 'gem-factory', status: 'ok' }));
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup
async function start() {
  try {
    await migrate(pool);
    console.log('Migrations complete');
  } catch (err) {
    console.error('Startup failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Gem Factory API listening on port ${PORT}`);
  });
}

start();
